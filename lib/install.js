/**
 * --install / --uninstall: systemd template service fhz2mqtt@<name> (mqtt-interfaces-core
 * installer). The service user joins `dialout` for the serial port.
 */

import {createInstaller} from 'mqtt-interfaces-core';

export const SERVICE = 'fhz2mqtt';
export const ENV_PREFIX = 'FHZ2MQTT';

const installer = createInstaller({
    service: SERVICE,
    envPrefix: ENV_PREFIX,
    description: `${SERVICE} %i - ELV FHZ1300 PC to MQTT bridge`,
    documentation: 'https://github.com/sker65/fhz2mqtt',
    serviceExtra: ['SupplementaryGroups=dialout'],
});

export const {unitFile, envFile, installService, uninstallService, handle} = installer;
