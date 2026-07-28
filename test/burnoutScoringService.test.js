import assert from 'node:assert/strict';
import test from 'node:test';

import {
  formatBurnoutScoreRow,
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

test('formatted v4 score exposes epoch and evidence-basis contract', () => {
  const score = formatBurnoutScoreRow({
    burnout_score_id: 4,
    user_id: 7,
    baseline_epoch_id: 12,
    score_date: '2026-07-28',
    overall_score: '45.5',
    risk_level: 'moderate',
    confidence_score: '90',
    completeness_score: '100',
    missing_fields: [],
    contributing_factors: [{ key: 'sleep_recovery', score: 60 }],
    source_snapshot: {
      baseline_policy: {
        epoch_started_at: '2026-07-28',
        logged_day_count: 1,
        weekly_pulse_count_since_epoch: 0,
        baseline_weight: 0.35,
        window_used: '1_day'
      }
    },
    scoring_version: 'burnout_engine_v4_decay_v1'
  });

  assert.equal(score.baseline_epoch_id, 12);
  assert.equal(score.evidence_basis.baseline_weight, 0.35);
  assert.equal(score.evidence_basis.log_coverage_percent, 100);
  assert.deepEqual(score.evidence_basis.top_factor_keys, ['sleep_recovery']);
  assert.match(score.explanation_note, /not a medical diagnosis/i);
});
