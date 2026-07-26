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

    this._countdownTimer = null;
    await super.onInit();
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

    const moisture = this.app.store.getSoilMoisture(this.orbitDeviceId, this.station);
    if (moisture !== null) {
      await this.safeSet('measure_moisture', Math.round(moisture));
    }

    await this.safeSet('next_start', this._formatNextStart(status));

    const zone = this.app.store.getZone(this.orbitDeviceId, this.station);
    if (zone) {
      await this.setSettings({
        station: String(this.station),
        sprinkler_type: zone.sprinkler_type || '',
        timer_name: device.name || '',
      }).catch(() => { /* settings may be mid-edit */ });
    }
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

  _formatNextStart(status) {
    if ((status.rain_delay || 0) > 0) return this.homey.__('next_start.rain_delayed');
    if (!status.next_start_time) return '—';
    const date = new Date(status.next_start_time);
    if (Number.isNaN(date.getTime())) return '—';
    return date.toLocaleString(this.homey.i18n.getLanguage(), {
      timeZone: this.homey.clock.getTimezone(),
      weekday: 'short',
      hour: 'numeric',
      minute: '2-digit',
      month: 'short',
      day: 'numeric',
    });
  }
}

module.exports = BhyveZoneDevice;
