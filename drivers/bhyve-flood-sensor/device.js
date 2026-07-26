'use strict';

const BhyveDevice = require('../../lib/BhyveDevice');
const { StateStore } = require('../../lib/StateStore');

const LOW_BATTERY_PCT = 10;

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
      await this.safeSet('measure_battery', Math.round(percent));
      await this.safeSet('alarm_battery', percent <= LOW_BATTERY_PCT);
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
