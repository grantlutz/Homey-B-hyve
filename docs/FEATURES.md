# Feature Inventory — Home Assistant B-hyve → Homey Port

Complete inventory of what the Home Assistant integration ([sebr/bhyve-home-assistant](https://github.com/sebr/bhyve-home-assistant) v4.1.2) provides, and how each piece maps to the Homey app. This is the port's functional contract: **everything in the "HA" columns must have a Homey answer** (device capability, flow card, or an explicit "not ported" decision).

## Supported hardware

| Hardware | Orbit `type` | HA treatment | Homey treatment |
|---|---|---|---|
| Hose faucet timers (HT-25/21004, XD; via Wi-Fi hub) | `sprinkler_timer` | 1 device, 1 zone valve | **Timer device + one zone device** (uniform with multi-zone — see As-built notes) |
| Indoor/outdoor multi-zone controllers (57946 6-zone, 57925 8-zone, 57995 XR 16-zone) | `sprinkler_timer` | 1 device, N zone valves + device sensors | **Controller device** (driver `bhyve-timer`) + one **zone device per station** |
| Flood/temp sensors (Orbit 71000) | `flood_sensor` | binary sensors + temp/RSSI/battery | **Flood sensor device** (driver `bhyve-flood-sensor`, class `sensor`) |
| Wi-Fi hub / gateway | `bridge` | connectivity binary sensor | Not a device; used internally for availability. *(Optional later: expose as device with `alarm_connectivity`.)* |
| Bluetooth-only timers (no hub) | — | skipped (no `status` key) | Skipped identically (filtered out of pairing list) |

## Entity → device/capability mapping

### Zone (HA `valve` entity, one per station) → Homey `bhyve-zone` device

| HA feature | Detail | Homey mapping |
|---|---|---|
| Open valve | waters zone for `manual_preset_runtime_sec` (default 5 min) | `onoff` capability (setable, quick action). ON = start watering with preset runtime; `capabilitiesOptions.duration: true` so Flows can say "on for 10 minutes" — duration overrides preset |
| Close valve | sends `stations: []` | `onoff` → false |
| Is-watering state | `current_station == station` | `onoff` reflects push state in real time |
| `manual_preset_runtime` attr | seconds | Device setting (editable, minutes) + `bhyve.set_manual_preset_runtime` equivalent flow action |
| `next_start_time` / `next_start_programs` attrs | ISO timestamp | Custom capability `next_start` (string sensor, device-local time) + flow token |
| `started_watering_station_at`, `current_program`, `current_runtime` attrs | while watering | Custom capability `watering_time_remaining` (number, min, sensor w/ insights) + trigger tokens (`program`, `run_time`) |
| `smart_watering_enabled` attr | per zone | Custom capability `smart_watering` (boolean, config toggle) — mirrors device-level `water_sense_mode` (Orbit made it device-level in 2025) |
| `sprinkler_type`, `image_url`, `landscape_image` attrs | metadata | Device settings (read-only labels); zone `image_url` considered for device icon later |
| `program_x` attrs (per-program schedule for this zone) | objects | Not capabilities — surfaced via program flow cards (below); schedule details visible in B-hyve app |
| Soil moisture (via landscape) | `current_water_level` ↔ % | `measure_moisture` capability (0–100 %) on smart-watering zones + flow action to set it |

### Controller (HA sensors/switches/select per `sprinkler_timer`) → Homey `bhyve-timer` device

| HA entity | Detail | Homey mapping |
|---|---|---|
| Device mode `select` (auto/off) + state sensor (auto/off/manual) | ws `change_mode` | Custom enum capability `run_mode` — values `auto`/`off`/`manual`; picker UI sets auto/off; `manual` is a reported state only |
| Rain delay `switch` | on = 24 h, off = 0; attrs delay/cause/weather_type/started_at | Custom boolean capability `rain_delay_active` (toggle: ON = 24 h, OFF = cancel) + custom number capability `rain_delay_remaining` (h, sensor) + flow action "Set rain delay [hours]" for arbitrary durations |
| Battery `sensor` (hose timers) | `percent` or `mv` | `measure_battery` + `energy.batteries: ["AA","AA"]` (on zone device for single-zone hose timers) |
| Next watering `sensor` | timestamp | `next_start` custom capability (also on zones) |
| Fault `binary_sensor` | `station_faults` non-empty | `alarm_generic` (title "Station fault") + trigger with fault token |
| Zone history `sensor` (per zone) | last run: time, program, consumption gal | Not a capability — **flow trigger** `watering_complete` carries tokens (zone, program, run time, gallons/litres); insights via `meter_water.last_run` considered later |
| Smart watering `switch` (per zone) | device-level `water_sense_mode` | `smart_watering` capability on zone devices (all zones of a device flip together, matching current Orbit behavior) |
| Program `switch` (per non-smart program) | enable/disable via REST PUT | Not devices — **flow cards** with program autocomplete: action "Enable/disable program", condition "Program is enabled", action "Run program now" |

### Flood sensor (HA binary_sensors/sensors) → Homey `bhyve-flood-sensor` device

| HA entity | Detail | Homey mapping |
|---|---|---|
| Flood `binary_sensor` (MOISTURE) | `flood_alarm_status == "alarm"` | `alarm_water` (free flow cards: became wet/dry, is wet) |
| Temperature alert `binary_sensor` (PROBLEM) | `"alarm" in temp_alarm_status`; thresholds attr | `alarm_heat` (title "Temperature alert"); thresholds shown as device settings |
| Temperature `sensor` (°F) | `status.temp_f` | `measure_temperature` (**converted °F → °C**; Homey renders per user locale) |
| Battery `sensor` | percent/mv | `measure_battery` + `energy.batteries` |
| Signal strength `sensor` (dBm) | `status.rssi` | `measure_signal_strength` |
| `location_name`, `auto_shutoff` attrs | metadata | Device settings (read-only labels) |

### Bridge (HA connectivity `binary_sensor`)

Used internally: children matched via `device_gateway_topic`. Devices with `is_connected == false` (or during WS outage) are marked `setUnavailable()` in Homey — which is more idiomatic than a connectivity sensor.

## HA services → Homey flow actions

| HA service | Params | Homey flow card (action unless noted) |
|---|---|---|
| `bhyve.start_watering` | entity, minutes | Zone device: **"Water for [minutes] minutes"** (plus standard `onoff` with duration) |
| `bhyve.stop_watering` | entity | Zone device: **"Stop watering"** (plus `onoff` off) |
| `bhyve.enable_rain_delay` | entity, hours | Timer device: **"Set rain delay to [hours] hours"** |
| `bhyve.disable_rain_delay` | entity | Timer device: **"Cancel rain delay"** (or `rain_delay_active` off) |
| `bhyve.start_program` | program switch | Timer device: **"Run program [program]"** (autocomplete arg) |
| `bhyve.update_program` | start_times/frequency/budget | Timer device: **"Enable/Disable program [program]"** + **"Set program [program] budget to [percent] %"**. Full schedule editing (start times/frequency) is **deferred** — low flow value, high UI cost; revisit on request |
| `bhyve.set_manual_preset_runtime` | entity, minutes | Zone device: **"Set default watering time to [minutes] minutes"** (support is patchy per Orbit device — surfaced in card hint) |
| `bhyve.set_smart_watering_soil_moisture` | entity, percentage | Zone device: **"Set soil moisture to [percent] %"** (smart-watering zones only) |

## HA events / WS push → Homey flow triggers & conditions

Free cards come with built-in capabilities (`onoff`, `alarm_water`, `measure_battery` changed, etc.). Custom cards:

**Triggers (device-level unless noted)**
- Zone: **Watering started** (tokens: zone name, station, program, planned minutes)
- Zone: **Watering finished** (tokens: zone name, station, program, run time, gallons, litres) — from `watering_complete` + latest history entry
- Timer: **Rain delay started** (tokens: hours, cause, weather type) / **Rain delay ended**
- Timer: **Mode changed** (token: mode) — from `change_mode`
- Timer: **Station fault detected** (token: faults)
- Flood: `alarm_water` / `alarm_heat` built-ins cover flood + temp alerts
- App-level: **Program created** / **Program deleted** (HA bus events `bhyve_program_created/deleted`) — **deferred**, niche

**Conditions**
- Zone: **Is watering** (`onoff` built-in)
- Timer: **Rain delay !{{is|isn't}} active**
- Timer: **Mode !{{is|isn't}} [auto/off/manual]**
- Timer: **Program [program] !{{is|isn't}} enabled**
- Flood: **Is wet** (`alarm_water` built-in)

## Config & lifecycle parity

| HA behavior | Homey equivalent |
|---|---|
| Config flow: email/password → pick devices | Pair flow: `login_credentials` → `list_devices` → `add_devices` (device picking is inherent to Homey pairing) |
| Options flow: change device selection | Add/remove devices individually in Homey (idiomatic) |
| Reauth flow on 401/403 | Driver `repair` flow with `login_credentials`; devices `setUnavailable("Re-authentication required")` until repaired |
| 5-min REST poll + WS push, 300 s client cache | Same: one shared API client in `App`, WS primary, 5-min poll as safety net + resync after WS reconnect |
| Availability = `is_connected` | `setAvailable()/setUnavailable()` per device |
| Device registry (model, fw, MAC, via bridge) | Device settings labels: model (`hardware_version`), firmware, MAC |
| Diagnostics with location redaction | `this.log` diagnostics; never log tokens, location fields, or `watering_plan` |

## As-built notes (v0.1.0)

Deviations from and additions to the plan above, decided during implementation and review:

- **Uniform two-tile model.** Every `sprinkler_timer` — including single-zone hose timers — pairs as one `bhyve-timer` device plus one `bhyve-zone` device per station. This keeps all controller-level flow cards (rain delay, mode, programs) on one driver with no duplication; the earlier "single-zone timers collapse into one device" idea was dropped.
- **Poll fires triggers too.** The 5-minute reconciliation poll diffs old vs. new state and fires the same watering/rain-delay/mode/fault flow triggers as the WebSocket path, so missed push events don't silently swallow automations.
- **WS-outage availability**: devices go unavailable 30 s after the push socket drops (grace period against flapping) and recover on reconnect + resync.
- **Auth failure halts traffic**: a rejected login tears down the socket and poll instead of retrying a bad password against Orbit every 5 minutes; devices show "repair" messaging.
- **Extra tokens/conditions**: watering triggers carry zone name, station, and the resolved program *name*; a "watering is held by the rain sensor" condition exposes `rain_sensor_hold`; the next-watering text appends upcoming program letters.
- **Adaptive capabilities**: `measure_battery` is removed on mains-powered controllers (no separate `alarm_battery` — store rules allow only one battery capability) and `measure_moisture` on zones without landscape calibration, instead of showing blank values.
- **Info labels**: model/firmware/MAC on timers and flood sensors, last-connected on timers.
- **Manual runs from the device UI**: zones have a "Water for" slider (1–120 min, seeded from the device preset) that starts a manual run at the chosen duration directly from the device view, without needing a Flow.
- **Bridge matching dropped**: per-device `is_connected` plus WS-outage handling covers availability; `device_gateway_topic` is unused.
- **Skipped as niche**: `battery_charging_state` (B-hyve battery models don't charge), program created/deleted app-level triggers.

## Explicitly not ported (v1)

- **Program schedule editing** (start times / frequency days / intervals) — B-hyve app does this better; only enable/disable + budget + run-now are ported. Revisit if requested.
- **Program created/deleted triggers** — niche; smart-program lifecycle is folded into the `smart_watering` toggle exactly as HA does.
- **Bridge as a visible device** — availability handling covers it; may add later.
- **Zone `image_url` as dynamic device icon** — Homey device icons are static assets; landscape images skipped.
- **Homey Cloud support** — v1 targets Homey Pro only (`platforms: ["local"]`); app settings pages and sideloading are Pro features anyway.
