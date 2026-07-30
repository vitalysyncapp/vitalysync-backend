import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import bcrypt from 'bcrypt';

import {
  AccountLifecycleError,
  USER_OWNED_TABLES,
  clearAccountData,
  deactivateAccount,
  purgeExpiredDeactivatedAccounts,
  reactivateAccount,
} from '../src/services/accountLifecycle.service.js';
import {
  createAccountReactivationGrant,
  verifyAccessToken,
  verifyAccountReactivationGrant,
} from '../src/services/authToken.service.js';

const migrationsDirectory = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../migrations',
);

function transactionDb(query) {
  const commands = [];
  const client = {
    async query(sql, params = []) {
      const normalized = String(sql).replace(/\s+/g, ' ').trim();
      commands.push({ sql: normalized, params });
      if (['BEGIN', 'COMMIT', 'ROLLBACK'].includes(normalized)) {
        return { rows: [], rowCount: 0 };
      }
      return query(normalized, params, commands);
    },
    release() {},
  };
  return {
    commands,
    db: { async connect() { return client; } },
  };
}

test('reactivation grants are purpose-limited, signed, and expire', () => {
  const now = new Date('2026-07-30T00:00:00.000Z');
  const grant = createAccountReactivationGrant(
    { user_id: 7, auth_token_version: 3 },
    { now },
  );
  const payload = verifyAccountReactivationGrant(grant.reactivation_token, {
    now: new Date('2026-07-30T00:05:00.000Z'),
  });

  assert.equal(payload.sub, 7);
  assert.equal(payload.ver, 3);
  assert.throws(
    () => verifyAccessToken(grant.reactivation_token),
    /access token/,
  );
  assert.throws(
    () => verifyAccountReactivationGrant(grant.reactivation_token, {
      now: new Date('2026-07-30T00:11:00.000Z'),
    }),
    /expired/,
  );
});

test('deactivation validates the password, stores both deadlines, and revokes sessions', async () => {
  const passwordHash = await bcrypt.hash('last-password', 4);
  const now = new Date('2026-07-30T00:00:00.000Z');
  const { db, commands } = transactionDb(async (sql, params) => {
    if (sql.includes('FROM users') && sql.includes('FOR UPDATE')) {
      return { rows: [{
        user_id: 7,
        password: passwordHash,
        auth_token_version: 2,
        deactivated_at: null,
      }] };
    }
    if (sql.startsWith('UPDATE users')) {
      return { rows: [{
        user_id: 7,
        auth_token_version: 3,
        deactivated_at: params[1],
        reactivation_deadline: params[2],
        retention_expires_at: params[3],
      }] };
    }
    return { rows: [], rowCount: 0 };
  });

  const result = await deactivateAccount({
    userId: 7,
    currentPassword: 'last-password',
    confirmation: 'CONFIRM',
    db,
    now,
  });

  assert.equal(
    new Date(result.reactivation_deadline).toISOString(),
    '2026-09-08T00:00:00.000Z',
  );
  assert.equal(
    new Date(result.retention_expires_at).toISOString(),
    '2031-07-30T00:00:00.000Z',
  );
  assert.ok(commands.some(({ sql }) => sql.includes('auth_token_version = auth_token_version + 1')));
  assert.ok(commands.some(({ sql }) => sql.startsWith('UPDATE auth_email_tokens')));
  assert.equal(commands.at(-1).sql, 'COMMIT');
});

test('deactivation requires exact CONFIRM and rolls back an incorrect password', async () => {
  assert.throws(
    () => deactivateAccount({
      userId: 7,
      currentPassword: 'secret',
      confirmation: 'confirm',
      db: {},
    }),
    (error) => error instanceof AccountLifecycleError && /CONFIRM/.test(error.message),
  );

  const passwordHash = await bcrypt.hash('correct', 4);
  const { db, commands } = transactionDb(async (sql) => {
    if (sql.includes('FROM users')) {
      return { rows: [{ user_id: 7, password: passwordHash, deactivated_at: null }] };
    }
    return { rows: [] };
  });
  await assert.rejects(
    deactivateAccount({
      userId: 7,
      currentPassword: 'wrong',
      confirmation: 'CONFIRM',
      db,
    }),
    /Current password is incorrect/,
  );
  assert.equal(commands.at(-1).sql, 'ROLLBACK');
});

test('clear account data deletes every owned table, preserves users, and resets non-auth fields', async () => {
  const passwordHash = await bcrypt.hash('secret', 4);
  const { db, commands } = transactionDb(async (sql) => {
    if (sql.includes('FROM users') && sql.includes('FOR UPDATE')) {
      return { rows: [{
        user_id: 7,
        password: passwordHash,
        deactivated_at: null,
      }] };
    }
    if (sql.startsWith('UPDATE users')) {
      return { rows: [{ user_id: 7, auth_token_version: 8 }] };
    }
    return { rows: [], rowCount: 0 };
  });

  await clearAccountData({ userId: 7, currentPassword: 'secret', db });

  const deletes = commands
    .filter(({ sql }) => sql.startsWith('DELETE FROM'))
    .map(({ sql }) => sql.split(' ')[2]);
  assert.deepEqual(deletes, [...USER_OWNED_TABLES]);
  assert.equal(deletes.includes('users'), false);
  const usersUpdate = commands.find(({ sql }) => sql.startsWith('UPDATE users'));
  assert.match(usersUpdate.sql, /onboarding_completed = FALSE/);
  assert.match(usersUpdate.sql, /age = NULL/);
  assert.match(usersUpdate.sql, /auth_token_version = auth_token_version \+ 1/);
  assert.equal(commands.at(-1).sql, 'COMMIT');
});

test('clear account data rolls back if any owned-table deletion fails', async () => {
  const passwordHash = await bcrypt.hash('secret', 4);
  const { db, commands } = transactionDb(async (sql) => {
    if (sql.includes('FROM users')) {
      return { rows: [{ user_id: 7, password: passwordHash, deactivated_at: null }] };
    }
    if (sql.startsWith('DELETE FROM user_settings')) {
      throw new Error('delete failed');
    }
    return { rows: [] };
  });

  await assert.rejects(
    clearAccountData({ userId: 7, currentPassword: 'secret', db }),
    /delete failed/,
  );
  assert.equal(commands.at(-1).sql, 'ROLLBACK');
});

test('clear-data registry covers every migration table directly owned by users', async () => {
  const ownedTables = new Set();
  for (const filename of await fs.readdir(migrationsDirectory)) {
    if (!filename.endsWith('.sql')) continue;
    const sql = await fs.readFile(path.join(migrationsDirectory, filename), 'utf8');
    const tablePattern = /CREATE TABLE(?: IF NOT EXISTS)?\s+(\w+)\s*\(([\s\S]*?)\);/gi;
    for (const match of sql.matchAll(tablePattern)) {
      if (/REFERENCES\s+users\s*\(\s*user_id\s*\)/i.test(match[2])) {
        ownedTables.add(match[1]);
      }
    }
    const alteredTablePattern = /ALTER TABLE\s+(\w+)([\s\S]*?)(?=ALTER TABLE|CREATE TABLE|$)/gi;
    for (const match of sql.matchAll(alteredTablePattern)) {
      if (/REFERENCES\s+users\s*\(\s*user_id\s*\)/i.test(match[2])) {
        ownedTables.add(match[1]);
      }
    }
  }

  assert.deepEqual(
    [...USER_OWNED_TABLES].sort(),
    [...ownedTables].sort(),
  );
});

test('reactivation restores an eligible account and makes its grant single-use', async () => {
  const now = new Date('2026-07-30T00:00:00.000Z');
  const grant = createAccountReactivationGrant(
    { user_id: 7, auth_token_version: 3 },
    { now },
  );
  let active = false;
  const { db } = transactionDb(async (sql) => {
    if (sql.includes('FROM users') && sql.includes('FOR UPDATE')) {
      return { rows: [{
        user_id: 7,
        password: 'unused',
        auth_token_version: 3,
        deactivated_at: active ? null : now,
        reactivation_deadline: new Date('2026-09-08T00:00:00.000Z'),
      }] };
    }
    if (sql.startsWith('UPDATE users')) {
      active = true;
      return { rows: [{ auth_token_version: 3 }] };
    }
    if (sql.startsWith('SELECT users.user_id')) {
      return { rows: [{
        user_id: 7,
        username: 'Student',
        email: 'student@example.com',
        email_verified: true,
        onboarding_completed: true,
        has_onboarding_profile: true,
        role: 'Student',
      }] };
    }
    if (sql.includes('FROM user_streaks')) {
      return { rows: [{ current_streak: 4, longest_streak: 9, last_logged_date: null }] };
    }
    return { rows: [] };
  });

  const session = await reactivateAccount({
    reactivationToken: grant.reactivation_token,
    db,
    now: new Date('2026-07-30T00:05:00.000Z'),
  });
  assert.equal(session.user.onboarding_completed, true);
  assert.ok(session.access_token);

  await assert.rejects(
    reactivateAccount({
      reactivationToken: grant.reactivation_token,
      db,
      now: new Date('2026-07-30T00:06:00.000Z'),
    }),
    /Invalid or expired reactivation session/,
  );
});

test('expired deactivated accounts are permanently purged by retention cleanup', async () => {
  const { db, commands } = transactionDb(async (sql) => {
    if (sql.startsWith('SELECT user_id FROM users')) {
      return { rows: [{ user_id: 1 }, { user_id: 2 }] };
    }
    return { rows: [], rowCount: 0 };
  });
  const count = await purgeExpiredDeactivatedAccounts({ db });

  assert.equal(count, 2);
  assert.ok(commands.some(({ sql }) => /retention_expires_at <= NOW\(\)/.test(sql)));
  assert.equal(
    commands.filter(({ sql }) => sql === 'DELETE FROM users WHERE user_id = $1').length,
    2,
  );
  assert.equal(commands.at(-1).sql, 'COMMIT');
});
