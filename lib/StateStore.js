'use strict';

const { EventEmitter } = require('events');
const C = require('./const');

// Keys copied from an fs_status_update event into device.status
// (same whitelist the HA integration uses).
const FLOOD_STATUS_KEYS = [
  'flood_alarm_status', 'temp_alarm_status', 'temp_f', 'rssi',
  'last_flood_alarm_at', 'last_temp_alarm_at', 'status_updated_at',
];

/**
 * In-memory account state with the HA coordinator's merge semantics.
 *
 * REST snapshots go in via setDevices/setPrograms/setHistory/setLandscapes;
 * websocket messages via applyEvent(). Consumers subscribe to:
 *   'device:<id>'        (device) — state for that device changed
 *   'programs_changed'   ()       — program list/content changed
 *   'watering_started'   ({ device, station, program, runTimeMinutes })
 *   'watering_stopped'   ({ device })
 *   'rain_delay_changed' ({ device, hours })
 *   'mode_changed'       ({ device, mode })
 *   'fault'              ({ device, faults })
 */
class StateStore extends EventEmitter {
  constructor({ log = () => {} } = {}) {
    super();
    this._log = log;
    this.devices = new Map();
    this.programs = new Map();
    this.histories = new Map(); // deviceId -> latest irrigation entry
    this.landscapes = new Map(); // deviceId -> Map<station, landscape>
  }

  getDevice(deviceId) {
    return this.devices.get(deviceId);
  }

  getZone(deviceId, station) {
    const device = this.devices.get(deviceId);
    return device?.zones?.find(z => z.station === station);
  }

  getProgramsForDevice(deviceId) {
    return [...this.programs.values()].filter(p => p.device_id === deviceId);
  }

  /** Latest completed irrigation entry for a zone, from watering history. */
  getLastRun(deviceId, station) {
    const entry = this.histories.get(deviceId);
    if (!entry) return null;
    const runs = (entry.irrigation || []).filter(i => i.station === station);
    if (!runs.length) return null;
    return runs.reduce((a, b) => ((a.start_time || '') > (b.start_time || '') ? a : b));
  }

  isWatering(deviceId, station) {
    const status = this.devices.get(deviceId)?.status;
    return status?.watering_status?.current_station === station;
  }

  // ---- REST ingestion -----------------------------------------------------

  setDevices(list) {
    const seen = new Set();
    for (const device of list || []) {
      // Devices never paired to a hub have no status and can't be controlled.
      if (device.type !== C.DEVICE_BRIDGE && !device.status) {
        this._log(`Skipping unpaired device ${device.id} (${device.name})`);
        continue;
      }
      seen.add(device.id);
      this.devices.set(device.id, device);
      this._emitDevice(device.id);
    }
    for (const id of [...this.devices.keys()]) {
      if (!seen.has(id)) {
        this.devices.delete(id);
        this._emitDevice(id);
      }
    }
  }

  setPrograms(list) {
    this.programs = new Map((list || []).map(p => [p.id, p]));
    this.emit('programs_changed');
  }

  setHistory(deviceId, items) {
    // Items are daily buckets; keep the one holding the most recent irrigation.
    let latest = null;
    let latestTime = '';
    for (const item of items || []) {
      for (const run of item.irrigation || []) {
        if ((run.start_time || '') > latestTime) {
          latestTime = run.start_time;
          latest = item;
        }
      }
    }
    if (latest) this.histories.set(deviceId, latest);
  }

  setLandscapes(deviceId, list) {
    this.landscapes.set(deviceId, new Map((list || []).map(l => [l.station, l])));
    this._emitDevice(deviceId);
  }

  /** Soil moisture 0-100% for a zone, derived from landscape water levels. */
  getSoilMoisture(deviceId, station) {
    const landscape = this.landscapes.get(deviceId)?.get(station);
    if (!landscape) return null;
    const { current_water_level: cur, replenishment_point: lo, field_capacity_depth: hi } = landscape;
    if (typeof cur !== 'number' || typeof lo !== 'number' || typeof hi !== 'number' || hi <= lo) {
      return null;
    }
    return Math.max(0, Math.min(100, ((cur - lo) / (hi - lo)) * 100));
  }

  // ---- WebSocket ingestion ------------------------------------------------

  applyEvent(event) {
    const deviceId = event.device_id;
    const device = deviceId ? this.devices.get(deviceId) : null;
    switch (event.event) {
      case 'watering_in_progress_notification': {
        if (!device) return;
        device.status = device.status || {};
        const wasStation = device.status.watering_status?.current_station;
        // Single-zone timers send no stations array — synthesize one so the
        // shape matches the REST watering_status.
        const stations = event.stations
          || [{ station: event.current_station, run_time: event.run_time }];
        device.status.watering_status = {
          current_station: event.current_station,
          program: event.program,
          run_time: event.run_time,
          total_run_time_sec: event.total_run_time_sec,
          started_watering_station_at: event.started_watering_station_at,
          stations,
        };
        device.status.run_mode = event.mode || 'manual';
        this._emitDevice(deviceId);
        if (wasStation !== event.current_station) {
          this.emit('watering_started', {
            device,
            station: event.current_station,
            program: event.program,
            runTimeMinutes: Number(event.run_time) || 0,
          });
        }
        break;
      }

      case 'watering_complete':
      case 'device_idle': {
        if (!device) return;
        device.status = device.status || {};
        const previous = device.status.watering_status;
        delete device.status.watering_status;
        device.status.run_mode = 'off';
        this._emitDevice(deviceId);
        if (previous) {
          this.emit('watering_stopped', {
            device,
            station: previous.current_station,
            program: previous.program,
            startedAt: previous.started_watering_station_at,
          });
        }
        break;
      }

      case 'change_mode': {
        if (!device) return;
        device.status = device.status || {};
        // Merge, but never clear watering_status: Orbit sends a
        // change_mode(auto) ~1 s after manual watering starts (HA issue #306).
        if (event.mode) device.status.run_mode = event.mode;
        this._emitDevice(deviceId);
        this.emit('mode_changed', { device, mode: event.mode });
        break;
      }

      case 'rain_delay': {
        if (!device) return;
        device.status = device.status || {};
        device.status.rain_delay = event.delay;
        device.status.rain_delay_started_at = event.timestamp;
        this._emitDevice(deviceId);
        this.emit('rain_delay_changed', { device, hours: Number(event.delay) || 0 });
        break;
      }

      case 'set_manual_preset_runtime': {
        if (!device) return;
        // Command echo carries `seconds`; some devices echo `runtime` instead.
        const seconds = event.seconds ?? event.runtime;
        if (typeof seconds === 'number') {
          device.manual_preset_runtime_sec = seconds;
          this._emitDevice(deviceId);
        }
        break;
      }

      case 'battery_status': {
        if (!device) return;
        if (event.battery) {
          device.battery = event.battery;
        } else if (typeof event.mv === 'number') {
          device.battery = { mv: event.mv, charging: event.charging };
        }
        this._emitDevice(deviceId);
        break;
      }

      case 'fault': {
        if (!device) return;
        device.status = device.status || {};
        device.status.station_faults = event.station_faults || [];
        this._emitDevice(deviceId);
        if (device.status.station_faults.length) {
          this.emit('fault', { device, faults: device.status.station_faults });
        }
        break;
      }

      case 'fs_status_update': {
        if (!device) return;
        device.status = device.status || {};
        for (const key of FLOOD_STATUS_KEYS) {
          if (event[key] !== undefined) device.status[key] = event[key];
        }
        this._emitDevice(deviceId);
        break;
      }

      case 'device_connected':
      case 'device_disconnected': {
        if (!device) return;
        device.is_connected = event.event === 'device_connected';
        this._emitDevice(deviceId);
        break;
      }

      case 'program_changed': {
        const program = event.program;
        const phase = event.lifecycle_phase;
        if (program?.is_smart_program) {
          // Orbit creates/destroys the smart program when smart watering is
          // toggled — reflect it as the device-level flag, like HA does.
          if (device && (phase === 'create' || phase === 'destroy')) {
            device.water_sense_mode = phase === 'create' ? 'auto' : 'off';
            this._emitDevice(deviceId);
          }
        }
        if (program?.id) {
          if (phase === 'delete' || phase === 'destroy') this.programs.delete(program.id);
          else this.programs.set(program.id, program);
        } else if (event.program_id && event.enabled !== undefined) {
          const existing = this.programs.get(event.program_id);
          if (existing) existing.enabled = event.enabled;
        }
        this.emit('programs_changed');
        if (device) this._emitDevice(deviceId);
        break;
      }

      default:
        break; // unknown events are fine to ignore
    }
  }

  /** Battery percentage 0-100 or null. Handles {percent} and legacy {mv}. */
  static batteryPercent(device) {
    const battery = device?.battery;
    if (!battery) return null;
    if (typeof battery.percent === 'number') return Math.max(0, Math.min(100, battery.percent));
    if (typeof battery.mv === 'number') return Math.min((battery.mv / 3000) * 100, 100);
    return null;
  }

  _emitDevice(deviceId) {
    this.emit(`device:${deviceId}`, this.devices.get(deviceId));
  }
}

module.exports = { StateStore, FLOOD_STATUS_KEYS };
