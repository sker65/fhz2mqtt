/**
 * The FHZ connection: a local serial port, or a raw TCP socket for a serial-to-network converter
 * (Lantronix XPort, ser2net, ...) given as `tcp://host:port`. Both look like a SerialPort to
 * index.js: `isOpen`, `open(cb)`, `write(buf, cb)`, `close(cb)` and the events `data`, `close`
 * (only after a successful open) and `error`.
 */

import {EventEmitter} from 'node:events';
import net from 'node:net';

const CONNECT_TIMEOUT_MS = 10000;
const KEEPALIVE_MS = 30000; // notice a converter that went away without closing the connection

/** `tcp://host:port` → {host, port}; null for a serial device path; throws on a bad tcp address. */
export function parseTcpAddress(address) {
    if (!/^tcp:\/\//i.test(String(address))) {
        return null;
    }
    let url;
    try {
        url = new URL(address);
    } catch {
        throw new Error(`invalid address ${address}, expected tcp://host:port`);
    }
    const port = Number(url.port);
    if (!url.hostname || !Number.isInteger(port) || port < 1 || port > 65535 || url.pathname.length > 1) {
        throw new Error(`invalid address ${address}, expected tcp://host:port`);
    }
    return {host: url.hostname.replace(/^\[(.*)\]$/, '$1'), port};
}

/** Raw TCP connection with the SerialPort subset index.js uses. */
export class TcpPort extends EventEmitter {
    constructor({host, port}, {connectTimeout = CONNECT_TIMEOUT_MS} = {}) {
        super();
        this.host = host;
        this.port = port;
        this.connectTimeout = connectTimeout;
        this.socket = null;
        this.isOpen = false;
    }

    open(cb) {
        const socket = net.createConnection({host: this.host, port: this.port});
        this.socket = socket;
        let settled = false;
        const settle = (err) => {
            if (!settled) {
                settled = true;
                socket.setTimeout(0);
                cb?.(err ?? null);
            }
        };
        socket.setTimeout(this.connectTimeout, () => {
            socket.destroy(new Error(`connect to ${this.host}:${this.port} timed out`));
        });
        socket.once('connect', () => {
            socket.setNoDelay(true); // the FHZ frames are short; send each one right away
            socket.setKeepAlive(true, KEEPALIVE_MS);
            this.isOpen = true;
            settle();
        });
        socket.on('data', (chunk) => this.emit('data', chunk));
        socket.on('error', (err) => {
            if (settled) {
                this.emit('error', err);
            } else {
                settle(err);
            }
        });
        socket.on('close', () => {
            settle(new Error(`connection to ${this.host}:${this.port} closed`));
            if (this.isOpen) {
                this.isOpen = false;
                this.emit('close');
            }
        });
    }

    write(data, cb) {
        if (!this.isOpen) {
            cb?.(new Error('port is not open'));
            return false;
        }
        return this.socket.write(data, cb);
    }

    close(cb) {
        if (!this.socket || this.socket.destroyed) {
            cb?.();
            return;
        }
        this.socket.once('close', () => cb?.());
        this.socket.end();
        setTimeout(() => this.socket.destroy(), 1000).unref();
    }
}
