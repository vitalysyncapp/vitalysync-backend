import assert from 'node:assert/strict';
import test from 'node:test';

import {
  createAccessToken,
  verifyAccessToken,
} from '../src/services/authToken.service.js';

test('auth tokens default to 90 days and accept only positive integer TTL overrides', () => {
  const originalTtl = process.env.AUTH_TOKEN_TTL_SECONDS;

  try {
    delete process.env.AUTH_TOKEN_TTL_SECONDS;
    const defaultPayload = verifyAccessToken(
      createAccessToken({ user_id: 42 }).access_token,
    );
    assert.equal(defaultPayload.exp - defaultPayload.iat, 60 * 60 * 24 * 90);

    process.env.AUTH_TOKEN_TTL_SECONDS = '3600';
    const configuredPayload = verifyAccessToken(
      createAccessToken({ user_id: 42 }).access_token,
    );
    assert.equal(configuredPayload.exp - configuredPayload.iat, 3600);

    for (const invalidTtl of ['0', '-1', '1.5', 'not-a-number']) {
      process.env.AUTH_TOKEN_TTL_SECONDS = invalidTtl;
      const fallbackPayload = verifyAccessToken(
        createAccessToken({ user_id: 42 }).access_token,
      );
      assert.equal(fallbackPayload.exp - fallbackPayload.iat, 60 * 60 * 24 * 90);
    }
  } finally {
    if (originalTtl == null) {
      delete process.env.AUTH_TOKEN_TTL_SECONDS;
    } else {
      process.env.AUTH_TOKEN_TTL_SECONDS = originalTtl;
    }
  }
});
