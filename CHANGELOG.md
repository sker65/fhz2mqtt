# Changelog

## 0.4.0

- `fht/<addr>/last_seen`: time of the last message from the thermostat (at most once a minute),
  Home Assistant diagnostic timestamp sensor. Home Assistant does not rewrite unchanged MQTT
  states, so their `last_reported` is no "last heard".

## 0.3.0

- Retries only if the thermostat was heard after sending; a silent thermostat's command still
  sits in the FHZ buffer and is not stacked again.
- Free FHT buffer published as `fhtbuf` (HA diagnostic sensor), polled every 5 minutes, with a
  warning when it stays occupied while nothing is pending.
- Compose example: `/dev` mount and cgroup rule, the FHZ survives a replug.

## 0.2.0

- FHT command queue like FHEM's `fhtsoftbuffer`: checks the FHZ's free FHT buffer before sending
  (`--fht-buffer-check`), resends unconfirmed commands (`--fht-retries`, `--fht-retry-after`),
  a newer command replaces a pending one of the same kind.
- License: MIT.

## 0.1.0

- First release: FHZ1000 PC / FHZ1300 PC serial protocol, FHT80b status and commands
  (`desired-temp`, `mode`, `day-temp`, `night-temp`, `windowopen-temp`, `sync-time`, `refresh`),
  Home Assistant device discovery, `--only`, `--fht-code`, Docker image.
