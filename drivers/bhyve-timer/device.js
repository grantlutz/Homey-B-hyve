'use strict';

const BhyveDevice = require('../../lib/BhyveDevice');
const { StateStore } = require('../../lib/StateStore');
const C = require('../../lib/const');

const LOW_BATTERY_PCT = 10;

class BhyveTimerDevice extends BhyveDevice {

  async onInit() {
    this.registerCapabilityListener('run_mode', async value => {
      if (value === 'manual') {
        throw new Error(this.homey.__('errors.manual_mode'));
      }
      await this.app.setMode(this.orbitDeviceId, value);
    });

    this.registerCapabilityListener('rain_delay_active', async value => {
      const hours = value
        ? (this.getSetting('default_rain_delay_hours') || C.DEFAULT_RAIN_DELAY_HOURS)
        : 0;
      await this.app.setRainDelay(this.orbitDeviceId, hours);
    });

    // Keep "rain delay remaining" counting down between push updates.
    this._countdownTimer = this.homey.setInterval(() => {
      this._syncRainDelayRemaining(this.app.store.getDevice(this.orbitDeviceId));
    }, 5 * 60 * 1000);

    await super.onInit();
  }

  async onUninit() {
    if (this._countdownTimer) this.homey.clearInterval(this._countdownTimer);
    await super.onUninit();
  }

  async onDeleted() {
    if (this._countdownTimer) this.homey.clearInterval(this._countdownTimer);
    await super.onDeleted();
  }

  async syncFromStore(device) {
    if (!await this.syncAvailability(device)) return;
    const status = device.status || {};

    await this.safeSet('run_mode', ['auto', 'off', 'manual'].includes(status.run_mode) ? status.run_mode : 'off');
    await this.safeSet('rain_delay_active', (status.rain_delay || 0) > 0);
    this._syncRainDelayRemaining(device);

    await this.safeSet('next_start', this.formatNextStart(status));
    await this.safeSet('alarm_generic', (status.station_faults || []).length > 0);

    // Battery only exists on hose timers; drop the capabilities on mains models.
    const percent = StateStore.batteryPercent(device);
    if (percent === null) {
      if (this.hasCapability('measure_battery')) await this.removeCapability('measure_battery').catch(this.error);
      if (this.hasCapability('alarm_battery')) await this.removeCapability('alarm_battery').catch(this.error);
    } else {
      await this.safeSet('measure_battery', Math.round(percent));
      await this.safeSet('alarm_battery', percent <= LOW_BATTERY_PCT);
    }

    await this.setSettings({
      model: device.hardware_version || '',
      firmware: device.firmware_version || '',
      mac: device.mac_address || '',
      stations: String(device.num_stations || (device.zones || []).length || 1),
      last_seen: this._formatLastSeen(device),
    }).catch(() => { /* settings may be mid-edit */ });
  }

  _formatLastSeen(device) {
    if (!device.last_connected_at) return '—';
    const date = new Date(device.last_connected_at);
    if (Number.isNaN(date.getTime())) return '—';
    return date.toLocaleString(this.homey.i18n.getLanguage(), {
      timeZone: this.homey.clock.getTimezone(),
    });
  }

  _syncRainDelayRemaining(device) {
    if (!device) return;
    const status = device.status || {};
    const hours = Number(status.rain_delay) || 0;
    let remaining = 0;
    if (hours > 0) {
      const startedAt = status.rain_delay_started_at ? Date.parse(status.rain_delay_started_at) : NaN;
      if (Number.isFinite(startedAt)) {
        remaining = Math.max(0, hours - (Date.now() - startedAt) / 3600000);
      } else {
        remaining = hours;
      }
    }
    this.safeSet('rain_delay_remaining', Math.round(remaining * 10) / 10).catch(this.error);
  }

}

module.exports = BhyveTimerDevice;
