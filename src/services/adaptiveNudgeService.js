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

function safeText(value) {
  const normalized = String(value ?? '').replace(/\s+/g, ' ').trim();
  return normalized.length > 0 ? normalized : null;
}

function normalizeStringList(value) {
  if (Array.isArray(value)) {
    return value.map(safeText).filter(Boolean);
  }

  const normalized = safeText(value);
  if (!normalized) {
    return [];
  }

  if (normalized.startsWith('{') && normalized.endsWith('}')) {
    return normalized
      .slice(1, -1)
      .split(',')
      .map((item) => safeText(item.replace(/^"|"$/g, '')))
      .filter(Boolean);
  }

  return normalized.split(',').map(safeText).filter(Boolean);
}

function compactObject(value) {
  return Object.entries(value).reduce((result, [key, item]) => {
    if (item == null) {
      return result;
    }
    if (Array.isArray(item) && item.length === 0) {
      return result;
    }
    result[key] = item;
    return result;
  }, {});
}

function displayNameFromUsername(value) {
  const normalized = safeText(value);
  return normalized ? normalized.slice(0, 36) : null;
}

function prependDisplayName(message, displayName) {
  const normalizedMessage = safeText(message) ?? '';
  const name = displayNameFromUsername(displayName);
  if (!name || normalizedMessage.length === 0) {
    return normalizedMessage;
  }

  if (normalizedMessage.toLowerCase().startsWith(`${name.toLowerCase()},`)) {
    return normalizedMessage;
  }

  const shouldLowerFirst = !normalizedMessage.startsWith('VitalySync');
  const personalizedMessage = shouldLowerFirst
    ? `${normalizedMessage[0].toLowerCase()}${normalizedMessage.slice(1)}`
    : normalizedMessage;

  return `${name}, ${personalizedMessage}`;
}

function personalizationVariables(personalization) {
  const profile = personalization?.profile ?? {};
  const variables = [];
  if (personalization?.displayName) {
    variables.push('username');
  }
  if (profile.role) {
    variables.push('role');
  }
  if (profile.lifestyle_type) {
    variables.push('lifestyle_type');
  }
  if (profile.wellness_goals?.length > 0) {
    variables.push('wellness_goals');
  }
  if (profile.usual_sleep_time || profile.usual_wake_time) {
    variables.push('routine_times');
  }
  if (profile.exercise_goal_days) {
    variables.push('exercise_goal_days');
  }
  if (profile.workload_level != null) {
    variables.push('workload_level');
  }
  if (profile.has_extra_responsibilities === true) {
    variables.push('responsibility_context');
  }
  return variables;
}

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
  const weeklyContext = summary?.latest_score?.source_snapshot?.weekly_pulse;
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
      weekly_context_response_date: weeklyContext?.response_date ?? null,
      weekly_context_freshness: weeklyContext?.freshness ?? 'not_available',
      recommended_focus: recommendedFocus,
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
          'Your recent pattern has stayed high. Make one task smaller today and protect a real break.',
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
          'Your risk trend is climbing. Take a short pause now and make the next task lighter.',
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
          'Workload and recovery look out of balance. Take a recovery break before the next hard task.',
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
          'Your scores have been shifting a lot. Keep the next step simple: water, one focused task, then a reset.',
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
          'Emotional exhaustion is the strongest signal. Protect sleep tonight and skip one optional task.',
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
          'Recovery is the part that needs care today. Take an off-screen break or stop a little earlier.',
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
          'Workload is the strongest signal. Set one small boundary that makes the rest of today lighter.',
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
          'Detachment is standing out. Try a brief check-in with someone or one grounding activity.',
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
          'Recent weekly context suggests progress has felt harder. Pick one small task you can finish and mark it done.',
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
          'Limited daily coverage or weekly context makes nudges less precise. Complete the check-in currently due when you can.',
        actionLabel: 'Complete check-in',
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
          'VitalySync needs a few recent check-ins to adapt well. A quick daily log is enough for today.',
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
          'Your recent trend is improving. Keep one recovery habit steady instead of adding more today.',
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
          'Your recent pattern is steady. Keep hydration, movement, and a clear stop time simple today.',
        actionLabel: 'Continue',
        triggerReason: pattern.title,
        recommendedFocus: pattern.recommended_focus ?? 'maintenance',
        pattern,
        summary
      });
  }
}

export function stateRecommendation(summary) {
  const state = summary.adaptive_state?.state;
  const latest = summary.latest_score;
  if (normalizeConfidence(summary) < 55) {
    return null;
  }

  if (state === 'critical' || latest?.risk_level === 'critical') {
    return buildRecommendation({
      nudgeType: 'support_check',
      priority: 'urgent',
      title: 'Use extra support today',
      message:
        'The multi-day pattern is in a critical range. Lower what you can today and consider trusted support.',
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
        'Recent data shows high risk. Choose one thing to pause, delegate, or make easier today.',
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

export async function loadNudgePersonalizationProfile(client, userId) {
  const result = await client.query(
    `SELECT
       u.username,
       COALESCE(profile.role, u.role) AS role,
       COALESCE(profile.lifestyle_type, u.lifestyle_type) AS lifestyle_type,
       COALESCE(profile.wellness_goal, preferences.primary_goal, u.wellness_goal) AS wellness_goal,
       CASE
         WHEN cardinality(profile.wellness_goals) > 0 THEN profile.wellness_goals
         WHEN cardinality(preferences.wellness_goals) > 0 THEN preferences.wellness_goals
         ELSE u.wellness_goals
       END AS wellness_goals,
       to_char(profile.usual_sleep_time, 'HH24:MI') AS usual_sleep_time,
       to_char(profile.usual_wake_time, 'HH24:MI') AS usual_wake_time,
       profile.exercise_goal_days,
       profile.workload_level,
       profile.has_extra_responsibilities,
       profile.extra_responsibility_level
     FROM users u
     LEFT JOIN user_onboarding_profiles profile
       ON profile.user_id = u.user_id
     LEFT JOIN user_preferences preferences
       ON preferences.user_id = u.user_id
     WHERE u.user_id = $1`,
    [userId]
  );

  const row = result.rows[0] ?? {};
  const wellnessGoals = normalizeStringList(row.wellness_goals);
  const profile = compactObject({
    role: safeText(row.role),
    lifestyle_type: safeText(row.lifestyle_type),
    wellness_goal: safeText(row.wellness_goal),
    wellness_goals: wellnessGoals.length > 0
      ? wellnessGoals
      : normalizeStringList(row.wellness_goal),
    usual_sleep_time: safeText(row.usual_sleep_time),
    usual_wake_time: safeText(row.usual_wake_time),
    exercise_goal_days: safeText(row.exercise_goal_days),
    workload_level: row.workload_level == null ? null : Number(row.workload_level),
    has_extra_responsibilities: row.has_extra_responsibilities === true,
    extra_responsibility_level:
      row.extra_responsibility_level == null
        ? null
        : Number(row.extra_responsibility_level)
  });

  return {
    displayName: displayNameFromUsername(row.username),
    profile
  };
}

export function personalizeNudgeRecommendation(recommendation, personalization) {
  const userDisplayName = personalization?.displayName ?? null;

  return {
    ...recommendation,
    message: prependDisplayName(recommendation.message, userDisplayName),
    metadata: {
      ...recommendation.metadata,
      title: recommendation.title,
      user_display_name: userDisplayName,
      personalization_profile: personalization?.profile ?? {},
      profile_variables_used: personalizationVariables(personalization)
    }
  };
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

function eventMetadata(event) {
  if (event?.metadata == null) {
    return {};
  }

  if (typeof event.metadata === 'string') {
    try {
      const parsed = JSON.parse(event.metadata);
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
        ? parsed
        : {};
    } catch (_) {
      return {};
    }
  }

  return typeof event.metadata === 'object' && !Array.isArray(event.metadata)
    ? event.metadata
    : {};
}

function eventMatchesRecommendation(event, recommendation) {
  if (event.nudge_type === recommendation.nudge_type) {
    return true;
  }

  const metadata = eventMetadata(event);
  return Boolean(
    recommendation.recommended_focus &&
    metadata.recommended_focus === recommendation.recommended_focus
  );
}

export function applyRecentFeedback(recommendations, recentEvents, preferences) {
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
        ['shown', 'completed', 'snoozed'].includes(event.status)
      );
      const dismissedRecently = recentEvents.some((event) =>
        eventMatchesRecommendation(event, recommendation) &&
        event.status === 'dismissed' &&
        hoursSince(event.created_at, now) < preferences.cooldownHours
      );
      const acceptedRecently = recentEvents.some((event) =>
        eventMatchesRecommendation(event, recommendation) &&
        ['accepted', 'completed'].includes(event.status) &&
        hoursSince(event.created_at, now) <= 7 * 24
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
          recently_accepted: acceptedRecently,
          suppressed_by_feedback:
            dismissedRecently && !isStrongRecommendation(recommendation),
          throttled,
          throttle_reason: throttled
            ? (dailyLimitReached ? 'daily_limit' : 'cooldown')
            : null
        }
      };

      return adjusted;
    })
    .filter((recommendation, _index, adjusted) => {
      if (recommendation.metadata?.suppressed_by_feedback !== true) {
        return true;
      }

      return !adjusted.some((candidate) =>
        candidate.nudge_type !== recommendation.nudge_type &&
        candidate.metadata?.suppressed_by_feedback !== true
      );
    })
    .sort((a, b) => {
      const aThrottled = a.metadata?.throttled === true ? 1 : 0;
      const bThrottled = b.metadata?.throttled === true ? 1 : 0;
      if (aThrottled !== bThrottled) {
        return aThrottled - bThrottled;
      }

      const priorityDiff = PRIORITY_RANK[b.priority] - PRIORITY_RANK[a.priority];
      if (priorityDiff !== 0) {
        return priorityDiff;
      }

      const aAccepted = a.metadata?.recently_accepted === true ? 1 : 0;
      const bAccepted = b.metadata?.recently_accepted === true ? 1 : 0;
      if (aAccepted !== bAccepted) {
        return bAccepted - aAccepted;
      }

      const aDismissed = a.metadata?.recently_dismissed === true ? 1 : 0;
      const bDismissed = b.metadata?.recently_dismissed === true ? 1 : 0;
      if (aDismissed !== bDismissed) {
        return aDismissed - bDismissed;
      }

      return 0;
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
  const personalization = await loadNudgePersonalizationProfile(client, userId);
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
  const personalizedRanked = ranked.map((recommendation) =>
    personalizeNudgeRecommendation(recommendation, personalization)
  );
  const recommendations = useAi
    ? await enhanceNudgeRecommendations(client, userId, personalizedRanked, {
      summary,
      preferences,
      personalization,
      enhanceThrottled: !recordShown
    })
    : personalizedRanked;

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
