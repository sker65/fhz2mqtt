# fhz2mqtt

Bridges an ELV **FHZ1000 PC / FHZ1300 PC** to MQTT, following the
[mqtt-smarthome](https://github.com/mqtt-smarthome/mqtt-smarthome) convention, and announces the
**FHT80b** room thermostats it hears to Home Assistant via MQTT discovery.

## Why

The FHT80b is an old but robust 868 MHz room thermostat (with FHT8v valves and FHT80TF window
contacts). To be remote-controlled it needs a "central". For years the usual central was an
FHZ1000/1300 PC driven by FHEM, or a CUL running culfw.

When moving a smart home from FHEM to Home Assistant, the other 868 MHz devices can go to a CUL
with [cul2mqtt](https://github.com/sker65/cul2mqtt). For the thermostats the FHZ is often the better
radio: in many installations it receives FHT traffic more reliably than a CUL, and it buffers
commands itself until each thermostat opens its short receive window. fhz2mqtt keeps the FHZ as
the FHT central without FHEM. It is a sibling of cul2mqtt, built on
[mqtt-interfaces-core](https://github.com/hobbyquaker/mqtt-interfaces-core), with the same topic
layout and conventions.

The protocol details follow FHEM's `00_FHZ.pm` and `11_FHT.pm` (thanks to the FHEM authors).

## Install

```sh
git clone https://github.com/sker65/fhz2mqtt && cd fhz2mqtt && npm ci --omit=dev
node index.js --discover         # lists FHZ sticks in /dev/serial/by-id
node index.js -s auto -u mqtt://broker
```

As a systemd service: `sudo node index.js --install -n fhz -s auto -u mqtt://broker` (instance
`fhz2mqtt@fhz`, config in `/etc/fhz2mqtt/fhz.env`). For Docker see `Dockerfile` and
`docker-compose.example.yml`. Only one program can open the FHZ: stop FHEM (or whatever else uses
it) first.

## Options

| Option             | Env                   | Default        | Meaning                                                     |
| ------------------ | --------------------- | -------------- | ----------------------------------------------------------- |
| `-s, --serialport` | `FHZ2MQTT_SERIALPORT` | `/dev/ttyUSB0` | FHZ serial port, or `auto` (`/dev/serial/by-id/*ELV*FHZ*`)  |
| `--fht-code`       | `FHZ2MQTT_FHT_CODE`   | –              | central code (2 hex digits) written on connect; unset: keep |
| `--only`           | `FHZ2MQTT_ONLY`       | –              | comma-separated FHT addresses to handle, others are ignored |
| `-n, --name`       | `FHZ2MQTT_NAME`       | `fhz`          | topic prefix                                                |

Plus the shared options of mqtt-interfaces-core (`-u`, `--ha-discovery`, `-v`, ...; see `--help`).

## Topics

- `fhz/connected` — `0` / `1` / `2` (FHZ open)
- `fhz/status/fht/<addr>/<field>` (retained, `{val, ts, lc}`): `measured_temp`, `desired_temp`,
  `mode` (`AUTO`/`MANU`/`HOLIDAY`/`HOLIDAY_SHORT`), `actuator` (%), `battery_low`, `window_open`,
  `window_sensor_fault`, `low_temp`, `windowopen_temp`, `day_temp`, `night_temp`, `lowtemp_offset`;
  `actuator_state` (event: `syncnow`, `lime-protection`, `pair`, ...)
- `fhz/set/fht/<addr>/desired-temp` (`5.5`…`30.5`, `on`, `off`), `…/mode` (`AUTO`/`MANU`),
  `…/day-temp`, `…/night-temp`, `…/windowopen-temp`, `…/sync-time` (sets the FHT clock),
  `…/refresh` (asks the FHT to send all its values)

`<addr>` is the FHT code in hex, lower case (`1a2b`). The FHT80b display shows the same code as two
decimal pairs: display `26 43` is `1a2b` (26 = 0x1a, 43 = 0x2b). Answers take up to a few minutes:
the FHZ waits for the thermostat's receive window.

## Home Assistant

One device per FHT80b heard (`FHT <addr>`), linked to the bridge device: a climate entity
(auto / heat, target and current temperature, heating while the valve is open), sensors for
temperature and valve, binary sensors for battery and window, and buttons for time sync and
refresh. Rename devices and entities in Home Assistant; topics stay protocol/address.

Send `sync-time` now and then to keep the FHT clocks right (e.g. a weekly automation pressing the
buttons).

## Pairing an FHT80b

1. On the FHT80b: `PROG` until `Sond`, wheel to `CEnt`, `PROG`, wheel to `nA`, `PROG`.
2. Send any command to it, e.g. `fhz/set/fht/<addr>/refresh`.
3. About two minutes later `CEnt` shows `On` and the FHT reports to the FHZ.

After a battery change the FHT runs a sync countdown first; pair after it finished. The FHZ keeps
its central code across restarts. `--fht-code` writes a new one, after which every FHT has to be
paired again.

## Sending limits

Frames to the FHZ are spaced 250 ms apart (the FHZ drops faster ones). The FHZ itself queues FHT
commands until the thermostat's receive window (about every two minutes). Its FHT buffer is
small: do not fire dozens of commands at once.

## License

GPL-2.0
