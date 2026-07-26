'use strict';

const { EventEmitter } = require('events');
const C = require('./const');

class OrbitApiError extends Error {}
class OrbitAuthError extends OrbitApiError {}

/**
 * REST client for the Orbit B-hyve cloud.
 *
 * - Sends the browser-mimic headers Orbit requires on every request.
 * - Caches GETs for REST_CACHE_MS with single-flight de-duplication.
 * - On 401/403 re-logins once with stored credentials and retries;
 *   if that fails, emits 'auth_failed' so the app can start repair.
 */
class OrbitClient extends EventEmitter {
  constructor({ email, password, token = null, log = () => {} }) {
    super();
    this._email = email;
    this._password = password;
    this._token = token;
    this._log = log;
    this._cache = new Map(); // key -> { at, promise }
    this._loginPromise = null;
  }

  get token() {
    return this._token;
  }

  _headers({ auth = true } = {}) {
    const headers = {
      'Accept': 'application/json, text/plain, */*',
      'Content-Type': 'application/json; charset=utf-8;',
      'Origin': C.WEB_ORIGIN,
      'Referer': `${C.WEB_ORIGIN}/`,
      'User-Agent': C.USER_AGENT,
      'orbit-app-id': C.ORBIT_APP_ID,
    };
    if (auth && this._token) {
      headers['orbit-api-key'] = this._token;
      headers['Orbit-Session-Token'] = this._token;
    } else if (!auth) {
      headers['orbit-api-key'] = 'null';
    }
    return headers;
  }

  /** Logs in and stores the session token. Single-flight. */
  async login() {
    if (this._loginPromise) return this._loginPromise;
    this._loginPromise = (async () => {
      const res = await fetch(`${C.API_HOST}${C.LOGIN_PATH}`, {
        method: 'POST',
        headers: this._headers({ auth: false }),
        body: JSON.stringify({ session: { email: this._email, password: this._password } }),
      });
      if (res.status === 400 || res.status === 401 || res.status === 403) {
        throw new OrbitAuthError(`Login rejected (HTTP ${res.status})`);
      }
      if (!res.ok) throw new OrbitApiError(`Login failed (HTTP ${res.status})`);
      const body = await res.json();
      this._token = body.orbit_api_key || body.orbit_session_token;
      if (!this._token) throw new OrbitApiError('Login response had no session token');
      this._userId = body.user_id;
      this.emit('token', this._token);
      return this._token;
    })();
    try {
      return await this._loginPromise;
    } finally {
      this._loginPromise = null;
    }
  }

  async _request(method, path, body, { retried = false } = {}) {
    if (!this._token) await this.login();
    const url = `${C.API_HOST}${path}${path.includes('?') ? '&' : '?'}t=${Date.now()}`;
    let res;
    try {
      res = await fetch(url, {
        method,
        headers: this._headers(),
        body: body === undefined ? undefined : JSON.stringify(body),
      });
    } catch (err) {
      throw new OrbitApiError(`Network error: ${err.message}`);
    }
    if (res.status === 401 || res.status === 403) {
      if (retried) {
        this.emit('auth_failed');
        throw new OrbitAuthError(`Unauthorized (HTTP ${res.status})`);
      }
      this._log('Token rejected, re-logging in');
      this._token = null;
      try {
        await this.login();
      } catch (err) {
        if (err instanceof OrbitAuthError) this.emit('auth_failed');
        throw err;
      }
      return this._request(method, path, body, { retried: true });
    }
    if (!res.ok) throw new OrbitApiError(`HTTP ${res.status} on ${method} ${path}`);
    if (res.status === 204) return null;
    const text = await res.text();
    return text ? JSON.parse(text) : null;
  }

  /** Cached GET with single-flight de-duplication per path. */
  async _get(path, { fresh = false } = {}) {
    const cached = this._cache.get(path);
    if (cached && !fresh && Date.now() - cached.at < C.REST_CACHE_MS) {
      return cached.promise;
    }
    const promise = this._request('GET', path).catch(err => {
      // Don't cache failures
      if (this._cache.get(path)?.promise === promise) this._cache.delete(path);
      throw err;
    });
    this._cache.set(path, { at: Date.now(), promise });
    return promise;
  }

  invalidateCache() {
    this._cache.clear();
  }

  async getDevices({ fresh = false } = {}) {
    return await this._get(C.DEVICES_PATH, { fresh }) || [];
  }

  async getPrograms({ fresh = false } = {}) {
    return await this._get(C.TIMER_PROGRAMS_PATH, { fresh }) || [];
  }

  async getHistory(deviceId, { fresh = false } = {}) {
    return await this._get(`${C.DEVICE_HISTORY_PATH}/${deviceId}?page=1&per-page=10`, { fresh }) || [];
  }

  async getLandscapes(deviceId, { fresh = false } = {}) {
    return await this._get(`${C.LANDSCAPE_DESCRIPTIONS_PATH}/${deviceId}`, { fresh }) || [];
  }

  /** Enable/disable/edit a program. Only whitelisted keys are sent. */
  async updateProgram(programId, program) {
    const allowed = ['budget', 'device_id', 'enabled', 'frequency', 'id',
      'name', 'program', 'program_start_date', 'run_times', 'start_times'];
    const payload = {};
    for (const key of allowed) {
      if (program[key] !== undefined) payload[key] = program[key];
    }
    const result = await this._request(
      'PUT', `${C.TIMER_PROGRAMS_PATH}/${programId}`,
      { sprinkler_timer_program: payload },
    );
    this._cache.delete(C.TIMER_PROGRAMS_PATH);
    return result;
  }

  /** Toggle smart watering (device-level water_sense_mode). */
  async setWaterSenseMode(device, enabled) {
    const result = await this._request('PUT', `${C.DEVICES_PATH}/${device.id}`, {
      device: {
        id: device.id,
        type: device.type,
        mac_address: device.mac_address,
        water_sense_mode: enabled ? 'auto' : 'off',
      },
    });
    this._cache.delete(C.DEVICES_PATH);
    return result;
  }

  /**
   * Set soil moisture % for a zone by translating to a water level between
   * replenishment_point (0%) and field_capacity_depth (100%).
   */
  async setSoilMoisture(deviceId, station, percent) {
    const landscapes = await this.getLandscapes(deviceId, { fresh: true });
    const landscape = (landscapes || []).find(l => l.station === station);
    if (!landscape) throw new OrbitApiError(`No landscape for device ${deviceId} station ${station}`);
    const { replenishment_point: lo, field_capacity_depth: hi } = landscape;
    if (typeof lo !== 'number' || typeof hi !== 'number') {
      throw new OrbitApiError('Landscape has no moisture calibration data');
    }
    const level = lo + (Math.max(0, Math.min(100, percent)) * (hi - lo)) / 100;
    return this._request('PUT', `${C.LANDSCAPE_DESCRIPTIONS_PATH}/${landscape.id}`, {
      landscape_description: {
        id: landscape.id,
        device_id: deviceId,
        station,
        current_water_level: level,
      },
    });
  }
}

module.exports = { OrbitClient, OrbitApiError, OrbitAuthError };
