# FHZ2MQTT

Bridges an ELV **FHZ1000 PC / FHZ1300 PC** to MQTT and announces the **FHT80b** room thermostats
it hears to Home Assistant via MQTT discovery: one device per thermostat with a climate entity,
temperature, valve, battery and window sensors, and buttons for time sync and refresh.

## Requirements

- An MQTT broker. With the **Mosquitto broker** app and the MQTT integration set up, the app finds
  it and its credentials by itself; leave `mqtt_url` empty.
- The FHZ plugged into the Home Assistant host via USB, or on a serial-to-network converter.
  Only one program can use the FHZ: stop FHEM or anything else that opens it.

## Configuration

| Option             | Default         | Meaning                                                                                 |
| ------------------ | --------------- | --------------------------------------------------------------------------------------- |
| `serialport`       | `auto`          | `auto` (USB FHZ via `/dev/serial/by-id`), a device path, or `tcp://host:port`           |
| `fht_code`         | –               | central code (2 hex digits) written on connect; empty keeps the paired one              |
| `only`             | –               | comma-separated FHT addresses to handle (`1a2b,3c4d`); empty handles all                |
| `fht_buffer_check` | `true`          | ask the FHZ for its free FHT buffer, hold what doesn't fit                              |
| `fht_retries`      | `2`             | resend unconfirmed FHT commands at most this often (0 = off)                            |
| `fht_retry_after`  | `240`           | seconds to wait for the confirmation before resending (min 120)                         |
| `instance_name`    | `fhz`           | MQTT topic prefix                                                                       |
| `mqtt_url`         | –               | external broker only, e.g. `mqtt://broker:1883`; with `mqtt_username` / `mqtt_password` |
| `log_level`        | `info`          | `debug` logs the raw traffic (`fhz <` / `fhz >`)                                        |
| `ha_prefix`        | `homeassistant` | MQTT discovery prefix                                                                   |

### USB

`auto` looks for `/dev/serial/by-id/*ELV*FHZ*`. If it finds nothing, pick the device under
**Settings → System → Hardware** and enter its path (preferably the `/dev/serial/by-id/...` one,
it survives a replug).

### Network (XPort, ser2net, ...)

Set `serialport` to `tcp://<host>:<port>` (Lantronix XPort default port: `10001`). The converter
must pass the bytes through unchanged: raw TCP, not Telnet or RFC 2217, serial side 9600 baud 8N1
without flow control. The app reconnects every 10 s when the connection drops. Most converters
accept only one connection at a time.

## Thermostats

Thermostats appear in Home Assistant as soon as the FHZ hears them (an FHT80b sends every few
minutes). Commands take up to a few minutes: the FHZ waits for the thermostat's receive window;
the _Pending_ binary sensor shows a command on its way. Pairing, topics and the address format are
described in the [README](https://github.com/sker65/fhz2mqtt#readme).

The FHZ clock and the FHT `sync-time` use the time zone of Home Assistant.
