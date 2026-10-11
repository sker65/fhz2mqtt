#!/usr/bin/env node

import {SerialPort} from 'serialport';
import {createAdapter, createLogger, runDiscovery, autoAddress} from 'mqtt-interfaces-core';
import config from './config.js';
import pkg from './package.json' with {type: 'json'};
import {FrameDecoder, encodeFrame} from './lib/frame.js';
import {WRITE_GAP_MS, initSequence, parseFhzAnswer} from './lib/fhz.js';
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
    const [fn, data] = fhtCommand(address, parts[2], value);
    log.info(`fht ${address} ${parts[2]}${value === '' || value === undefined ? '' : ' ' + value}`);
    send(fn, data);
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
    });
}

adapter.start();
open();
