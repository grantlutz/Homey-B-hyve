'use strict';

const Homey = require('homey');
const C = require('../../lib/const');

class BhyveFloodSensorDriver extends Homey.Driver {

  async onPair(session) {
    this.homey.app.registerLoginHandlers(session);
    session.setHandler('list_devices', async () => this._listDevices());
  }

  async onRepair(session, _device) {
    this.homey.app.registerLoginHandlers(session);
  }

  async _listDevices() {
    const devices = await this.homey.app.ensureFreshDevices();
    return devices
      .filter(d => d.type === C.DEVICE_FLOOD)
      .map(d => ({
        name: d.name || d.location_name || 'B-hyve Flood Sensor',
        data: { deviceId: d.id },
      }));
  }
}

module.exports = BhyveFloodSensorDriver;
