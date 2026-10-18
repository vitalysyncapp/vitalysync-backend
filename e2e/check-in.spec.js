import { test, expect, apiUrl, webUrl, today } from './check-in.fixture.js';

const reflections = ['perceived_stress_level', 'break_quality_level',
  'daily_detachment_level', 'daily_focus_level', 'daily_accomplishment_level'];
const core = {
  questionnaire_version: 'daily_core9_v3', sleep_hours: 8, sleep_quality: 4,
  mood_index: 4, energy_level: 5, hydration_liters: 2.5, workload_hours_band: 'None',
  exercise_names: ['Walking'], symptom_names: ['None'],
  habit_names: ['Quiet break', 'Deep breathing', 'Stretching'],
};
const full = { ...core, questionnaire_version: 'daily_14_v2',
  perceived_stress_level: 1, break_quality_level: 5, daily_detachment_level: 1,
  daily_focus_level: 5, daily_accomplishment_level: 5 };
const weeklyAnswers = {
  ee_01: 1, ee_02: 2, ee_03: 3, ee_04: 4, ee_05: 5,
  dp_01: 1, dp_02: 3, dp_03: 5, pa_01: 5, pa_02: 4, pa_03: 3,
};

async function dueToday(database, userId) {
  await database.query(`INSERT INTO user_check_in_schedules (user_id, next_pulse_due_date)
    VALUES ($1, $2) ON CONFLICT (user_id) DO UPDATE SET next_pulse_due_date = $2`, [userId, today()]);
}

async function expectDashboardScore(request, headers, savedScore) {
  const latestResponse = await request.get(`${apiUrl}/api/burnout/scores/latest`, { headers });
  expect(latestResponse.ok(), await latestResponse.text()).toBeTruthy();
  const latest = (await latestResponse.json()).score;
  const expectedScore = {
    score_date: savedScore.score_date,
    overall_score: savedScore.overall_score,
    risk_level: savedScore.risk_level,
    scoring_version: savedScore.scoring_version,
  };
  expect(latest).toMatchObject(expectedScore);

  // Both persisted and recalculated summaries must expose the same daily
  // estimate in the dashboard risk stat and its seven-day chart.
  for (const refresh of [false, true]) {
    const response = await request.get(
      `${apiUrl}/api/burnout/patterns/summary?end=${savedScore.score_date}&refresh=${refresh}`,
      { headers },
    );
    expect(response.ok(), await response.text()).toBeTruthy();
    const summary = await response.json();
    expect(summary.latest_score).toMatchObject(expectedScore);
    expect(summary.windows['7_day'].latest_score).toBe(savedScore.overall_score);
    expect(summary.windows['7_day'].points).toHaveLength(1);
    expect(summary.windows['7_day'].points[0]).toMatchObject({
      score_date: savedScore.score_date,
      overall_score: savedScore.overall_score,
    });
    expect(summary.timeline).toMatchObject([{
      score_date: savedScore.score_date,
      overall_score: savedScore.overall_score,
    }]);
  }
}

test('API persists baseline, daily and weekly logs with independently checked scores', async ({ request, system }) => {
  const user = await system.createUser(request);
  const { database } = system;
  const { headers, userId } = user;
  const baseline = (await database.query('SELECT * FROM user_onboarding_profiles WHERE user_id = $1', [userId])).rows[0];
  expect(baseline.burnout_questionnaire_version).toBe('vitalysync_maslach22_v1');
  expect(Number(baseline.emotional_exhaustion_score)).toBe(1);
  expect(Number(baseline.depersonalization_score)).toBe(1);
  expect(Number(baseline.personal_accomplishment_score)).toBe(5);
  expect(Number(baseline.initial_burnout_score)).toBe(10);
  expect(Number((await database.query("SELECT COUNT(*) FROM user_onboarding_answers WHERE user_id = $1 AND question_key ~ '^(ee|dp|pa)_'", [userId])).rows[0].count)).toBe(22);

  const saveDaily = (daily) => request.post(`${apiUrl}/api/logs/check-in`, { headers,
    data: { schema_version: 3, check_in_type: 'daily', log_date: today(), daily } });
  const first = await saveDaily(full);
  expect(first.status(), await first.text()).toBe(201);
  const firstBody = await first.json();
  expect(firstBody.burnout_score).toBeTruthy();
  // Hand-calculated from the documented relative weights: behavioral 1.56,
  // then 65% behavioral + 35% baseline(10) on the first logged day = 4.51.
  expect(Number(firstBody.burnout_score.overall_score)).toBe(4.51);
  expect(firstBody.burnout_score.data_points_count).toBe(14);
  expect(firstBody.log.log_date).toBe(today());
  await expectDashboardScore(request, headers, firstBody.burnout_score);
  await dueToday(database, userId);
  const status = await request.get(`${apiUrl}/api/logs/check-in/status?date=${today()}&schema_version=3`, { headers });
  const checkInStatus = await status.json();
  expect(checkInStatus.daily_input_mode).toBe('weekly');
  expect(checkInStatus.schedule.due_date).toBe(today());
  const second = await saveDaily(core);
  expect(second.status(), await second.text()).toBe(200);
  const secondBody = await second.json();
  // Removing the five reflection weights produces behavioral 4.64;
  // 65% * 4.64 + 35% * 10 = 6.52 (two decimals).
  expect(Number(secondBody.burnout_score.overall_score)).toBe(6.52);
  expect(secondBody.burnout_score.data_points_count).toBe(9);
  expect(Number(secondBody.burnout_score.completeness_score)).toBe(100);
  for (const field of reflections) expect(secondBody.burnout_score.source_snapshot.daily_log[field]).toBeNull();
  const storedDaily = (await database.query('SELECT * FROM daily_logs WHERE user_id = $1', [userId])).rows;
  expect(storedDaily).toHaveLength(1);
  expect(storedDaily[0].questionnaire_version).toBe('daily_core9_v3');
  expect(Number(storedDaily[0].hydration_liters)).toBe(2.5);
  await expectDashboardScore(request, headers, secondBody.burnout_score);
  const scoresBefore = (await database.query('SELECT * FROM burnout_score_history WHERE user_id = $1', [userId])).rows;
  expect(scoresBefore).toHaveLength(1);
  expect(Number(scoresBefore[0].overall_score)).toBe(6.52);
  expect(scoresBefore[0].scoring_version).toBe('burnout_engine_v6_core9_v1');
  const streakBefore = (await database.query('SELECT * FROM user_streaks WHERE user_id = $1', [userId])).rows;

  const weeklyPayload = { due_date: today(), response_date: today(),
    questionnaire_version: 'vitalysync_maslach11_v1', answers: weeklyAnswers,
    scores: { emotional_exhaustion: { total: 999 } } };
  const weekly = await request.post(`${apiUrl}/api/logs/weekly-assessment`, { headers, data: weeklyPayload });
  expect(weekly.ok(), await weekly.text()).toBeTruthy();
  const saved = (await weekly.json()).assessment;
  expect(saved.scores.emotional_exhaustion).toMatchObject({ total: 15, mean: 3, item_count: 5, maximum: 25 });
  expect(saved.due_date).toBe(today());
  expect(saved.response_date).toBe(today());
  expect(saved.scores.depersonalization).toMatchObject({ total: 9, mean: 3, item_count: 3, maximum: 15 });
  expect(saved.scores.personal_accomplishment).toMatchObject({ total: 12, mean: 4, item_count: 3, maximum: 15, higher_is: 'more_accomplishment' });
  const stored = (await database.query('SELECT * FROM weekly_burnout_assessments WHERE user_id = $1', [userId])).rows;
  expect(stored).toHaveLength(1);
  expect(stored[0].answers).toEqual(weeklyAnswers);
  expect(stored[0].scores).toEqual(saved.scores);
  expect((await database.query('SELECT * FROM burnout_score_history WHERE user_id = $1', [userId])).rows).toEqual(scoresBefore);
  expect((await database.query('SELECT * FROM user_streaks WHERE user_id = $1', [userId])).rows).toEqual(streakBefore);

  for (const answers of [ {}, { ...weeklyAnswers, ee_01: 6 }, { ...weeklyAnswers, pa_03: null },
    { ...weeklyAnswers, extra: 3 }, { ...weeklyAnswers, dp_02: '3' } ]) {
    const response = await request.post(`${apiUrl}/api/logs/weekly-assessment`, { headers,
      data: { ...weeklyPayload, answers } });
    expect(response.status()).toBe(400);
  }
  for (const daily of [{ ...core, perceived_stress_level: 3 }, { ...core, energy_level: 6 }]) {
    expect((await saveDaily(daily)).status()).toBe(400);
  }
  expect((await database.query('SELECT answers, scores FROM weekly_burnout_assessments WHERE user_id = $1', [userId])).rows[0])
    .toEqual({ answers: weeklyAnswers, scores: saved.scores });
  expect((await database.query('SELECT * FROM burnout_score_history WHERE user_id = $1', [userId])).rows).toEqual(scoresBefore);
  const replay = await request.post(`${apiUrl}/api/logs/weekly-assessment`, { headers, data: weeklyPayload });
  expect(replay.ok()).toBeTruthy();
  expect(Number((await database.query('SELECT COUNT(*) FROM weekly_burnout_assessments WHERE user_id = $1', [userId])).rows[0].count)).toBe(1);
  const events = (await database.query("SELECT event_name, event_key FROM wellness_product_events WHERE user_id = $1 AND event_name IN ('daily_check_in_completed', 'weekly_pulse_completed') ORDER BY event_name", [userId])).rows;
  expect(events).toEqual([
    { event_name: 'daily_check_in_completed', event_key: today() },
    { event_name: 'weekly_pulse_completed', event_key: today() },
  ]);
});

test('browser weekly-day form saves through the real API', async ({ page, request, system }, testInfo) => {
  const user = await system.createUser(request);
  await dueToday(system.database, user.userId);
  await page.addInitScript(({ userId, token, email }) => {
    const values = { user_id: userId, email, username: 'Check-in Test', auth_access_token: token,
      onboarding_completed: true, [`core_tutorial_completed_${userId}`]: true };
    for (const [key, value] of Object.entries(values)) localStorage.setItem(`flutter.${key}`, JSON.stringify(value));
  }, user);
  await page.goto(webUrl);
  await page.locator('flt-glass-pane').waitFor({ state: 'attached' });
  await page.locator('flt-semantics-placeholder').evaluate((element) => element.click());
  // Flutter paints on canvas. Its semantic buttons dispatch the real UI tap
  // handlers without browser auto-scroll desynchronizing the canvas overlay.
  await expect(page.getByRole('button', { name: 'Log', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Log', exact: true }).dispatchEvent('click');
  await expect(page.getByText('Your daily essentials', { exact: true })).toBeVisible();
  for (const label of ["Today's pressure", 'Recovery breaks', 'Daily detachment', 'Daily focus', 'Daily accomplishment']) {
    await expect(page.getByText(label, { exact: true })).toHaveCount(0);
  }
  await page.getByRole('button', { name: 'Excellent', exact: true }).dispatchEvent('click');
  await page.getByRole('button', { name: '5 Very high', exact: true }).dispatchEvent('click');
  await expect(page.getByText('Energy logged as very high.', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: '😊', exact: true }).dispatchEvent('click');
  await page.getByRole('button', { name: 'None', exact: true }).nth(0).dispatchEvent('click');
  for (const label of ['Quiet break', 'Sunlight or fresh air', 'Deep breathing']) {
    await page.getByRole('button', { name: label, exact: true }).dispatchEvent('click');
  }
  await page.getByRole('button', { name: '+1L', exact: true }).dispatchEvent('click');
  await page.getByRole('button', { name: '+1L', exact: true }).dispatchEvent('click');
  await page.getByRole('button', { name: 'None', exact: true }).nth(2).dispatchEvent('click');
  await page.getByRole('button', { name: 'Walking', exact: true }).dispatchEvent('click');
  const dailyResponse = page.waitForResponse((response) => response.url() === `${apiUrl}/api/logs/check-in` && response.request().method() === 'POST');
  await page.getByRole('button', { name: 'Save daily check-in', exact: true }).last().dispatchEvent('click');
  const savedResponse = await dailyResponse;
  expect(savedResponse.status(), await savedResponse.text()).toBe(201);
  const sent = savedResponse.request().postDataJSON();
  expect(sent.daily.questionnaire_version).toBe('daily_core9_v3');
  for (const field of reflections) expect(sent.daily).not.toHaveProperty(field);
  const result = await savedResponse.json();
  expect(result.burnout_score.data_points_count).toBe(9);
  expect(Number(result.burnout_score.completeness_score)).toBe(100);
  const savedDaily = (await system.database.query('SELECT * FROM daily_logs WHERE user_id = $1', [user.userId])).rows;
  expect(savedDaily).toHaveLength(1);
  expect(savedDaily[0].questionnaire_version).toBe('daily_core9_v3');
  expect(Number(savedDaily[0].hydration_liters)).toBe(2.5);
  const savedScore = (await system.database.query('SELECT overall_score FROM burnout_score_history WHERE user_id = $1', [user.userId])).rows[0];
  expect(Number(savedScore.overall_score)).toBe(Number(result.burnout_score.overall_score));
  await page.getByRole('button', { name: 'Complete weekly log', exact: true }).dispatchEvent('click');
  await expect(page.getByText('0 of 11 answered', { exact: true })).toBeVisible();
  const labels = ['Never', 'Rarely', 'Sometimes', 'Often', 'Always'];
  await expect(page.getByRole('button', { name: '3 - Sometimes 3', exact: true })).toHaveCount(11);
  await expect(page.getByRole('button', { name: 'Save weekly log', exact: true })).toBeDisabled();
  for (const [index, value] of Object.values(weeklyAnswers).entries()) {
    await page.getByRole('button', { name: `${value} - ${labels[value - 1]} ${value}`, exact: true }).nth(index).dispatchEvent('click');
    await expect(page.getByText(`${index + 1} of 11 answered`, { exact: true })).toBeVisible();
  }
  const weeklyResponse = page.waitForResponse((response) => response.url() === `${apiUrl}/api/logs/weekly-assessment` && response.request().method() === 'POST');
  await page.getByRole('button', { name: 'Save weekly log', exact: true }).dispatchEvent('click');
  const savedWeeklyResponse = await weeklyResponse;
  expect(savedWeeklyResponse.ok(), await savedWeeklyResponse.text()).toBeTruthy();
  expect(savedWeeklyResponse.request().postDataJSON().answers).toEqual(weeklyAnswers);
  const storedWeekly = (await system.database.query('SELECT answers, scores FROM weekly_burnout_assessments WHERE user_id = $1', [user.userId])).rows;
  expect(storedWeekly).toHaveLength(1);
  expect(storedWeekly[0].answers).toEqual(weeklyAnswers);
  expect(storedWeekly[0].scores.emotional_exhaustion.total).toBe(15);
  expect(storedWeekly[0].scores.depersonalization.total).toBe(9);
  expect(storedWeekly[0].scores.personal_accomplishment.total).toBe(12);
  await expect(page.getByText('11-item weekly reflection', { exact: true })).toBeVisible();
  await expect(page.getByText('Emotional exhaustion: 3 / 5 · total 15 / 25', { exact: true })).toBeVisible();
  await expect(page.getByText('Personal accomplishment: 4 / 5 · total 12 / 15', { exact: true })).toBeVisible();
  await page.reload();
  await page.locator('flt-semantics-placeholder').evaluate((element) => element.click());
  await page.getByRole('button', { name: "Today's daily check-in is complete", exact: true }).dispatchEvent('click');
  await expect(page.getByText('Personal accomplishment: 4 / 5 · total 12 / 15', { exact: true })).toBeVisible();
  const screenshot = testInfo.outputPath('saved-weekly-results.png');
  await page.screenshot({ path: screenshot });
  await testInfo.attach('saved-weekly-results', { path: screenshot, contentType: 'image/png' });
});
