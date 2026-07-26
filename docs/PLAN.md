# Build Plan — Homey B-hyve

Port of [sebr/bhyve-home-assistant](https://github.com/sebr/bhyve-home-assistant) to a Homey Pro app (Apps SDK v3). Companion docs: [FEATURES.md](FEATURES.md) (what to build), [ORBIT-API.md](ORBIT-API.md) (protocol).

## Key decisions

| Decision | Choice | Rationale |
|---|---|---|
| App ID | `com.orbitbhyve` | Reverse-domain convention; matches community norms (e.g. `com.linktap`) |
| Language | Plain JavaScript, SDK v3, Homey Compose | Simplest; `homey-apps-sdk-v3-types` for editor IntelliSense via JSDoc |
| Min compatibility | `">=5.0.0"` | `sprinkler` class and all capabilities used are long-established |
| Runtime deps | `ws` only | Node 18/22 on Homey has global `fetch`; `ws` is pure JS |
| Device model | 3 drivers: `bhyve-timer` (controller), `bhyve-zone` (one per station), `bhyve-flood-sensor` | Mirrors HA's valve-per-zone; zones are the unit users automate |
| Single-zone hose timers | Pair as **one zone device only** (no separate controller device); controller capabilities (`run_mode`, `rain_delay_active`, `measure_battery`) live on that zone device | One physical product = one Homey device |
| Account & client | Credentials in `homey.settings` (set during pairing); **one shared `OrbitClient`** (REST + WS) owned by `App`, devices subscribe via EventEmitter | One account, one socket — same as HA coordinator |
| Programs | Flow cards with autocomplete, not devices | Programs are schedules, not things |
| State strategy | WS push is primary; 5-min REST poll as reconciliation; full resync after every WS reconnect | Same as HA; survives missed events |

## Architecture

```
App (app.js)
 ├── OrbitClient (lib/OrbitClient.js)      REST: login, devices, programs, history, landscapes,
 │    │                                     PUTs (program, device, landscape)
 │    │                                     - browser-mimic headers on every call
 │    │                                     - 300 s GET cache, single-flight landscapes
 │    │                                     - re-login once on 401/403, then emit 'auth_failed'
 │    └── OrbitWebSocket (lib/OrbitWebSocket.js)
 │          - app_connection hello, {"event":"ping"} 25 s idle timer
 │          - reconnect backoff 5 s → 300 s, emit 'connected'/'disconnected'
 │          - emits parsed events keyed by device_id
 ├── DeviceStateStore (lib/StateStore.js)   merged device/program/landscape state, HA-coordinator
 │                                          semantics (incl. the change_mode-auto quirk)
 └── Flow card registration (app-level autocomplete for programs)

Drivers subscribe:  this.homey.app.store.on(`device:${id}`, snap => this.syncCapabilities(snap))
```

**Why a StateStore:** the HA coordinator's event-merging rules (synthesize `stations` array, don't clear watering on `change_mode auto`, copy `battery` verbatim, flood-key whitelist) are the hard-won part of the integration. Port them as pure functions in one module with unit tests — no Homey imports — so they can be tested with `node --test` against recorded payloads.

## Repository layout (target)

```
app.js  package.json  env.json(ignored)
.homeycompose/
  app.json
  capabilities/{run_mode,rain_delay_active,rain_delay_remaining,
                next_start,watering_time_remaining,smart_watering}.json
  flow/…                      (app-level cards, if any end up app-level)
lib/
  OrbitClient.js  OrbitWebSocket.js  StateStore.js  const.js
drivers/
  bhyve-timer/         driver.compose.json driver.flow.compose.json
                       driver.settings.compose.json driver.js device.js assets/
  bhyve-zone/          (same shape)
  bhyve-flood-sensor/  (same shape)
test/
  statestore.test.js   fixtures/*.json     (recorded Orbit payloads)
docs/
  FEATURES.md PLAN.md ORBIT-API.md CHANGELOG-notes
assets/ images/{small,large,xlarge}.png icon.svg
```

## Custom capabilities

| id | type | UI | notes |
|---|---|---|---|
| `run_mode` | enum `auto/off/manual` | picker | setting `manual` from UI is blocked (report-only value) |
| `rain_delay_active` | boolean | toggle | ON = 24 h delay, OFF = cancel |
| `rain_delay_remaining` | number (h) | sensor | computed from `rain_delay` + `rain_delay_started_at`; refreshed on a coarse timer |
| `next_start` | string | sensor | localized datetime text |
| `watering_time_remaining` | number (min) | sensor, insights | ticks down via 30 s device timer while watering |
| `smart_watering` | boolean | toggle | device-level `water_sense_mode` mirrored to zones |

Built-ins used: `onoff` (duration enabled), `measure_battery`, `measure_moisture`, `alarm_water`, `alarm_heat`, `measure_temperature` (°C — convert from `temp_f`), `measure_signal_strength`, `alarm_generic` (station fault).

## Milestones

### M0 — Scaffold (½ evening)
- [ ] `homey app create` (id `com.orbitbhyve`, sdk 3, compose) — then restructure into this repo
- [ ] Manifest: category `climate`, brandColor (Orbit teal, muted), permissions `[]`, `platforms: ["local"]`
- [ ] Placeholder assets sized correctly (app 250×175/500×350/1000×700; drivers 75×75/500×500)
- [ ] `homey app validate` passes; `homey app run` deploys to Gk Homey Pro

### M1 — Orbit client library (1–2 evenings)
- [ ] `OrbitClient`: login (`POST /v1/session`), full header set from ORBIT-API.md, token in `homey.settings`
- [ ] GETs: devices, programs, history, landscapes — 300 s cache + `t` cache-buster + single-flight
- [ ] PUTs: program, device (`water_sense_mode`), landscape (soil moisture)
- [ ] `OrbitWebSocket`: hello, 25 s idle ping, 5→300 s backoff, tolerate handshake 5xx
- [ ] `StateStore` with the HA merge rules + `node --test` unit tests against fixture payloads
- [ ] Smoke-test script (`test/live.js`, run locally with real creds from env.json) — verify against real account **before writing any driver code**

### M2 — Pairing + timer & zone drivers (2 evenings)
- [ ] Pair flow: `login_credentials` → `list_devices` → `add_devices` (both drivers)
- [ ] `bhyve-zone` lists one entry per station of every `sprinkler_timer` (skip `status`-less devices; null zone names → device name); `data: {deviceId, station}`
- [ ] `bhyve-timer` lists only multi-zone controllers; single-zone timers get controller capabilities on their zone device
- [ ] Capability sync from StateStore events; `onoff` listener → start/stop watering (duration support)
- [ ] `run_mode`, `rain_delay_active`, battery, `next_start`, fault alarm working end-to-end
- [ ] Availability: `is_connected` + WS down ⇒ `setUnavailable`
- [ ] Repair flow (re-login) on both drivers; auto-trigger unavailable state on `auth_failed`

### M3 — Flow cards (1–2 evenings)
- [ ] Zone: water-for-minutes, stop, set-default-runtime, set-soil-moisture actions; watering started/finished triggers with tokens; is-watering condition (built-in)
- [ ] Timer: rain-delay set/cancel actions, run-program / enable-disable-program / set-budget actions with **program autocomplete**, mode-changed & rain-delay triggers, mode/rain-delay/program-enabled conditions
- [ ] `watering_time_remaining` countdown + `measure_moisture` sync

### M4 — Flood sensor driver (1 evening)
- [ ] `alarm_water`, `alarm_heat`, `measure_temperature` (°F→°C), `measure_battery`, `measure_signal_strength` from `fs_status_update` + REST
- [ ] Settings labels: location, auto-shutoff, temp thresholds

### M5 — Hardening & polish (1–2 evenings)
- [ ] 5-min reconciliation poll; full resync on WS reconnect
- [ ] Kill all logging of tokens/credentials/location/`watering_plan`; memory check (< 30 MB PSS in dev tools)
- [ ] Real product photos for driver images, proper icon.svg
- [ ] README rewrite for end users; docs updated to as-built
- [ ] Long-run soak test on Gk Homey Pro via `homey app install`

### M6 — Publish (optional)
- [ ] `homey app validate --level publish`
- [ ] `homey app publish` → Test channel URL → community forum thread → certification

## Risks & mitigations

1. **Orbit API changes again** (May 2025 precedent): keep all headers/endpoints in `lib/const.js`; the HA repo is the canary — watch its issues.
2. **No official API / ToS**: same reverse-engineered API every ecosystem uses (HA, openHAB, Hubitat, Node); personal-use risk accepted.
3. **`set_manual_preset_runtime` patchy per model**: card hint documents it; failure is non-fatal.
4. **Multi-account**: v1 assumes one B-hyve account (matches HA). Pairing a second account overwrites credentials — document it.
5. **Testing needs real hardware**: build the live smoke-test script first (M1) so protocol assumptions are verified against Grant's actual devices before driver work.

## Working agreement

- Docs in `docs/` and README are updated **in the same commit** as the feature they describe.
- Every milestone ends with `homey app validate` green and a push to `main` on [grantlutz/Homey-B-hyve](https://github.com/grantlutz/Homey-B-hyve).
- Recorded (sanitized) Orbit payloads from the live account go into `test/fixtures/` to lock in StateStore behavior.
