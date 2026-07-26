# Orbit B-hyve Cloud API Reference

Reverse-engineered API used by the B-hyve mobile app and web dashboard, as implemented by the Home Assistant integration ([sebr/bhyve-home-assistant](https://github.com/sebr/bhyve-home-assistant) v4.1.2, vendored `pybhyve` client) and cross-validated against [billchurch/bhyve-api](https://github.com/billchurch/bhyve-api) (Node.js).

- REST base: `https://api.orbitbhyve.com`
- WebSocket: `wss://api.orbitbhyve.com/v1/events`
- Web dashboard origin: `https://techsupport.orbitbhyve.com`

## Required headers (critical)

Since ~May 2025 Orbit **rejects requests that don't look like a browser**. Every REST request and the WebSocket handshake must include:

```
User-Agent: Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Safari/537.36
Origin: https://techsupport.orbitbhyve.com
Referer: https://techsupport.orbitbhyve.com/
orbit-app-id: Bhyve Dashboard
```

Authenticated REST requests additionally carry:

```
orbit-api-key: <token>
Orbit-Session-Token: <token>
Content-Type: application/json; charset=utf-8;
Accept: application/json, text/plain, */*
```

## Authentication

`POST /v1/session`

```json
{ "session": { "email": "<email>", "password": "<password>" } }
```

On login only, send `orbit-api-key: null` plus the browser-mimic headers above.

Response contains `orbit_api_key`, `orbit_session_token` (in practice the same bearer value), and `user_id`. 401/403 → bad credentials.

**Token lifecycle:** there is no refresh endpoint. The token is obtained once and reused indefinitely; expiry shows up as 401/403 on a later call → re-login with stored credentials.

## REST endpoints

| Method & path | Purpose |
|---|---|
| `GET /v1/devices?t=<unix_ts>` | All devices for the account (`t` is a cache-buster; `?user_id=<id>` also works) |
| `GET /v1/sprinkler_timer_programs?t=<ts>` | All watering programs for the account |
| `GET /v1/watering_events/{device_id}?t=<ts>&page=1&per-page=10` | Watering history (daily items, each with an `irrigation: []` array) |
| `GET /v1/landscape_descriptions/{device_id}?t=<ts>` | Per-zone landscape/soil data |
| `PUT /v1/devices/{device_id}` | Update device — used for smart watering: `{"device": {"id", "type", "mac_address", "water_sense_mode": "auto"\|"off"}}` |
| `PUT /v1/sprinkler_timer_programs/{program_id}` | Enable/disable/edit a program — body `{"sprinkler_timer_program": {...}}`, allowed keys: `budget, device_id, enabled, frequency, id, name, program, program_start_date, run_times, start_times` |
| `PUT /v1/landscape_descriptions/{landscape_id}` | Set soil moisture — body `{"landscape_description": {"current_water_level", "device_id", "id", "station"}}` |

**Client-side caching:** the HA client caches every GET for **300 s** per resource and de-duplicates concurrent landscape fetches (single-flight). Polling more often than every 5 minutes is unnecessary — the WebSocket carries real-time state.

## Device object (key fields)

```
id, name, type, mac_address, hardware_version (model), firmware_version,
is_connected, num_stations, manual_preset_runtime_sec,
water_sense_mode ("auto"|"off"), device_gateway_topic, last_connected_at,
battery: {percent} | {mv, charging},          // format varies by model, see Quirks
zones: [{station, name, enabled, smart_watering_enabled, sprinkler_type, image_url}],
status: {
  run_mode ("auto"|"off"|"manual"),
  watering_status: {current_station, program, run_time,
                    started_watering_station_at, stations: [{station, run_time}]},
  rain_delay (hours), rain_delay_started_at,
  rain_delay_cause ("auto"), rain_delay_weather_type ("wind"|"rain"),
  next_start_time, next_start_programs: [],
  station_faults: [],
  // flood sensors:
  flood_alarm_status ("ok"|"alarm"), temp_alarm_status, temp_f, rssi,
  last_flood_alarm_at, last_temp_alarm_at, status_updated_at
}
// flood sensors also: location_name, auto_shutoff, temp_alarm_thresholds {low, high}
```

### Device types (`type` field)

- `sprinkler_timer` — all watering controllers: hose faucet timers (HT-25/21004, XD) and indoor/outdoor multi-zone controllers (57946 6-station, 57925 8-zone, 57995 XR 16-zone). Zone count via `num_stations`/`zones[]`.
- `flood_sensor` — Orbit 71000 flood/temperature sensors.
- `bridge` — the B-hyve Wi-Fi hub/gateway. Children link to it by matching `device_gateway_topic`.
- Bluetooth-only timers never paired to a hub have **no `status` key** — skip them (not cloud-controllable).

## Program object

```
id, device_id, name,
program: "a"|"b"|"c" (custom slots) | "e" (smart watering),
enabled, is_smart_program,
start_times: ["HH:MM"],
frequency: {type: "days"|"interval", days: [0-6, 0=Sunday], interval, interval_hours},
budget: 0-200 (%),
run_times: [{station, run_time (minutes)}],
watering_plan: [{date, start_times, run_times}],   // smart programs only; very large
program_start_date
```

## Landscape object (per zone)

```
id, device_id, station, current_water_level,
replenishment_point (= 0% moisture), field_capacity_depth (= 100% moisture),
image_url, sprinkler_type
```

Soil moisture % ↔ water level: `current_water_level = replenishment_point + pct * (field_capacity_depth - replenishment_point) / 100`.

## History item (`irrigation[]` entries)

```
station, start_time, run_time (minutes), program (letter), program_name,
budget, status, water_volume_gal
```

Pick the latest by max `start_time`, not array order.

## WebSocket

### Connect & auth

1. Open `wss://api.orbitbhyve.com/v1/events` with the `Origin` + `User-Agent` headers.
2. Immediately send: `{"event": "app_connection", "orbit_session_token": "<token>"}` — no ack; events just start flowing.

### Keepalive & reconnect

- Send `{"event": "ping"}` after **25 s** of inactivity (reset the timer on every send/receive). Also answer protocol-level PINGs. Without pings the connection silently dies.
- Reconnect with exponential backoff: 5 s doubling to a 300 s max; reset to 5 s after a successful connect. Orbit intermittently returns 5xx on the handshake — expected, just retry.
- Reuse the same token on reconnect; a dead token surfaces as 401/403 on the next REST call → re-login.

### Commands (client → server)

| Action | Message |
|---|---|
| Start watering a zone | `{"event": "change_mode", "mode": "manual", "device_id": id, "timestamp": "<ISO8601>", "stations": [{"station": n, "run_time": minutes}]}` |
| Stop watering | Same, with `"stations": []` |
| Run a program manually | `{"event": "change_mode", "mode": "manual", "device_id": id, "timestamp": "<ISO>", "program": "a"}` |
| Set device mode | `{"event": "change_mode", "device_id": id, "mode": "auto"\|"off"}` |
| Rain delay | `{"event": "rain_delay", "device_id": id, "delay": hours}` — `0` cancels |
| Set manual preset runtime | `{"event": "set_manual_preset_runtime", "device_id": id, "seconds": minutes*60}` |

(Program edits, smart-watering toggle, and soil moisture go over REST — see above.)

### Events (server → client), dispatched by `event` field

| Event | Notes / example |
|---|---|
| `watering_in_progress_notification` | `{program, current_station, run_time, started_watering_station_at, rain_sensor_hold, device_id, timestamp}`. Newer devices add `total_run_time_sec`, `status: "watering_in_progress"`; `run_time` is minutes and may be float. Usually **no `stations` array** — synthesize `[{station: current_station, run_time}]` to match the REST shape. Set `run_mode` to the event's mode or `"manual"`. |
| `watering_complete` | `{device_id, timestamp}` → clear watering state, `run_mode: "off"` |
| `device_idle` | Same clearing behavior as `watering_complete` |
| `change_mode` | `{mode: "auto"\|"off"\|"manual", device_id, timestamp}` (may echo `program`/`stations`). **Quirk:** a `mode=auto` often arrives ~1 s after watering starts and must NOT clear the active watering state. |
| `rain_delay` | `{delay: hours, device_id, timestamp}` — 0 = cancelled |
| `set_manual_preset_runtime` | Echo of the command; carries `seconds` (or possibly `runtime`) — handle both keys |
| `battery_status` | Old: `{mv: 3311, charging: false}`; new: `{battery: {percent: 85, ...}}` (copy the `battery` object verbatim) |
| `fault` | Contains `station_faults: []` |
| `fs_status_update` | Flood sensor status: `{flood_alarm_status, temp_alarm_status, temp_f, rssi, last_flood_alarm_at, last_temp_alarm_at, status_updated_at, ...}`. Alarm when `flood_alarm_status == "alarm"`; temp alert when `"alarm" in temp_alarm_status`. |
| `program_changed` | `{device_id, program: {<full program>}, lifecycle_phase: "create"\|"delete"\|"destroy" (absent on plain update), timestamp}`; may carry top-level `program_id`/`enabled`. Smart programs use create/destroy when smart watering is toggled — treat as the smart-watering flag flipping, not program add/remove. |

## Quirks checklist for any port

1. **Browser-mimic headers on everything** — REST and WS handshake (May 2025 API change).
2. **Token never refreshes** — re-login on 401/403; WS reconnects reuse the old token until REST fails.
3. **App-level ping every 25 s** or the socket silently dies; backoff 5→300 s on reconnect; tolerate handshake 5xx.
4. **Respect a ~300 s GET cache** and rely on the WebSocket for real-time state; add the `t` cache-buster.
5. **Battery format drift**: `{percent}` vs `{mv, charging}`; compute `min(mv/3000*100, 100)` from mV.
6. **Single-zone hose timers**: `zones[0].name` may be `null` (fall back to device name); watering event has no `stations` array.
7. **`change_mode mode=auto` right after watering starts** must not clear watering state.
8. **Smart watering** is a device-level `water_sense_mode`; Orbit creates/destroys the `is_smart_program` program behind the scenes.
9. **Devices without a `status` key** were never hub-paired — skip.
10. **`set_manual_preset_runtime` support is patchy** across models.
11. **`watering_plan`** payloads are huge — strip from logs.
12. `run_time` is **minutes** everywhere (float allowed); `manual_preset_runtime_sec` and the preset command are **seconds**; rain delay is **hours**.
