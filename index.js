#!/usr/bin/env node

import {SerialPort} from 'serialport';
import {createAdapter, createLogger, runDiscovery, autoAddress} from 'mqtt-interfaces-core';
import config from './config.js';
import pkg from './package.json' with {type: 'json'};
import {FrameDecoder, encodeFrame} from './lib/frame.js';
import {FHTBUF, WRITE_GAP_MS, initSequence, parseFhzAnswer} from './lib/fhz.js';
import {FhtQueue} from './lib/fht-queue.js';
import {FhtDecoder, fhtCommand, parseFhtFrame} from './lib/fht.js';
import {discoveryModel} from './lib/hadiscovery.js';
import {handle as handleInstall} from './lib/install.js';
import {discoveryHint} from './lib/discovery.js';

// --discover / --serialport auto, before the installer so --install persists the by-id path
if (config.discover || config.serialport === 'auto') {
    const discoveryLog = createLogger({envPrefix: config.$envPrefix || 'FHZ2MQTT', level: config.verbosity});
    const hint = discoveryHint();
    if (config.discover) {
        await runDiscovery({hint, config, log: discoveryLog}); // prints and exits
    }
    try {
        config.serialport = await autoAddress(hint, {config, log: discoveryLog});
    } catch (err) {
        discoveryLog.error('--serialport auto:', err.message);
        process.exit(1);
    }
}

handleInstall(config);

const RECONNECT_MS = 10000;
const DISCOVERY_DELAY_MS = 2000;
const QUEUE_CHECK_MS = 30000; // FHEM's softbuffer timer
const FHTBUF_TIMEOUT_MS = 2000;

const retries = Number(config.fhtRetries);
const retryAfter = Number(config.fhtRetryAfter);
if (!Number.isInteger(retries) || retries < 0 || retries > 5) {
    console.error('--fht-retries must be 0 ... 5');
    process.exit(1);
}
if (!Number.isFinite(retryAfter) || retryAfter < 120) {
    console.error('--fht-retry-after must be at least 120 seconds (the FHT listens about every 2 minutes)');
    process.exit(1);
}

const only = config.only
    ? new Set(
          String(config.only)
              .split(',')
              .map((a) => a.trim().toLowerCase())
              .filter(Boolean),
      )
    : null;
const handled = (address) => !only || only.has(address);

/** FHT addresses heard (or restored from retained status) → discovery */
const seen = new Set(only || []);
let discoveryTimer = null;

const adapter = createAdapter({
    pkg,
    config,
    deviceLabel: 'fhz',
    info: {fhz: config.serialport},
    discovery: () =>
        discoveryModel({name: config.name, adapter: pkg.name, addresses: seen, jsonPayloads: config.jsonPayloads}),
    subscriptions: {
        // retained status from an earlier run keeps the thermostats announced after a restart
        'status/fht/+/+': ([address]) => addSeen(address),
    },
    onSet: handleSet,
    onShutdown: () => {
        stopped = true;
        clearTimeout(reconnectTimer);
        clearInterval(queueTimer);
        if (port?.isOpen) {
            return new Promise((resolve) => port.close(() => resolve()));
        }
    },
});
const {log, pubStatus} = adapter;

function addSeen(address) {
    if (!handled(address) || seen.has(address)) {
        return;
    }
    seen.add(address);
    clearTimeout(discoveryTimer);
    discoveryTimer = setTimeout(() => {
        adapter.markDiscoveryDirty();
        adapter.publishDiscovery();
    }, DISCOVERY_DELAY_MS);
}

async function handleSet(parts, value) {
    if (parts[0] !== 'fht' || parts.length !== 3) {
        throw new Error('unknown item ' + parts.join('/'));
    }
    const address = parts[1].toLowerCase();
    if (!handled(address)) {
        throw new Error(`fht ${address} is not in --only`);
    }
    const [, data] = fhtCommand(address, parts[2], value);
    const label = `${parts[2]}${value === '' || value === undefined ? '' : ' ' + value}`;
    const replaced = fhtQueue.add(address, data, label);
    if (replaced) {
        log.info(`fht ${address} ${label} replaces pending ${replaced.label}`);
    }
    pump();
}

/*
 * FHT commands go through a queue (FHEM's fhtsoftbuffer): only as much as fits into the FHZ's
 * free FHT buffer goes out, unconfirmed commands are resent up to --fht-retries times.
 */
const fhtQueue = new FhtQueue({retries, retryAfterMs: retryAfter * 1000});
const queueTimer = setInterval(() => pump(), QUEUE_CHECK_MS);
let pumping = false;
let bufferWaiter = null;

function readFhtBuffer() {
    return new Promise((resolve) => {
        const timer = setTimeout(() => {
            bufferWaiter = null;
            resolve(null);
        }, FHTBUF_TIMEOUT_MS);
        bufferWaiter = (free) => {
            clearTimeout(timer);
            bufferWaiter = null;
            resolve(free);
        };
        send(...FHTBUF);
    });
}

async function pump() {
    if (pumping || !fhtQueue.length || !port?.isOpen) {
        return;
    }
    pumping = true;
    try {
        let free = Infinity;
        if (config.fhtBufferCheck && fhtQueue.hasDue(Date.now())) {
            free = await readFhtBuffer();
            if (free === null) {
                log.warn('fhz did not report its free FHT buffer, sending without the check');
                free = Infinity;
            } else {
                log.debug(`fhz FHT buffer ${free} bytes free, ${fhtQueue.length} queued`);
            }
        }
        const {send: due, expired} = fhtQueue.take(free, Date.now());
        for (const e of expired) {
            log.warn(`fht ${e.address} ${e.label}: no confirmation after ${e.sends} sends, giving up`);
        }
        for (const e of due) {
            log.info(`fht ${e.address} ${e.label}${e.sends > 1 ? ` (retry ${e.sends - 1})` : ''}`);
            send('04', e.data);
        }
        if (fhtQueue.hasDue(Date.now())) {
            log.info(`fhz FHT buffer full, ${fhtQueue.length} command(s) waiting`);
        }
    } finally {
        pumping = false;
    }
}

/*
 * Serial port and write queue. The FHZ discards frames that follow each other closer than
 * 250 ms; it queues FHT commands itself until the thermostat's receive window.
 */
let port = null;
let stopped = false;
let reconnectTimer = null;
const queue = [];
let writing = false;
const frames = new FrameDecoder({onBad: (why, hex) => log.debug(`fhz < ${why}: ${hex}`)});
const fht = new FhtDecoder();

function send(fn, data) {
    queue.push(encodeFrame(fn, data));
    drain();
}

function drain() {
    if (writing || !queue.length || !port?.isOpen) {
        return;
    }
    writing = true;
    const frame = queue.shift();
    log.debug('fhz >', frame.toString('hex'));
    port.write(frame, (err) => err && log.warn('fhz write:', err.message));
    setTimeout(() => {
        writing = false;
        drain();
    }, WRITE_GAP_MS);
}

function onFrame(frame) {
    log.debug('fhz <', frame);
    const answer = parseFhzAnswer(frame);
    if (answer) {
        log.debug('fhz answer', JSON.stringify(answer));
        if (answer.fhtbuf !== undefined && bufferWaiter) {
            bufferWaiter(answer.fhtbuf);
        }
        return;
    }
    const msg = parseFhtFrame(frame);
    if (!msg) {
        return; // FS20, HMS, ... are not ours
    }
    if (!handled(msg.address)) {
        return;
    }
    addSeen(msg.address);
    if (msg.confirm) {
        for (const e of fhtQueue.confirm(msg.address, msg.cmdRaw, msg.value)) {
            log.debug(`fht ${e.address} ${e.label} confirmed`);
        }
    }
    for (const {field, val, retain} of fht.decode(msg)) {
        pubStatus(`fht/${msg.address}/${field}`, val, retain === false ? {retain: false} : {});
    }
}

function scheduleReconnect() {
    if (stopped || reconnectTimer) {
        return;
    }
    reconnectTimer = setTimeout(() => {
        reconnectTimer = null;
        open();
    }, RECONNECT_MS);
}

function open() {
    port = new SerialPort({path: config.serialport, baudRate: 9600, autoOpen: false});
    port.on('data', (chunk) => frames.push(chunk).forEach(onFrame));
    port.on('close', () => {
        log.warn('fhz closed', config.serialport);
        adapter.setDeviceConnected(false);
        queue.length = 0;
        fhtQueue.resetSent(); // the FHZ may have lost its buffer: send pending commands again
        scheduleReconnect();
    });
    port.on('error', (err) => log.warn('fhz error:', err.message));
    port.open((err) => {
        if (err) {
            log.warn('fhz open:', err.message);
            adapter.setDeviceConnected(false);
            scheduleReconnect();
            return;
        }
        log.info('fhz opened', config.serialport);
        adapter.setDeviceConnected(true);
        for (const [fn, data] of initSequence({fhtCode: config.fhtCode})) {
            send(fn, data);
        }
        pump();
    });
}

adapter.start();
open();
