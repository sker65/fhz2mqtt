import test from 'node:test';
import assert from 'node:assert/strict';
import {FhtQueue, bufferBytes, commandPairs} from '../lib/fht-queue.js';
import {fhtCommand} from '../lib/fht.js';

const data = (cmd, value) => fhtCommand('1a2b', cmd, value)[1];

test('bufferBytes and commandPairs follow the FHZ message layout', () => {
    assert.equal(bufferBytes(data('desired-temp', 21)), 5);
    assert.equal(bufferBytes(data('refresh')), 7);
    assert.deepEqual(commandPairs(data('refresh')), [
        ['65', 'ff'],
        ['66', 'ff'],
    ]);
});

test('take hands out only what fits into the free buffer, in order', () => {
    const q = new FhtQueue();
    q.add('1a2b', data('desired-temp', 21), 'a');
    q.add('3c4d', data('refresh'), 'b');
    q.add('5e6f', data('desired-temp', 19), 'c');
    let r = q.take(10, 0);
    assert.deepEqual(
        r.send.map((e) => e.label),
        ['a'],
    );
    r = q.take(Infinity, 1000);
    assert.deepEqual(
        r.send.map((e) => e.label),
        ['b', 'c'],
    );
    assert.equal(q.length, 3, 'sent commands wait for their confirmation');
});

test('a newer command for the same thermostat replaces the pending one', () => {
    const q = new FhtQueue();
    q.add('1a2b', data('desired-temp', 21), 'old');
    const replaced = q.add('1a2b', data('desired-temp', 18), 'new');
    assert.equal(replaced.label, 'old');
    assert.equal(q.length, 1);
    q.add('1a2b', data('mode', 'auto'), 'mode');
    assert.equal(q.length, 2, 'other command codes queue separately');
});

test('confirm removes the command; one confirmed pair confirms the transmission', () => {
    const q = new FhtQueue();
    q.add('1a2b', data('desired-temp', 19), 'temp');
    q.add('1a2b', data('refresh'), 'refresh');
    q.take(Infinity, 0);
    assert.deepEqual(q.confirm('1a2b', '41', 0x20), [], 'other value');
    assert.equal(q.confirm('1a2b', '41', 0x26).length, 1);
    assert.equal(q.confirm('1a2b', '65', 0xff).length, 1);
    assert.equal(q.length, 0);
});

test('unconfirmed commands are resent at most `retries` times, then expire', () => {
    const q = new FhtQueue({retries: 1, retryAfterMs: 1000});
    q.add('1a2b', data('desired-temp', 19), 'temp');
    assert.equal(q.take(Infinity, 10).send.length, 1);
    q.heard('1a2b', 400);
    assert.equal(q.take(Infinity, 500).send.length, 0, 'not yet');
    assert.equal(q.take(Infinity, 1010).send[0].sends, 2, 'one retry');
    q.heard('1a2b', 1500);
    const r = q.take(Infinity, 2010);
    assert.equal(r.send.length, 0);
    assert.deepEqual(
        r.expired.map((e) => e.reason),
        ['unconfirmed'],
    );
    assert.equal(q.length, 0);
});

test('no resend while the thermostat is silent: the command may still sit in the FHZ buffer', () => {
    const q = new FhtQueue({retries: 2, retryAfterMs: 1000});
    q.add('1a2b', data('desired-temp', 19), 'temp');
    q.take(Infinity, 10);
    q.heard('1a2b', 5, 'heard before the send does not count');
    assert.equal(q.hasDue(2000), false);
    const r = q.take(Infinity, 2000);
    assert.equal(r.send.length, 0);
    assert.deepEqual(
        r.expired.map((e) => e.reason),
        ['silent'],
    );
});

test('retries 0 sends once and expires after the wait', () => {
    const q = new FhtQueue({retries: 0, retryAfterMs: 1000});
    q.add('1a2b', data('desired-temp', 19), 'temp');
    q.take(Infinity, 10);
    q.heard('1a2b', 100);
    assert.equal(q.hasDue(5000), false);
    assert.equal(q.take(Infinity, 5000).expired[0].reason, 'unconfirmed');
});

test('resetSent sends everything again after a reconnect', () => {
    const q = new FhtQueue();
    q.add('1a2b', data('desired-temp', 19), 'temp');
    q.take(Infinity, 0);
    q.resetSent();
    assert.equal(q.hasDue(1), true);
});

test('pending lasts from add until confirmation or expiry', () => {
    const q = new FhtQueue({retries: 0, retryAfterMs: 1000});
    assert.equal(q.pending('1a2b'), false);
    q.add('1a2b', data('desired-temp', 21), 'a');
    q.add('3c4d', data('desired-temp', 19), 'b');
    assert.equal(q.pending('1a2b'), true);
    q.take(Infinity, 0);
    assert.equal(q.pending('1a2b'), true);
    q.confirm('1a2b', '41', 42);
    assert.equal(q.pending('1a2b'), false);
    assert.equal(q.pending('3c4d'), true);
    q.take(Infinity, 2000);
    assert.equal(q.pending('3c4d'), false);
});
