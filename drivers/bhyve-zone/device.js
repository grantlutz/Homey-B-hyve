'use strict';

const BhyveDevice = require('../../lib/BhyveDevice');
const C = require('../../lib/const');

const COUNTDOWN_TICK_MS = 30 * 1000;

class BhyveZoneDevice extends BhyveDevice {

  get station() {
    return this.getData().station;
  }

  async onInit() {
    this.registerCapabilityListener('onoff', async (value, opts) => {
      if (value) {
        const minutes = opts?.duration ? opts.duration / 60000 : undefined;
        await this.startWatering(minutes);
      } else {
        await this.stopWatering();
      }
    });

    this.registerCapabilityListener('smart_watering', async value => {
      await this.app.setSmartWatering(this.orbitDeviceId, value);
    });

    // Manual run straight from the device UI: slide to a duration and go.
    this.registerCapabilityListener('manual_watering_minutes', async value => {
      await this.startWatering(value);
    });

    this._countdownTimer = null;
    await super.onInit();
  }

  async onSettings({ oldSettings, newSettings, changedKeys }) {
    if (changedKeys.includes('default_watering_minutes')) {
      await this.app.setPresetRuntime(this.orbitDeviceId, newSettings.default_watering_minutes);
    }
  }

  async onUninit() {
    this._stopCountdown();
    await super.onUninit();
  }

  async onDeleted() {
    this._stopCountdown();
    await super.onDeleted();
  }

  async startWatering(minutes) {
    await this.app.startWatering(this.orbitDeviceId, this.station, minutes);
  }

  async stopWatering() {
    await this.app.stopWatering(this.orbitDeviceId);
  }

  /** Cumulative water usage in m³ from Orbit's per-run gallons. */
  async recordWaterUsage(gallons) {
    if (!gallons || !this.hasCapability('meter_water')) return;
    const total = (this.getCapabilityValue('meter_water') || 0) + gallons * C.GALLONS_TO_M3;
    await this.safeSet('meter_water', Math.round(total * 1000) / 1000);
  }

  async syncFromStore(device) {
    if (!await this.syncAvailability(device)) return;
    const status = device.status || {};
    const watering = this.app.store.isWatering(this.orbitDeviceId, this.station);

    await this.safeSet('onoff', watering);
    this._syncCountdown(status, watering);

    // Smart watering is device-level since Orbit's 2025 API change.
    await this.safeSet('smart_watering', device.water_sense_mode === 'auto');

    // Only smart-watering zones have calibrated landscape data — hide the
    // moisture sensor entirely on the rest instead of showing a blank value.
    const moisture = this.app.store.getSoilMoisture(this.orbitDeviceId, this.station);
    if (moisture !== null) {
      if (!this.hasCapability('measure_moisture')) {
        await this.addCapability('measure_moisture').catch(this.error);
      }
      await this.safeSet('measure_moisture', Math.round(moisture));
    } else if (this.hasCapability('measure_moisture')) {
      await this.removeCapability('measure_moisture').catch(this.error);
    }

    await this.safeSet('next_start', this.formatNextStart(status));

    const zone = this.app.store.getZone(this.orbitDeviceId, this.station);
    const presetSec = device.manual_preset_runtime_sec;

    // Seed the manual-run slider with the device preset; after that the
    // user's last chosen duration wins.
    if (this.getCapabilityValue('manual_watering_minutes') === null) {
      const seed = presetSec ? Math.round(presetSec / 60) : C.DEFAULT_WATER_MINUTES;
      await this.safeSet('manual_watering_minutes', Math.max(1, Math.min(120, seed)));
    }
    await this.setSettings({
      ...(zone ? {
        station: String(this.station),
        sprinkler_type: zone.sprinkler_type || '',
        timer_name: device.name || '',
      } : {}),
      ...(presetSec ? { default_watering_minutes: Math.max(1, Math.round(presetSec / 60)) } : {}),
    }).catch(() => { /* settings may be mid-edit */ });
  }

  _syncCountdown(status, watering) {
    if (!watering) {
      this._stopCountdown();
      this.safeSet('watering_time_remaining', 0).catch(this.error);
      return;
    }
    const update = () => {
      const ws = this.app.store.getDevice(this.orbitDeviceId)?.status?.watering_status;
      if (!ws || ws.current_station !== this.station) {
        this._stopCountdown();
        this.safeSet('watering_time_remaining', 0).catch(this.error);
        return;
      }
      const totalMinutes = ws.total_run_time_sec
        ? ws.total_run_time_sec / 60
        : Number(ws.run_time) || 0;
      const started = ws.started_watering_station_at ? Date.parse(ws.started_watering_station_at) : NaN;
      const elapsed = Number.isFinite(started) ? (Date.now() - started) / 60000 : 0;
      const remaining = Math.max(0, Math.ceil(totalMinutes - elapsed));
      this.safeSet('watering_time_remaining', remaining).catch(this.error);
    };
    update();
    if (!this._countdownTimer) {
      this._countdownTimer = this.homey.setInterval(update, COUNTDOWN_TICK_MS);
    }
  }

  _stopCountdown() {
    if (this._countdownTimer) {
      this.homey.clearInterval(this._countdownTimer);
      this._countdownTimer = null;
    }
  }

}

module.exports = BhyveZoneDevice;
