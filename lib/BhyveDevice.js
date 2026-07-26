'use strict';

const Homey = require('homey');

/**
 * Shared base for all B-hyve devices: subscribes to the app's StateStore,
 * handles availability, and offers tolerant capability writes.
 */
class BhyveDevice extends Homey.Device {

  /** @returns {import('../app')} */
  get app() {
    return this.homey.app;
  }

  get orbitDeviceId() {
    return this.getData().deviceId;
  }

  async onInit() {
    this._onStoreUpdate = device => {
      this.syncFromStore(device).catch(err => this.error(`Sync failed: ${err.message}`));
    };
    this._onAuthFailed = () => {
      this.setUnavailable(this.homey.__('errors.auth_failed')).catch(this.error);
    };
    this.app.store.on(`device:${this.orbitDeviceId}`, this._onStoreUpdate);
    this.app.store.on('auth_failed', this._onAuthFailed);

    const current = this.app.store.getDevice(this.orbitDeviceId);
    if (current) {
      await this.syncFromStore(current).catch(err => this.error(`Initial sync failed: ${err.message}`));
    }
  }

  async onUninit() {
    this._unsubscribe();
  }

  async onDeleted() {
    this._unsubscribe();
  }

  _unsubscribe() {
    if (this._onStoreUpdate) {
      this.app.store.removeListener(`device:${this.orbitDeviceId}`, this._onStoreUpdate);
    }
    if (this._onAuthFailed) {
      this.app.store.removeListener('auth_failed', this._onAuthFailed);
    }
  }

  /**
   * Availability from Orbit connectivity. Returns false when the device
   * should not sync capability state.
   */
  async syncAvailability(device) {
    if (this.app.authFailed) {
      await this.setUnavailable(this.homey.__('errors.auth_failed')).catch(this.error);
      return false;
    }
    if (this.app.wsDown) {
      await this.setUnavailable(this.homey.__('errors.ws_down')).catch(this.error);
      return false;
    }
    if (!device) {
      await this.setUnavailable(this.homey.__('errors.device_missing')).catch(this.error);
      return false;
    }
    if (device.is_connected === false) {
      await this.setUnavailable(this.homey.__('errors.device_offline')).catch(this.error);
      return false;
    }
    await this.setAvailable().catch(this.error);
    return true;
  }

  /** setCapabilityValue that skips missing capabilities and logs failures. */
  async safeSet(capability, value) {
    if (!this.hasCapability(capability)) return;
    if (value === undefined) return;
    try {
      await this.setCapabilityValue(capability, value);
    } catch (err) {
      this.error(`Set ${capability}=${value} failed: ${err.message}`);
    }
  }

  /** Override in subclasses. */
  async syncFromStore(_device) {}

  /** Localized "next watering" text from device status, e.g. "Sat, Jul 26, 6:00 AM (A)". */
  formatNextStart(status) {
    if ((status.rain_delay || 0) > 0) return this.homey.__('next_start.rain_delayed');
    if (!status.next_start_time) return '—';
    const date = new Date(status.next_start_time);
    if (Number.isNaN(date.getTime())) return '—';
    const text = date.toLocaleString(this.homey.i18n.getLanguage(), {
      timeZone: this.homey.clock.getTimezone(),
      weekday: 'short',
      hour: 'numeric',
      minute: '2-digit',
      month: 'short',
      day: 'numeric',
    });
    const programs = (status.next_start_programs || [])
      .map(p => String(p).toUpperCase()).join(', ');
    return programs ? `${text} (${programs})` : text;
  }
}

module.exports = BhyveDevice;
