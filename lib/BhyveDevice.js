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
    if (!device) {
      await this.setUnavailable('Device not found in B-hyve account').catch(this.error);
      return false;
    }
    if (device.is_connected === false) {
      await this.setUnavailable('Device is offline in the B-hyve cloud').catch(this.error);
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
}

module.exports = BhyveDevice;
