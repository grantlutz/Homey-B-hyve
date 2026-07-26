'use strict';

// All Orbit endpoints and protocol constants in one place — the API is
// reverse-engineered and has changed before (May 2025 header sniffing),
// so keep every knob here. See docs/ORBIT-API.md.

module.exports = {
  API_HOST: 'https://api.orbitbhyve.com',
  WS_URL: 'wss://api.orbitbhyve.com/v1/events',
  WEB_ORIGIN: 'https://techsupport.orbitbhyve.com',

  LOGIN_PATH: '/v1/session',
  DEVICES_PATH: '/v1/devices',
  TIMER_PROGRAMS_PATH: '/v1/sprinkler_timer_programs',
  DEVICE_HISTORY_PATH: '/v1/watering_events',
  LANDSCAPE_DESCRIPTIONS_PATH: '/v1/landscape_descriptions',

  // Orbit rejects requests that don't look like the B-hyve web dashboard.
  USER_AGENT:
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 '
    + '(KHTML, like Gecko) Chrome/147.0.0.0 Safari/537.36',
  ORBIT_APP_ID: 'Bhyve Dashboard',

  REST_CACHE_MS: 300 * 1000,
  POLL_INTERVAL_MS: 5 * 60 * 1000,
  WS_PING_IDLE_MS: 25 * 1000,
  WS_BACKOFF_MIN_MS: 5 * 1000,
  WS_BACKOFF_MAX_MS: 300 * 1000,

  DEFAULT_WATER_MINUTES: 5,
  DEFAULT_RAIN_DELAY_HOURS: 24,

  DEVICE_SPRINKLER: 'sprinkler_timer',
  DEVICE_FLOOD: 'flood_sensor',
  DEVICE_BRIDGE: 'bridge',

  GALLONS_TO_M3: 0.00378541,
};
