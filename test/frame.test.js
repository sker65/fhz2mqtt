import test from 'node:test';
import assert from 'node:assert/strict';
import {FrameDecoder, crc, encodeFrame} from '../lib/frame.js';

test('encodeFrame adds start, length and checksum', () => {
    // FHEM: set FHZ time → 81 0a c9 <crc> 020161...
    const f = encodeFrame('04', 'c90185');
    assert.equal(f.toString('hex'), '810504' + crc([0xc9, 0x01, 0x85]).toString(16) + 'c90185');
    assert.throws(() => encodeFrame('4', 'c9'));
    assert.throws(() => encodeFrame('04', 'c9x'));
});

test('FrameDecoder splits frames across chunks and skips noise', () => {
    const bad = [];
    const d = new FrameDecoder({onBad: (why) => bad.push(why)});
    const a = encodeFrame('04', '0909a001123444006900');
    const b = encodeFrame('04', '83098301123441002a');
    const stream = Buffer.concat([Buffer.from([0x00, 0x13]), a, b]);
    assert.deepEqual(d.push(stream.subarray(0, 7)), []);
    assert.deepEqual(d.push(stream.subarray(7)), [a.toString('hex'), b.toString('hex')]);
    assert.deepEqual(bad, ['skipping to start byte']);
});

test('FrameDecoder drops frames with a wrong checksum', () => {
    const d = new FrameDecoder();
    const a = encodeFrame('04', '0909a001123444006900');
    a[3] ^= 0xff;
    const b = encodeFrame('04', 'c90185');
    assert.deepEqual(d.push(Buffer.concat([a, b])), [b.toString('hex')]);
});
