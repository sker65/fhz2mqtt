/**
 * Home Assistant device discovery: one device per FHT80b that has been heard, linked to the
 * bridge. Pure: seen addresses in, device blocks out.
 */

import {discoveryId, entity} from 'mqtt-interfaces-core';

const BOOL_TPL = {
    json: "{{ 'ON' if value_json.val else 'OFF' }}",
    plain: "{{ 'ON' if value == 'true' else 'OFF' }}",
};

function value(jsonPayloads, expr) {
    return jsonPayloads ? expr.replaceAll('VALUE', 'value_json.val') : expr.replaceAll('VALUE', 'value');
}

/**
 * @param {object} o
 * @param {string} o.name instance name / topic prefix
 * @param {string} o.adapter package name
 * @param {Iterable<string>} o.addresses FHT addresses seen so far
 * @param {boolean} [o.jsonPayloads]
 */
export function discoveryModel({name, adapter, addresses, jsonPayloads = true}) {
    const bridgeId = discoveryId(adapter, name);
    const blocks = [
        {
            id: bridgeId,
            device: {mf: 'ELV', mdl: 'FHZ1300 PC'},
            components: {
                connected: {
                    p: 'binary_sensor',
                    uniq_id: `${bridgeId}_connected`,
                    name: 'Connected',
                    stat_t: `${name}/connected`,
                    pl_on: '2',
                    pl_off: '1',
                    dev_cla: 'connectivity',
                    ent_cat: 'diagnostic',
                },
                fhtbuf: entity({
                    id: bridgeId,
                    name,
                    item: 'fhtbuf',
                    platform: 'sensor',
                    label: 'FHT buffer free',
                    category: 'diagnostic',
                    icon: 'mdi:tray-full',
                    jsonPayloads,
                    extra: {unit_of_meas: 'B', stat_cla: 'measurement'},
                }),
            },
            availabilityMin: 1,
        },
    ];

    for (const address of [...addresses].sort()) {
        const id = `${bridgeId}_fht_${address}`;
        const base = `fht/${address}`;
        const e = (item, platform, label, more = {}) =>
            entity({id, name, item: `${base}/${item}`, uid: item, platform, label, jsonPayloads, ...more});
        const bool = jsonPayloads ? BOOL_TPL.json : BOOL_TPL.plain;
        blocks.push({
            id,
            device: {name: `FHT ${address}`, mf: 'ELV', mdl: 'FHT80b', sn: address, via_device: bridgeId},
            components: {
                climate: {
                    p: 'climate',
                    uniq_id: `${id}_climate`,
                    name: null,
                    curr_temp_t: `${name}/status/${base}/measured_temp`,
                    curr_temp_tpl: value(jsonPayloads, '{{ VALUE }}'),
                    temp_stat_t: `${name}/status/${base}/desired_temp`,
                    temp_stat_tpl: value(jsonPayloads, '{{ VALUE }}'),
                    temp_cmd_t: `${name}/set/${base}/desired-temp`,
                    mode_stat_t: `${name}/status/${base}/mode`,
                    mode_stat_tpl: value(jsonPayloads, "{{ 'auto' if VALUE == 'AUTO' else 'heat' }}"),
                    mode_cmd_t: `${name}/set/${base}/mode`,
                    mode_cmd_tpl: "{{ 'AUTO' if value == 'auto' else 'MANU' }}",
                    act_t: `${name}/status/${base}/actuator`,
                    act_tpl: value(jsonPayloads, "{{ 'heating' if VALUE | float(0) > 0 else 'idle' }}"),
                    modes: ['auto', 'heat'],
                    temp_unit: 'C',
                    min_temp: 5.5,
                    max_temp: 30.5,
                    temp_step: 0.5,
                    precision: 0.1,
                },
                measured_temp: e('measured_temp', 'sensor', 'Temperature', {
                    extra: {dev_cla: 'temperature', unit_of_meas: '°C', stat_cla: 'measurement'},
                }),
                actuator: e('actuator', 'sensor', 'Valve', {
                    icon: 'mdi:valve',
                    extra: {unit_of_meas: '%', stat_cla: 'measurement'},
                }),
                battery_low: e('battery_low', 'binary_sensor', 'Battery', {
                    category: 'diagnostic',
                    extra: {dev_cla: 'battery', val_tpl: bool},
                }),
                window_open: e('window_open', 'binary_sensor', 'Window', {extra: {dev_cla: 'window', val_tpl: bool}}),
                windowopen_temp: e('windowopen_temp', 'sensor', 'Window open temperature', {
                    category: 'diagnostic',
                    extra: {dev_cla: 'temperature', unit_of_meas: '°C'},
                }),
                sync_time: e('sync-time', 'button', 'Sync time', {category: 'config', command: true}),
                refresh: e('refresh', 'button', 'Refresh values', {category: 'diagnostic', command: true}),
            },
        });
    }
    return blocks;
}
