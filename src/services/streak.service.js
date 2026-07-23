import pool from '../config/db.js';

const BASE_MONTHLY_SAVERS = 3;
const MS_PER_DAY = 24 * 60 * 60 * 1000;
const LEADERBOARD_SECTIONS = new Set(['global', 'area', 'role', 'wellness']);
const LEADERBOARD_METRICS = new Set(['current', 'month', 'longest']);
const RESTORE_DECISIONS = new Set(['use', 'skip', 'defer']);

export class StreakServiceError extends Error {
  constructor(message, statusCode = 400, details = {}) {
    super(message);
    this.name = 'StreakServiceError';
    this.statusCode = statusCode;
    this.details = details;
  }
}

export function normalizeRestoreDecision(value) {
  const normalized = String(value ?? 'defer').trim().toLowerCase();
  return RESTORE_DECISIONS.has(normalized) ? normalized : 'defer';
}

function isValidDateString(value) {
  return /^\d{4}-\d{2}-\d{2}$/.test(String(value ?? '').trim());
}

function dateOnly(value) {
  if (!value) {
    return null;
  }

  if (value instanceof Date) {
    return new Date(Date.UTC(
      value.getUTCFullYear(),
      value.getUTCMonth(),
      value.getUTCDate()
    ));
  }

  const raw = String(value).slice(0, 10);
  if (!isValidDateString(raw)) {
    return null;
  }

  const [year, month, day] = raw.split('-').map(Number);
  return new Date(Date.UTC(year, month - 1, day));
}

function formatDate(value) {
  return value.toISOString().slice(0, 10);
}

function addDays(value, days) {
  const next = new Date(value.getTime());
  next.setUTCDate(next.getUTCDate() + days);
  return next;
}

function dayDifference(fromDate, toDate) {
  return Math.round((toDate.getTime() - fromDate.getTime()) / MS_PER_DAY);
}

function monthStart(value) {
  const date = dateOnly(value) ?? dateOnly(new Date());
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1));
}

function nextMonthStart(value) {
  const date = monthStart(value);
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 1));
}

function weekStart(value) {
  const date = dateOnly(value) ?? dateOnly(new Date());
  const day = date.getUTCDay();
  const mondayOffset = day === 0 ? -6 : 1 - day;
  return addDays(date, mondayOffset);
}

function periodKey(value) {
  return formatDate(monthStart(value)).slice(0, 7);
}

function safeJson(value) {
  if (value == null || typeof value !== 'object' || Array.isArray(value)) {
    return {};
  }
  return value;
}

function parsePositiveInt(value, fallback) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function initialsForName(name) {
  const parts = String(name ?? '')
    .trim()
    .split(/\s+/)
    .filter(Boolean);

  if (parts.length === 0) {
    return 'VS';
  }

  if (parts.length === 1) {
    return parts[0].slice(0, 2).toUpperCase();
  }

  return `${parts[0][0]}${parts[1][0]}`.toUpperCase();
}

function avatarColorForUser(userId) {
  const colors = [
    '#1D8CA8',
    '#2563EB',
    '#14B8A6',
    '#16A34A',
    '#7C3AED',
    '#EA580C',
    '#DB2777',
  ];
  return colors[Math.abs(Number(userId) || 0) % colors.length];
}

function effectiveCurrentStreak(row, now = new Date()) {
  const current = Number(row?.current_streak ?? 0);
  const lastLoggedDate = dateOnly(row?.last_logged_date);
  const today = dateOnly(now);

  if (!lastLoggedDate || !today || current <= 0) {
    return 0;
  }

  return dayDifference(lastLoggedDate, today) > 1 ? 0 : current;
}

function formatSaverPeriod(row) {
  const base = Number(row?.base_savers ?? BASE_MONTHLY_SAVERS);
  const earned = Number(row?.earned_savers ?? 0);
  const used = Number(row?.used_savers ?? 0);
  return {
    period_month: row?.period_month ?? null,
    base_savers: base,
    earned_savers: earned,
    used_savers: used,
    available_savers: Math.max(0, base + earned - used),
  };
}

export function formatStreakPayload(streakRow, { now = new Date() } = {}) {
  return {
    current_streak: effectiveCurrentStreak(streakRow, now),
    longest_streak: Number(streakRow?.longest_streak ?? 0),
    last_logged_date: streakRow?.last_logged_date ?? null,
  };
}

export async function ensureUserStreak(client, userId, { forUpdate = false } = {}) {
  await client.query(
    `INSERT INTO user_streaks (user_id)
     VALUES ($1)
     ON CONFLICT (user_id) DO NOTHING`,
    [userId]
  );

  const result = await client.query(
    `SELECT user_id, current_streak, longest_streak, last_logged_date
     FROM user_streaks
     WHERE user_id = $1
     ${forUpdate ? 'FOR UPDATE' : ''}`,
    [userId]
  );

  return result.rows[0] ?? null;
}

export async function ensureSaverPeriod(client, userId, value = new Date()) {
  const periodMonth = formatDate(monthStart(value));
  await client.query(
    `INSERT INTO streak_saver_periods (user_id, period_month, base_savers)
     VALUES ($1, $2, $3)
     ON CONFLICT (user_id, period_month) DO NOTHING`,
    [userId, periodMonth, BASE_MONTHLY_SAVERS]
  );

  const result = await client.query(
    `SELECT user_id, period_month, base_savers, earned_savers, used_savers
     FROM streak_saver_periods
     WHERE user_id = $1 AND period_month = $2
     FOR UPDATE`,
    [userId, periodMonth]
  );

  return result.rows[0];
}

async function readSaverPeriod(client, userId, value = new Date()) {
  const periodMonth = formatDate(monthStart(value));
  const result = await client.query(
    `SELECT user_id, period_month, base_savers, earned_savers, used_savers
     FROM streak_saver_periods
     WHERE user_id = $1 AND period_month = $2`,
    [userId, periodMonth]
  );

  return result.rows[0] ?? null;
}

async function spendSaver(client, {
  userId,
  spendDate,
  protectedDate,
  reason = 'manual_restore',
  metadata = {},
}) {
  const period = await ensureSaverPeriod(client, userId, spendDate);
  const available = formatSaverPeriod(period).available_savers;

  if (available < 1) {
    throw new StreakServiceError('Not enough streak savers available', 409, {
      streak_restore: {
        required: true,
        reason: 'insufficient_savers',
        available_savers: available,
      },
    });
  }

  const periodMonth = formatDate(monthStart(spendDate));
  const eventResult = await client.query(
    `INSERT INTO streak_saver_events (
       user_id,
       period_month,
       event_type,
       amount,
       reason,
       protected_date,
       metadata
     )
     VALUES ($1, $2, 'spend', 1, $3, $4, $5::jsonb)
     RETURNING event_id`,
    [
      userId,
      periodMonth,
      reason,
      protectedDate,
      JSON.stringify(safeJson(metadata)),
    ]
  );

  await client.query(
    `UPDATE streak_saver_periods
     SET used_savers = used_savers + 1,
         updated_at = NOW()
     WHERE user_id = $1 AND period_month = $2`,
    [userId, periodMonth]
  );

  await client.query(
    `INSERT INTO streak_protected_days (
       user_id,
       protected_date,
       period_month,
       saver_event_id
     )
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (user_id, protected_date) DO NOTHING`,
    [userId, protectedDate, periodMonth, eventResult.rows[0].event_id]
  );
}

async function grantSaverReward(client, {
  userId,
  rewardKey,
  periodKeyValue,
  periodMonthValue,
  reason,
  metadata = {},
  amount = 1,
}) {
  const claimResult = await client.query(
    `INSERT INTO streak_reward_claims (
       user_id,
       reward_key,
       period_key,
       period_month,
       awarded_savers,
       metadata
     )
     VALUES ($1, $2, $3, $4, $5, $6::jsonb)
     ON CONFLICT (user_id, reward_key, period_key) DO NOTHING
     RETURNING claim_id`,
    [
      userId,
      rewardKey,
      periodKeyValue,
      periodMonthValue,
      amount,
      JSON.stringify(safeJson(metadata)),
    ]
  );

  if (claimResult.rowCount === 0) {
    return null;
  }

  await ensureSaverPeriod(client, userId, periodMonthValue);
  await client.query(
    `UPDATE streak_saver_periods
     SET earned_savers = earned_savers + $3,
         updated_at = NOW()
     WHERE user_id = $1 AND period_month = $2`,
    [userId, periodMonthValue, amount]
  );

  await client.query(
    `INSERT INTO streak_saver_events (
       user_id,
       period_month,
       event_type,
       amount,
       reason,
       metadata
     )
     VALUES ($1, $2, 'grant', $3, $4, $5::jsonb)`,
    [
      userId,
      periodMonthValue,
      amount,
      reason,
      JSON.stringify(safeJson(metadata)),
    ]
  );

  return {
    reward_key: rewardKey,
    savers_awarded: amount,
    period_key: periodKeyValue,
  };
}

function missingDatesBetween(previousDate, currentDate) {
  const difference = dayDifference(previousDate, currentDate);
  const dates = [];

  for (let offset = 1; offset < difference; offset++) {
    dates.push(formatDate(addDays(previousDate, offset)));
  }

  return dates;
}

async function restoreMissingDates(client, {
  userId,
  currentLogDate,
  missingDates,
}) {
  for (const protectedDate of missingDates) {
    await spendSaver(client, {
      userId,
      spendDate: currentLogDate,
      protectedDate,
      reason: 'manual_restore',
      metadata: {
        restored_by_log_date: currentLogDate,
      },
    });
  }
}

export async function prepareStreakForNewLog(client, {
  userId,
  logDate,
  streakRow,
  restoreDecision,
}) {
  const previousLogDate = dateOnly(streakRow?.last_logged_date);
  const currentLogDate = dateOnly(logDate);
  const currentLogDateText = formatDate(currentLogDate);
  let updatedStreak = Number(streakRow?.current_streak ?? 0);
  let longestStreak = Number(streakRow?.longest_streak ?? 0);
  let restore = {
    required: false,
    decision: normalizeRestoreDecision(restoreDecision),
    missing_dates: [],
    savers_used: 0,
  };

  if (!previousLogDate) {
    updatedStreak = 1;
  } else {
    const difference = dayDifference(previousLogDate, currentLogDate);

    if (difference === 1) {
      updatedStreak += 1;
    } else if (difference > 1) {
      const missingDates = missingDatesBetween(previousLogDate, currentLogDate);
      const saverPeriod = await ensureSaverPeriod(client, userId, currentLogDate);
      const available = formatSaverPeriod(saverPeriod).available_savers;
      const decision = normalizeRestoreDecision(restoreDecision);

      restore = {
        required: true,
        decision,
        missing_dates: missingDates,
        missing_days: missingDates.length,
        available_savers: available,
        savers_required: missingDates.length,
        savers_used: 0,
      };

      if (decision === 'use') {
        if (available < missingDates.length) {
          throw new StreakServiceError('Not enough streak savers available', 409, {
            streak_restore: {
              ...restore,
              reason: 'insufficient_savers',
            },
          });
        }

        await restoreMissingDates(client, {
          userId,
          currentLogDate: currentLogDateText,
          missingDates,
        });
        updatedStreak += difference;
        restore.savers_used = missingDates.length;
      } else if (decision === 'skip') {
        updatedStreak = 1;
      } else {
        throw new StreakServiceError('Streak restore decision required', 409, {
          streak_restore: {
            ...restore,
            reason: 'missed_days',
          },
        });
      }
    }
  }

  longestStreak = Math.max(longestStreak, updatedStreak);

  return {
    updatedStreak,
    longestStreak,
    lastLoggedDate: currentLogDateText,
    restore,
  };
}

export async function awardStreakRewardsForLog(client, {
  userId,
  logDate,
  currentStreak,
}) {
  const rewards = [];
  const currentDate = dateOnly(logDate);
  const periodMonthText = formatDate(monthStart(currentDate));
  const nextMonthText = formatDate(nextMonthStart(currentDate));

  if (currentStreak >= 7) {
    const reward = await grantSaverReward(client, {
      userId,
      rewardKey: 'first_7_day_streak',
      periodKeyValue: 'lifetime',
      periodMonthValue: periodMonthText,
      reason: 'first_7_day_streak',
      metadata: { current_streak: currentStreak },
    });
    if (reward) rewards.push(reward);
  }

  const monthlyLogs = await client.query(
    `SELECT COUNT(*)::INTEGER AS log_count
     FROM daily_logs
     WHERE user_id = $1
       AND log_date >= $2
       AND log_date < $3`,
    [userId, periodMonthText, nextMonthText]
  );
  const monthlyLogCount = Number(monthlyLogs.rows[0]?.log_count ?? 0);

  if (monthlyLogCount >= 10) {
    const reward = await grantSaverReward(client, {
      userId,
      rewardKey: 'monthly_10_checkins',
      periodKeyValue: periodKey(currentDate),
      periodMonthValue: periodMonthText,
      reason: 'monthly_10_checkins',
      metadata: { log_count: monthlyLogCount },
    });
    if (reward) rewards.push(reward);
  }

  const weekStartText = formatDate(weekStart(currentDate));
  const weekEndText = formatDate(addDays(weekStart(currentDate), 7));
  const weeklyGoalResult = await client.query(
    `WITH goal_values AS (
       SELECT
         COALESCE(MAX(target_value) FILTER (WHERE goal_type = 'sleep_hours'), 8) AS sleep_hours,
         COALESCE(MAX(target_value) FILTER (WHERE goal_type = 'hydration_liters'), 2.5) AS hydration_liters
       FROM user_goals
       WHERE user_id = $1
     )
     SELECT COUNT(*)::INTEGER AS goal_days
     FROM daily_logs logs
     CROSS JOIN goal_values goals
     WHERE logs.user_id = $1
       AND logs.log_date >= $2
       AND logs.log_date < $3
       AND (
         logs.sleep_hours >= goals.sleep_hours
         OR (
           logs.hydration_liters >= goals.hydration_liters
           AND logs.hydration_liters <= 5
         )
         OR logs.exercise_goal_completed = TRUE
         OR EXISTS (
           SELECT 1
           FROM daily_activity_logs activity
           WHERE activity.user_id = logs.user_id
             AND activity.log_date = logs.log_date
             AND activity.goal_completed = TRUE
         )
       )`,
    [userId, weekStartText, weekEndText]
  );
  const weeklyGoalDays = Number(weeklyGoalResult.rows[0]?.goal_days ?? 0);

  if (weeklyGoalDays >= 4) {
    const reward = await grantSaverReward(client, {
      userId,
      rewardKey: 'weekly_goal_guardian',
      periodKeyValue: weekStartText,
      periodMonthValue: periodMonthText,
      reason: 'weekly_goal_guardian',
      metadata: { goal_days: weeklyGoalDays },
    });
    if (reward) rewards.push(reward);
  }

  return rewards;
}

export async function readStreakOverview(userIdValue, { client = pool } = {}) {
  const userId = Number(userIdValue);
  if (!Number.isInteger(userId) || userId <= 0) {
    throw new StreakServiceError('Valid user_id is required');
  }

  const userResult = await client.query(
    'SELECT user_id, username FROM users WHERE user_id = $1',
    [userId]
  );

  if (userResult.rowCount === 0) {
    return null;
  }

  const streak = await ensureUserStreak(client, userId);
  await ensureSaverPeriod(client, userId);
  const saverPeriod = await readSaverPeriod(client, userId);

  const protectedResult = await client.query(
    `SELECT COUNT(*)::INTEGER AS protected_day_count
     FROM streak_protected_days
     WHERE user_id = $1`,
    [userId]
  );

  const recentEventsResult = await client.query(
    `SELECT event_type, amount, reason, protected_date, created_at
     FROM streak_saver_events
     WHERE user_id = $1
     ORDER BY created_at DESC
     LIMIT 8`,
    [userId]
  );

  return {
    user_id: userId,
    display_name: userResult.rows[0].username,
    streak: formatStreakPayload(streak),
    savers: formatSaverPeriod(saverPeriod),
    protected_day_count: Number(
      protectedResult.rows[0]?.protected_day_count ?? 0
    ),
    recent_events: recentEventsResult.rows,
  };
}

async function readViewerContext(client, userId) {
  const result = await client.query(
    `WITH latest_area AS (
       SELECT location_name
       FROM user_environment_snapshots
       WHERE user_id = $1
         AND NULLIF(TRIM(location_name), '') IS NOT NULL
       ORDER BY fetched_at DESC
       LIMIT 1
     )
     SELECT
       users.user_id,
       COALESCE(profile.role, users.role) AS role,
       COALESCE(profile.wellness_goal, users.wellness_goal) AS wellness_goal,
       (SELECT location_name FROM latest_area) AS area_name
     FROM users
     LEFT JOIN user_onboarding_profiles profile
       ON profile.user_id = users.user_id
     WHERE users.user_id = $1`,
    [userId]
  );

  return result.rows[0] ?? null;
}

function buildSectionFilter(section, viewerContext, params) {
  if (section === 'area') {
    const areaName = String(viewerContext?.area_name ?? '').trim();
    if (!areaName) {
      return {
        available: false,
        label: 'Local Area',
        filterSql: 'FALSE',
      };
    }
    params.push(areaName);
    return {
      available: true,
      label: areaName,
      filterSql: `latest_area.location_name = $${params.length}`,
    };
  }

  if (section === 'role') {
    const role = String(viewerContext?.role ?? '').trim();
    if (!role) {
      return {
        available: false,
        label: 'Role Cohort',
        filterSql: 'FALSE',
      };
    }
    params.push(role);
    return {
      available: true,
      label: role,
      filterSql: `COALESCE(profile.role, users.role) = $${params.length}`,
    };
  }

  if (section === 'wellness') {
    const wellnessGoal = String(viewerContext?.wellness_goal ?? '').trim();
    if (!wellnessGoal) {
      return {
        available: false,
        label: 'Wellness Goal',
        filterSql: 'FALSE',
      };
    }
    params.push(wellnessGoal);
    return {
      available: true,
      label: wellnessGoal,
      filterSql: `COALESCE(profile.wellness_goal, users.wellness_goal) = $${params.length}`,
    };
  }

  return {
    available: true,
    label: 'Global',
    filterSql: 'TRUE',
  };
}

function appendQueryParam(params, value) {
  params.push(value);
  return params.length;
}

function scoreExpression(metric, params, dates) {
  if (metric === 'longest') {
    return 'COALESCE(streaks.longest_streak, 0)';
  }

  if (metric === 'month') {
    const monthStartParam = appendQueryParam(params, dates.currentMonthStart);
    const nextMonthParam = appendQueryParam(
      params,
      dates.currentNextMonthStart
    );

    return `(
      SELECT COUNT(*)::INTEGER
      FROM (
        SELECT log_date AS score_date
        FROM daily_logs
        WHERE user_id = users.user_id
          AND log_date >= $${monthStartParam}
          AND log_date < $${nextMonthParam}
        UNION
        SELECT protected_date AS score_date
        FROM streak_protected_days
        WHERE user_id = users.user_id
          AND protected_date >= $${monthStartParam}
          AND protected_date < $${nextMonthParam}
      ) month_scores
    )`;
  }

  const todayParam = appendQueryParam(params, dates.today);

  return `CASE
    WHEN streaks.last_logged_date IS NULL THEN 0
    WHEN ($${todayParam}::DATE - streaks.last_logged_date::DATE) > 1 THEN 0
    ELSE COALESCE(streaks.current_streak, 0)
  END`;
}

export async function readLeaderboard(userIdValue, options = {}) {
  const userId = Number(userIdValue);
  if (!Number.isInteger(userId) || userId <= 0) {
    throw new StreakServiceError('Valid user_id is required');
  }

  const section = LEADERBOARD_SECTIONS.has(options.section)
    ? options.section
    : 'global';
  const metric = LEADERBOARD_METRICS.has(options.metric)
    ? options.metric
    : 'current';
  const limit = Math.min(parsePositiveInt(options.limit, 50), 100);
  const today = formatDate(dateOnly(options.today ?? new Date()));
  const currentMonthStart = formatDate(monthStart(today));
  const currentNextMonthStart = formatDate(nextMonthStart(today));

  const client = options.client ?? pool;
  const viewerContext = await readViewerContext(client, userId);
  if (!viewerContext) {
    return null;
  }

  const params = [userId];
  const scoreSql = scoreExpression(metric, params, {
    today,
    currentMonthStart,
    currentNextMonthStart,
  });
  const sectionFilter = buildSectionFilter(section, viewerContext, params);
  params.push(limit);

  const result = await client.query(
    `WITH latest_area AS (
       SELECT DISTINCT ON (user_id)
         user_id,
         location_name
       FROM user_environment_snapshots
       WHERE NULLIF(TRIM(location_name), '') IS NOT NULL
       ORDER BY user_id, fetched_at DESC
     ),
     scored AS (
       SELECT
         users.user_id,
         users.username,
         users.gender,
         COALESCE(profile.role, users.role) AS user_type,
         ${scoreSql} AS score,
         COALESCE(protected_counts.protected_day_count, 0) AS protected_day_count,
         streaks.longest_streak,
         streaks.current_streak,
         streaks.last_logged_date
       FROM users
       JOIN user_streaks streaks
         ON streaks.user_id = users.user_id
       LEFT JOIN user_onboarding_profiles profile
         ON profile.user_id = users.user_id
       LEFT JOIN latest_area
         ON latest_area.user_id = users.user_id
       LEFT JOIN (
         SELECT user_id, COUNT(*)::INTEGER AS protected_day_count
         FROM streak_protected_days
         GROUP BY user_id
       ) protected_counts
         ON protected_counts.user_id = users.user_id
       WHERE $1::INTEGER > 0
         AND ${sectionFilter.filterSql}
     )
     SELECT *
     FROM scored
     WHERE score > 0
     ORDER BY score DESC, protected_day_count ASC, longest_streak DESC, user_id ASC
     LIMIT $${params.length}`,
    params
  );

  const rows = result.rows.map((row, index) => ({
    rank: index + 1,
    user_id: row.user_id,
    display_name: row.username,
    initials: initialsForName(row.username),
    avatar_color: avatarColorForUser(row.user_id),
    gender: row.gender ?? null,
    user_type: row.user_type ?? null,
    score: Number(row.score ?? 0),
    protected_day_count: Number(row.protected_day_count ?? 0),
    is_current_user: Number(row.user_id) === userId,
  }));

  return {
    section,
    metric,
    limit,
    available: sectionFilter.available,
    section_label: sectionFilter.label,
    rows,
    current_user_rank: rows.find((row) => row.is_current_user)?.rank ?? null,
  };
}
