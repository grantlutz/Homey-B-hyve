# User Guide — Orbit B-hyve for Homey Pro

Step-by-step instructions for every function of the app. For the feature matrix see [FEATURES.md](FEATURES.md); for protocol internals see [ORBIT-API.md](ORBIT-API.md).

## 1. Installation

The app is currently sideloaded (not yet in the Homey App Store):

```bash
npm install -g homey        # once
git clone https://github.com/grantlutz/Homey-B-hyve.git
cd Homey-B-hyve
npm install
homey login                 # once — authorizes the CLI against your Homey
homey app install           # builds and installs on your Homey Pro
```

Sideloaded apps do **not** auto-update: after pulling new changes, run `homey app install` again. Devices and their settings survive reinstalls.

## 2. Pairing devices

The app has three device types. Each physical B-hyve product appears as **two tiles** (a timer + its zones), except flood sensors (one tile).

| Device type | What it is | What it controls |
|---|---|---|
| **B-hyve Sprinkler Timer** | The controller (hose faucet timer or multi-zone box) | Mode, rain delay, programs, battery, faults |
| **B-hyve Watering Zone** | One station of a timer | Start/stop watering, duration, moisture, water usage |
| **B-hyve Flood Sensor** | Orbit 71000 flood/temp sensor | Leak & temperature alarms |

### First pairing (any type)

1. Homey app → **Devices → +** → **Orbit B-hyve**.
2. Pick a device type (start with **B-hyve Sprinkler Timer**).
3. Log in with your **B-hyve account email and password** (the same as the Orbit B-hyve phone app).
4. Select the devices to add → **Add**.

### Subsequent pairings

Repeat for the other device types. The login screen is **skipped automatically** once the app is connected — you go straight to the device list. Add:

- **B-hyve Watering Zone** — lists one entry per station. Single-zone hose timers appear under the timer's name; multi-zone controllers appear as "«Timer name» Zone N" (or the zone's name from the B-hyve app).
- **B-hyve Flood Sensor** — lists any flood sensors on the account.

> Timers that were never connected to a B-hyve Wi-Fi hub (Bluetooth-only setups) cannot be controlled from the cloud and won't be listed.

## 3. Watering a zone

Open a **zone** device tile.

### Quick on/off
- **Tap the toggle** (or the tile's quick action): starts watering for the **default watering time** (see below). Tap off to stop.

### Manual run with a chosen duration
- Use the **"Water for" slider** (1–120 min): sliding to a value **immediately starts** a manual run of that length. The slider remembers your last choice; first time it seeds from the default watering time.

### While watering
- **Watering time remaining** counts down in minutes (also logged to Insights).
- The toggle shows on; it turns off automatically when the run completes — including when a program moves on to the next zone.

### Default watering time
Used by the plain toggle (and Flow "turn on" without a duration):
- Zone device → **Settings (gear) → Behavior → Default watering time**, or
- Flow action **"Set the default watering time to N minutes"**.

This is stored **on the B-hyve timer**, so all zones of one timer share it. Some models ignore this command (Orbit limitation) — if yours does, use the slider or Flow durations instead.

### Water usage
- **Water usage (m³)** accumulates each run's consumption as reported by Orbit's history (converted from gallons). View history in Insights.

## 4. Rain delays

Open a **timer** device tile.

- **Rain delay toggle**: on = pause all watering for the default delay (24 h, configurable in timer **Settings → Behavior → Default rain delay**); off = cancel immediately.
- **Rain delay remaining** shows hours left and counts down.
- While delayed, **Next watering** shows "Rain delayed".
- Any duration: Flow action **"Delay watering for N hours"** (1–999).

## 5. Modes

The timer's **Mode** picker:
- **Auto** — programs run on schedule (normal operation).
- **Off** — nothing runs until set back to Auto (standby).
- **Manual** — shown while a manual run is active; it cannot be selected directly (start a watering instead).

## 6. Programs (schedules)

Programs are created and scheduled in the **B-hyve phone app**; Homey controls them through **Flows** (they are not tiles). All program cards use an autocomplete picker — start typing the program's name.

Available on the **timer** device:
- **Run program …** — starts a program right now.
- **Enable/Disable program …** — turn a schedule on or off (e.g., disable "Everyday" during vacation).
- **Set program … budget to N %** — scale all of a program's run times (100 % = normal, 50 % = half). Ideal for seasonal adjustment.
- Condition: **Program … is enabled**.

Smart Watering (Orbit's weather-based program) is not toggled per program — use the **Smart watering** toggle on any zone device (it's account/device-level, all zones of a timer switch together).

## 7. Soil moisture (smart watering zones)

Zones with smart watering enabled and landscape data configured in the B-hyve app show a **Moisture (%)** sensor.
- Update it (e.g., after manual rain measurement) with the zone Flow action **"Set the soil moisture to N %"** — Orbit's smart watering replans accordingly.
- Zones without landscape calibration don't show the sensor.

## 8. Flood sensors

Flood sensor tiles expose:
- **Water alarm** (leak detected), **Temperature alert** (outside the thresholds set in the B-hyve app), **Temperature** (°C), **Battery**, **Signal strength**.
- Device Settings show location, auto-shutoff status, alert thresholds, model/firmware/MAC.

Homey's standard alarm cards work directly: "The water alarm turned on", "Temperature alert is on", etc.

## 9. Flow card reference

### Zone device
| Type | Card | Tokens / args |
|---|---|---|
| Trigger | Watering started | zone, station, program (name), planned minutes |
| Trigger | Watering finished | zone, station, program, minutes watered, gallons, litres |
| Trigger | Turned on / Turned off (built-in) | — |
| Condition | Is on (watering) (built-in) | — |
| Action | Water for [N] minutes | 1–1440 |
| Action | Stop watering | — |
| Action | Turn on / off (built-in; supports "for X minutes" duration) | — |
| Action | Set the default watering time to [N] minutes | 1–1440 |
| Action | Set the soil moisture to [N] % | 0–100 |

### Timer device
| Type | Card | Tokens / args |
|---|---|---|
| Trigger | Rain delay started | hours, cause, weather type |
| Trigger | Rain delay ended | — |
| Trigger | Mode changed | mode |
| Trigger | Station fault detected | faults |
| Condition | Rain delay is / isn't active | — |
| Condition | Watering is / isn't held by the rain sensor | — |
| Condition | Mode is / isn't […] | auto / off / manual |
| Condition | Program […] is / isn't enabled | autocomplete |
| Action | Delay watering for [N] hours | 1–999 |
| Action | Cancel the rain delay | — |
| Action | Set the mode to […] | auto / off |
| Action | Run program […] | autocomplete |
| Action | [Enable/Disable] program […] | autocomplete |
| Action | Set program […] budget to [N] % | 0–200 |

### Example flows
- **Skip watering when rain is forecast**: WHEN OpenWeather says rain tomorrow → THEN timer "Delay watering for 24 hours".
- **Leak response**: WHEN flood sensor water alarm turns on → THEN send notification AND timer "Set the mode to Off".
- **Water after mowing**: WHEN "Mowing done" virtual button pressed → THEN back-yard zone "Water for 15 minutes".
- **Track usage**: WHEN zone "Watering finished" → THEN log `{{gallons}}` to a spreadsheet/notification.

## 10. Device availability & re-login

- Tiles show **unavailable** when: the device is offline in the B-hyve cloud, the push connection has been down >30 s (auto-recovers), or your B-hyve login expired.
- If the message says login expired: long-press the device → **Repair** (or Settings → Maintenance → Repair) → enter your B-hyve password. One repair fixes every device.
- If you change your B-hyve password on purpose, do the same — the app deliberately stops all traffic until repaired to protect your account.

## 11. Insights

Logged automatically: watering on/off per zone, watering time remaining, water usage (m³), rain delay active, battery %, flood/temperature alarms, temperature, moisture.

## 12. Troubleshooting

| Symptom | Cause / fix |
|---|---|
| "I only see rain delay / mode" | That's the **timer** tile — add the **B-hyve Watering Zone** devices for watering controls (§2). |
| Zone won't start; error "connection is down" | Push socket reconnecting — wait ~30 s. Persistent: check Homey's internet and that the B-hyve phone app works. |
| "Next watering" shows "—" | No enabled program with a scheduled next run reported by Orbit, or the timer is in Off mode. Check schedules in the B-hyve app. |
| Default watering time doesn't stick | Some B-hyve models ignore the preset command (Orbit limitation). Use the slider/Flow durations. |
| Gallons show 0 on "Watering finished" | Not all models report flow volume; history can also lag ~20 s (the app waits, then falls back to elapsed time). |
| Moisture sensor missing | Zone has no smart-watering landscape calibration in the B-hyve app. |
| Devices unavailable after password change | Run Repair on any B-hyve device (§10). |
| App not updating after `git pull` | Sideloads don't auto-update — run `homey app install` again. |
