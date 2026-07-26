'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { StateStore } = require('../lib/StateStore');

const DEVICE_ID = 'dev1';

function makeStore() {
  const store = new StateStore();
  store.setDevices([
    {
      id: DEVICE_ID,
      name: 'Front Yard Timer',
      type: 'sprinkler_timer',
      is_connected: true,
      num_stations: 2,
      manual_preset_runtime_sec: 600,
      water_sense_mode: 'off',
      battery: { mv: 3000, charging: false },
      zones: [
        { station: 1, name: 'Lawn', smart_watering_enabled: true },
        { station: 2, name: null, smart_watering_enabled: false },
      ],
      status: { run_mode: 'auto', rain_delay: 0 },
    },
    { id: 'unpaired', name: 'BT-only timer', type: 'sprinkler_timer' },
    {
      id: 'flood1',
      name: 'Laundry Sensor',
      type: 'flood_sensor',
      is_connected: true,
      location_name: 'Laundry',
      battery: { percent: 85 },
      status: { flood_alarm_status: 'ok', temp_alarm_status: 'ok', temp_f: 68, rssi: -55 },
    },
  ]);
  return store;
}

test('unpaired devices (no status) are skipped', () => {
  const store = makeStore();
  assert.equal(store.getDevice('unpaired'), undefined);
  assert.ok(store.getDevice(DEVICE_ID));
});

test('watering_in_progress synthesizes stations array (single-zone shape)', () => {
  const store = makeStore();
  const started = [];
  store.on('watering_started', e => started.push(e));
  store.applyEvent({
    event: 'watering_in_progress_notification',
    device_id: DEVICE_ID,
    program: 'e',
    current_station: 1,
    run_time: 14,
    started_watering_station_at: '2026-07-26T20:29:59.000Z',
  });
  const status = store.getDevice(DEVICE_ID).status;
  assert.deepEqual(status.watering_status.stations, [{ station: 1, run_time: 14 }]);
  assert.equal(status.run_mode, 'manual');
  assert.equal(store.isWatering(DEVICE_ID, 1), true);
  assert.equal(store.isWatering(DEVICE_ID, 2), false);
  assert.equal(started.length, 1);
  assert.equal(started[0].runTimeMinutes, 14);
});

test('change_mode auto right after watering starts does NOT clear watering', () => {
  const store = makeStore();
  store.applyEvent({
    event: 'watering_in_progress_notification',
    device_id: DEVICE_ID,
    current_station: 2,
    run_time: 5.5,
  });
  store.applyEvent({ event: 'change_mode', device_id: DEVICE_ID, mode: 'auto' });
  const status = store.getDevice(DEVICE_ID).status;
  assert.equal(status.run_mode, 'auto');
  assert.ok(status.watering_status, 'watering_status must survive change_mode');
  assert.equal(store.isWatering(DEVICE_ID, 2), true);
});

test('watering_complete clears state and emits watering_stopped once', () => {
  const store = makeStore();
  const stopped = [];
  store.on('watering_stopped', e => stopped.push(e));
  store.applyEvent({
    event: 'watering_in_progress_notification',
    device_id: DEVICE_ID, current_station: 1, run_time: 10,
  });
  store.applyEvent({ event: 'watering_complete', device_id: DEVICE_ID });
  store.applyEvent({ event: 'device_idle', device_id: DEVICE_ID });
  assert.equal(store.isWatering(DEVICE_ID, 1), false);
  assert.equal(store.getDevice(DEVICE_ID).status.run_mode, 'off');
  assert.equal(stopped.length, 1);
});

test('repeated watering_in_progress for same station does not re-trigger start', () => {
  const store = makeStore();
  const started = [];
  store.on('watering_started', e => started.push(e));
  const event = {
    event: 'watering_in_progress_notification',
    device_id: DEVICE_ID, current_station: 1, run_time: 10,
  };
  store.applyEvent(event);
  store.applyEvent(event);
  assert.equal(started.length, 1);
});

test('rain_delay sets and clears', () => {
  const store = makeStore();
  const changes = [];
  store.on('rain_delay_changed', e => changes.push(e.hours));
  store.applyEvent({
    event: 'rain_delay', device_id: DEVICE_ID, delay: 24,
    timestamp: '2026-07-26T12:10:10.000Z',
  });
  assert.equal(store.getDevice(DEVICE_ID).status.rain_delay, 24);
  store.applyEvent({ event: 'rain_delay', device_id: DEVICE_ID, delay: 0 });
  assert.equal(store.getDevice(DEVICE_ID).status.rain_delay, 0);
  assert.deepEqual(changes, [24, 0]);
});

test('battery handles legacy mv and modern percent forms', () => {
  const store = makeStore();
  assert.equal(StateStore.batteryPercent(store.getDevice(DEVICE_ID)), 100); // 3000mv
  store.applyEvent({ event: 'battery_status', device_id: DEVICE_ID, mv: 1500, charging: false });
  assert.equal(StateStore.batteryPercent(store.getDevice(DEVICE_ID)), 50);
  store.applyEvent({ event: 'battery_status', device_id: DEVICE_ID, battery: { percent: 42 } });
  assert.equal(StateStore.batteryPercent(store.getDevice(DEVICE_ID)), 42);
  assert.equal(StateStore.batteryPercent(store.getDevice('flood1')), 85);
});

test('set_manual_preset_runtime accepts seconds or runtime echo keys', () => {
  const store = makeStore();
  store.applyEvent({ event: 'set_manual_preset_runtime', device_id: DEVICE_ID, seconds: 480 });
  assert.equal(store.getDevice(DEVICE_ID).manual_preset_runtime_sec, 480);
  store.applyEvent({ event: 'set_manual_preset_runtime', device_id: DEVICE_ID, runtime: 300 });
  assert.equal(store.getDevice(DEVICE_ID).manual_preset_runtime_sec, 300);
});

test('fs_status_update copies only whitelisted keys', () => {
  const store = makeStore();
  store.applyEvent({
    event: 'fs_status_update',
    device_id: 'flood1',
    flood_alarm_status: 'alarm',
    temp_alarm_status: 'low_temp_alarm',
    temp_f: 39.5,
    rssi: -70,
    identify_enabled: true, // not whitelisted
  });
  const status = store.getDevice('flood1').status;
  assert.equal(status.flood_alarm_status, 'alarm');
  assert.equal(status.temp_alarm_status, 'low_temp_alarm');
  assert.equal(status.temp_f, 39.5);
  assert.equal(status.identify_enabled, undefined);
});

test('smart program create/destroy flips water_sense_mode, not program list churn', () => {
  const store = makeStore();
  store.setPrograms([{ id: 'p1', device_id: DEVICE_ID, program: 'a', enabled: true, name: 'Morning' }]);
  store.applyEvent({
    event: 'program_changed',
    device_id: DEVICE_ID,
    lifecycle_phase: 'create',
    program: { id: 'smart1', device_id: DEVICE_ID, program: 'e', is_smart_program: true },
  });
  assert.equal(store.getDevice(DEVICE_ID).water_sense_mode, 'auto');
  store.applyEvent({
    event: 'program_changed',
    device_id: DEVICE_ID,
    lifecycle_phase: 'destroy',
    program: { id: 'smart1', device_id: DEVICE_ID, program: 'e', is_smart_program: true },
  });
  assert.equal(store.getDevice(DEVICE_ID).water_sense_mode, 'off');
  assert.ok(store.programs.has('p1'), 'regular programs untouched');
  assert.ok(!store.programs.has('smart1'));
});

test('program enable toggle via program_changed updates program', () => {
  const store = makeStore();
  store.setPrograms([{ id: 'p1', device_id: DEVICE_ID, program: 'a', enabled: true }]);
  store.applyEvent({
    event: 'program_changed',
    device_id: DEVICE_ID,
    program: { id: 'p1', device_id: DEVICE_ID, program: 'a', enabled: false },
  });
  assert.equal(store.programs.get('p1').enabled, false);
});

test('history picks the latest run per zone across daily buckets', () => {
  const store = makeStore();
  store.setHistory(DEVICE_ID, [
    { irrigation: [{ station: 1, start_time: '2026-07-24T06:00:00Z', run_time: 10, water_volume_gal: 12 }] },
    {
      irrigation: [
        { station: 1, start_time: '2026-07-25T06:00:00Z', run_time: 8, water_volume_gal: 9 },
        { station: 2, start_time: '2026-07-25T06:10:00Z', run_time: 5, water_volume_gal: 4 },
      ],
    },
  ]);
  assert.equal(store.getLastRun(DEVICE_ID, 1).water_volume_gal, 9);
  assert.equal(store.getLastRun(DEVICE_ID, 2).run_time, 5);
});

test('soil moisture derives % from landscape calibration', () => {
  const store = makeStore();
  store.setLandscapes(DEVICE_ID, [
    { id: 'l1', station: 1, current_water_level: 15, replenishment_point: 10, field_capacity_depth: 20 },
  ]);
  assert.equal(store.getSoilMoisture(DEVICE_ID, 1), 50);
  assert.equal(store.getSoilMoisture(DEVICE_ID, 2), null);
});

test('device_connected/disconnected toggles is_connected', () => {
  const store = makeStore();
  store.applyEvent({ event: 'device_disconnected', device_id: DEVICE_ID });
  assert.equal(store.getDevice(DEVICE_ID).is_connected, false);
  store.applyEvent({ event: 'device_connected', device_id: DEVICE_ID });
  assert.equal(store.getDevice(DEVICE_ID).is_connected, true);
});
