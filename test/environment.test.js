import assert from 'node:assert/strict';
import test from 'node:test';

import { readEnvironmentTimeoutConfig } from '../src/services/environment.service.js';

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
