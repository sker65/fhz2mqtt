import {parseConfig} from 'mqtt-interfaces-core';
import pkg from './package.json' with {type: 'json'};
import {discoveryHint} from './lib/discovery.js';

export const OPTIONS = {
    serialport: {
        alias: 's',
        type: 'string',
        describe: 'serial port of the FHZ1000 PC / FHZ1300 PC, or "auto" to find it (see --discover)',
        default: '/dev/ttyUSB0',
        discover: true,
    },
    'fht-code': {
        type: 'string',
        describe: 'central code (2 hex digits) written to the FHZ on connect; unset keeps the paired one',
    },
    only: {
        type: 'string',
        describe: 'handle only these FHT addresses, e.g. "1a2b,3c4d" (others are neither published nor sent to)',
    },
};

export default parseConfig({
    pkg,
    options: OPTIONS,
    defaults: {name: 'fhz'},
    discovery: discoveryHint(),
    examples: [
        ['$0 --discover', 'list the FHZ sticks plugged into this host and exit'],
        ['$0 -s /dev/ttyUSB0 -u mqtt://broker', 'run in the foreground'],
        ['sudo $0 --install -n fhz -s auto -u mqtt://broker', 'install as service fhz2mqtt@fhz'],
    ],
});
