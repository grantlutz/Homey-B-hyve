'use strict';

const BhyveDevice = require('../../lib/BhyveDevice');
const { StateStore } = require('../../lib/StateStore');


class BhyveFloodSensorDevice extends BhyveDevice {

  async syncFromStore(device) {
    if (!await this.syncAvailability(device)) return;
    const status = device.status || {};

    await this.safeSet('alarm_water', status.flood_alarm_status === 'alarm');
    await this.safeSet('alarm_heat', typeof status.temp_alarm_status === 'string'
      && status.temp_alarm_status.includes('alarm'));

    if (typeof status.temp_f === 'number') {
      const celsius = (status.temp_f - 32) * 5 / 9;
      await this.safeSet('measure_temperature', Math.round(celsius * 10) / 10);
    }

    if (typeof status.rssi === 'number') {
      await this.safeSet('measure_signal_strength', status.rssi);
    }

    const percent = StateStore.batteryPercent(device);
    if (percent !== null) {
      // alarm_battery removed in 0.1.2 (store rule: only one battery
      // capability) — clean it off devices paired with older versions.
      if (this.hasCapability('alarm_battery')) await this.removeCapability('alarm_battery').catch(this.error);
      await this.safeSet('measure_battery', Math.round(percent));
    }

    const thresholds = device.temp_alarm_thresholds || {};
    await this.setSettings({
      location: device.location_name || '',
      auto_shutoff: device.auto_shutoff ? 'On' : 'Off',
      temp_low: thresholds.low !== undefined ? `${thresholds.low} °F` : '—',
      temp_high: thresholds.high !== undefined ? `${thresholds.high} °F` : '—',
      model: device.hardware_version || '',
      firmware: device.firmware_version || '',
      mac: device.mac_address || '',
    }).catch(() => { /* settings may be mid-edit */ });
  }
}

module.exports = BhyveFloodSensorDevice;
