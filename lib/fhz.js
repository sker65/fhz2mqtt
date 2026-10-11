/**
 * FHZ1300 commands (fn + data hex), taken from FHEM's 00_FHZ.pm. The FHZ buffers FHT commands
 * itself and sends them in the thermostat's ~2 minute receive window, so the host only has to
 * keep 250 ms between frames.
 */

export const WRITE_GAP_MS = 250; // shorter gaps get dropped by the FHZ (3 x 65.6 ms + pauses)

export const INIT2 = ['c9', '02011f60'];
export const SERIAL = ['04', 'c90184570208'];
export const FHTBUF = ['04', 'c90185'];
export const INIT_HMS = ['04', 'c90186'];
export const INIT_FS20 = ['04', 'c90196'];
// FHEM's workaround: an FS20 "off" to 0101/00 after init, else the receiver stays quiet
export const ENABLE_RECEIVER = ['04', '01010100010000'];

function hex2(n) {
    return n.toString(16).padStart(2, '0');
}

/** Set the FHZ clock. */
export function timeCommand(date = new Date()) {
    return [
        'c9',
        '020161' +
            hex2(date.getFullYear() % 100) +
            hex2(date.getMonth() + 1) +
            hex2(date.getDate()) +
            hex2(date.getHours()) +
            hex2(date.getMinutes()),
    ];
}

/**
 * Set the central code ("Zentralencode") the FHTs pair with. The FHZ picks a random one and
 * keeps it; FHEM never sets it, so leaving it alone keeps existing pairings.
 *
 * @param {string} code 2 hex digits, as FHEM's `set <fhz> FHTcode`
 */
export function fhtCodeCommand(code) {
    if (!/^[0-9a-f]{2}$/i.test(String(code))) {
        throw new Error('--fht-code must be 2 hex digits');
    }
    return ['04', 'c901839e0101' + String(code).toLowerCase()];
}

/** The init sequence FHEM runs after opening the port (FHZ_DoInit). */
export function initSequence({fhtCode, date} = {}) {
    return [
        INIT2,
        SERIAL,
        INIT_HMS,
        INIT_FS20,
        timeCommand(date),
        ...(fhtCode ? [fhtCodeCommand(fhtCode)] : []),
        ENABLE_RECEIVER,
    ];
}

/** Answers to FHZ register reads (init2, serial, free FHT buffer); null for radio messages. */
export function parseFhzAnswer(frame) {
    if (!/^81..c9..0102/.test(frame)) {
        return null;
    }
    if (/^81..c9..01028501/.test(frame)) {
        return {fhtbuf: Number.parseInt(frame.slice(16, 18), 16)};
    }
    return {answer: frame.slice(12)};
}
