import assert from 'node:assert/strict';
import test from 'node:test';

import {
  advanceCheckInSchedule,
  getCheckInScheduleStatus
} from '../src/services/checkInSchedule.service.js';

class ScheduleClient {
  constructor({
    pulseWeekday = 1,
    schedule = null,
    firstLogDate = null,
    latestPulse = null,
    todayPulse = null
  } = {}) {
    this.pulseWeekday = pulseWeekday;
    this.schedule = schedule;
    this.firstLogDate = firstLogDate;
    this.latestPulse = latestPulse;
    this.todayPulse = todayPulse;
  }

  async query(sql, params = []) {
    const normalized = sql.replace(/\s+/g, ' ').trim();

    if (normalized.includes('FROM users LEFT JOIN user_reminder_preferences')) {
      return {
        rowCount: 1,
        rows: [{ user_id: params[0], pulse_weekday: this.pulseWeekday }]
      };
    }

    if (normalized.startsWith('INSERT INTO user_check_in_schedules')) {
      this.schedule ??= {
        user_id: params[0],
        pulse_weekday: params[1],
        next_pulse_due_date: null,
        last_completed_due_date: null,
        last_completed_at: null
      };
      return { rowCount: 0, rows: [] };
    }

    if (normalized.includes('SELECT due_date, response_date FROM weekly_pulse_responses')) {
      return {
        rowCount: this.latestPulse ? 1 : 0,
        rows: this.latestPulse ? [this.latestPulse] : []
      };
    }

    if (normalized.includes('SELECT MIN(log_date) AS first_log_date')) {
      return { rows: [{ first_log_date: this.firstLogDate }] };
    }

    if (normalized.includes('FROM weekly_pulse_responses WHERE user_id = $1 AND response_date = $2')) {
      const matches = this.todayPulse?.response_date === params[1];
      return {
        rowCount: matches ? 1 : 0,
        rows: matches ? [this.todayPulse] : []
      };
    }

    if (normalized.startsWith('UPDATE user_check_in_schedules')) {
      if (normalized.includes('last_completed_due_date = $3')) {
        this.schedule = {
          ...this.schedule,
          next_pulse_due_date: params[1],
          last_completed_due_date: params[2],
          last_completed_at: '2026-05-26T00:00:00.000Z',
          pulse_weekday: params[3]
        };
      } else {
        this.schedule = {
          ...this.schedule,
          next_pulse_due_date: params[1],
          pulse_weekday: params[2]
        };
      }
      return { rowCount: 1, rows: [] };
    }

    if (normalized.includes('FROM user_check_in_schedules')) {
      return { rowCount: 1, rows: [this.schedule] };
    }

    throw new Error(`Unexpected SQL in schedule test: ${normalized}`);
  }
}

test('schedule initializes from the first daily log and becomes overdue', async () => {
  const client = new ScheduleClient({ firstLogDate: '2026-05-18' });

  const beforeDue = await getCheckInScheduleStatus(client, {
    userId: 1,
    localDate: '2026-05-24',
    forUpdate: true
  });
  assert.equal(beforeDue.requiredMode, 'daily');
  assert.equal(beforeDue.nextDueDate, '2026-05-25');

  const overdue = await getCheckInScheduleStatus(client, {
    userId: 1,
    localDate: '2026-05-26',
    forUpdate: true
  });
  assert.equal(overdue.requiredMode, 'weekly');
  assert.equal(overdue.isOverdue, true);
  assert.equal(overdue.dueDate, '2026-05-25');
});

test('an overdue pulse keeps its date when the reminder weekday changes', async () => {
  const client = new ScheduleClient({
    pulseWeekday: 5,
    schedule: {
      user_id: 1,
      pulse_weekday: 1,
      next_pulse_due_date: '2026-05-18',
      last_completed_due_date: null,
      last_completed_at: null
    }
  });

  const status = await getCheckInScheduleStatus(client, {
    userId: 1,
    localDate: '2026-05-20',
    forUpdate: true
  });

  assert.equal(status.isOverdue, true);
  assert.equal(status.dueDate, '2026-05-18');
  assert.equal(status.pulseWeekday, 5);
});

test('multiple missed weeks collapse into the latest scheduled cycle', async () => {
  const client = new ScheduleClient({
    schedule: {
      user_id: 1,
      pulse_weekday: 1,
      next_pulse_due_date: '2026-05-18',
      last_completed_due_date: null,
      last_completed_at: null
    }
  });

  const status = await getCheckInScheduleStatus(client, {
    userId: 1,
    localDate: '2026-06-10',
    forUpdate: true
  });

  assert.equal(status.isOverdue, true);
  assert.equal(status.dueDate, '2026-06-08');
});

test('a future due date follows a newly configured reminder weekday', async () => {
  const client = new ScheduleClient({
    pulseWeekday: 5,
    schedule: {
      user_id: 1,
      pulse_weekday: 1,
      next_pulse_due_date: '2026-05-25',
      last_completed_due_date: null,
      last_completed_at: null
    }
  });

  const status = await getCheckInScheduleStatus(client, {
    userId: 1,
    localDate: '2026-05-20',
    forUpdate: true
  });

  assert.equal(status.requiredMode, 'daily');
  assert.equal(status.nextDueDate, '2026-05-22');
});

test('a pulse completed today remains in weekly redo mode', async () => {
  const client = new ScheduleClient({
    schedule: {
      user_id: 1,
      pulse_weekday: 1,
      next_pulse_due_date: '2026-06-01',
      last_completed_due_date: '2026-05-25',
      last_completed_at: '2026-05-26T00:00:00.000Z'
    },
    todayPulse: {
      pulse_id: 7,
      due_date: '2026-05-25',
      response_date: '2026-05-26'
    }
  });

  const status = await getCheckInScheduleStatus(client, {
    userId: 1,
    localDate: '2026-05-26',
    forUpdate: true
  });

  assert.equal(status.requiredMode, 'weekly');
  assert.equal(status.completedToday, true);
  assert.equal(status.isOverdue, false);
  assert.equal(status.dueDate, '2026-05-25');
});

test('late completion advances to the next configured weekday without stacking', async () => {
  const client = new ScheduleClient({
    schedule: {
      user_id: 1,
      pulse_weekday: 1,
      next_pulse_due_date: '2026-05-25',
      last_completed_due_date: null,
      last_completed_at: null
    }
  });

  const nextDueDate = await advanceCheckInSchedule(client, {
    userId: 1,
    mode: 'weekly',
    logDate: '2026-05-27',
    dueDate: '2026-05-25',
    pulseWeekday: 1
  });

  assert.equal(nextDueDate, '2026-06-01');
  assert.equal(client.schedule.last_completed_due_date, '2026-05-25');
});
