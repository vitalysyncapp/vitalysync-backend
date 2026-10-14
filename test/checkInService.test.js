import assert from 'node:assert/strict';
import test from 'node:test';

import { submitCheckIn } from '../src/services/checkIn.service.js';

function dailyPayload(checkInType = 'daily') {
  return {
    log_date: '2026-05-26',
    check_in_type: checkInType,
    daily: {
      sleep_hours: 7,
      sleep_quality: 3,
      mood_index: 2,
      energy_level: 4,
      hydration_liters: 2,
      workload_hours_band: '3-4 hours',
      exercise_names: ['Walking'],
      symptom_names: ['None'],
      habit_names: ['Quiet break']
    }
  };
}

class CheckInClient {
  constructor({
    schedule,
    todayPulse = null,
    hasTodayLog = true,
    lastLoggedDate = null,
    baselineEpochStartedAt = null
  }) {
    this.schedule = { ...schedule };
    this.todayPulse = todayPulse;
    this.hasTodayLog = hasTodayLog;
    this.lastLoggedDate = lastLoggedDate;
    this.baselineEpochStartedAt = baselineEpochStartedAt;
    this.updatedDaily = false;
    this.savedWeekly = null;
    this.commands = [];
    this.released = false;
  }

  async query(sql, params = []) {
    const normalized = sql.replace(/\s+/g, ' ').trim();
    this.commands.push(normalized);

    if (['BEGIN', 'COMMIT', 'ROLLBACK'].includes(normalized)) {
      return { rowCount: 0, rows: [] };
    }
    if (normalized.includes('FROM users LEFT JOIN user_reminder_preferences')) {
      return {
        rowCount: 1,
        rows: [{
          user_id: 1,
          pulse_weekday: 1,
          last_logged_date: this.lastLoggedDate,
          baseline_epoch_started_at: this.baselineEpochStartedAt
        }]
      };
    }
    if (normalized.startsWith('INSERT INTO user_check_in_schedules')) {
      return { rowCount: 0, rows: [] };
    }
    if (normalized.includes('FROM user_check_in_schedules')) {
      return { rowCount: 1, rows: [{ user_id: 1, ...this.schedule }] };
    }
    if (normalized.startsWith('UPDATE user_check_in_schedules')) {
      this.schedule.next_pulse_due_date = params[1];
      if (normalized.includes('last_completed_due_date = $3')) {
        this.schedule.last_completed_due_date = params[2];
        this.schedule.pulse_weekday = params[3];
      } else {
        this.schedule.pulse_weekday = params[2];
      }
      return { rowCount: 1, rows: [] };
    }
    if (normalized.includes('FROM weekly_pulse_responses WHERE user_id = $1 AND response_date = $2')) {
      return {
        rowCount: this.todayPulse ? 1 : 0,
        rows: this.todayPulse ? [this.todayPulse] : []
      };
    }
    if (normalized.includes('WHERE user_id = $1 AND check_in_idempotency_key = $2')) {
      return { rowCount: 0, rows: [] };
    }
    if (normalized.startsWith('INSERT INTO user_streaks')) {
      return { rowCount: 0, rows: [] };
    }
    if (normalized.includes('SELECT user_id, current_streak, longest_streak, last_logged_date FROM user_streaks')) {
      return {
        rowCount: 1,
        rows: [{
          user_id: 1,
          current_streak: 5,
          longest_streak: 8,
          last_logged_date: '2026-05-26'
        }]
      };
    }
    if (normalized === 'SELECT log_id FROM daily_logs WHERE user_id = $1 AND log_date = $2 FOR UPDATE') {
      return {
        rowCount: this.hasTodayLog ? 1 : 0,
        rows: this.hasTodayLog ? [{ log_id: 10 }] : []
      };
    }
    if (normalized.startsWith('UPDATE daily_logs SET sleep_hours')) {
      this.updatedDaily = true;
      return { rowCount: 1, rows: [] };
    }
    if (normalized.startsWith('SELECT log_id, user_id, log_date, sleep_hours')) {
      return {
        rowCount: 1,
        rows: [{
          log_id: 10,
          user_id: 1,
          log_date: '2026-05-26',
          sleep_hours: 7,
          sleep_quality: 3,
          mood_index: 2,
          energy_level: 4,
          hydration_liters: 2,
          workload_hours_band: '3-4 hours',
          exercise_names: ['Walking'],
          symptom_names: ['None'],
          habit_names: ['Quiet break']
        }]
      };
    }
    if (normalized.includes('SELECT current_streak, longest_streak, last_logged_date FROM user_streaks')) {
      return {
        rowCount: 1,
        rows: [{
          current_streak: 5,
          longest_streak: 8,
          last_logged_date: '2026-05-26'
        }]
      };
    }
    if (normalized.startsWith('INSERT INTO weekly_pulse_responses')) {
      this.savedWeekly = {
        pulse_id: 20,
        user_id: params[0],
        week_start_date: params[1],
        due_date: params[2],
        response_date: params[3],
        perceived_pressure_level: params[4],
        productivity_focus_level: params[5],
        recovery_rest_level: params[6],
        detachment_level: params[7],
        accomplishment_level: params[8],
        schema_version: 2
      };
      return { rowCount: 1, rows: [this.savedWeekly] };
    }

    throw new Error(`Unexpected SQL in check-in service test: ${normalized}`);
  }

  release() {
    this.released = true;
  }
}

function databaseFor(client) {
  return {
    async connect() {
      return client;
    }
  };
}

test('an overdue pulse rejects a short daily payload before log mutation', async () => {
  const client = new CheckInClient({
    schedule: {
      pulse_weekday: 1,
      next_pulse_due_date: '2026-05-25',
      last_completed_due_date: null,
      last_completed_at: null
    }
  });

  await assert.rejects(
    submitCheckIn({
      userId: 1,
      payload: dailyPayload(),
      database: databaseFor(client),
      scoreUpdater: async () => null
    }),
    (error) => error.statusCode === 409 && error.code === 'WEEKLY_PULSE_REQUIRED'
  );

  assert.equal(client.updatedDaily, false);
  assert.equal(client.commands.includes('ROLLBACK'), true);
  assert.equal(client.released, true);
});

test('daily redo updates the existing row without changing the streak', async () => {
  const client = new CheckInClient({
    schedule: {
      pulse_weekday: 1,
      next_pulse_due_date: '2026-06-01',
      last_completed_due_date: '2026-05-25',
      last_completed_at: '2026-05-25T00:00:00.000Z'
    }
  });

  const result = await submitCheckIn({
    userId: 1,
    payload: dailyPayload(),
    idempotencyKey: 'daily-2026-05-26',
    database: databaseFor(client),
    scoreUpdater: async () => ({ overall_score: 40 })
  });

  assert.equal(result.check_in_type, 'daily');
  assert.equal(result.is_redo, true);
  assert.equal(result.streak.longest_streak, 8);
  assert.equal(client.updatedDaily, true);
  assert.equal(
    client.commands.some((command) => command.startsWith('UPDATE user_streaks SET current_streak')),
    false
  );
  assert.equal(client.commands.includes('COMMIT'), true);
});

test('weekly redo saves the five pulse answers and daily log atomically', async () => {
  const client = new CheckInClient({
    schedule: {
      pulse_weekday: 1,
      next_pulse_due_date: '2026-06-01',
      last_completed_due_date: '2026-05-25',
      last_completed_at: '2026-05-26T00:00:00.000Z'
    },
    todayPulse: {
      pulse_id: 20,
      due_date: '2026-05-25',
      response_date: '2026-05-26'
    }
  });
  const payload = dailyPayload('weekly');
  payload.weekly = {
    perceived_pressure_level: 4,
    recovery_rest_level: 2,
    detachment_level: 3,
    productivity_focus_level: 2,
    accomplishment_level: 3
  };

  const result = await submitCheckIn({
    userId: 1,
    payload,
    database: databaseFor(client),
    scoreUpdater: async () => null
  });

  assert.equal(result.check_in_type, 'weekly');
  assert.equal(result.weekly_pulse.perceived_pressure_level, 4);
  assert.equal(result.weekly_pulse.response_date, '2026-05-26');
  assert.equal(result.schedule.next_due_date, '2026-06-01');
  assert.equal(client.updatedDaily, true);
  assert.equal(
    client.commands.some((command) =>
      command.includes('ON CONFLICT (user_id, due_date)')
    ),
    true
  );
  assert.equal(client.commands.includes('COMMIT'), true);
});

test('thirty-day return blocks a unified save with the stable conflict code', async () => {
  const client = new CheckInClient({
    schedule: {
      pulse_weekday: 1,
      next_pulse_due_date: '2026-06-01',
      last_completed_due_date: null,
      last_completed_at: null
    },
    lastLoggedDate: '2026-04-26',
    baselineEpochStartedAt: '2026-04-01'
  });

  await assert.rejects(
    submitCheckIn({
      userId: 1,
      payload: dailyPayload(),
      database: databaseFor(client),
      scoreUpdater: async () => null
    }),
    (error) => {
      assert.equal(error.statusCode, 409);
      assert.equal(error.code, 'BASELINE_REFRESH_REQUIRED');
      assert.equal(error.details.requires_baseline_refresh, true);
      assert.equal(error.details.baseline_refresh_reason, 'thirty_day_return');
      assert.equal(error.details.days_since_last_log, 30);
      return true;
    }
  );

  assert.equal(client.updatedDaily, false);
  assert.equal(client.commands.includes('ROLLBACK'), true);
});
