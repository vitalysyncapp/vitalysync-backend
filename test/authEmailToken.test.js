import assert from 'node:assert/strict';
import test from 'node:test';

import {
  AUTH_EMAIL_TOKEN_MESSAGES,
  AUTH_EMAIL_TOKEN_TYPES,
  consumeEmailVerificationToken,
  createEmailVerificationToken,
  hashEmailToken,
} from '../src/services/authEmailToken.service.js';

function createFakeDb(handler) {
  const calls = [];

  return {
    calls,
    async query(sql, params) {
      calls.push({ sql, params });
      return handler(sql, params, calls.length);
    },
  };
}

test('email verification tokens are hashed and stored with expiry', async () => {
  const now = new Date('2026-07-23T00:00:00.000Z');
  const db = createFakeDb(() => ({ rows: [] }));

  const result = await createEmailVerificationToken({
    userId: 7,
    email: 'Student@Example.COM',
    db,
    now,
  });

  assert.equal(typeof result.token, 'string');
  assert.ok(result.token.length > 20);
  assert.equal(result.expiresAt.toISOString(), '2026-07-24T00:00:00.000Z');
  assert.equal(db.calls.length, 2);
  assert.match(db.calls[0].sql, /UPDATE auth_email_tokens/);
  assert.equal(db.calls[0].params[1], AUTH_EMAIL_TOKEN_TYPES.emailVerification);
  assert.match(db.calls[1].sql, /INSERT INTO auth_email_tokens/);
  assert.equal(db.calls[1].params[1], 'student@example.com');
  assert.equal(db.calls[1].params[3], hashEmailToken(result.token));
  assert.equal(db.calls[1].params[3].length, 64);
});

test('email verification consumes valid tokens once', async () => {
  const rawToken = 'verification-token';
  const db = createFakeDb((sql) => {
    if (sql.includes('UPDATE auth_email_tokens')) {
      return {
        rows: [{ user_id: 7, email: 'student@example.com' }],
      };
    }

    if (sql.includes('UPDATE users')) {
      return {
        rows: [
          {
            user_id: 7,
            email: 'student@example.com',
            email_verified: true,
            email_verified_at: new Date('2026-07-23T00:00:00.000Z'),
          },
        ],
      };
    }

    return { rows: [] };
  });

  const result = await consumeEmailVerificationToken(rawToken, { db });

  assert.equal(result.user.email_verified, true);
  assert.equal(db.calls[0].params[0], hashEmailToken(rawToken));
  assert.equal(db.calls[0].params[1], AUTH_EMAIL_TOKEN_TYPES.emailVerification);
  assert.equal(db.calls.length, 2);
});

test('email verification rejects missing, expired, or already used tokens', async () => {
  const emptyResult = await consumeEmailVerificationToken('', {
    db: createFakeDb(() => ({ rows: [] })),
  });
  assert.deepEqual(emptyResult, {
    error: AUTH_EMAIL_TOKEN_MESSAGES.invalidVerificationToken,
  });

  const db = createFakeDb(() => ({ rows: [] }));
  const expiredResult = await consumeEmailVerificationToken('expired-token', {
    db,
  });

  assert.deepEqual(expiredResult, {
    error: AUTH_EMAIL_TOKEN_MESSAGES.invalidVerificationToken,
  });
  assert.equal(db.calls.length, 1);
});
