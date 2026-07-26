# Homey B-hyve

A [Homey Pro](https://homey.app) app for **Orbit B-hyve** smart watering products — hose faucet timers, indoor/underground sprinkler timers, and flood sensors — connected through the Orbit B-hyve cloud API.

This project is a full port of the [Home Assistant B-hyve integration](https://github.com/sebr/bhyve-home-assistant) to the Homey Apps SDK v3.

> **Status: 🚧 Planning complete, ready to build.** Research and architecture docs are in [`docs/`](docs/) — see [PLAN.md](docs/PLAN.md) for milestones. Implementation starts at M0 (scaffold).

## Goals

- Pair your Orbit B-hyve account with Homey using your B-hyve email/password.
- Expose each B-hyve timer and each watering zone as a Homey device with real-time state (via Orbit's WebSocket push API — no polling lag).
- Start/stop watering, run programs, set rain delays, and react to watering events from Homey Flows.
- Surface battery levels, flood/leak alarms, and device status.

## Documentation

| Document | Purpose |
|---|---|
| `docs/FEATURES.md` | Complete feature and functionality inventory of the Home Assistant integration, and how each maps to Homey |
| `docs/PLAN.md` | Build plan: architecture, drivers, capabilities, flow cards, milestones |
| `docs/ORBIT-API.md` | Orbit B-hyve cloud REST + WebSocket API reference |

*(These are written as part of the planning phase and kept up to date as the app is built.)*

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
