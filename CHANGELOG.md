# Changelog

All notable changes to the B-hyve Homey app are documented here.
Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/); versions follow [SemVer](https://semver.org).

> Maintenance rule: every change that lands in `main` must be reflected here in the same commit (or commit series) that makes it. The `[Unreleased]` section collects changes between versions; publishing to the App Store moves them under a version heading, which also becomes the `.homeychangelog.json` entry for that release.

## [Unreleased]

### Changed
- App ID renamed from `com.orbitbhyve` to `io.github.grantlutz.bhyve` (reverse-DNS of a namespace we actually control) to make the unofficial status unambiguous. Done before first App Store publish, when an ID change is still possible. Sideload users must re-pair devices under the new app and remove the old one.

## [0.1.0] — 2026-07-27

Initial release. Full port of the Home Assistant B-hyve integration to Homey Pro (SDK v3), sideloaded and in soak testing ahead of App Store submission.

### Added
- **Orbit cloud connection**: REST client with the browser-mimic headers Orbit requires (post-May-2025), 300 s GET cache, single re-login on 401/403; live push over Orbit's WebSocket (25 s keepalive, 5→300 s backoff reconnect, full resync after reconnect) with a 5-minute reconciliation poll that also fires flow triggers for any events the socket missed.
- **B-hyve Sprinkler Timer driver**: mode (auto/off/manual), rain delay toggle + remaining-hours sensor + configurable default delay, next-watering text (with upcoming program letters), station-fault alarm, battery % and low-battery alarm on battery models (capabilities auto-removed on mains models), model/firmware/MAC/last-connected info labels.
- **B-hyve Watering Zone driver**: watering on/off with Flow duration support, "Water for" slider (1–120 min) for manual runs from the device UI, watering-time-remaining countdown, editable default watering time, smart-watering toggle, soil moisture sensor on calibrated zones, cumulative water-usage meter (m³) from Orbit history.
- **B-hyve Flood Sensor driver**: water alarm, temperature alert, temperature (°F→°C), battery + low-battery alarm, signal strength, location/auto-shutoff/threshold info labels.
- **Flow cards** — triggers: watering started/finished (zone, station, program name, minutes, gallons, litres tokens), rain delay started (hours/cause/weather)/ended, mode changed, station fault; conditions: rain delay active, rain-sensor hold, mode is, program enabled; actions: water for N minutes, stop watering, set default watering time, set soil moisture, set/cancel rain delay, set mode, run program, enable/disable program, set program budget — programs picked via autocomplete.
- **Pairing** with B-hyve email/password (login skipped when already connected); **repair** flow on every driver for expired logins.
- **Resilience**: devices go unavailable on cloud/device offline or >30 s push outage and self-recover; a rejected password halts all cloud traffic until repaired (protects against account lockout); per-zone stop events fire when multi-zone programs advance stations.
- **StateStore** port of the HA coordinator's merge rules (synthesized station arrays, `change_mode(auto)` must not clear active watering, battery format drift, flood-sensor key whitelist, smart-program lifecycle → smart-watering flag) with 15 `node --test` unit tests.
- **Store readiness**: original SVG-based artwork for the app and all drivers (sources in `assets/artwork-src/`), App Store description (`README.txt`), community forum topic (157617) linked, publish-level validation green.
- **Documentation**: user guide, feature matrix with as-built notes, build plan, Orbit cloud API reference.

[Unreleased]: https://github.com/grantlutz/Homey-B-hyve/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/grantlutz/Homey-B-hyve/releases/tag/v0.1.0
