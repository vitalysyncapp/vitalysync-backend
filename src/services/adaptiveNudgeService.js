import { enhanceNudgeRecommendations } from './aiNudgeService.js';
import {
  localizeAdaptiveSummary,
  localizeNudgeRecommendation,
} from '../i18n/generatedCopy.js';
import { getBurnoutPatternSummary } from './burnoutPatternService.js';
import { validateNudgeCopy } from './nudgeCopyPolicy.js';
import {
  fallbackCopyForSeverity,
  toUserFacingNudgeSeverity
} from './nudgeSeverityPolicy.js';

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

function dominantDimensionFromSummary(summary) {
  const dimension = summary?.windows?.['14_day']?.dominant_dimension ??
    summary?.windows?.['7_day']?.dominant_dimension ??
    null;
  if (!dimension) {
    return null;
  }

  return compactObject({
    key: safeText(dimension.key),
    label: safeText(dimension.label),
    focus: safeText(dimension.focus),
    average_score: Number.isFinite(Number(dimension.average_score))
      ? Number(dimension.average_score)
      : null
  });
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
  internalSeverity = null,
  metadata = {}
}) {
  const weeklyContext = summary?.latest_score?.source_snapshot?.weekly_pulse;
  const resolvedInternalSeverity = internalSeverity ?? pattern?.severity ?? null;
  const userFacingSeverity = toUserFacingNudgeSeverity(
    resolvedInternalSeverity,
    priority
  );
  const dominantDimension = dominantDimensionFromSummary(summary);
  const latestPattern = summary?.patterns?.[0] ?? pattern ?? null;
  return {
    nudge_type: nudgeType,
    priority,
    title,
    message,
    action_label: actionLabel,
    trigger_reason: triggerReason,
    recommended_focus: recommendedFocus,
    pattern_type: pattern?.type ?? null,
    severity: userFacingSeverity,
    confidence_score: normalizeConfidence(summary),
    nudge_event_id: null,
    metadata: {
      pattern_type: pattern?.type ?? null,
      pattern_title: pattern?.title ?? null,
      internal_severity: resolvedInternalSeverity,
      user_facing_severity: userFacingSeverity,
      adaptive_state: summary?.adaptive_state?.state ?? null,
      latest_risk_level: summary?.latest_score?.risk_level ?? null,
      dominant_dimension: dominantDimension,
      context_snapshot: compactObject({
        latest_pattern_type: latestPattern?.type ?? null,
        latest_pattern_severity: latestPattern?.severity ?? null,
        dominant_dimension: dominantDimension,
        confidence_score: normalizeConfidence(summary)
      }),
      weekly_context_response_date: weeklyContext?.response_date ?? null,
      weekly_context_freshness: weeklyContext?.freshness ?? 'not_available',
      recommended_focus: recommendedFocus,
      ...metadata
    }
  };
}

function higherSeverityCopy(pattern) {
  const severity = toUserFacingNudgeSeverity(pattern?.severity);
  if (severity === 'needs support') {
    return fallbackCopyForSeverity(severity);
  }
  if (severity !== 'high') {
    return null;
  }

  switch (pattern?.recommended_focus) {
    case 'recovery':
      return {
        title: 'Protect recovery today',
        message:
          'Recovery is the clearest signal. Protect one real break before your next hard task.',
        actionLabel: 'Protect a break'
      };
    case 'workload':
      return {
        title: 'Make workload lighter',
        message:
          'Workload is the clearest signal. Make one task smaller today.',
        actionLabel: 'Reduce one task'
      };
    case 'progress':
      return {
        title: 'Shrink the next step',
        message:
          'Progress strain is staying high. Cut one task down to its next manageable step.',
        actionLabel: 'Shrink one task'
      };
    default:
      return fallbackCopyForSeverity(severity);
  }
}

export function recommendationFromPattern(pattern, summary) {
  const priority = priorityForPattern(pattern);
  const severityCopy = higherSeverityCopy(pattern);
  const copy = (fallback) => severityCopy ?? fallback;

  switch (pattern.type) {
    case 'sustained_elevated_risk': {
      const selected = copy({
        title: 'Ease the recent load',
        message:
          'Pressure has stayed elevated. Make one task smaller today.',
        actionLabel: 'Reduce one task'
      });
      return buildRecommendation({
        nudgeType: 'load_reduction_check',
        priority,
        ...selected,
        triggerReason: pattern.title,
        recommendedFocus: 'load_reduction',
        pattern,
        summary
      });
    }
    case 'rising_recent_risk': {
      const selected = copy({
        title: 'Take a small reset',
        message:
          'Pressure is trending up. Take one short reset before the next task.',
        actionLabel: 'Take a reset'
      });
      return buildRecommendation({
        nudgeType: 'micro_recovery_break',
        priority,
        ...selected,
        triggerReason: pattern.title,
        recommendedFocus: 'early_recovery',
        pattern,
        summary
      });
    }
    case 'workload_recovery_mismatch': {
      const selected = copy({
        title: 'Protect a recovery break',
        message:
          'Workload is outpacing recovery. Protect one break before the next hard task.',
        actionLabel: 'Protect a break'
      });
      return buildRecommendation({
        nudgeType: 'recovery_break',
        priority: 'high',
        ...selected,
        triggerReason: pattern.title,
        recommendedFocus: 'recovery',
        pattern,
        summary
      });
    }
    case 'volatile_recent_pattern': {
      const selected = copy({
        title: 'Keep the next step steady',
        message:
          'Recent check-ins have shifted. Keep the next task simple, then pause.',
        actionLabel: 'Simplify one task'
      });
      return buildRecommendation({
        nudgeType: 'stabilize_routine',
        priority,
        ...selected,
        triggerReason: pattern.title,
        recommendedFocus: 'stabilize_routine',
        pattern,
        summary
      });
    }
    case 'dominant_exhaustion': {
      const selected = copy({
        title: 'Give energy room to recover',
        message:
          'Emotional energy is the clearest signal. Choose an earlier wind-down tonight.',
        actionLabel: 'Wind down earlier'
      });
      return buildRecommendation({
        nudgeType: 'sleep_wind_down',
        priority,
        ...selected,
        triggerReason: pattern.title,
        recommendedFocus: 'recovery',
        pattern,
        summary
      });
    }
    case 'dominant_recovery': {
      const selected = copy({
        title: 'Make space for recovery',
        message:
          'Recovery is the clearest signal. Take one off-screen break before your next task.',
        actionLabel: 'Take a break'
      });
      return buildRecommendation({
        nudgeType: 'recovery_break',
        priority,
        ...selected,
        triggerReason: pattern.title,
        recommendedFocus: 'recovery',
        pattern,
        summary
      });
    }
    case 'dominant_workload': {
      const selected = copy({
        title: 'Make workload lighter',
        message:
          'Workload is the clearest signal. Make one task smaller today.',
        actionLabel: 'Reduce one task'
      });
      return buildRecommendation({
        nudgeType: 'workload_boundary',
        priority,
        ...selected,
        triggerReason: pattern.title,
        recommendedFocus: 'workload',
        pattern,
        summary
      });
    }
    case 'dominant_connection': {
      const selected = copy({
        title: 'Reconnect in one small way',
        message:
          'Connection is the clearest signal. Check in briefly with someone you trust.',
        actionLabel: 'Check in'
      });
      return buildRecommendation({
        nudgeType: 'connection_reset',
        priority,
        ...selected,
        triggerReason: pattern.title,
        recommendedFocus: 'connection',
        pattern,
        summary
      });
    }
    case 'dominant_progress': {
      const selected = copy({
        title: 'Make one win visible',
        message:
          'Progress feels harder in recent check-ins. Finish one small task and mark it done.',
        actionLabel: 'Finish one task'
      });
      return buildRecommendation({
        nudgeType: 'small_win',
        priority,
        ...selected,
        triggerReason: pattern.title,
        recommendedFocus: 'progress',
        pattern,
        summary
      });
    }
    case 'low_confidence_score': {
      const selected = copy({
        title: 'Build a clearer pattern',
        message:
          'Recent coverage is limited. Complete the check-in currently due when you can.',
        actionLabel: 'Complete check-in'
      });
      return buildRecommendation({
        nudgeType: 'complete_check_in',
        priority: 'low',
        ...selected,
        triggerReason: pattern.title,
        recommendedFocus: 'data_completion',
        pattern,
        summary
      });
    }
    case 'insufficient_recent_data': {
      const selected = copy({
        title: 'Build your recent pattern',
        message:
          'A few recent check-ins will make guidance clearer. Log one quick check-in today.',
        actionLabel: 'Log today'
      });
      return buildRecommendation({
        nudgeType: 'complete_check_in',
        priority: 'low',
        ...selected,
        triggerReason: pattern.title,
        recommendedFocus: 'data_completion',
        pattern,
        summary
      });
    }
    case 'improving_recent_recovery': {
      const selected = copy({
        title: 'Keep what is helping',
        message:
          'Your recent pattern is improving. Keep one recovery habit simple today.',
        actionLabel: 'Keep it simple'
      });
      return buildRecommendation({
        nudgeType: 'maintain_recovery',
        priority: 'low',
        ...selected,
        triggerReason: pattern.title,
        recommendedFocus: 'maintain_recovery',
        pattern,
        summary
      });
    }
    default: {
      const selected = copy({
        title: 'Keep what is working',
        message:
          'Your recent pattern is steady. Keep one recovery habit simple today.',
        actionLabel: 'Keep it simple'
      });
      return buildRecommendation({
        nudgeType: 'steady_routine',
        priority: 'low',
        ...selected,
        triggerReason: pattern.title,
        recommendedFocus: pattern.recommended_focus ?? 'maintenance',
        pattern,
        summary
      });
    }
  }
}

export function stateRecommendation(summary) {
  const state = summary.adaptive_state?.state;
  const latest = summary.latest_score;
  if (normalizeConfidence(summary) < 55) {
    return null;
  }

  if (state === 'critical' || latest?.risk_level === 'critical') {
    const copy = fallbackCopyForSeverity('critical');
    return buildRecommendation({
      nudgeType: 'support_check',
      priority: 'urgent',
      ...copy,
      triggerReason: summary.adaptive_state?.reason ?? 'Critical pattern',
      recommendedFocus: 'support',
      pattern: summary.patterns?.[0],
      summary,
      internalSeverity: 'critical',
      metadata: { state_driven: true }
    });
  }

  if (state === 'high_risk') {
    const copy = fallbackCopyForSeverity('high');
    return buildRecommendation({
      nudgeType: 'load_reduction_check',
      priority: 'high',
      ...copy,
      triggerReason: summary.adaptive_state?.reason ?? 'High risk pattern',
      recommendedFocus: 'load_reduction',
      pattern: summary.patterns?.[0],
      summary,
      internalSeverity: 'high',
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
  const personalizedMessage = prependDisplayName(
    recommendation.message,
    userDisplayName
  );
  const validation = validateNudgeCopy({
    title: recommendation.title,
    message: personalizedMessage,
    actionLabel: recommendation.action_label,
    displayName: userDisplayName
  });
  const fallbackCopy = fallbackCopyForSeverity(recommendation.severity);
  const shouldFallback = !validation.valid;
  const selectedCopy = shouldFallback
    ? {
      ...fallbackCopy,
      message: prependDisplayName(fallbackCopy.message, userDisplayName)
    }
    : {
      title: validation.copy.title,
      message: validation.copy.message,
      actionLabel: validation.copy.actionLabel
    };
  const fallbackValidation = shouldFallback
    ? validateNudgeCopy({
      title: selectedCopy.title,
      message: selectedCopy.message,
      actionLabel: selectedCopy.actionLabel,
      displayName: userDisplayName
    })
    : validation;

  return {
    ...recommendation,
    title: selectedCopy.title,
    message: selectedCopy.message,
    action_label: selectedCopy.actionLabel,
    metadata: {
      ...recommendation.metadata,
      title: selectedCopy.title,
      user_display_name: userDisplayName,
      personalization_profile: personalization?.profile ?? {},
      profile_variables_used: personalizationVariables(personalization),
      copy_validation_status: fallbackValidation.valid
        ? (shouldFallback ? 'fallback' : 'valid')
        : 'invalid',
      copy_validation_errors: validation.errors
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

export async function loadRecentNudgeEvents(client, userId) {
  const result = await client.query(
    `SELECT nudge_event_id, nudge_type, status, metadata, created_at
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

function feedbackMatch(event, recommendation) {
  const metadata = eventMetadata(event);
  return {
    type: event.nudge_type === recommendation.nudge_type,
    focus: Boolean(
      recommendation.recommended_focus &&
      metadata.recommended_focus === recommendation.recommended_focus
    )
  };
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
      const recentlyDismissedEvents = recentEvents.filter((event) =>
        eventMatchesRecommendation(event, recommendation) &&
        event.status === 'dismissed' &&
        hoursSince(event.created_at, now) < preferences.cooldownHours
      );
      const recentlyAcceptedEvents = recentEvents.filter((event) =>
        eventMatchesRecommendation(event, recommendation) &&
        ['accepted', 'completed'].includes(event.status) &&
        hoursSince(event.created_at, now) <= 7 * 24
      );
      const dismissedType = recentlyDismissedEvents.some((event) =>
        feedbackMatch(event, recommendation).type
      );
      const dismissedFocus = recentlyDismissedEvents.some((event) =>
        feedbackMatch(event, recommendation).focus
      );
      const acceptedType = recentlyAcceptedEvents.some((event) =>
        feedbackMatch(event, recommendation).type
      );
      const acceptedFocus = recentlyAcceptedEvents.some((event) =>
        feedbackMatch(event, recommendation).focus
      );
      const dismissedRecently = dismissedType || dismissedFocus;
      const acceptedRecently = acceptedType || acceptedFocus;
      const feedbackRank =
        (acceptedType ? 2 : 0) +
        (acceptedFocus ? 1 : 0) -
        (dismissedType ? 2 : 0) -
        (dismissedFocus ? 1 : 0);
      const inCooldown =
        sameTypeEvent &&
        hoursSince(sameTypeEvent.created_at, now) < preferences.cooldownHours;
      const throttled =
        !isStrongRecommendation(recommendation) &&
        (dailyLimitReached || inCooldown);

      const adjusted = {
        ...recommendation,
        priority: dismissedRecently || throttled
          ? (isStrongRecommendation(recommendation)
            ? recommendation.priority
            : 'low')
          : recommendation.priority,
        metadata: {
          ...recommendation.metadata,
          preferred_nudge_style: preferences.preferredNudgeStyle,
          nudge_cooldown_hours: preferences.cooldownHours,
          max_daily_nudges: preferences.maxDailyNudges,
          recent_daily_nudge_count: shownTodayCount,
          recently_dismissed: dismissedRecently,
          recently_dismissed_type: dismissedType,
          recently_dismissed_focus: dismissedFocus,
          recently_accepted: acceptedRecently,
          recently_accepted_type: acceptedType,
          recently_accepted_focus: acceptedFocus,
          feedback_rank: feedbackRank,
          suppressed_by_feedback:
            dismissedRecently && !isStrongRecommendation(recommendation),
          throttled,
          throttle_reason: throttled
            ? (dailyLimitReached ? 'daily_limit' : 'cooldown')
            : null,
          context_snapshot: {
            ...(recommendation.metadata?.context_snapshot ?? {}),
            preferred_nudge_style: preferences.preferredNudgeStyle
          }
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

      const feedbackDiff =
        Number(b.metadata?.feedback_rank ?? 0) -
        Number(a.metadata?.feedback_rank ?? 0);
      if (feedbackDiff !== 0) {
        return feedbackDiff;
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
  { limit = 3, recordShown = true, endDate, useAi = false, locale = 'en' } = {}
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
      locale,
      enhanceThrottled: !recordShown
    })
    : personalizedRanked;
  const localizedRecommendations = recommendations.map((recommendation) =>
    localizeNudgeRecommendation(recommendation, locale)
  );
  const localizedSummary = localizeAdaptiveSummary(summary, locale);

  if (!recordShown || localizedRecommendations.length === 0) {
    return {
      summary: localizedSummary,
      recommendations: localizedRecommendations
    };
  }

  const primary = await attachShownEvent(
    client,
    userId,
    localizedRecommendations[0],
    preferences
  );

  return {
    summary: localizedSummary,
    recommendations: [primary, ...localizedRecommendations.slice(1)]
  };
}
