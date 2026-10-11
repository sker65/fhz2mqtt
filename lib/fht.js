/**
 * FHT80b messages as the FHZ reports them, and FHT commands for the FHZ to send (FHEM's
 * 11_FHT.pm). A received FHT frame:
 *
 *   81 <len> <fn 04|09|0d> <crc> <0909a001|83098301|c409c401> <addr 2 bytes> <cmd> <x> <status> <val>
 *
 * `0909a001` is the thermostat talking, `83098301` a confirmation that carries the value one byte
 * earlier, `c409c401` a short message without value. Addresses are the FHT code in hex, as FHEM
 * shows it (`4b2c`), lower case.
 */

const FHT_FRAME = /^81..(04|09|0d)..(0909a001|83098301|c409c401)/;

const CODES = {
    '00': 'actuator',
    '3e': 'mode',
    41: 'desired-temp',
    42: 'measured-low',
    43: 'measured-high',
    44: 'warnings',
    60: 'year',
    61: 'month',
    62: 'day',
    63: 'hour',
    64: 'minute',
    65: 'report1',
    66: 'report2',
    82: 'day-temp',
    84: 'night-temp',
    85: 'lowtemp-offset',
    '8a': 'windowopen-temp',
};

const MODES = ['AUTO', 'MANU', 'HOLIDAY', 'HOLIDAY_SHORT'];

/** Fields published as status items, by FHT command name. */
const TEMPERATURES = new Set(['desired-temp', 'day-temp', 'night-temp', 'windowopen-temp']);

/**
 * Split an FHZ frame into the FHT parts, or null if it is not an FHT message.
 *
 * @param {string} frame lower-case hex from FrameDecoder
 */
export function parseFhtFrame(frame) {
    const m = FHT_FRAME.exec(frame);
    if (!m || frame.length < 26) {
        return null; // not FHT, or a short message without value
    }
    const address = frame.slice(16, 20);
    const cmdRaw = frame.slice(20, 22);
    const status = frame.slice(24, 26);
    let valRaw = frame.length > 26 ? frame.slice(26, 28) : null;
    let confirm = false;
    if (valRaw === null || cmdRaw === '65' || cmdRaw === '66') {
        valRaw = frame.slice(22, 24);
        confirm = true;
    }
    return {
        address,
        cmdRaw,
        cmd: CODES[cmdRaw] || null,
        status,
        value: Number.parseInt(valRaw, 16),
        confirm,
        // status high nibble 7: the FHZ's own transmission echoed back (FHEM: reading FHZ_<cmd>)
        fromFhz: !confirm && status[0] === '7',
    };
}

/** Valve position or state from the actuator status byte (FHT_Parse in FHEM). */
export function actuatorState(status, value) {
    const hi = Number.parseInt(status[0], 16);
    const lo = Number.parseInt(status[1], 16);
    const percent = Math.round((100 * value) / 255);
    switch (lo) {
        case 0x0:
            return hi === 0xa || hi === 0xb ? {percent} : {state: 'syncnow'};
        case 0x1:
            return {percent: 100}; // FHT set to "on" (30.5)
        case 0x2:
            return {percent: 0}; // FHT set to "off" (5.5)
        case 0x6:
            return {percent};
        case 0x8:
            return {state: 'offset'};
        case 0xa:
            return hi === 0xa || hi === 0xb ? {percent} : {state: 'lime-protection'};
        case 0xc:
            return {state: 'synctime'};
        case 0xe:
            return {state: 'test'};
        case 0xf:
            return {state: 'pair'};
        default:
            return {state: `unknown_${status}`};
    }
}

/**
 * Turns FHT frames into status items. Keeps the measured-temperature low byte until the high byte
 * arrives.
 */
export class FhtDecoder {
    constructor() {
        this.low = new Map();
    }

    /**
     * @param {ReturnType<typeof parseFhtFrame>} msg
     * @returns {{field: string, val: *, retain?: boolean}[]}
     */
    decode(msg) {
        if (!msg || msg.fromFhz || !msg.cmd) {
            return [];
        }
        const {cmd, value} = msg;
        if (cmd === 'measured-low') {
            this.low.set(msg.address, value);
            return [];
        }
        if (cmd === 'measured-high') {
            if (!this.low.has(msg.address)) {
                return [];
            }
            const low = this.low.get(msg.address);
            this.low.delete(msg.address);
            return [{field: 'measured_temp', val: Math.round(value * 256 + low) / 10}];
        }
        if (TEMPERATURES.has(cmd)) {
            return [{field: cmd.replace('-', '_'), val: value / 2}];
        }
        if (cmd === 'lowtemp-offset') {
            return [{field: 'lowtemp_offset', val: value}];
        }
        if (cmd === 'mode') {
            return [{field: 'mode', val: MODES[value] || `UNKNOWN_${value}`}];
        }
        if (cmd === 'actuator') {
            const a = actuatorState(msg.status, value);
            return a.percent === undefined
                ? [{field: 'actuator_state', val: a.state, retain: false}]
                : [{field: 'actuator', val: a.percent}];
        }
        if (cmd === 'warnings') {
            return [
                {field: 'battery_low', val: Boolean(value & 1)},
                {field: 'low_temp', val: Boolean(value & 2)},
                {field: 'window_sensor_fault', val: Boolean(value & 16)},
                {field: 'window_open', val: Boolean(value & 32)},
            ];
        }
        return []; // clock bytes, report/ack/can-xmit chatter
    }
}

function address(value) {
    const a = String(value).trim().toLowerCase();
    if (!/^[0-9a-f]{4}$/.test(a)) {
        throw new Error(`fht: address "${value}" must be 4 hex digits`);
    }
    return a;
}

function hex2(n) {
    return n.toString(16).padStart(2, '0');
}

function temperature(value) {
    const v = String(value).trim().toLowerCase();
    const n = v === 'on' ? 30.5 : v === 'off' ? 5.5 : Number(v);
    if (!Number.isFinite(n) || n < 5.5 || n > 30.5 || Math.round(n * 2) !== n * 2) {
        throw new Error('fht: temperature must be 5.5 ... 30.5 in 0.5 steps, on or off');
    }
    return hex2(n * 2);
}

function mode(value) {
    const v = String(value).trim().toUpperCase();
    if (v === 'AUTO') {
        return '00';
    }
    if (v === 'MANU' || v === 'MANUAL' || v === 'HEAT') {
        return '01';
    }
    throw new Error('fht: mode must be AUTO or MANU');
}

const SETTERS = {
    'desired-temp': (v) => [['41', temperature(v)]],
    'day-temp': (v) => [['82', temperature(v)]],
    'night-temp': (v) => [['84', temperature(v)]],
    'windowopen-temp': (v) => [['8a', temperature(v)]],
    mode: (v) => [['3e', mode(v)]],
    // like FHEM's `set <fht> time`: hour and minute in one transmission (date stays)
    'sync-time': (_v, now = new Date()) => [
        ['63', hex2(now.getHours())],
        ['64', hex2(now.getMinutes())],
    ],
    // FHEM's refreshvalues: ask the FHT to send all its values
    refresh: () => [
        ['65', 'ff'],
        ['66', 'ff'],
    ],
};

export const COMMANDS = Object.keys(SETTERS);

/**
 * FHZ send frame (fn 04) for an FHT command.
 *
 * @returns {[string, string]} fn and data hex for encodeFrame()
 */
export function fhtCommand(device, command, value, now = new Date()) {
    const setter = SETTERS[String(command).trim().toLowerCase()];
    if (!setter) {
        throw new Error(`fht: unknown command "${command}" (${COMMANDS.join(', ')})`);
    }
    const pairs = setter(value, now);
    return ['04', '020183' + address(device) + pairs.map(([c, v]) => c + v).join('')];
}
