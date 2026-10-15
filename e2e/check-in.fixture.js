import { test as base, expect } from '@playwright/test';
import dotenv from 'dotenv';
import pg from 'pg';
import { randomBytes } from 'node:crypto';
import { readdir, readFile, access } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const backendDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const webDir = path.resolve(backendDir, '../vitalysync-frontend/build/web');
export const apiUrl = 'http://127.0.0.1:4181';
export const webUrl = 'http://127.0.0.1:4173';
export const today = () => new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Manila', year: 'numeric', month: '2-digit', day: '2-digit',
}).format(new Date());

function listen(app, port) {
  return new Promise((resolve, reject) => {
    const server = app.listen(port, '127.0.0.1', () => resolve(server));
    server.once('error', reject);
  });
}

async function close(server) {
  if (!server) return;
  await new Promise((resolve) => server.close(resolve));
}

export const test = base.extend({
  system: [async ({}, use) => {
    await access(path.join(webDir, 'index.html'));
    expect((await readFile(path.join(webDir, 'main.dart.js'), 'utf8')).includes(apiUrl),
      'Rebuild Flutter web with API_BASE_URL=http://127.0.0.1:4181').toBe(true);
    dotenv.config({ path: path.join(backendDir, '.env') });
    const connection = process.env.DATABASE_URL
      ? { connectionString: process.env.DATABASE_URL }
      : { host: process.env.DB_HOST, port: process.env.DB_PORT || 5432,
          user: process.env.DB_USER, password: process.env.DB_PASSWORD,
          database: process.env.DB_NAME };
    const admin = new pg.Client({ ...connection,
      ssl: process.env.DB_SSL === 'false' ? false : { rejectUnauthorized: false },
      connectionTimeoutMillis: 10_000 });
    const databaseName = `vitalysync_e2e_${Date.now()}_${randomBytes(4).toString('hex')}`;
    let created = false;
    let database;
    let apiServer;
    let webServer;
    const activeResponses = new Set();
    await admin.connect();
    try {
      // Only this generated, empty database is migrated or removed.
      await admin.query(`CREATE DATABASE "${databaseName}"`);
      created = true;
      if (process.env.DATABASE_URL) {
        const url = new URL(process.env.DATABASE_URL);
        url.pathname = `/${databaseName}`;
        process.env.DATABASE_URL = url.toString();
      }
      process.env.DB_NAME = databaseName;
      process.env.NODE_ENV = 'test';
      process.env.TZ = 'Asia/Manila';
      process.env.AUTH_TOKEN_SECRET = randomBytes(32).toString('hex');
      process.env.CORS_ALLOWED_ORIGINS = webUrl;
      for (const key of ['OPENAI_API_KEY', 'USDA_API_KEY', 'OPENWEATHER_API_KEY',
        'BREVO_API_KEY', 'SMTP_USER', 'SMTP_PASS']) process.env[key] = '';
      database = (await import('../src/config/db.js')).default;
      const connected = await database.query('SELECT current_database() AS name');
      expect(connected.rows[0].name).toBe(databaseName);
      const migrations = (await readdir(path.join(backendDir, 'migrations')))
        .filter((name) => name.endsWith('.sql')).sort();
      for (const migration of migrations) {
        await database.query(await readFile(path.join(backendDir, 'migrations', migration), 'utf8'));
      }
      const app = (await import('../src/app.js')).default;
      const express = (await import('express')).default;
      apiServer = await listen(app, 4181);
      // A browser closing can disconnect before its route finishes querying.
      // Drain those handlers too before closing the pool during teardown.
      apiServer.prependListener('request', (_req, res) => {
        let finished;
        const pending = new Promise((resolve) => { finished = resolve; });
        activeResponses.add(pending);
        const end = res.end;
        res.end = function (...args) {
          try { return end.apply(this, args); }
          finally { activeResponses.delete(pending); finished(); }
        };
      });
      webServer = await listen(express().use(express.static(webDir)), 4173);
      const { createAccessToken } = await import('../src/services/authToken.service.js');
      await use({ database, async createUser(request) {
        const email = `checkin_${randomBytes(6).toString('hex')}@example.com`;
        const result = await database.query(
          `INSERT INTO users (username, email, password, age, gender, email_verified)
           VALUES ($2, $1, 'test-only-unused-password', 25, 'Other', TRUE)
           RETURNING user_id`, [email, email.split('@')[0]]);
        const userId = result.rows[0].user_id;
        const token = createAccessToken({ user_id: userId }).access_token;
        const headers = { Authorization: `Bearer ${token}` };
        const answers = [
          ...Array.from({ length: 9 }, (_, i) => ({ question_key: `ee_0${i + 1}`, numeric_value: 1 })),
          ...Array.from({ length: 5 }, (_, i) => ({ question_key: `dp_0${i + 1}`, numeric_value: 1 })),
          ...Array.from({ length: 8 }, (_, i) => ({ question_key: `pa_0${i + 1}`, numeric_value: 5 })),
        ];
        const response = await request.post(`${apiUrl}/api/onboarding/submit`, { headers, data: {
          questionnaire_version: 'vitalysync_maslach22_v1', burnout_answers: answers,
          profile: { role: 'Student', lifestyle_type: 'Sedentary', wellness_goal: 'Improve sleep',
            height_cm: 170, weight_kg: 65, usual_sleep_time: '22:00', usual_wake_time: '06:00',
            exercise_goal_days: '3-4 days', workload_level: 3, has_extra_responsibilities: false },
        } });
        expect(response.ok(), await response.text()).toBeTruthy();
        return { userId, token, email, headers, baseline: await response.json() };
      } });
    } finally {
      await close(webServer);
      await close(apiServer);
      await Promise.all(activeResponses);
      if (database) await database.end();
      if (created && /^vitalysync_e2e_\d+_[a-f0-9]{8}$/.test(databaseName)) {
        await admin.query(`DROP DATABASE "${databaseName}"`);
      }
      await admin.end();
    }
  }, { scope: 'worker', timeout: 120_000 }],
});

export { expect };
