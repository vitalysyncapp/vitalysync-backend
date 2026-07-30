import assert from 'node:assert/strict';
import test from 'node:test';

import bcrypt from 'bcrypt';

import {
  AUTH_CODE_LENGTH,
  AUTH_CODE_MAX_ATTEMPTS,
  AUTH_EMAIL_TOKEN_MESSAGES,
  AUTH_EMAIL_TOKEN_TYPES,
  consumeEmailVerificationCode,
  createEmailVerificationCode,
  createPasswordResetCode,
  exchangePasswordResetCode,
  hashEmailToken,
} from '../src/services/authEmailToken.service.js';

function createFakeDb(handler) {
  const calls = [];
  return {
    calls,
    async query(sql, params = []) {
      calls.push({ sql, params });
      return handler(sql, params, calls.length);
    },
  };
}

test('email verification codes are six digits, bcrypt hashed, and expire in ten minutes', async () => {
  const now = new Date('2026-07-23T00:00:00.000Z');
  const db = createFakeDb(() => ({ rows: [] }));

  const result = await createEmailVerificationCode({
    userId: 7,
    email: 'Student@Example.COM',
    db,
    now,
  });

  assert.match(result.code, /^\d{6}$/);
  assert.equal(result.code.length, AUTH_CODE_LENGTH);
  assert.equal(result.expiresAt.toISOString(), '2026-07-23T00:10:00.000Z');
  assert.equal(db.calls.length, 2);
  assert.equal(db.calls[0].params[1], AUTH_EMAIL_TOKEN_TYPES.emailVerification);
  assert.equal(db.calls[1].params[1], 'student@example.com');
  assert.equal(db.calls[1].params[2], AUTH_EMAIL_TOKEN_TYPES.emailVerification);
  assert.notEqual(db.calls[1].params[3], result.code);
  assert.equal(await bcrypt.compare(result.code, db.calls[1].params[3]), true);
});

test('password reset code creation invalidates the previous active code', async () => {
  const db = createFakeDb(() => ({ rows: [] }));
  const result = await createPasswordResetCode({
    userId: 9,
    email: 'reset@example.com',
    db,
    now: new Date('2026-07-23T00:00:00.000Z'),
  });

  assert.match(db.calls[0].sql, /SET consumed_at = NOW\(\)/);
  assert.equal(db.calls[0].params[1], AUTH_EMAIL_TOKEN_TYPES.passwordReset);
  assert.match(db.calls[1].sql, /token_hash, code_hash/);
  assert.equal(await bcrypt.compare(result.code, db.calls[1].params[3]), true);
});

test('email verification consumes a valid code and updates the bound user', async () => {
  const code = '123456';
  const codeHash = await bcrypt.hash(code, 4);
  const db = createFakeDb((sql) => {
    if (sql.includes('SELECT token_id')) {
      return {
        rows: [{
          token_id: 15,
          user_id: 7,
          email: 'student@example.com',
          code_hash: codeHash,
        }],
      };
    }
    if (sql.includes('UPDATE users')) {
      return {
        rows: [{
          user_id: 7,
          email: 'student@example.com',
          email_verified: true,
        }],
      };
    }
    return { rows: [] };
  });

  const result = await consumeEmailVerificationCode({ userId: 7, code, db });

  assert.equal(result.user.email_verified, true);
  assert.equal(db.calls[0].params[0], AUTH_EMAIL_TOKEN_TYPES.emailVerification);
  assert.ok(db.calls.some((call) => /SET consumed_at = NOW\(\)/.test(call.sql)));
});

test('wrong codes increment attempts and the fifth failure consumes the code', async () => {
  const codeHash = await bcrypt.hash('123456', 4);
  const db = createFakeDb((sql) => {
    if (sql.includes('SELECT token_id')) {
      return {
        rows: [{ token_id: 21, user_id: 7, email: 'student@example.com', code_hash: codeHash }],
      };
    }
    return { rows: [] };
  });

  const result = await consumeEmailVerificationCode({
    userId: 7,
    code: '654321',
    db,
  });

  assert.equal(result.error, AUTH_EMAIL_TOKEN_MESSAGES.invalidVerificationCode);
  const attemptUpdate = db.calls.find((call) => call.sql.includes('failed_attempts = failed_attempts + 1'));
  assert.equal(attemptUpdate.params[1], AUTH_CODE_MAX_ATTEMPTS);
  assert.match(attemptUpdate.sql, /consumed_at = CASE/);
});

test('malformed and expired verification codes are rejected', async () => {
  const malformedDb = createFakeDb(() => ({ rows: [] }));
  const malformed = await consumeEmailVerificationCode({
    userId: 7,
    code: '12x',
    db: malformedDb,
  });
  assert.equal(malformed.error, AUTH_EMAIL_TOKEN_MESSAGES.invalidVerificationCode);
  assert.equal(malformedDb.calls.length, 0);

  const expiredDb = createFakeDb(() => ({ rows: [] }));
  const expired = await consumeEmailVerificationCode({
    userId: 7,
    code: '123456',
    db: expiredDb,
  });
  assert.equal(expired.error, AUTH_EMAIL_TOKEN_MESSAGES.invalidVerificationCode);
  assert.equal(expiredDb.calls.length, 1);
});

test('a valid password reset code is exchanged for an opaque ten-minute grant', async () => {
  const code = '234567';
  const codeHash = await bcrypt.hash(code, 4);
  const db = createFakeDb((sql) => {
    if (sql.includes('SELECT token_id')) {
      return {
        rows: [{ token_id: 31, user_id: 8, email: 'reset@example.com', code_hash: codeHash }],
      };
    }
    return { rows: [] };
  });
  const now = new Date('2026-07-23T01:00:00.000Z');

  const result = await exchangePasswordResetCode({
    email: 'Reset@Example.com',
    code,
    db,
    now,
  });

  assert.ok(result.resetToken.length > 20);
  assert.notEqual(result.resetToken, code);
  assert.equal(result.expiresAt.toISOString(), '2026-07-23T01:10:00.000Z');
  const exchange = db.calls.find((call) => call.sql.includes('SET token_hash = $2'));
  assert.equal(exchange.params[1], hashEmailToken(result.resetToken));
  assert.equal(exchange.params.includes(code), false);
});
