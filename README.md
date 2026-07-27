# Homey B-hyve

A [Homey Pro](https://homey.app) app for **Orbit B-hyve** smart watering products — hose faucet timers, indoor/underground sprinkler timers, and flood sensors — connected through the Orbit B-hyve cloud API.

This project is a full port of the [Home Assistant B-hyve integration](https://github.com/sebr/bhyve-home-assistant) to the Homey Apps SDK v3.

> **Status: ✅ v0.1.0 implemented** — validates at Homey publish level, 15 unit tests, reviewed in two adversarial passes. Awaiting live testing against real B-hyve hardware. See [docs/FEATURES.md](docs/FEATURES.md) for the complete feature matrix.

## Features

- **Pairing** with your B-hyve email/password (`login_credentials` flow, with repair/re-login support on every driver).
- **Three drivers**: sprinkler timer (mode, rain delay, next watering, faults, battery), watering zone (start/stop with duration, time remaining, soil moisture, water meter, smart watering), and flood sensor (water & temperature alarms, temperature, signal strength, battery).
- **Real-time push** via Orbit's WebSocket (25 s keepalive, 5→300 s backoff reconnect) with a 5-minute reconciliation poll that also fires missed flow triggers.
- **Flow cards**: watering started/finished (zone, station, program, minutes, gallons/litres tokens), rain delay start/end/set/cancel, mode changed/set, run program, enable/disable program, program budget, soil moisture, rain-sensor hold condition — programs picked via autocomplete.
- **Resilience**: devices go unavailable on cloud/socket outage and recover automatically; a rejected password halts all traffic until repaired.

## Documentation

| Document | Purpose |
|---|---|
| [`docs/USER-GUIDE.md`](docs/USER-GUIDE.md) | **How to use the app**: installation, pairing, watering, rain delays, programs, flow card reference, troubleshooting |
| [`docs/FEATURES.md`](docs/FEATURES.md) | Complete feature inventory of the Home Assistant integration, how each maps to Homey, and as-built notes |
| [`docs/PLAN.md`](docs/PLAN.md) | Build plan: architecture, drivers, capabilities, flow cards, milestones |
| [`docs/ORBIT-API.md`](docs/ORBIT-API.md) | Orbit B-hyve cloud REST + WebSocket API reference |

## Quick start

1. Install: `homey app install` from a clone of this repo (see the [User Guide](docs/USER-GUIDE.md#1-installation)).
2. Add devices: **Devices → + → Orbit B-hyve → B-hyve Sprinkler Timer**, log in with your B-hyve account, and add your timers.
3. Add the zones: repeat with **B-hyve Watering Zone** (login is skipped) — the zone tiles are where watering is controlled, including the "Water for" slider for manual runs.
4. Flood sensors: repeat with **B-hyve Flood Sensor**.

Full instructions for every function: **[docs/USER-GUIDE.md](docs/USER-GUIDE.md)**.

## Development

Built with the [Homey Apps SDK v3](https://apps.developer.homey.app) and the `homey` CLI.

```bash
npm install -g homey   # Homey CLI
homey app run          # run on your Homey Pro during development
homey app validate     # validate the app manifest
```

## Credits

- [sebr/bhyve-home-assistant](https://github.com/sebr/bhyve-home-assistant) — the Home Assistant integration this port is based on.
- Orbit B-hyve is a trademark of Orbit Irrigation Products. This app is not affiliated with or endorsed by Orbit.
