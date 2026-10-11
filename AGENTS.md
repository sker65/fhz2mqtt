# Agent instructions — fhz2mqtt

Bridges an ELV FHZ1000 PC / FHZ1300 PC (FHT80b thermostats) to MQTT, mqtt-smarthome convention,
Home Assistant discovery. Sibling of [cul2mqtt](https://github.com/sker65/cul2mqtt); shared
behaviour comes from [mqtt-interfaces-core](https://github.com/hobbyquaker/mqtt-interfaces-core)
(generic fixes go there).

## Code layout (ES modules, node >= 20.19)

- `index.js` — `createAdapter()` plus the serial part: open/reconnect (10 s), FHZ init sequence,
  write queue (250 ms gap, the FHZ drops faster frames), frames → FHT items → `pubStatus()`,
  `set/fht/<addr>/<cmd>` → FHZ send frame, debounced discovery when a new FHT is heard.
- `lib/frame.js` — pure: FHZ framing (`0x81 len fn crc data`), stream decoder.
- `lib/fhz.js` — pure: FHZ register commands and init sequence (from FHEM's `00_FHZ.pm`).
- `lib/fht.js` — pure: FHT frames → items, FHT commands (from FHEM's `11_FHT.pm`).
- `lib/hadiscovery.js` — pure: seen FHT addresses → HA device blocks.
- `test/` — node:test unit tests for every `lib/` module (`npm test`).

## Practices

- Plain JavaScript, 4-space indentation, eslint + prettier (`npm run lint`), minimal dependencies.
- Topics are API: `<name>/status/fht/<addr>/<field>`, `<name>/set/fht/<addr>/<cmd>`. Do not rename
  outside a major release.
- No site data in the repo: example addresses only (`1a2b`), no device serials, no room names.
- Log raw traffic at `debug` with `fhz <` / `fhz >` prefixes.

## Release

1. Bump `version` in `package.json` (`npm version --no-git-tag-version <x.y.z>` keeps the lockfile in sync) and add a
   `## x.y.z` section to `CHANGELOG.md`.
2. Commit, then tag `x.y.z` or `vx.y.z` and push the tag (or create the release on GitHub with a new tag).
3. `.github/workflows/release.yml` checks that the tag matches `package.json`, runs lint and tests, publishes to npm
   (trusted publishing via OIDC, no token; with provenance) and creates the GitHub release with notes from `.github/release-notes.js`
   (CHANGELOG section plus the commits since the previous tag); a release created by hand only gets its notes
   replaced. A failed run can be repeated for an existing tag via
   _Run workflow_.
