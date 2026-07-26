'use strict';

const Homey = require('homey');
const C = require('../../lib/const');

class BhyveTimerDriver extends Homey.Driver {

  async onInit() {
    const app = this.homey.app;

    // Triggers
    this._rainDelayStarted = this.homey.flow.getDeviceTriggerCard('rain_delay_started');
    this._rainDelayEnded = this.homey.flow.getDeviceTriggerCard('rain_delay_ended');
    this._modeChanged = this.homey.flow.getDeviceTriggerCard('mode_changed');
    this._stationFault = this.homey.flow.getDeviceTriggerCard('station_fault');

    app.store.on('rain_delay_changed', ({ device, hours }) => {
      const paired = this._findDevice(device.id);
      if (!paired) return;
      if (hours > 0) {
        this._rainDelayStarted.trigger(paired, {
          hours,
          cause: device.status?.rain_delay_cause || '',
          weather: device.status?.rain_delay_weather_type || '',
        }).catch(this.error);
      } else {
        this._rainDelayEnded.trigger(paired).catch(this.error);
      }
    });

    app.store.on('mode_changed', ({ device, mode }) => {
      const paired = this._findDevice(device.id);
      if (!paired || !mode) return;
      this._modeChanged.trigger(paired, { mode }).catch(this.error);
    });

    app.store.on('fault', ({ device, faults }) => {
      const paired = this._findDevice(device.id);
      if (!paired) return;
      this._stationFault.trigger(paired, { faults: JSON.stringify(faults) }).catch(this.error);
    });

    // Conditions
    this.homey.flow.getConditionCard('rain_delay_is_active')
      .registerRunListener(async args => args.device.getCapabilityValue('rain_delay_active') === true);

    this.homey.flow.getConditionCard('mode_is')
      .registerRunListener(async args => args.device.getCapabilityValue('run_mode') === args.mode);

    const programEnabled = this.homey.flow.getConditionCard('program_is_enabled');
    programEnabled.registerRunListener(async args => {
      const program = app.store.programs.get(args.program.id);
      return program?.enabled === true;
    });
    programEnabled.registerArgumentAutocompleteListener('program',
      async (query, args) => app.programAutocomplete(args.device.orbitDeviceId, query));

    // Actions
    this.homey.flow.getActionCard('set_rain_delay')
      .registerRunListener(async args => app.setRainDelay(args.device.orbitDeviceId, args.hours));

    this.homey.flow.getActionCard('cancel_rain_delay')
      .registerRunListener(async args => app.setRainDelay(args.device.orbitDeviceId, 0));

    this.homey.flow.getActionCard('set_mode')
      .registerRunListener(async args => app.setMode(args.device.orbitDeviceId, args.mode));

    const runProgram = this.homey.flow.getActionCard('run_program');
    runProgram.registerRunListener(async args => app.runProgram(args.device.orbitDeviceId, args.program.letter));
    runProgram.registerArgumentAutocompleteListener('program',
      async (query, args) => app.programAutocomplete(args.device.orbitDeviceId, query));

    const setProgramEnabled = this.homey.flow.getActionCard('set_program_enabled');
    setProgramEnabled.registerRunListener(
      async args => app.setProgramEnabled(args.program.id, args.state === 'enable'),
    );
    setProgramEnabled.registerArgumentAutocompleteListener('program',
      async (query, args) => app.programAutocomplete(args.device.orbitDeviceId, query));

    const setProgramBudget = this.homey.flow.getActionCard('set_program_budget');
    setProgramBudget.registerRunListener(
      async args => app.setProgramBudget(args.program.id, Math.round(args.budget)),
    );
    setProgramBudget.registerArgumentAutocompleteListener('program',
      async (query, args) => app.programAutocomplete(args.device.orbitDeviceId, query));
  }

  _findDevice(orbitDeviceId) {
    return this.getDevices().find(d => d.orbitDeviceId === orbitDeviceId) || null;
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
    return devices
      .filter(d => d.type === C.DEVICE_SPRINKLER)
      .map(d => ({
        name: d.name || 'B-hyve Timer',
        data: { deviceId: d.id },
        settings: {
          model: d.hardware_version || '',
          firmware: d.firmware_version || '',
          mac: d.mac_address || '',
          stations: String(d.num_stations || (d.zones || []).length || 1),
        },
      }));
  }
}

module.exports = BhyveTimerDriver;
