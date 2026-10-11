/**
 * FHT command queue in front of the FHZ (FHEM's `fhtsoftbuffer`, 11_FHT.pm doSoftBuffer).
 *
 * The FHZ keeps FHT commands in a small buffer (FHZ1300: 74 bytes, FHZ1000: 42) until each
 * thermostat opens its receive window, about every two minutes. When the buffer is full it drops
 * new commands without telling anyone. A message takes 3 + 2 x (number of FHT commands) bytes.
 *
 * The queue hands out only what fits into the free space the FHZ reported, keeps the rest, and
 * resends a command the thermostat did not confirm (`83098301 <addr> <cmd> <val>`) after
 * `retryAfterMs`, at most `retries` times. Pure: time and buffer space come from the caller.
 */

/** Bytes a send frame (fn 04, data 020183 <addr> <cmd val>...) takes in the FHZ buffer. */
export function bufferBytes(data) {
    const pairs = (data.length - 10) / 4;
    return 3 + 2 * pairs;
}

/** [[cmd, val], ...] of a send frame's data hex. */
export function commandPairs(data) {
    const pairs = [];
    for (let i = 10; i + 4 <= data.length; i += 4) {
        pairs.push([data.slice(i, i + 2), data.slice(i + 2, i + 4)]);
    }
    return pairs;
}

export class FhtQueue {
    /**
     * @param {object} o
     * @param {number} [o.retries] resends of an unconfirmed command (0 = never)
     * @param {number} [o.retryAfterMs] wait for the confirmation this long before resending
     */
    constructor({retries = 2, retryAfterMs = 240000} = {}) {
        this.retries = retries;
        this.retryAfterMs = retryAfterMs;
        this.entries = [];
    }

    get length() {
        return this.entries.length;
    }

    /**
     * Queue a command. A pending command for the same thermostat with the same FHT command codes
     * (a newer desired-temp, mode, ...) replaces the older one instead of queueing behind it.
     *
     * @param {string} address FHT address, 4 hex digits
     * @param {string} data send frame data hex from fhtCommand()
     * @param {string} label for log lines ("desired-temp 21")
     * @returns {object|null} the replaced entry, if any
     */
    add(address, data, label) {
        const codes = commandPairs(data)
            .map(([c]) => c)
            .join();
        const entry = {address, data, label, codes, bytes: bufferBytes(data), sends: 0, sentAt: 0};
        const i = this.entries.findIndex((e) => e.address === address && e.codes === codes);
        if (i === -1) {
            this.entries.push(entry);
            return null;
        }
        const replaced = this.entries[i];
        this.entries[i] = entry;
        return replaced;
    }

    /** True if something is waiting to be sent now (new, or due for a retry). */
    hasDue(now) {
        return this.entries.some((e) => this.#due(e, now));
    }

    #due(e, now) {
        return e.sends === 0 || (now - e.sentAt >= this.retryAfterMs && e.sends <= this.retries);
    }

    /**
     * Take what to send now, oldest first, as far as it fits into `freeBytes`. Commands that used
     * up their retries without a confirmation are removed and returned as `expired`.
     *
     * @param {number} freeBytes free FHT buffer reported by the FHZ (Infinity: do not check)
     * @param {number} now ms
     * @returns {{send: object[], expired: object[]}}
     */
    take(freeBytes, now) {
        const expired = this.entries.filter(
            (e) => e.sends > 0 && now - e.sentAt >= this.retryAfterMs && e.sends > this.retries,
        );
        this.entries = this.entries.filter((e) => !expired.includes(e));
        const send = [];
        let free = freeBytes;
        for (const e of this.entries) {
            if (!this.#due(e, now)) {
                continue;
            }
            if (e.bytes > free) {
                break; // keep the order: nothing jumps the queue
            }
            free -= e.bytes;
            e.sends++;
            e.sentAt = now;
            send.push(e);
        }
        return {send, expired};
    }

    /**
     * The thermostat confirmed a command: any of the entry's command codes with its value means
     * the whole transmission arrived.
     *
     * @returns {object[]} the confirmed entries (removed from the queue)
     */
    confirm(address, cmd, value) {
        const val = value.toString(16).padStart(2, '0');
        const done = this.entries.filter(
            (e) =>
                e.address === address && e.sends > 0 && commandPairs(e.data).some(([c, v]) => c === cmd && v === val),
        );
        this.entries = this.entries.filter((e) => !done.includes(e));
        return done;
    }

    /** Forget the send state after the FHZ was reconnected: everything goes out again. */
    resetSent() {
        for (const e of this.entries) {
            e.sends = 0;
            e.sentAt = 0;
        }
    }
}
