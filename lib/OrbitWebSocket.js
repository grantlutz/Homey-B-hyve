'use strict';

const { EventEmitter } = require('events');
const WebSocket = require('ws');
const C = require('./const');

/**
 * Push connection to wss://api.orbitbhyve.com/v1/events.
 *
 * Protocol (see docs/ORBIT-API.md):
 * - after connect, send {"event":"app_connection","orbit_session_token":token}
 * - send {"event":"ping"} after 25 s of inactivity or the socket silently dies
 * - reconnect with 5 s → 300 s exponential backoff (handshake 5xx is normal)
 *
 * Emits: 'connected', 'disconnected', 'message' (parsed JSON with an `event` field).
 */
class OrbitWebSocket extends EventEmitter {
  constructor({ getToken, log = () => {} }) {
    super();
    this._getToken = getToken;
    this._log = log;
    this._ws = null;
    this._backoff = C.WS_BACKOFF_MIN_MS;
    this._pingTimer = null;
    this._reconnectTimer = null;
    this._stopped = true;
  }

  get connected() {
    return !!this._ws && this._ws.readyState === WebSocket.OPEN;
  }

  start() {
    this._stopped = false;
    this._connect();
  }

  stop() {
    this._stopped = true;
    this._clearTimers();
    if (this._ws) {
      this._ws.removeAllListeners();
      try { this._ws.close(); } catch (err) { /* already closing */ }
      this._ws = null;
    }
  }

  send(payload) {
    if (!this.connected) throw new Error('B-hyve push connection is not connected');
    this._ws.send(JSON.stringify(payload));
    this._armPing();
  }

  _connect() {
    if (this._stopped) return;
    this._clearTimers();
    const ws = new WebSocket(C.WS_URL, {
      headers: { 'User-Agent': C.USER_AGENT },
      origin: C.WEB_ORIGIN,
      handshakeTimeout: 15000,
    });
    this._ws = ws;

    ws.on('open', () => {
      this._log('WebSocket connected');
      this._backoff = C.WS_BACKOFF_MIN_MS;
      try {
        ws.send(JSON.stringify({
          event: 'app_connection',
          orbit_session_token: this._getToken(),
        }));
      } catch (err) {
        this._log(`WebSocket hello failed: ${err.message}`);
      }
      this._armPing();
      this.emit('connected');
    });

    ws.on('message', data => {
      this._armPing();
      let message;
      try {
        message = JSON.parse(data.toString());
      } catch (err) {
        return; // non-JSON frame, ignore
      }
      if (message && message.event) this.emit('message', message);
    });

    ws.on('ping', () => this._armPing()); // ws lib auto-pongs

    ws.on('error', err => {
      this._log(`WebSocket error: ${err.message}`);
    });

    ws.on('close', (code) => {
      this._log(`WebSocket closed (${code})`);
      if (this._ws === ws) this._ws = null;
      this._clearTimers();
      this.emit('disconnected');
      this._scheduleReconnect();
    });
  }

  _scheduleReconnect() {
    if (this._stopped || this._reconnectTimer) return;
    const delay = this._backoff;
    this._backoff = Math.min(this._backoff * 2, C.WS_BACKOFF_MAX_MS);
    this._log(`WebSocket reconnecting in ${Math.round(delay / 1000)}s`);
    this._reconnectTimer = setTimeout(() => {
      this._reconnectTimer = null;
      this._connect();
    }, delay);
  }

  _armPing() {
    if (this._pingTimer) clearTimeout(this._pingTimer);
    this._pingTimer = setTimeout(() => {
      this._pingTimer = null;
      if (!this.connected) return;
      try {
        this._ws.send(JSON.stringify({ event: 'ping' }));
        this._armPing();
      } catch (err) {
        this._log(`WebSocket ping failed: ${err.message}`);
      }
    }, C.WS_PING_IDLE_MS);
  }

  _clearTimers() {
    if (this._pingTimer) { clearTimeout(this._pingTimer); this._pingTimer = null; }
    if (this._reconnectTimer) { clearTimeout(this._reconnectTimer); this._reconnectTimer = null; }
  }
}

module.exports = { OrbitWebSocket };
