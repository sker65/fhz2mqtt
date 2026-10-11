import test from 'node:test';
import assert from 'node:assert/strict';
import {fhtCodeCommand, initSequence, parseFhzAnswer, timeCommand} from '../lib/fhz.js';

test('timeCommand encodes yymmddhhmm as hex', () => {
    assert.deepEqual(timeCommand(new Date(2026, 9, 11, 14, 5)), ['c9', '020161' + '1a0a0b0e05']);
});

test('initSequence follows FHEM and writes the central code only when asked', () => {
    const plain = initSequence({date: new Date(2026, 0, 1)});
    assert.equal(plain.length, 6);
    assert.deepEqual(plain.at(-1), ['04', '01010100010000']);
    const withCode = initSequence({fhtCode: '4F', date: new Date(2026, 0, 1)});
    assert.deepEqual(withCode.at(-2), ['04', 'c901839e01014f']);
    assert.throws(() => fhtCodeCommand('123'));
});

test('parseFhzAnswer reads the free FHT buffer', () => {
    assert.deepEqual(parseFhzAnswer('8106c90001028501' + '17'), {fhtbuf: 23});
    assert.deepEqual(parseFhzAnswer('810cc9..01020102030405060708'), {answer: '0102030405060708'});
    assert.equal(parseFhzAnswer('810c04000909a001123444006900'), null);
});
