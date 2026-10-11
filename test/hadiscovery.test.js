import test from 'node:test';
import assert from 'node:assert/strict';
import {discoveryModel} from '../lib/hadiscovery.js';

test('discoveryModel announces the bridge and one device per FHT', () => {
    const blocks = discoveryModel({name: 'fhz', adapter: 'fhz2mqtt', addresses: new Set(['4b2c', '1234'])});
    assert.equal(blocks.length, 3);
    assert.equal(blocks[0].id, 'fhz2mqtt_fhz');
    const fht = blocks[1];
    assert.equal(fht.id, 'fhz2mqtt_fhz_fht_1234');
    assert.equal(fht.device.via_device, 'fhz2mqtt_fhz');
    const c = fht.components;
    assert.equal(c.climate.temp_cmd_t, 'fhz/set/fht/1234/desired-temp');
    assert.equal(c.climate.curr_temp_t, 'fhz/status/fht/1234/measured_temp');
    assert.equal(c.climate.curr_temp_tpl, '{{ value_json.val }}');
    assert.equal(c.sync_time.cmd_t, 'fhz/set/fht/1234/sync-time');
    assert.equal(c.sync_time.stat_t, undefined);
    assert.equal(c.window_open.dev_cla, 'window');
});

test('discoveryModel without JSON payloads', () => {
    const [, fht] = discoveryModel({name: 'fhz', adapter: 'fhz2mqtt', addresses: ['1234'], jsonPayloads: false});
    assert.equal(fht.components.climate.curr_temp_tpl, '{{ value }}');
    assert.equal(fht.components.battery_low.val_tpl, "{{ 'ON' if value == 'true' else 'OFF' }}");
});

test('FHT devices use the default bridge availability', () => {
    const [, fht] = discoveryModel({name: 'fhz', adapter: 'fhz2mqtt', addresses: ['1234']});
    assert.equal(fht.availability, undefined);
});

test('the bridge announces the free FHT buffer', () => {
    const [bridge] = discoveryModel({name: 'fhz', adapter: 'fhz2mqtt', addresses: []});
    assert.equal(bridge.components.fhtbuf.stat_t, 'fhz/status/fhtbuf');
});
