import assert from 'node:assert/strict';
import test from 'node:test';

import {
  fetchEnvironmentSnapshot,
  readEnvironmentTimeoutConfig,
} from '../src/services/environment.service.js';

test('environment service timeout config uses default and validates override', () => {
  assert.deepEqual(readEnvironmentTimeoutConfig({}), {
    openWeatherMs: 12000,
  });
  assert.deepEqual(
    readEnvironmentTimeoutConfig({ OPENWEATHER_TIMEOUT_MS: '18000' }),
    {
      openWeatherMs: 18000,
    }
  );
  assert.throws(
    () => readEnvironmentTimeoutConfig({ OPENWEATHER_TIMEOUT_MS: '-1' }),
    /OPENWEATHER_TIMEOUT_MS must be a positive integer/
  );
});

test('environment snapshot returns canonical weather and AQI codes', async () => {
  const originalFetch = globalThis.fetch;
  const originalApiKey = process.env.OPENWEATHER_API_KEY;
  process.env.OPENWEATHER_API_KEY = 'test-key';
  globalThis.fetch = async (url) => {
    const isAir = String(url).includes('/air_pollution');
    return {
      ok: true,
      json: async () => isAir
        ? { list: [{ main: { aqi: 4 }, components: {} }] }
        : {
            name: 'Manila',
            coord: { lat: 14.6, lon: 121 },
            weather: [{ id: 501, main: 'Rain', description: 'moderate rain', icon: '10d' }],
            main: {},
            wind: {},
          },
    };
  };

  try {
    const snapshot = await fetchEnvironmentSnapshot({ lat: 14.6, lon: 121 });
    assert.equal(snapshot.weather.condition_code, 501);
    assert.equal(snapshot.air_quality.aqi, 4);
    assert.equal(snapshot.air_quality.aqi_label, 'Poor');
  } finally {
    globalThis.fetch = originalFetch;
    if (originalApiKey == null) delete process.env.OPENWEATHER_API_KEY;
    else process.env.OPENWEATHER_API_KEY = originalApiKey;
  }
});
