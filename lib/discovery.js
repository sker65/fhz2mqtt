/**
 * Finding the FHZ on the USB bus (core B-2). The FHZ1300 PC has an FTDI chip that udev names
 * `usb-ELV_AG_ELV_FHZ_1300_PC_<serial>-if00-port0` in `/dev/serial/by-id`.
 */

export const SERIAL_WORDS = ['ELV', 'FHZ'];

export function discoveryHint() {
    return {
        serial: {contains: SERIAL_WORDS},
    };
}
