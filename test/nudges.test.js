import assert from 'node:assert/strict';
import test from 'node:test';

import pool from '../src/config/db.js';
import {
  createNudgeEvent,
  getNudgeRecommendations,
  updateNudgeEventStatus,
} from '../src/controllers/adaptive.controller.js';
import {
  applyRecentFeedback,
  loadRecentNudgeEvents,
  personalizeNudgeRecommendation,
  recommendationFromPattern,
  stateRecommendation
} from '../src/services/adaptiveNudgeService.js';
import {
  buildAiContext,
  enhanceNudgeRecommendation,
  ensureNameInMessage
} from '../src/services/aiNudgeService.js';
import {
  NUDGE_COPY_LIMITS,
  validateNudgeCopy
} from '../src/services/nudgeCopyPolicy.js';
import { toUserFacingNudgeSeverity } from '../src/services/nudgeSeverityPolicy.js';
import { createMockResponse } from './controllerTestHelpers.js';

function recommendation({
  nudgeType,
  priority = 'medium',
  recommendedFocus = 'recovery',
} = {}) {
  return {
    nudge_type: nudgeType,
    priority,
    title: nudgeType,
    message: 'Test message',
    action_label: 'Act',
    trigger_reason: 'Test',
    recommended_focus: recommendedFocus,
    metadata: { recommended_focus: recommendedFocus },
  };
}

const feedbackPreferences = {
  preferredNudgeStyle: 'Gentle',
  cooldownHours: 8,
  maxDailyNudges: 4,
};

function patternSummary(pattern, { state = 'watch', confidence = 82 } = {}) {
  return {
    latest_score: { risk_level: pattern.severity, overall_score: 58 },
    adaptive_state: {
      state,
      confidence_score: confidence,
      reason: pattern.title
    },
    windows: {
      '7_day': {
        dominant_dimension: {
          key: 'workload_strain_score',
          label: 'Workload',
          focus: 'workload',
          average_score: 61
        }
      },
      '14_day': {}
    },
    patterns: [pattern]
  };
}

test('nudge recommendations validate user id before database work', async () => {
  const res = createMockResponse();

  await getNudgeRecommendations({ query: { user_id: 'abc' } }, res);

  assert.equal(res.statusCode, 400);
  assert.equal(res.body.message, 'Valid user_id is required');
});

test('nudge recommendations validate boolean flags before database work', async () => {
  const res = createMockResponse();

  await getNudgeRecommendations(
    { query: { user_id: 1, record: 'sometimes' } },
    res
  );

  assert.equal(res.statusCode, 400);
  assert.equal(res.body.message, 'Valid record flag is required');
});

test('nudge event creation validates required message before database work', async () => {
  const res = createMockResponse();

  await createNudgeEvent(
    { body: { user_id: 1, nudge_type: 'recovery_break' } },
    res
  );

  assert.equal(res.statusCode, 400);
  assert.equal(res.body.message, 'Valid message is required');
});

test('nudge event updates validate allowed statuses before database work', async () => {
  const res = createMockResponse();

  await updateNudgeEventStatus(
    { params: { eventId: 12 }, body: { user_id: 1, status: 'ignored' } },
    res
  );

  assert.equal(res.statusCode, 400);
  assert.equal(res.body.message, 'Valid nudge status is required');
});

test('recent nudge feedback loads metadata needed for focus matching', async () => {
  let querySql = '';
  await loadRecentNudgeEvents(
    {
      query: async (sql) => {
        querySql = sql;
        return { rows: [] };
      }
    },
    1
  );

  assert.match(querySql, /status, metadata, created_at/);
});

test('smart nudge feedback suppresses recently dismissed non-urgent types when alternatives exist', () => {
  const ranked = applyRecentFeedback(
    [
      recommendation({ nudgeType: 'recovery_break', priority: 'medium' }),
      recommendation({
        nudgeType: 'small_win',
        priority: 'medium',
        recommendedFocus: 'progress',
      }),
    ],
    [
      {
        nudge_type: 'recovery_break',
        status: 'dismissed',
        created_at: new Date(),
        metadata: { recommended_focus: 'recovery' },
      },
    ],
    feedbackPreferences
  );

  assert.equal(ranked[0].nudge_type, 'small_win');
  assert.equal(
    ranked.some((item) => item.nudge_type === 'recovery_break'),
    false
  );
});

test('smart nudge feedback uses accepted status as same-priority tie breaker', () => {
  const ranked = applyRecentFeedback(
    [
      recommendation({ nudgeType: 'recovery_break', priority: 'medium' }),
      recommendation({
        nudgeType: 'small_win',
        priority: 'medium',
        recommendedFocus: 'progress',
      }),
    ],
    [
      {
        nudge_type: 'small_win',
        status: 'accepted',
        created_at: new Date(),
        metadata: { recommended_focus: 'progress' },
      },
    ],
    feedbackPreferences
  );

  assert.equal(ranked[0].nudge_type, 'small_win');
  assert.equal(ranked[0].metadata.recently_accepted, true);
});

test('smart nudge feedback suppresses a disliked focus across nudge types', () => {
  const ranked = applyRecentFeedback(
    [
      recommendation({
        nudgeType: 'recovery_break',
        recommendedFocus: 'recovery'
      }),
      recommendation({
        nudgeType: 'small_win',
        recommendedFocus: 'progress'
      })
    ],
    [
      {
        nudge_type: 'sleep_wind_down',
        status: 'dismissed',
        created_at: new Date(),
        metadata: { recommended_focus: 'recovery' }
      }
    ],
    feedbackPreferences
  );

  assert.deepEqual(ranked.map((item) => item.nudge_type), ['small_win']);
});

test('smart nudge feedback slightly boosts an accepted focus across nudge types', () => {
  const ranked = applyRecentFeedback(
    [
      recommendation({
        nudgeType: 'small_win',
        recommendedFocus: 'progress'
      }),
      recommendation({
        nudgeType: 'recovery_break',
        recommendedFocus: 'recovery'
      })
    ],
    [
      {
        nudge_type: 'sleep_wind_down',
        status: 'accepted',
        created_at: new Date(),
        metadata: { recommended_focus: 'recovery' }
      }
    ],
    feedbackPreferences
  );

  assert.equal(ranked[0].nudge_type, 'recovery_break');
  assert.equal(ranked[0].metadata.recently_accepted_focus, true);
  assert.equal(ranked[0].metadata.recently_accepted_type, false);
});

test('smart nudge feedback keeps high recommendations visible after a dislike', () => {
  const ranked = applyRecentFeedback(
    [
      recommendation({
        nudgeType: 'load_reduction_check',
        priority: 'high',
        recommendedFocus: 'recovery'
      }),
      recommendation({
        nudgeType: 'small_win',
        priority: 'medium',
        recommendedFocus: 'progress'
      })
    ],
    [
      {
        nudge_type: 'sleep_wind_down',
        status: 'dismissed',
        created_at: new Date(),
        metadata: { recommended_focus: 'recovery' }
      }
    ],
    feedbackPreferences
  );

  assert.equal(ranked[0].nudge_type, 'load_reduction_check');
  assert.equal(ranked[0].priority, 'high');
  assert.equal(ranked[0].metadata.suppressed_by_feedback, false);
});

test('smart nudge feedback does not let accepted low priority outrank high priority nudges', () => {
  const ranked = applyRecentFeedback(
    [
      recommendation({ nudgeType: 'load_reduction_check', priority: 'high' }),
      recommendation({
        nudgeType: 'small_win',
        priority: 'low',
        recommendedFocus: 'progress',
      }),
    ],
    [
      {
        nudge_type: 'small_win',
        status: 'accepted',
        created_at: new Date(),
        metadata: { recommended_focus: 'progress' },
      },
    ],
    feedbackPreferences
  );

  assert.equal(ranked[0].nudge_type, 'load_reduction_check');
});

test('smart nudge personalization adds username metadata without changing ranking fields', () => {
  const original = recommendation({
    nudgeType: 'recovery_break',
    priority: 'high'
  });
  const personalized = personalizeNudgeRecommendation(original, {
    displayName: 'Vitaly',
    profile: {
      role: 'Student',
      wellness_goals: ['Improve sleep', 'Manage burnout'],
      usual_sleep_time: '22:30'
    }
  });

  assert.equal(personalized.nudge_type, original.nudge_type);
  assert.equal(personalized.priority, original.priority);
  assert.equal(personalized.recommended_focus, original.recommended_focus);
  assert.match(personalized.message, /^Vitaly, /);
  assert.equal(personalized.metadata.user_display_name, 'Vitaly');
  assert.deepEqual(personalized.metadata.personalization_profile.wellness_goals, [
    'Improve sleep',
    'Manage burnout'
  ]);
  assert.deepEqual(personalized.metadata.profile_variables_used, [
    'username',
    'role',
    'wellness_goals',
    'routine_times'
  ]);
  assert.equal(personalized.metadata.copy_validation_status, 'valid');
  assert.ok(personalized.message.length <= NUDGE_COPY_LIMITS.message);
  assert.equal((personalized.message.match(/Vitaly/gi) ?? []).length, 1);
});

test('deterministic nudges match user-facing severity and contextual inputs', () => {
  const cases = [
    {
      pattern: {
        type: 'stable_current_pattern',
        severity: 'low',
        title: 'Pattern is stable',
        recommended_focus: 'maintenance'
      },
      severity: 'steady',
      phrase: /steady/i
    },
    {
      pattern: {
        type: 'rising_recent_risk',
        severity: 'moderate',
        title: 'Pressure is rising',
        recommended_focus: 'early_recovery'
      },
      severity: 'watch',
      phrase: /reset/i
    },
    {
      pattern: {
        type: 'dominant_workload',
        severity: 'high',
        title: 'Workload is strongest',
        recommended_focus: 'workload'
      },
      severity: 'high',
      phrase: /smaller/i
    },
    {
      pattern: {
        type: 'sustained_elevated_risk',
        severity: 'critical',
        title: 'Pattern needs support',
        recommended_focus: 'load_reduction'
      },
      severity: 'needs support',
      phrase: /someone you trust/i
    }
  ];

  for (const item of cases) {
    const result = recommendationFromPattern(
      item.pattern,
      patternSummary(item.pattern)
    );
    assert.equal(result.severity, item.severity);
    assert.match(result.message, item.phrase);
    assert.doesNotMatch(`${result.title} ${result.message}`, /critical|urgent/i);
    assert.equal(
      result.metadata.context_snapshot.latest_pattern_type,
      item.pattern.type
    );
    assert.equal(
      result.metadata.context_snapshot.dominant_dimension.focus,
      'workload'
    );
    assert.equal(result.metadata.context_snapshot.confidence_score, 82);
  }
});

test('copy policy blocks diagnosis, unsupported claims, long copy, and bad username use', () => {
  const diagnosis = validateNudgeCopy({
    title: 'A clear answer',
    message: 'Alex, you have burnout and should stop.',
    actionLabel: 'Stop',
    displayName: 'Alex'
  });
  const unsupported = validateNudgeCopy({
    title: 'A guaranteed reset',
    message: 'Alex, this will cure stress. Take a pause.',
    actionLabel: 'Pause',
    displayName: 'Alex'
  });
  const tooLong = validateNudgeCopy({
    title: 'Take a reset',
    message: `Alex, ${'x'.repeat(NUDGE_COPY_LIMITS.message)}`,
    actionLabel: 'Pause',
    displayName: 'Alex'
  });
  const duplicateName = validateNudgeCopy({
    title: 'Take a reset',
    message: 'Alex, take one short reset, Alex.',
    actionLabel: 'Pause',
    displayName: 'Alex'
  });

  assert.ok(diagnosis.errors.includes('diagnosis_language'));
  assert.ok(unsupported.errors.includes('unsupported_claim'));
  assert.ok(tooLong.errors.includes('message_too_long'));
  assert.ok(duplicateName.errors.includes('username_count'));
});

test('internal urgent and critical severity maps to needs support', () => {
  assert.equal(toUserFacingNudgeSeverity('critical'), 'needs support');
  assert.equal(toUserFacingNudgeSeverity('urgent'), 'needs support');
  assert.equal(toUserFacingNudgeSeverity('high_risk'), 'high');
  assert.equal(toUserFacingNudgeSeverity('moderate'), 'watch');
});

test('low-confidence score states do not create urgent assistant nudges', () => {
  const recommendation = stateRecommendation({
    latest_score: { risk_level: 'critical', overall_score: 84 },
    adaptive_state: {
      state: 'critical',
      confidence_score: 40,
      reason: 'Limited inputs'
    },
    patterns: []
  });

  assert.equal(recommendation, null);
});

test('AI nudge context carries personal context and keeps username in message locally', () => {
  const personalized = personalizeNudgeRecommendation(
    recommendation({ nudgeType: 'small_win', recommendedFocus: 'progress' }),
    {
      displayName: 'Alex',
      profile: {
        lifestyle_type: 'Lightly Active',
        exercise_goal_days: '3-4 days',
        workload_level: 4
      }
    }
  );
  const context = buildAiContext(
    personalized,
    {
      latest_score: { risk_level: 'moderate', overall_score: 52 },
      adaptive_state: { state: 'watch', confidence_score: 82 },
      windows: {},
      patterns: []
    },
    feedbackPreferences
  );

  assert.equal(context.personal_context.user_display_name, 'Alex');
  assert.equal(context.personal_context.profile.workload_level, 4);
  assert.equal(
    context.personal_context.visible_personalization.use_username_once_when_available,
    true
  );
  assert.equal(context.guardrails.do_not_change_priority_or_risk, true);
  assert.equal(context.guardrails.do_not_reference_email_age_or_gender, true);
  assert.equal(context.guardrails.message_max_characters, 140);
  assert.equal(context.guardrails.use_one_concrete_action, true);
  assert.match(ensureNameInMessage('Take one small step.', 'Alex'), /^Alex, /);
});

test('AI nudge enhancement returns deterministic fallback without AI', async () => {
  const originalApiKey = process.env.OPENAI_API_KEY;
  delete process.env.OPENAI_API_KEY;
  const base = personalizeNudgeRecommendation(
    recommendation({ nudgeType: 'small_win', recommendedFocus: 'progress' }),
    { displayName: 'Alex', profile: {} }
  );
  const auditQueries = [];

  try {
    const result = await enhanceNudgeRecommendation(
      {
        query: async (sql, params) => {
          auditQueries.push({ sql, params });
          return { rowCount: 1, rows: [] };
        }
      },
      1,
      base,
      {
        summary: patternSummary({
          type: 'stable_current_pattern',
          severity: 'low',
          title: 'Pattern is stable',
          recommended_focus: 'maintenance'
        }),
        preferences: feedbackPreferences,
        personalization: { displayName: 'Alex', profile: {} }
      }
    );

    assert.equal(result.title, base.title);
    assert.equal(result.message, base.message);
    assert.equal(result.metadata.ai_enhanced, false);
    assert.equal(result.metadata.ai_fallback, true);
    assert.equal(auditQueries.length, 1);
  } finally {
    if (originalApiKey == null) {
      delete process.env.OPENAI_API_KEY;
    } else {
      process.env.OPENAI_API_KEY = originalApiKey;
    }
  }
});

test('nudge event creation casts reused status parameter for PostgreSQL', async () => {
  const res = createMockResponse();
  const originalQuery = pool.query;
  const queries = [];

  pool.query = async (sql, params) => {
    queries.push({ sql, params });

    if (sql.includes('SELECT user_id FROM users')) {
      return { rowCount: 1, rows: [{ user_id: params[0] }] };
    }

    return {
      rowCount: 1,
      rows: [
        {
          nudge_event_id: 42,
          user_id: params[0],
          nudge_type: params[1],
          trigger_reason: params[2],
          message: params[3],
          action_label: params[4],
          status: params[5],
          metadata: JSON.parse(params[6]),
          acted_at: new Date().toISOString(),
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString()
        }
      ]
    };
  };

  try {
    await createNudgeEvent(
      {
        body: {
          user_id: 1,
          nudge_type: 'steady_routine',
          message: 'Keep today steady.',
          status: 'accepted',
          metadata: { title: 'Keep today steady' }
        }
      },
      res
    );
  } finally {
    pool.query = originalQuery;
  }

  const insertQuery = queries.find((query) =>
    query.sql.includes('INSERT INTO nudge_events')
  );

  assert.equal(res.statusCode, 201);
  assert.match(insertQuery.sql, /\$6::varchar/);
  assert.match(insertQuery.sql, /CASE WHEN \$6::text = 'shown'/);
});

test('nudge event status update casts reused status parameter for PostgreSQL', async () => {
  const res = createMockResponse();
  const originalQuery = pool.query;
  let updateSql = '';

  pool.query = async (sql, params) => {
    updateSql = sql;
    return {
      rowCount: 1,
      rows: [
        {
          nudge_event_id: params[0],
          user_id: params[1],
          nudge_type: 'steady_routine',
          trigger_reason: null,
          message: 'Keep today steady.',
          action_label: null,
          status: params[2],
          metadata: {},
          acted_at: new Date().toISOString(),
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString()
        }
      ]
    };
  };

  try {
    await updateNudgeEventStatus(
      { params: { eventId: 12 }, body: { user_id: 1, status: 'dismissed' } },
      res
    );
  } finally {
    pool.query = originalQuery;
  }

  assert.equal(res.statusCode, 200);
  assert.match(updateSql, /status = \$3::varchar/);
  assert.match(updateSql, /CASE WHEN \$3::text = 'shown'/);
});
