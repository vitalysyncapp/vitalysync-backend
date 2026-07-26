import assert from 'node:assert/strict';
import test from 'node:test';

import {
  loadBurnoutScoreInputs,
} from '../src/services/burnoutScoringService.js';

test('score inputs carry forward only the latest pulse completed by the score date', async () => {
  const queries = [];
  const client = {
    async query(sql, params) {
      queries.push({ sql, params });

      if (sql.includes('FROM weekly_pulse_responses')) {
        return {
          rows: [{
            week_start_date: '2026-05-18',
            due_date: '2026-05-18',
            response_date: '2026-05-20',
            perceived_pressure_level: 4,
            productivity_focus_level: 2,
            recovery_rest_level: 2,
            detachment_level: 4,
            accomplishment_level: 2,
            schema_version: 2,
          }],
        };
      }

      return { rows: [] };
    },
  };

  const inputs = await loadBurnoutScoreInputs(client, 7, '2026-05-22');
  const pulseQuery = queries.find(({ sql }) =>
    sql.includes('FROM weekly_pulse_responses')
  );

  assert.ok(pulseQuery);
  assert.match(pulseQuery.sql, /response_date <= \$2/);
  assert.match(pulseQuery.sql, /ORDER BY response_date DESC, updated_at DESC/);
  assert.match(pulseQuery.sql, /perceived_pressure_level/);
  assert.deepEqual(pulseQuery.params, [7, '2026-05-22']);
  assert.equal(inputs.weeklyPulse.response_date, '2026-05-20');
  assert.equal(inputs.weeklyPulse.perceived_pressure_level, 4);
});
