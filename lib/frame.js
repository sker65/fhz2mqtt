/**
 * FHZ1000PC / FHZ1300PC serial framing (as FHEM's 00_FHZ.pm):
 *
 *   0x81 <len> <fn> <crc> <data...>
 *
 * `len` counts fn + crc + data, `crc` is the byte sum of data & 0xff. Messages longer than 20
 * bytes do not exist; anything that does not start with 0x81 is line noise.
 */

export const START = 0x81;
const MAX_LEN = 20;

export function crc(bytes) {
    let sum = 0;
    for (const b of bytes) {
        sum += b;
    }
    return sum & 0xff;
}

/**
 * Build a frame.
 *
 * @param {string} fn function byte, 2 hex digits ("04" = send, "c9" = FHZ register access)
 * @param {string} data payload as hex
 * @returns {Buffer}
 */
export function encodeFrame(fn, data) {
    if (!/^[0-9a-f]{2}$/i.test(fn) || !/^([0-9a-f]{2})*$/i.test(data)) {
        throw new Error('fhz frame: fn and data must be hex bytes');
    }
    const payload = Buffer.from(data, 'hex');
    return Buffer.from([START, payload.length + 2, Number.parseInt(fn, 16), crc(payload), ...payload]);
}

/** Split the serial byte stream into checked frames (lower-case hex strings). */
export class FrameDecoder {
    constructor({onBad} = {}) {
        this.buf = Buffer.alloc(0);
        this.onBad = onBad || (() => {});
    }

    /**
     * @param {Buffer} chunk bytes read from the port
     * @returns {string[]} complete frames with a valid checksum
     */
    push(chunk) {
        this.buf = Buffer.concat([this.buf, chunk]);
        const frames = [];
        while (this.buf.length > 2) {
            const start = this.buf.indexOf(START);
            if (start === -1) {
                this.onBad('no start byte', this.buf.toString('hex'));
                this.buf = Buffer.alloc(0);
                break;
            }
            if (start > 0) {
                this.onBad('skipping to start byte', this.buf.subarray(0, start).toString('hex'));
                this.buf = this.buf.subarray(start);
                continue;
            }
            const len = this.buf[1] + 2;
            if (len > MAX_LEN) {
                this.onBad('oversized message', this.buf.toString('hex'));
                this.buf = Buffer.alloc(0);
                break;
            }
            if (this.buf.length < len) {
                break;
            }
            const frame = this.buf.subarray(0, len);
            if (len >= 4 && frame[3] === crc(frame.subarray(4))) {
                if (frame[2] === START) {
                    // function 0x81: a second start byte, FHEM skips it
                    this.buf = this.buf.subarray(2);
                    continue;
                }
                frames.push(frame.toString('hex'));
                this.buf = this.buf.subarray(len);
            } else {
                this.onBad('bad checksum', frame.toString('hex'));
                this.buf = this.buf.subarray(2);
            }
        }
        return frames;
    }
}
