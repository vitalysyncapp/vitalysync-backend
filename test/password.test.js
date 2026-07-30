import assert from 'node:assert/strict';
import test from 'node:test';

import bcrypt from 'bcrypt';

import {
  PASSWORD_CHANGE_MESSAGES,
  changeAuthenticatedPassword,
  resetPasswordWithGrant,
} from '../src/services/password.service.js';
import { hashEmailToken } from '../src/services/authEmailToken.service.js';

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

test('password reset grant updates the hash, increments token version, and is consumed', async () => {
  const currentHash = await bcrypt.hash('old-password', 4);
  const db = createFakeDb((sql, params) => {
    if (sql.includes('FROM auth_email_tokens')) {
      assert.equal(params[0], hashEmailToken('reset-grant'));
      return { rows: [{ token_id: 4, user_id: 7, email: 'student@example.com' }] };
    }
    if (sql.includes('SELECT user_id, email, password')) {
      return { rows: [{ user_id: 7, email: 'student@example.com', password: currentHash }] };
    }
    if (sql.includes('UPDATE users')) {
      return { rows: [{ user_id: 7, email: 'student@example.com', auth_token_version: 2 }] };
    }
    return { rows: [] };
  });

  const result = await resetPasswordWithGrant({
    resetToken: 'reset-grant',
    newPassword: 'new-password',
    db,
  });

  assert.equal(result.user.auth_token_version, 2);
  const passwordUpdate = db.calls.find((call) => call.sql.includes('auth_token_version = auth_token_version + 1'));
  assert.equal(await bcrypt.compare('new-password', passwordUpdate.params[1]), true);
  assert.ok(db.calls.some((call) => call.sql.includes('WHERE token_id = $1') && call.sql.includes('consumed_at')));
});

test('password reset rejects reuse of the current password without consuming its grant', async () => {
  const currentHash = await bcrypt.hash('same-password', 4);
  const db = createFakeDb((sql) => {
    if (sql.includes('FROM auth_email_tokens')) {
      return { rows: [{ token_id: 4, user_id: 7, email: 'student@example.com' }] };
    }
    if (sql.includes('SELECT user_id, email, password')) {
      return { rows: [{ user_id: 7, email: 'student@example.com', password: currentHash }] };
    }
    return { rows: [] };
  });

  const result = await resetPasswordWithGrant({
    resetToken: 'reset-grant',
    newPassword: 'same-password',
    db,
  });

  assert.equal(result.error, PASSWORD_CHANGE_MESSAGES.passwordUnchanged);
  assert.equal(db.calls.some((call) => call.sql.includes('UPDATE users')), false);
});

test('authenticated password change verifies the current password and revokes sessions', async () => {
  const currentHash = await bcrypt.hash('old-password', 4);
  const db = createFakeDb((sql) => {
    if (sql.includes('SELECT user_id, password')) {
      return { rows: [{ user_id: 7, password: currentHash }] };
    }
    if (sql.includes('UPDATE users')) {
      return { rows: [{ user_id: 7, auth_token_version: 5 }] };
    }
    return { rows: [] };
  });

  const result = await changeAuthenticatedPassword({
    userId: 7,
    currentPassword: 'old-password',
    newPassword: 'new-password',
    db,
  });

  assert.equal(result.user.auth_token_version, 5);
  assert.ok(db.calls.some((call) => call.sql.includes('auth_token_version = auth_token_version + 1')));
});

test('authenticated password change rejects an incorrect current password', async () => {
  const currentHash = await bcrypt.hash('old-password', 4);
  const db = createFakeDb((sql) => sql.includes('SELECT user_id, password')
    ? { rows: [{ user_id: 7, password: currentHash }] }
    : { rows: [] });

  const result = await changeAuthenticatedPassword({
    userId: 7,
    currentPassword: 'wrong-password',
    newPassword: 'new-password',
    db,
  });

  assert.equal(result.error, PASSWORD_CHANGE_MESSAGES.invalidCurrentPassword);
  assert.equal(db.calls.some((call) => call.sql.includes('UPDATE users')), false);
});
