import { enhanceNudgeRecommendations } from './aiNudgeService.js';
import { getBurnoutPatternSummary } from './burnoutPatternService.js';

const PRIORITY_RANK = {
  urgent: 4,
  high: 3,
  medium: 2,
  low: 1
};

const SEVERITY_PRIORITY = {
  critical: 'urgent',
  high: 'high',
  moderate: 'medium',
  low: 'low'
};

const STYLE_THROTTLE_DEFAULTS = {
  Gentle: { cooldownHours: 8, maxDailyNudges: 2 },
  Direct: { cooldownHours: 4, maxDailyNudges: 4 },
  Motivational: { cooldownHours: 6, maxDailyNudges: 3 },
  'Data-Driven': { cooldownHours: 6, maxDailyNudges: 3 }
};

function boundedLimit(value, fallback = 3) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    return fallback;
  }

  return Math.min(parsed, 5);
}

function priorityForPattern(pattern, fallback = 'medium') {
  return SEVERITY_PRIORITY[pattern?.severity] ?? fallback;
}

function normalizeConfidence(summary) {
  const confidence = Number(summary?.adaptive_state?.confidence_score);
  return Number.isFinite(confidence) ? Math.round(confidence) : 0;
}

function buildRecommendation({
  nudgeType,
  priority,
  title,
  message,
  actionLabel,
  triggerReason,
  recommendedFocus,
  pattern,
  summary,
  metadata = {}
}) {
  return {
    nudge_type: nudgeType,
    priority,
    title,
    message,
    action_label: actionLabel,
    trigger_reason: triggerReason,
    recommended_focus: recommendedFocus,
    pattern_type: pattern?.type ?? null,
    severity: pattern?.severity ?? null,
    confidence_score: normalizeConfidence(summary),
    nudge_event_id: null,
    metadata: {
      pattern_type: pattern?.type ?? null,
      pattern_title: pattern?.title ?? null,
      adaptive_state: summary?.adaptive_state?.state ?? null,
      latest_risk_level: summary?.latest_score?.risk_level ?? null,
      ...metadata
    }
  };
}

function recommendationFromPattern(pattern, summary) {
  const priority = priorityForPattern(pattern);

  switch (pattern.type) {
    case 'sustained_elevated_risk':
      return buildRecommendation({
        nudgeType: 'load_reduction_check',
        priority,
        title: 'Protect your recovery window',
        message:
          'Your recent pattern has stayed elevated. Pick one workload pressure to reduce or defer today, then protect a real recovery block.',
        actionLabel: 'Plan recovery',
        triggerReason: pattern.title,
        recommendedFocus: 'load_reduction',
        pattern,
        summary
      });
    case 'rising_recent_risk':
      return buildRecommendation({
        nudgeType: 'micro_recovery_break',
        priority,
        title: 'Slow the rising trend',
        message:
          'Your short-term burnout trend is climbing. A short pause, lighter task, or earlier wind-down can help interrupt the pattern.',
        actionLabel: 'Take a pause',
        triggerReason: pattern.title,
        recommendedFocus: 'early_recovery',
        pattern,
        summary
      });
    case 'workload_recovery_mismatch':
      return buildRecommendation({
        nudgeType: 'recovery_break',
        priority: 'high',
        title: 'Balance load with recovery',
        message:
          'High workload and weak recovery are appearing together. Add a recovery break before taking on another demanding block.',
        actionLabel: 'Schedule break',
        triggerReason: pattern.title,
        recommendedFocus: 'recovery',
        pattern,
        summary
      });
    case 'volatile_recent_pattern':
      return buildRecommendation({
        nudgeType: 'stabilize_routine',
        priority,
        title: 'Keep today steady',
        message:
          'Your scores have been moving sharply. Keep the next step simple: hydrate, do one focused task, then take a short reset.',
        actionLabel: 'Stabilize',
        triggerReason: pattern.title,
        recommendedFocus: 'stabilize_routine',
        pattern,
        summary
      });
    case 'dominant_exhaustion':
      return buildRecommendation({
        nudgeType: 'sleep_wind_down',
        priority,
        title: 'Support emotional energy',
        message:
          'Emotional exhaustion is the strongest signal in your pattern. Protect sleep tonight and avoid adding one more optional task.',
        actionLabel: 'Set wind-down',
        triggerReason: pattern.title,
        recommendedFocus: 'recovery',
        pattern,
        summary
      });
    case 'dominant_recovery':
      return buildRecommendation({
        nudgeType: 'recovery_break',
        priority,
        title: 'Recovery needs attention',
        message:
          'Recovery deficit is standing out. A short off-screen break or earlier stop time is more useful than pushing through.',
        actionLabel: 'Take break',
        triggerReason: pattern.title,
        recommendedFocus: 'recovery',
        pattern,
        summary
      });
    case 'dominant_workload':
      return buildRecommendation({
        nudgeType: 'workload_boundary',
        priority,
        title: 'Trim the load',
        message:
          'Workload strain is the strongest signal. Choose the smallest task boundary that makes the rest of the day lighter.',
        actionLabel: 'Set boundary',
        triggerReason: pattern.title,
        recommendedFocus: 'workload',
        pattern,
        summary
      });
    case 'dominant_connection':
      return buildRecommendation({
        nudgeType: 'connection_reset',
        priority,
        title: 'Reconnect gently',
        message:
          'Detachment is standing out in your pattern. A brief check-in with someone or a grounding activity may help reduce distance.',
        actionLabel: 'Reconnect',
        triggerReason: pattern.title,
        recommendedFocus: 'connection',
        pattern,
        summary
      });
    case 'dominant_progress':
      return buildRecommendation({
        nudgeType: 'small_win',
        priority,
        title: 'Make progress visible',
        message:
          'Reduced accomplishment is the strongest signal. Pick one small finishable task and mark it clearly when done.',
        actionLabel: 'Choose one win',
        triggerReason: pattern.title,
        recommendedFocus: 'progress',
        pattern,
        summary
      });
    case 'low_confidence_score':
      return buildRecommendation({
        nudgeType: 'complete_check_in',
        priority: 'low',
        title: 'Improve recommendation quality',
        message:
          "A few missing inputs are lowering score confidence. Completing today's log will make future nudges more precise.",
        actionLabel: 'Complete log',
        triggerReason: pattern.title,
        recommendedFocus: 'data_completion',
        pattern,
        summary
      });
    case 'insufficient_recent_data':
      return buildRecommendation({
        nudgeType: 'complete_check_in',
        priority: 'low',
        title: 'Build your trend baseline',
        message:
          'VitalySync needs a few recent check-ins before it can adapt strongly. A quick daily log is enough to improve the pattern.',
        actionLabel: 'Log today',
        triggerReason: pattern.title,
        recommendedFocus: 'data_completion',
        pattern,
        summary
      });
    case 'improving_recent_recovery':
      return buildRecommendation({
        nudgeType: 'maintain_recovery',
        priority: 'low',
        title: 'Keep the recovery trend',
        message:
          'Your recent trend is improving. Keep one recovery habit steady today instead of adding a new goal.',
        actionLabel: 'Keep routine',
        triggerReason: pattern.title,
        recommendedFocus: 'maintain_recovery',
        pattern,
        summary
      });
    default:
      return buildRecommendation({
        nudgeType: 'steady_routine',
        priority: 'low',
        title: 'Keep today steady',
        message:
          'Your recent pattern is stable. Stay consistent with hydration, movement, and a clear stop time.',
        actionLabel: 'Continue',
        triggerReason: pattern.title,
        recommendedFocus: pattern.recommended_focus ?? 'maintenance',
        pattern,
        summary
      });
  }
}

function stateRecommendation(summary) {
  const state = summary.adaptive_state?.state;
  const latest = summary.latest_score;

  if (state === 'critical' || latest?.risk_level === 'critical') {
    return buildRecommendation({
      nudgeType: 'support_check',
      priority: 'urgent',
      title: 'Use extra support today',
      message:
        'The multi-day pattern is in a critical range. Reduce load where possible and consider reaching out to trusted support.',
      actionLabel: 'Reduce load',
      triggerReason: summary.adaptive_state?.reason ?? 'Critical pattern',
      recommendedFocus: 'support',
      pattern: summary.patterns?.[0],
      summary,
      metadata: { state_driven: true }
    });
  }

  if (state === 'high_risk') {
    return buildRecommendation({
      nudgeType: 'load_reduction_check',
      priority: 'high',
      title: "Lower today's pressure",
      message:
        'The pattern is high risk across recent data. Choose one thing to pause, delegate, or make easier today.',
      actionLabel: 'Lower pressure',
      triggerReason: summary.adaptive_state?.reason ?? 'High risk pattern',
      recommendedFocus: 'load_reduction',
      pattern: summary.patterns?.[0],
      summary,
      metadata: { state_driven: true }
    });
  }

  return null;
}

function dedupeRecommendations(recommendations) {
  const seenTypes = new Set();
  return recommendations.filter((recommendation) => {
    if (seenTypes.has(recommendation.nudge_type)) {
      return false;
    }
    seenTypes.add(recommendation.nudge_type);
    return true;
  });
}

function hoursSince(value, now = new Date()) {
  const date = value instanceof Date ? value : new Date(value);
  const diff = now.getTime() - date.getTime();
  return Number.isFinite(diff) ? diff / (1000 * 60 * 60) : Number.POSITIVE_INFINITY;
}

function isStrongRecommendation(recommendation) {
  return recommendation.priority === 'urgent' || recommendation.priority === 'high';
}

async function loadNudgeThrottlePreferences(client, userId) {
  const result = await client.query(
    `SELECT
       urp.nudge_cooldown_hours,
       urp.max_daily_nudges,
       up.preferred_nudge_style
     FROM users u
     LEFT JOIN user_reminder_preferences urp ON urp.user_id = u.user_id
     LEFT JOIN user_preferences up ON up.user_id = u.user_id
     WHERE u.user_id = $1`,
    [userId]
  );
  const row = result.rows[0] ?? {};
  const style = row.preferred_nudge_style ?? 'Gentle';
  const styleDefaults = STYLE_THROTTLE_DEFAULTS[style] ??
    STYLE_THROTTLE_DEFAULTS.Gentle;

  return {
    preferredNudgeStyle: style,
    cooldownHours:
      Number.isInteger(row.nudge_cooldown_hours) && row.nudge_cooldown_hours > 0
        ? row.nudge_cooldown_hours
        : styleDefaults.cooldownHours,
    maxDailyNudges:
      Number.isInteger(row.max_daily_nudges) && row.max_daily_nudges > 0
        ? row.max_daily_nudges
        : styleDefaults.maxDailyNudges
  };
}

async function loadRecentNudgeEvents(client, userId) {
  const result = await client.query(
    `SELECT nudge_event_id, nudge_type, status, created_at
     FROM nudge_events
     WHERE user_id = $1
       AND created_at >= NOW() - INTERVAL '7 days'
     ORDER BY created_at DESC`,
    [userId]
  );

  return result.rows;
}

function applyRecentFeedback(recommendations, recentEvents, preferences) {
  const now = new Date();
  const shownTodayCount = recentEvents.filter((event) =>
    ['shown', 'accepted', 'completed', 'snoozed'].includes(event.status) &&
    hoursSince(event.created_at, now) <= 24
  ).length;
  const dailyLimitReached = shownTodayCount >= preferences.maxDailyNudges;

  return recommendations
    .map((recommendation) => {
      const sameTypeEvent = recentEvents.find((event) =>
        event.nudge_type === recommendation.nudge_type &&
        ['shown', 'accepted', 'completed', 'snoozed'].includes(event.status)
      );
      const dismissedRecently = recentEvents.some((event) =>
        event.nudge_type === recommendation.nudge_type &&
        event.status === 'dismissed'
      );
      const inCooldown =
        sameTypeEvent &&
        hoursSince(sameTypeEvent.created_at, now) < preferences.cooldownHours;
      const throttled =
        !isStrongRecommendation(recommendation) &&
        (dailyLimitReached || inCooldown);

      const adjusted = {
        ...recommendation,
        priority: dismissedRecently || throttled
          ? (isStrongRecommendation(recommendation) ? 'medium' : 'low')
          : recommendation.priority,
        metadata: {
          ...recommendation.metadata,
          preferred_nudge_style: preferences.preferredNudgeStyle,
          nudge_cooldown_hours: preferences.cooldownHours,
          max_daily_nudges: preferences.maxDailyNudges,
          recent_daily_nudge_count: shownTodayCount,
          recently_dismissed: dismissedRecently,
          throttled,
          throttle_reason: throttled
            ? (dailyLimitReached ? 'daily_limit' : 'cooldown')
            : null
        }
      };

      return adjusted;
    })
    .sort((a, b) => {
      const aThrottled = a.metadata?.throttled === true ? 1 : 0;
      const bThrottled = b.metadata?.throttled === true ? 1 : 0;
      if (aThrottled !== bThrottled) {
        return aThrottled - bThrottled;
      }

      return PRIORITY_RANK[b.priority] - PRIORITY_RANK[a.priority];
    });
}

async function attachShownEvent(client, userId, recommendation, preferences) {
  if (recommendation.metadata?.throttled === true) {
    return recommendation;
  }

  const existing = await client.query(
    `SELECT nudge_event_id
     FROM nudge_events
     WHERE user_id = $1
       AND nudge_type = $2
       AND status = 'shown'
       AND created_at >= NOW() - ($3::int * INTERVAL '1 hour')
     ORDER BY created_at DESC
     LIMIT 1`,
    [userId, recommendation.nudge_type, preferences.cooldownHours]
  );

  if (existing.rowCount > 0) {
    return {
      ...recommendation,
      nudge_event_id: existing.rows[0].nudge_event_id
    };
  }

  const result = await client.query(
    `INSERT INTO nudge_events (
       user_id,
       nudge_type,
       trigger_reason,
       message,
       action_label,
       status,
       metadata
     )
     VALUES ($1, $2, $3, $4, $5, 'shown', $6)
     RETURNING nudge_event_id`,
    [
      userId,
      recommendation.nudge_type,
      recommendation.trigger_reason,
      recommendation.message,
      recommendation.action_label,
      JSON.stringify(recommendation.metadata)
    ]
  );

  return {
    ...recommendation,
    nudge_event_id: result.rows[0].nudge_event_id
  };
}

export async function getAdaptiveNudgeRecommendations(
  client,
  userId,
  { limit = 3, recordShown = true, endDate, useAi = false } = {}
) {
  const normalizedLimit = boundedLimit(limit);
  const summary = await getBurnoutPatternSummary(client, userId, { endDate });
  const recentEvents = await loadRecentNudgeEvents(client, userId);
  const preferences = await loadNudgeThrottlePreferences(client, userId);
  const stateDriven = stateRecommendation(summary);
  const patternDriven = (summary.patterns ?? []).map((pattern) =>
    recommendationFromPattern(pattern, summary)
  );
  const candidates = dedupeRecommendations(
    [stateDriven, ...patternDriven].filter(Boolean)
  );
  const ranked = applyRecentFeedback(
    candidates,
    recentEvents,
    preferences
  ).slice(
    0,
    normalizedLimit
  );
  const recommendations = useAi
    ? await enhanceNudgeRecommendations(client, userId, ranked, {
      summary,
      preferences,
      enhanceThrottled: !recordShown
    })
    : ranked;

  if (!recordShown || recommendations.length === 0) {
    return {
      summary,
      recommendations
    };
  }

  const primary = await attachShownEvent(
    client,
    userId,
    recommendations[0],
    preferences
  );

  return {
    summary,
    recommendations: [primary, ...recommendations.slice(1)]
  };
}
