import test from 'node:test';
import assert from 'node:assert/strict';
import {encodeFrame} from '../lib/frame.js';
import {FhtDecoder, actuatorState, fhtCommand, parseFhtFrame} from '../lib/fht.js';

const frame = (data) => encodeFrame('04', data).toString('hex');

test('parseFhtFrame reads thermostat messages', () => {
    assert.deepEqual(parseFhtFrame(frame('0909a001' + '4b2c' + '41' + '00' + '69' + '2a')), {
        address: '4b2c',
        cmdRaw: '41',
        cmd: 'desired-temp',
        status: '69',
        value: 0x2a,
        confirm: false,
        fromFhz: false,
    });
});

test('parseFhtFrame takes the value of a confirmation one byte earlier', () => {
    const msg = parseFhtFrame(frame('83098301' + '1111' + '41' + '30' + '1d'));
    assert.equal(msg.value, 0x30);
    assert.equal(msg.confirm, true);
});

test('parseFhtFrame ignores short and non-FHT messages', () => {
    assert.equal(parseFhtFrame(frame('c409c401' + '1111' + '00')), null);
    assert.equal(parseFhtFrame(frame('0101a001' + '123400' + '00' + '11')), null);
});

test('FhtDecoder combines measured low and high byte', () => {
    const d = new FhtDecoder();
    const m = (cmd, val) => parseFhtFrame(frame('0909a001' + '1234' + cmd + '00' + '69' + val));
    assert.deepEqual(d.decode(m('43', '00')), []); // high without low
    assert.deepEqual(d.decode(m('42', 'd7')), []);
    assert.deepEqual(d.decode(m('43', '00')), [{field: 'measured_temp', val: 21.5}]);
});

test('FhtDecoder maps temperatures, mode, warnings and actuator', () => {
    const d = new FhtDecoder();
    const m = (cmd, status, val) => parseFhtFrame(frame('0909a001' + '1234' + cmd + '00' + status + val));
    assert.deepEqual(d.decode(m('41', '69', '29')), [{field: 'desired_temp', val: 20.5}]);
    assert.deepEqual(d.decode(m('8a', '69', '1c')), [{field: 'windowopen_temp', val: 14}]);
    assert.deepEqual(d.decode(m('3e', '69', '01')), [{field: 'mode', val: 'MANU'}]);
    assert.deepEqual(d.decode(m('44', '69', '21')), [
        {field: 'battery_low', val: true},
        {field: 'low_temp', val: false},
        {field: 'window_sensor_fault', val: false},
        {field: 'window_open', val: true},
    ]);
    assert.deepEqual(d.decode(m('00', 'a6', '80')), [{field: 'actuator', val: 50}]);
    assert.deepEqual(d.decode(m('00', '2a', '00')), [{field: 'actuator_state', val: 'lime-protection', retain: false}]);
    assert.deepEqual(d.decode(m('41', '79', '29')), [], 'echo of the FHZ own transmission');
});

test('actuatorState follows FHEM', () => {
    assert.deepEqual(actuatorState('a0', 255), {percent: 100});
    assert.deepEqual(actuatorState('20', 0), {state: 'syncnow'});
    assert.deepEqual(actuatorState('21', 0), {percent: 100});
    assert.deepEqual(actuatorState('2f', 0), {state: 'pair'});
});

test('fhtCommand builds FHZ send frames', () => {
    assert.deepEqual(fhtCommand('4B2C', 'desired-temp', '21.5'), ['04', '0201834b2c412b']);
    assert.deepEqual(fhtCommand('4b2c', 'desired-temp', 'off'), ['04', '0201834b2c410b']);
    assert.deepEqual(fhtCommand('4b2c', 'mode', 'auto'), ['04', '0201834b2c3e00']);
    assert.deepEqual(fhtCommand('4b2c', 'refresh'), ['04', '0201834b2c65ff66ff']);
    assert.deepEqual(fhtCommand('4b2c', 'sync-time', '', new Date(2026, 9, 11, 4, 2)), ['04', '0201834b2c63046402']);
    assert.throws(() => fhtCommand('4b2c', 'desired-temp', '21.3'));
    assert.throws(() => fhtCommand('4b2c', 'desired-temp', '31'));
    assert.throws(() => fhtCommand('5a3', 'mode', 'auto'));
    assert.throws(() => fhtCommand('4b2c', 'holiday1', '3'));
});
