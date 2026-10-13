import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import pg from 'pg';
import http from 'node:http';
import app from '../src/app.js';
import pool from '../src/config/db.js';
import { createAccessToken } from '../src/services/authToken.service.js';
import { ASSESSMENT_IDENTITY } from '../src/services/assessmentDefinition.js';
import { assessmentHistory, latestAssessment, submitAssessment } from '../src/services/assessment.service.js';
import { submitRequiredOnboarding } from '../src/services/onboarding.service.js';

// Explicit opt-in only; never fall back to DATABASE_URL or the workspace .env.
const connectionString = process.env.CBI_TEST_DATABASE_URL;
const fixture = (value = 3, completed_at = '2026-10-13T12:00:00.000Z') => ({
  ...ASSESSMENT_IDENTITY, submission_id: randomUUID(), completed_at,
  answers: Array.from({ length: 6 }, (_, i) => ({ question_id: `PB${i + 1}`, response: value })),
});
const profile = { role: 'Student', lifestyle_type: 'Sedentary', wellness_goal: 'Improve sleep',
  height_cm: 170, weight_kg: 70, usual_sleep_time: '22:00', usual_wake_time: '06:00',
  exercise_goal_days: '3-4 days', workload_level: 3, has_extra_responsibilities: false };

test('CBI migration, transactions, replay, history and legacy preservation', { skip: !connectionString }, async (t) => {
  const url = new URL(connectionString);
  assert.ok(['127.0.0.1', 'localhost'].includes(url.hostname) && url.pathname.startsWith('/cbi_'),
    'Use an explicitly named disposable local cbi_* database.');
  const schema = `cbi_test_${randomUUID().replaceAll('-', '')}`;
  const admin = new pg.Pool({ connectionString });
  await admin.query(`CREATE SCHEMA ${schema}`);
  const db = new pg.Pool({ connectionString, options: `-c search_path=${schema},public` });
  const oldFlag = process.env.CBI_ASSESSMENT_ENABLED;
  process.env.CBI_ASSESSMENT_ENABLED = 'true';
  try {
    const directory = new URL('../migrations/', import.meta.url);
    const files = (await readdir(directory)).filter((name) => name.endsWith('.sql')).sort();
    for (const file of files.filter((name) => name < '031')) {
      await db.query(await readFile(new URL(file, directory), 'utf8'));
    }
    const user = async (name, age = 25) => (await db.query(
      'INSERT INTO users(username,email,password,age) VALUES ($1,$2,$3,$4) RETURNING user_id',
      [name, `${name}@test.invalid`, 'test-only', age],
    )).rows[0].user_id;
    const owner = await user('owner');
    const other = await user('other');
    await db.query("INSERT INTO user_onboarding_profiles(user_id,initial_burnout_score,initial_burnout_level) VALUES ($1,42,'moderate')", [owner]);
    await db.query("INSERT INTO user_onboarding_answers(user_id,question_key,numeric_value) VALUES ($1,'ee_01',4)", [owner]);
    await db.query(`INSERT INTO daily_logs(user_id,log_date,sleep_hours,sleep_quality,mood_index,energy_level,hydration_liters,exercise_names,symptom_names)
      VALUES ($1,'2026-10-01',7,3,3,3,2,ARRAY['Walking'],ARRAY['None'])`, [owner]);
    await db.query(`INSERT INTO burnout_score_history(user_id,score_date,overall_score,risk_level,confidence_score,completeness_score)
      VALUES ($1,'2026-10-01',42,'moderate',80,90)`, [owner]);
    await db.query(`INSERT INTO user_insight_reports(user_id,report_type,period_start,period_end,title,summary)
      VALUES ($1,'daily','2026-10-01','2026-10-01','Legacy report','Original generated text')`, [owner]);
    const legacyTables = ['user_onboarding_profiles', 'user_onboarding_answers', 'daily_logs', 'burnout_score_history', 'user_insight_reports'];
    const snapshot = async () => Promise.all(legacyTables.map(async (table) => (await db.query(`SELECT * FROM ${table} WHERE user_id=$1`, [owner])).rows));
    const before = await snapshot();
    await db.query(await readFile(new URL('031_create_cbi_assessments.sql', directory), 'utf8'));
    assert.deepEqual(await snapshot(), before, 'migration leaves historical records unchanged');

    const request = fixture(3);
    const options = { db, now: new Date('2026-10-14T12:00:00Z') };
    let saved;
    await t.test('parallel identical requests persist once; changed replays conflict', async () => {
      const results = await Promise.all(Array.from({ length: 5 }, () => submitAssessment(owner, request, options)));
      assert.equal(results.filter((item) => !item.idempotent_replay).length, 1);
      assert.equal(new Set(results.map((item) => item.assessment.assessment_id)).size, 1);
      saved = results[0].assessment;
      assert.equal(saved.result.display_score, '50.0');
      const reversed = { ...request, answers: [...request.answers].reverse() };
      assert.deepEqual((await submitAssessment(owner, reversed, options)).assessment, saved);
      await assert.rejects(submitAssessment(owner, { ...request, answers: fixture(5).answers }, options), { statusCode: 409 });
      assert.deepEqual(await snapshot(), before, 'submission leaves all legacy records unchanged');
    });
    await t.test('older offline arrival and equal timestamps paginate deterministically per owner', async () => {
      const older = await submitAssessment(owner, fixture(5, '2026-10-01T10:00:00Z'), options);
      assert.equal((await latestAssessment(owner, { db })).assessment.assessment_id, saved.assessment_id);
      const sameTime = await submitAssessment(owner, fixture(1), options);
      const expected = [saved, sameTime.assessment].sort((a, b) => b.submission_id.localeCompare(a.submission_id));
      expected.push(older.assessment);
      const history = []; let cursor;
      do {
        const page = await assessmentHistory(owner, { db, limit: 1, cursor });
        history.push(...page.assessments); cursor = page.next_cursor ?? undefined;
      } while (cursor);
      assert.deepEqual(history.map((item) => item.assessment_id), expected.map((item) => item.assessment_id));
      assert.deepEqual(await latestAssessment(other, { db }), { assessment: null });
      const firstPage = await assessmentHistory(owner, { db, limit: 1 });
      await assert.rejects(assessmentHistory(other, { db, cursor: firstPage.next_cursor }), { statusCode: 400 });
      assert.equal((await assessmentHistory(other, { db })).assessments.length, 0);
    });
    await t.test('database protects saved results, raw values and aggregate completeness', async () => {
      const id = saved.assessment_id;
      await assert.rejects(db.query('UPDATE user_assessments SET cbi_score=0 WHERE assessment_id=$1', [id]), { code: '23514' });
      await assert.rejects(db.query('UPDATE user_assessment_answers SET response=5 WHERE assessment_id=$1', [id]), { code: '23514' });
      await assert.rejects(db.query("DELETE FROM user_assessment_answers WHERE assessment_id=$1 AND question_id='PB1'", [id]), { code: '23514' });
      await assert.rejects(db.query("INSERT INTO user_assessment_answers VALUES ($1,'context1','context',6)", [id]), { code: '23514' });
      await assert.rejects(db.query(`INSERT INTO user_assessments(user_id,instrument,instrument_version,definition_version,scoring_version,context_version,language,
        submission_id,request_fingerprint,completed_at,cbi_answer_count,cbi_mapped_total,cbi_score)
        SELECT user_id,instrument,instrument_version,definition_version,scoring_version,context_version,language,
        $2,request_fingerprint,completed_at,6,300,50 FROM user_assessments WHERE assessment_id=$1`, [id, randomUUID()]), { code: '23514' });
      await db.query('UPDATE daily_logs SET hydration_liters=3 WHERE user_id=$1', [owner]);
      assert.equal((await db.query('SELECT cbi_score FROM user_assessments WHERE assessment_id=$1', [id])).rows[0].cbi_score, '50.0');
    });
    await t.test('adult eligibility, future clock and invalid answers leave no partial data', async () => {
      const minor = await user('minor', 17);
      await assert.rejects(submitAssessment(minor, fixture(), options), { code: 'ASSESSMENT_ADULT_REQUIRED' });
      await assert.rejects(submitAssessment(other, fixture(3, '2099-01-01T00:00:00Z'), options), { code: 'INVALID_COMPLETION_TIME' });
      assert.equal((await assessmentHistory(minor, { db })).assessments.length, 0);
      assert.equal((await assessmentHistory(other, { db })).assessments.length, 0);
    });
    await t.test('authenticated HTTP contracts enforce ownership, versions, ETags and replay statuses', async () => {
      const originalQuery = pool.query;
      const originalConnect = pool.connect;
      pool.query = (...args) => db.query(...args);
      pool.connect = () => db.connect();
      app.locals.authTokenVersionLookup = async () => 0;
      const server = http.createServer(app);
      await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
      const base = `http://127.0.0.1:${server.address().port}/api/assessments`;
      const headers = { authorization: `Bearer ${createAccessToken({ user_id: other, auth_token_version: 0 }).access_token}`, 'content-type': 'application/json' };
      try {
        assert.equal((await fetch(`${base}/latest`)).status, 401);
        assert.equal((await fetch(`${base}/history?user_id=${owner}`, { headers })).status, 403);
        const definition = await fetch(`${base}/definition`, { headers });
        assert.equal(definition.status, 200);
        const etag = definition.headers.get('etag');
        assert.equal((await fetch(`${base}/definition`, { headers: { ...headers, 'if-none-match': etag } })).status, 304);
        assert.equal((await fetch(`${base}/definition?definition_version=unknown`, { headers })).status, 422);
        assert.deepEqual(await (await fetch(`${base}/latest`, { headers })).json(), { assessment: null });
        const request = fixture();
        const post = (body) => fetch(base, { method: 'POST', headers, body: JSON.stringify(body) });
        assert.equal((await post({ ...request, user_id: owner })).status, 403);
        assert.equal((await post(request)).status, 201);
        assert.equal((await post(request)).status, 200);
        assert.equal((await post({ ...request, answers: fixture(1).answers })).status, 409);
        process.env.CBI_ASSESSMENT_ENABLED = 'false';
        assert.equal((await post(fixture())).status, 503);
        assert.equal((await fetch(`${base}/definition`, { headers })).status, 503);
        assert.equal((await fetch(`${base}/history`, { headers })).status, 200, 'rollback retains history reads');
        const api = base.replace('/assessments', '');
        const beforeCbi = (await db.query('SELECT * FROM user_assessments ORDER BY assessment_id')).rows;
        const beforeScores = (await db.query('SELECT * FROM burnout_score_history ORDER BY burnout_score_id')).rows;
        for (const [method, path, body] of [
          ['POST', '/burnout/scores/recalculate', {}],
          ['PUT', '/onboarding/burnout-baseline', {}],
          ['PUT', `/onboarding/${other}/burnout-baseline`, {}],
          ['POST', '/onboarding/submit', { profile, burnout_answers: [] }],
          ['POST', '/onboarding', { mental_drain_level: 3 }],
          ['PUT', '/onboarding', { stress_level: 3 }]
        ]) {
          const response = await fetch(api + path, { method, headers, body: JSON.stringify(body) });
          assert.equal(response.status, 410, path);
          assert.equal((await response.json()).code, 'LEGACY_SCORING_RETIRED');
        }
        const noAssessment = await user('no-assessment');
        await db.query("INSERT INTO user_streaks(user_id,last_logged_date,current_streak,longest_streak) VALUES ($1,'2026-08-01',0,1)", [noAssessment]);
        const logHeaders = { ...headers, authorization: `Bearer ${createAccessToken({ user_id: noAssessment, auth_token_version: 0 }).access_token}` };
        const date = '2026-10-14';
        const statusResponse = await fetch(`${api}/logs/check-in/status?date=${date}`, { headers: logHeaders });
        assert.equal(statusResponse.status, 200);
        const status = await statusResponse.json();
        assert.equal(status.requires_baseline_refresh, false);
        const daily = { sleep_hours: 7, sleep_quality: 3, mood_index: 2, energy_level: 4,
          hydration_liters: 1, workload_hours_band: '3-4 hours', exercise_names: ['Walking'], symptom_names: ['None'], habit_names: ['Quiet break'] };
        const logResponse = await fetch(`${api}/logs/check-in`, { method: 'POST', headers: logHeaders,
          body: JSON.stringify({ log_date: date, check_in_type: status.required_mode, daily,
            ...(status.required_mode === 'weekly' ? { weekly: { perceived_pressure_level: 3, recovery_rest_level: 3, detachment_level: 3, productivity_focus_level: 3, accomplishment_level: 3 } } : {}) }) });
        assert.ok([200, 201].includes(logResponse.status), await logResponse.text());
        const activityResponse = await fetch(`${api}/activity/save`, { method: 'POST', headers: logHeaders,
          body: JSON.stringify({ log_date: date, steps: 1000, active_minutes: 5 }) });
        assert.equal(activityResponse.status, 200, await activityResponse.text());
        const recommendations = await fetch(`${api}/adaptive/nudges/recommendations?date=${date}&record=false&ai=false`, { headers: logHeaders });
        assert.equal(recommendations.status, 200);
        const recommendationBody = await recommendations.json();
        assert.equal(recommendationBody.wellness_summary.period_end, date);
        assert.equal(recommendationBody.wellness_summary.recorded_days, 1);
        const invalidDate = await fetch(`${api}/adaptive/nudges/recommendations?date=2026-02-30`, { headers });
        assert.equal(invalidDate.status, 400);
        for (const path of ['/burnout/scores/latest', '/burnout/scores/history', '/burnout/patterns/summary?refresh=true', '/adaptive/nudges/recommendations?record=false&ai=false', '/reports/export']) {
          const response = await fetch(api + path, { headers });
          assert.equal(response.status, 200, `${path}: ${response.status === 200 ? '' : await response.text()}`);
        }
        const reportResponse = await fetch(`${api}/adaptive/insight-reports/refresh`, { method: 'POST', headers: logHeaders, body: JSON.stringify({ date }) });
        assert.equal(reportResponse.status, 200, await reportResponse.text());
        assert.equal((await db.query('SELECT * FROM user_assessments WHERE user_id=$1', [noAssessment])).rowCount, 0);
        assert.deepEqual((await db.query('SELECT * FROM user_assessments ORDER BY assessment_id')).rows, beforeCbi);
        assert.deepEqual((await db.query('SELECT * FROM burnout_score_history ORDER BY burnout_score_id')).rows, beforeScores);
        assert.equal((await db.query("SELECT summary FROM user_insight_reports WHERE title='Legacy report'")).rows[0].summary, 'Original generated text');

      } finally {
        process.env.CBI_ASSESSMENT_ENABLED = 'true';
        server.closeAllConnections();
        await new Promise((resolve) => server.close(resolve));
        pool.query = originalQuery;
        pool.connect = originalConnect;
      }
    });
    await t.test('onboarding shares atomic storage, preserves legacy scores, and replay cannot rewrite profiles', async () => {
      const newUser = await user('onboarding');
      const payload = { user_id: newUser, profile, assessment: fixture(5) };
      const original = await submitRequiredOnboarding(payload, options);
      assert.equal(original.assessment.result.score, 100);
      assert.equal(original.profile.initial_burnout_score, null);
      assert.equal(Number(original.profile.bmi), 24.2);
      assert.equal(original.scores, undefined);
      assert.equal((await db.query('SELECT onboarding_completed FROM users WHERE user_id=$1', [newUser])).rows[0].onboarding_completed, true);
      assert.equal((await db.query('SELECT * FROM user_baseline_epochs WHERE user_id=$1', [newUser])).rowCount, 0);
      await db.query("UPDATE user_onboarding_profiles SET role='Other' WHERE user_id=$1", [newUser]);
      const replay = await submitRequiredOnboarding(payload, options);
      assert.equal(replay.idempotent_replay, true);
      assert.equal(replay.profile.role, 'Other');
      await assert.rejects(submitRequiredOnboarding({ ...payload, profile: { ...profile, role: 'Other' } }, options), { statusCode: 409 });
      await submitRequiredOnboarding({ user_id: owner, profile, assessment: fixture() }, options);
      assert.equal((await db.query('SELECT initial_burnout_score FROM user_onboarding_profiles WHERE user_id=$1', [owner])).rows[0].initial_burnout_score, '42.00');
      const failedUser = await user('rollback');
      const failingDb = { connect: async () => {
        const client = await db.connect();
        return { release: () => client.release(), query: (sql, params) => {
          if (sql.includes('INSERT INTO user_preferences')) throw new Error('simulated late profile failure');
          return client.query(sql, params);
        } };
      } };
      await assert.rejects(submitRequiredOnboarding({ user_id: failedUser, profile, assessment: fixture() }, { ...options, db: failingDb }), /simulated late/);
      assert.equal((await assessmentHistory(failedUser, { db })).assessments.length, 0);
      assert.equal((await db.query('SELECT * FROM user_onboarding_profiles WHERE user_id=$1', [failedUser])).rowCount, 0);
    });
    await t.test('account deletion cascades through immutable answers', async () => {
      const id = saved.assessment_id;
      await db.query('DELETE FROM users WHERE user_id=$1', [owner]);
      assert.equal((await assessmentHistory(owner, { db })).assessments.length, 0);
      assert.equal((await db.query('SELECT * FROM user_assessment_answers WHERE assessment_id=$1', [id])).rowCount, 0);
    });
  } finally {
    if (oldFlag === undefined) delete process.env.CBI_ASSESSMENT_ENABLED;
    else process.env.CBI_ASSESSMENT_ENABLED = oldFlag;
    await db.end();
    await admin.query(`DROP SCHEMA ${schema} CASCADE`);
    await admin.end();
  }
});
