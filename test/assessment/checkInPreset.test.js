import assert from 'node:assert/strict';
import test from 'node:test';

import {
  CHECK_IN_PRESET_AVATAR_IDS,
  createCheckInPreset,
  deleteCheckInPreset,
  listCheckInPresets,
  normalizeCheckInPresetPayload,
  updateCheckInPreset,
} from '../../src/services/checkInPreset.service.js';
import {
  WEEKLY_BURNOUT_QUESTIONS,
} from '../../src/services/burnoutQuestionnaire.js';

const dailyAnswers = {
  questionnaire_version: 'daily_14_v2',
  sleep_hours: 7.5,
  sleep_quality: 3,
  mood_index: 3,
  energy_level: 4,
  hydration_liters: 2,
  workload_hours_band: '5-6 hours',
  exercise_names: ['Walking'],
  symptom_names: ['None'],
  habit_names: ['Quiet break'],
  perceived_stress_level: 3,
  break_quality_level: 4,
  daily_detachment_level: 2,
  daily_focus_level: 4,
  daily_accomplishment_level: 4,
};

const weeklyDailyAnswers = Object.fromEntries(
  Object.entries({
    ...dailyAnswers,
    questionnaire_version: 'daily_core9_v3',
  }).filter(([key]) => ![
    'perceived_stress_level',
    'break_quality_level',
    'daily_detachment_level',
    'daily_focus_level',
    'daily_accomplishment_level',
  ].includes(key))
);

const weeklyAnswers = Object.fromEntries(
  WEEKLY_BURNOUT_QUESTIONS.map((question) => [question.question_key, 3])
);

test('all illustrated avatar choices are accepted for saving presets', () => {
  assert.equal(CHECK_IN_PRESET_AVATAR_IDS.length, 36);
  for (const avatarId of CHECK_IN_PRESET_AVATAR_IDS) {
    const preset = normalizeCheckInPresetPayload({
      name: 'My day',
      check_in_type: 'daily',
      avatar_id: avatarId,
      daily: dailyAnswers,
    });
    assert.equal(preset.avatar_id, avatarId);
  }
});

test('preset payloads reuse complete daily and weekly questionnaire validation', () => {
  const daily = normalizeCheckInPresetPayload({
    name: '  Productive  ',
    check_in_type: 'daily',
    avatar_id: 'focused',
    daily: dailyAnswers,
    weekly_answers: null,
  });
  assert.equal(daily.name, 'Productive');
  assert.equal(daily.daily_answers.questionnaire_version, 'daily_14_v2');
  assert.equal(daily.weekly_answers, null);

  const weekly = normalizeCheckInPresetPayload({
    name: 'Weekly reset',
    check_in_type: 'weekly',
    avatar_id: 'calm',
    daily: weeklyDailyAnswers,
    weekly_answers: weeklyAnswers,
  });
  assert.equal(weekly.daily_answers.questionnaire_version, 'daily_core9_v3');
  assert.deepEqual(weekly.weekly_answers, weeklyAnswers);
});

test('preset validation rejects malformed metadata, partial answers, and mode changes', () => {
  assert.throws(() => normalizeCheckInPresetPayload({
    name: '',
    check_in_type: 'daily',
    avatar_id: 'focused',
    daily: dailyAnswers,
  }), /name/i);
  assert.throws(() => normalizeCheckInPresetPayload({
    name: 'Wrong mode',
    check_in_type: 'monthly',
    avatar_id: 'focused',
    daily: dailyAnswers,
  }), /check_in_type/i);
  assert.throws(() => normalizeCheckInPresetPayload({
    name: 'Unknown art',
    check_in_type: 'daily',
    avatar_id: 'unknown',
    daily: dailyAnswers,
  }), /avatar/i);
  assert.throws(() => normalizeCheckInPresetPayload({
    name: 'Incomplete daily',
    check_in_type: 'daily',
    avatar_id: 'focused',
    daily: { ...dailyAnswers, energy_level: null },
  }), /energy_level/i);
  assert.throws(() => normalizeCheckInPresetPayload({
    name: 'Incomplete',
    check_in_type: 'weekly',
    avatar_id: 'calm',
    daily: weeklyDailyAnswers,
    weekly_answers: {},
  }), /All 11/i);
  assert.throws(() => normalizeCheckInPresetPayload({
    name: 'Changed',
    check_in_type: 'weekly',
    avatar_id: 'calm',
    daily: weeklyDailyAnswers,
    weekly_answers: weeklyAnswers,
  }, { existingMode: 'daily' }), /cannot be changed/i);
});

test('list remains user-scoped and returns presets in creation order', async () => {
  let call;
  const database = {
    async query(sql, params) {
      call = { sql, params };
      return {
        rows: [
          {
            preset_id: '2',
            name: 'First',
            check_in_type: 'daily',
            avatar_id: 'happy',
            daily_answers: dailyAnswers,
            weekly_answers: null,
          },
          {
            preset_id: '5',
            name: 'Second',
            check_in_type: 'weekly',
            avatar_id: 'calm',
            daily_answers: weeklyDailyAnswers,
            weekly_answers: weeklyAnswers,
          },
        ],
      };
    },
  };

  const presets = await listCheckInPresets(7, database);
  assert.deepEqual(call.params, [7]);
  assert.match(call.sql, /WHERE user_id = \$1/);
  assert.match(call.sql, /ORDER BY preset_id ASC/);
  assert.deepEqual(presets.map((preset) => preset.preset_id), [2, 5]);
});

test('create serializes normalized questionnaire snapshots', async () => {
  let call;
  const database = {
    async query(sql, params) {
      call = { sql, params };
      return {
        rowCount: 1,
        rows: [{
          preset_id: '9',
          name: params[1],
          check_in_type: params[2],
          avatar_id: params[3],
          daily_answers: JSON.parse(params[4]),
          weekly_answers: params[5] == null ? null : JSON.parse(params[5]),
          created_at: new Date('2026-10-27T00:00:00Z'),
          updated_at: new Date('2026-10-27T00:00:00Z'),
        }],
      };
    },
  };
  const created = await createCheckInPreset(7, {
    name: 'Productive',
    check_in_type: 'daily',
    avatar_id: 'focused',
    daily: dailyAnswers,
  }, database);
  assert.match(call.sql, /INSERT INTO check_in_presets/);
  assert.equal(created.preset_id, 9);
  assert.equal(created.daily.questionnaire_version, 'daily_14_v2');
});

test('updates keep the stored type and delete is scoped by user and preset', async () => {
  const commands = [];
  const database = {
    async query(sql, params) {
      commands.push({ sql, params });
      if (sql.includes('SELECT check_in_type')) {
        return { rowCount: 1, rows: [{ check_in_type: 'daily' }] };
      }
      if (sql.startsWith('UPDATE')) {
        return {
          rowCount: 1,
          rows: [{
            preset_id: '3',
            name: params[2],
            check_in_type: 'daily',
            avatar_id: params[3],
            daily_answers: JSON.parse(params[4]),
            weekly_answers: null,
          }],
        };
      }
      return { rowCount: 1, rows: [{ preset_id: '3' }] };
    },
  };

  await updateCheckInPreset(7, 3, {
    name: 'Edited',
    check_in_type: 'daily',
    avatar_id: 'happy',
    daily: dailyAnswers,
  }, database);
  const deletedId = await deleteCheckInPreset(7, 3, database);
  assert.equal(deletedId, 3);
  assert.deepEqual(commands.at(-1).params, [7, 3]);
});

test('another user cannot update or delete a preset', async () => {
  const database = {
    async query() {
      return { rowCount: 0, rows: [] };
    },
  };
  await assert.rejects(
    updateCheckInPreset(8, 3, {
      name: 'No access',
      check_in_type: 'daily',
      avatar_id: 'happy',
      daily: dailyAnswers,
    }, database),
    (error) => error.statusCode === 404
  );
  await assert.rejects(
    deleteCheckInPreset(8, 3, database),
    (error) => error.statusCode === 404
  );
});
