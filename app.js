'use strict';

const Homey = require('homey');
const C = require('./lib/const');
const { OrbitClient, OrbitAuthError } = require('./lib/OrbitClient');
const { OrbitWebSocket } = require('./lib/OrbitWebSocket');
const { StateStore } = require('./lib/StateStore');

/**
 * One shared Orbit connection for the whole app: REST client + push
 * websocket + StateStore. Devices subscribe to store events; all commands
 * funnel through the helpers here.
 */
class BhyveApp extends Homey.App {

  async onInit() {
    this.store = new StateStore({ log: this.log.bind(this) });
    this.client = null;
    this.ws = null;
    this._pollTimer = null;
    this.authFailed = false;

    if (this.hasCredentials()) {
      this.connect().catch(err => this.error(`Startup connect failed: ${err.message}`));
    } else {
      this.log('No B-hyve credentials yet — waiting for first pairing');
    }
  }

  async onUninit() {
    this._teardown();
  }

  hasCredentials() {
    return !!(this.homey.settings.get('email') && this.homey.settings.get('password'));
  }

  isConnected() {
    return !!this.client && !this.authFailed;
  }

  /**
   * Validate credentials with a live login; on success store them and
   * (re)connect the shared client. Used by pairing and repair.
   */
  async setCredentials(email, password) {
    const probe = new OrbitClient({ email, password, log: this.log.bind(this) });
    await probe.login(); // throws OrbitAuthError on bad credentials
    this.homey.settings.set('email', email);
    this.homey.settings.set('password', password);
    this.homey.settings.set('token', probe.token);
    this._teardown();
    await this.connect();
    return true;
  }

  async connect() {
    if (this.client) return;
    this.authFailed = false;
    this.client = new OrbitClient({
      email: this.homey.settings.get('email'),
      password: this.homey.settings.get('password'),
      token: this.homey.settings.get('token'),
      log: this.log.bind(this),
    });
    this.client.on('token', token => this.homey.settings.set('token', token));
    this.client.on('auth_failed', () => this._onAuthFailed());

    await this.refresh({ fresh: true });

    this.ws = new OrbitWebSocket({
      getToken: () => this.client?.token,
      log: this.log.bind(this),
    });
    this.ws.on('message', message => this.store.applyEvent(message));
    this.ws.on('connected', () => {
      // Resync: events may have been missed while the socket was down.
      this.refresh({ fresh: true }).catch(err => this.error(`Resync failed: ${err.message}`));
    });
    this.ws.start();

    // Reconciliation poll — push is the primary channel, this catches drift.
    this._pollTimer = this.homey.setInterval(() => {
      this.refresh().catch(err => this.error(`Poll failed: ${err.message}`));
    }, C.POLL_INTERVAL_MS);
  }

  _teardown() {
    if (this._pollTimer) {
      this.homey.clearInterval(this._pollTimer);
      this._pollTimer = null;
    }
    if (this.ws) {
      this.ws.stop();
      this.ws = null;
    }
    if (this.client) {
      this.client.removeAllListeners();
      this.client = null;
    }
  }

  _onAuthFailed() {
    this.authFailed = true;
    this.error('B-hyve authentication failed — devices need repair');
    this.emitToDevices();
  }

  /** Nudge every paired device to re-evaluate availability/state. */
  emitToDevices() {
    for (const id of this.store.devices.keys()) {
      this.store.emit(`device:${id}`, this.store.devices.get(id));
    }
    if (this.authFailed) this.store.emit('auth_failed');
  }

  /** Pull REST state into the store. */
  async refresh({ fresh = false } = {}) {
    if (!this.client) throw new Error('Not connected');
    const [devices, programs] = await Promise.all([
      this.client.getDevices({ fresh }),
      this.client.getPrograms({ fresh }),
    ]);
    this.store.setDevices(devices);
    this.store.setPrograms(programs);
    await Promise.all(
      devices
        .filter(d => d.type === C.DEVICE_SPRINKLER && d.status)
        .map(async device => {
          const [history, landscapes] = await Promise.all([
            this.client.getHistory(device.id, { fresh }).catch(() => []),
            this.client.getLandscapes(device.id, { fresh }).catch(() => []),
          ]);
          this.store.setHistory(device.id, history);
          this.store.setLandscapes(device.id, landscapes);
          this.store.emit(`device:${device.id}`, this.store.getDevice(device.id));
        }),
    );
  }

  // ---- Commands (websocket) -----------------------------------------------

  _sendWs(payload) {
    if (!this.ws?.connected) {
      throw new Error(this.homey.__('errors.not_connected'));
    }
    this.ws.send(payload);
  }

  async startWatering(deviceId, station, minutes) {
    const runTime = Number(minutes)
      || (this.store.getDevice(deviceId)?.manual_preset_runtime_sec || 0) / 60
      || C.DEFAULT_WATER_MINUTES;
    this._sendWs({
      event: 'change_mode',
      mode: 'manual',
      device_id: deviceId,
      timestamp: new Date().toISOString(),
      stations: [{ station, run_time: runTime }],
    });
  }

  async stopWatering(deviceId) {
    this._sendWs({
      event: 'change_mode',
      mode: 'manual',
      device_id: deviceId,
      timestamp: new Date().toISOString(),
      stations: [],
    });
  }

  async runProgram(deviceId, programLetter) {
    this._sendWs({
      event: 'change_mode',
      mode: 'manual',
      device_id: deviceId,
      timestamp: new Date().toISOString(),
      program: programLetter,
    });
  }

  async setMode(deviceId, mode) {
    this._sendWs({ event: 'change_mode', device_id: deviceId, mode });
  }

  async setRainDelay(deviceId, hours) {
    this._sendWs({ event: 'rain_delay', device_id: deviceId, delay: hours });
  }

  async setPresetRuntime(deviceId, minutes) {
    this._sendWs({
      event: 'set_manual_preset_runtime',
      device_id: deviceId,
      seconds: Math.round(minutes * 60),
    });
  }

  // ---- Commands (REST) ------------------------------------------------------

  async setSmartWatering(deviceId, enabled) {
    const device = this.store.getDevice(deviceId);
    if (!device) throw new Error('Unknown device');
    await this.client.setWaterSenseMode(device, enabled);
    device.water_sense_mode = enabled ? 'auto' : 'off';
    this.store.emit(`device:${deviceId}`, device);
  }

  async setSoilMoisture(deviceId, station, percent) {
    const zone = this.store.getZone(deviceId, station);
    if (zone && zone.smart_watering_enabled === false
        && this.store.getDevice(deviceId)?.water_sense_mode !== 'auto') {
      throw new Error(this.homey.__('errors.not_smart_zone'));
    }
    await this.client.setSoilMoisture(deviceId, station, percent);
  }

  async setProgramEnabled(programId, enabled) {
    const program = this.store.programs.get(programId);
    if (!program) throw new Error('Unknown program');
    await this.client.updateProgram(programId, { ...program, enabled });
    program.enabled = enabled;
    this.store.emit('programs_changed');
  }

  async setProgramBudget(programId, budget) {
    const program = this.store.programs.get(programId);
    if (!program) throw new Error('Unknown program');
    await this.client.updateProgram(programId, { ...program, budget });
    program.budget = budget;
    this.store.emit('programs_changed');
  }

  /** Autocomplete results for program args, scoped to one timer device. */
  programAutocomplete(deviceId, query) {
    const q = (query || '').toLowerCase();
    return this.store.getProgramsForDevice(deviceId)
      .filter(p => !p.is_smart_program)
      .filter(p => (p.name || '').toLowerCase().includes(q)
        || (p.program || '').toLowerCase().includes(q))
      .map(p => ({
        id: p.id,
        name: p.name || `Program ${(p.program || '?').toUpperCase()}`,
        description: p.enabled === false ? this.homey.__('program.disabled') : undefined,
        letter: p.program,
      }));
  }

  /** Pairing/repair helper shared by all drivers. */
  registerLoginHandlers(session) {
    session.setHandler('login', async data => {
      try {
        await this.setCredentials(data.username, data.password);
        return true;
      } catch (err) {
        if (err instanceof OrbitAuthError) return false;
        throw err;
      }
    });
    session.setHandler('showView', async viewId => {
      // Already logged in? Skip straight to device selection.
      if (viewId === 'login_credentials' && this.isConnected()) {
        await session.showView('list_devices');
      }
    });
  }

  /** Make sure we have live account data for pairing lists. */
  async ensureFreshDevices() {
    if (!this.client) {
      if (!this.hasCredentials()) throw new Error(this.homey.__('errors.no_credentials'));
      await this.connect();
    } else {
      await this.refresh({ fresh: true });
    }
    return [...this.store.devices.values()];
  }
}

module.exports = BhyveApp;
