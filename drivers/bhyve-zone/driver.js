'use strict';

const Homey = require('homey');
const C = require('../../lib/const');

const HISTORY_SETTLE_MS = 20 * 1000;

class BhyveZoneDriver extends Homey.Driver {

  async onInit() {
    const app = this.homey.app;

    this._wateringStarted = this.homey.flow.getDeviceTriggerCard('watering_started');
    this._wateringFinished = this.homey.flow.getDeviceTriggerCard('watering_finished');

    app.store.on('watering_started', ({ device, station, program, runTimeMinutes }) => {
      const paired = this._findZone(device.id, station);
      if (!paired) return;
      this._wateringStarted.trigger(paired, {
        zone: paired.getName(),
        station,
        program: app.programDisplayName(device.id, program),
        minutes: runTimeMinutes,
      }).catch(this.error);
    });

    app.store.on('watering_stopped', ({ device, station, program, startedAt }) => {
      const paired = this._findZone(device.id, station);
      if (!paired) return;
      // Give Orbit a moment to write the run into watering history so the
      // trigger can carry real consumption numbers.
      this.homey.setTimeout(() => {
        this._triggerFinished(paired, device.id, station, program, startedAt)
          .catch(this.error);
      }, HISTORY_SETTLE_MS);
    });

    // Actions
    this.homey.flow.getActionCard('start_watering')
      .registerRunListener(async args => args.device.startWatering(args.minutes));

    this.homey.flow.getActionCard('stop_watering')
      .registerRunListener(async args => args.device.stopWatering());

    this.homey.flow.getActionCard('set_preset_runtime')
      .registerRunListener(async args => app.setPresetRuntime(args.device.orbitDeviceId, args.minutes));

    this.homey.flow.getActionCard('set_soil_moisture')
      .registerRunListener(async args => app.setSoilMoisture(
        args.device.orbitDeviceId, args.device.station, args.percent,
      ));
  }

  async _triggerFinished(pairedDevice, deviceId, station, program, startedAt) {
    const app = this.homey.app;
    let minutes = 0;
    let gallons = 0;
    try {
      const history = await app.client.getHistory(deviceId, { fresh: true });
      app.store.setHistory(deviceId, history);
      const lastRun = app.store.getLastRun(deviceId, station);
      // Only trust the history entry if it's from this run. Compare as
      // epochs — history and websocket timestamps may differ in format —
      // with a minute of tolerance for second-truncation.
      const lastTs = Date.parse(lastRun?.start_time);
      const startTs = Date.parse(startedAt);
      if (lastRun && (!Number.isFinite(startTs)
        || (Number.isFinite(lastTs) && lastTs >= startTs - 60000))) {
        minutes = Number(lastRun.run_time) || 0;
        gallons = Number(lastRun.water_volume_gal) || 0;
        program = lastRun.program || program;
      }
    } catch (err) {
      this.log(`History fetch after watering failed: ${err.message}`);
    }
    if (!minutes && startedAt) {
      const started = Date.parse(startedAt);
      if (Number.isFinite(started)) {
        minutes = Math.round(((Date.now() - HISTORY_SETTLE_MS) - started) / 60000);
      }
    }
    await pairedDevice.recordWaterUsage(gallons);
    await this._wateringFinished.trigger(pairedDevice, {
      zone: pairedDevice.getName(),
      station,
      program: app.programDisplayName(deviceId, program),
      minutes: Math.max(0, minutes),
      gallons,
      litres: Math.round(gallons * 3.78541 * 10) / 10,
    });
  }

  _findZone(orbitDeviceId, station) {
    return this.getDevices().find(
      d => d.orbitDeviceId === orbitDeviceId && d.station === station,
    ) || null;
  }

  async onPair(session) {
    this.homey.app.registerLoginHandlers(session);
    session.setHandler('list_devices', async () => this._listDevices());
  }

  async onRepair(session, _device) {
    this.homey.app.registerLoginHandlers(session, { repair: true });
  }

  async _listDevices() {
    const devices = await this.homey.app.ensureFreshDevices();
    const results = [];
    for (const device of devices) {
      if (device.type !== C.DEVICE_SPRINKLER) continue;
      const zones = device.zones?.length
        ? device.zones
        : [{ station: 1, name: null }];
      const multiZone = zones.length > 1;
      for (const zone of zones) {
        results.push({
          name: zone.name
            || (multiZone ? `${device.name} Zone ${zone.station}` : device.name)
            || `Zone ${zone.station}`,
          data: { deviceId: device.id, station: zone.station },
          settings: {
            station: String(zone.station),
            sprinkler_type: zone.sprinkler_type || '',
            timer_name: device.name || '',
          },
        });
      }
    }
    return results;
  }
}

module.exports = BhyveZoneDriver;
