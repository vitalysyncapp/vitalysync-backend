import { formatDateOnly } from './burnoutScoringEngine.js';

function formatEpoch(row) {
  if (!row) return null;
  return {
    baselineEpochId: Number(row.baseline_epoch_id),
    userId: Number(row.user_id),
    startedAt: formatDateOnly(row.started_at),
    endedAt: row.ended_at ? formatDateOnly(row.ended_at) : null,
    resetReason: row.reset_reason ?? null
  };
}

export async function ensureBaselineEpochForDate(
  client,
  userId,
  scoreDate
) {
  const existing = await client.query(
    `SELECT
       baseline_epoch_id,
       user_id,
       started_at,
       ended_at,
       reset_reason
     FROM user_baseline_epochs
     WHERE user_id = $1
       AND started_at::DATE <= $2
       AND (ended_at IS NULL OR ended_at::DATE >= $2)
     ORDER BY started_at DESC, baseline_epoch_id DESC
     LIMIT 1`,
    [userId, formatDateOnly(scoreDate)]
  );

  if (existing.rowCount > 0) {
    return formatEpoch(existing.rows[0]);
  }

  const created = await client.query(
    `INSERT INTO user_baseline_epochs (
       user_id,
       started_at,
       reset_reason
     )
     SELECT
       profile.user_id,
       LEAST(COALESCE(profile.created_at, NOW()), $2::DATE::TIMESTAMPTZ),
       'initial_onboarding'
     FROM user_onboarding_profiles profile
     WHERE profile.user_id = $1
     ON CONFLICT DO NOTHING
     RETURNING
       baseline_epoch_id,
       user_id,
       started_at,
       ended_at,
       reset_reason`,
    [userId, formatDateOnly(scoreDate)]
  );

  if (created.rowCount > 0) {
    return formatEpoch(created.rows[0]);
  }

  const fallback = await client.query(
    `SELECT
       baseline_epoch_id,
       user_id,
       started_at,
       ended_at,
       reset_reason
     FROM user_baseline_epochs
     WHERE user_id = $1
     ORDER BY started_at DESC, baseline_epoch_id DESC
     LIMIT 1`,
    [userId]
  );

  return formatEpoch(fallback.rows[0]);
}

export async function startBaselineEpoch(
  client,
  userId,
  { startedAt, resetReason }
) {
  const normalizedStart = formatDateOnly(startedAt);
  const activeResult = await client.query(
    `SELECT
       baseline_epoch_id,
       user_id,
       started_at,
       ended_at,
       reset_reason
     FROM user_baseline_epochs
     WHERE user_id = $1 AND ended_at IS NULL
     ORDER BY started_at DESC, baseline_epoch_id DESC
     LIMIT 1
     FOR UPDATE`,
    [userId]
  );
  const activeEpoch = activeResult.rows[0];
  if (activeEpoch && formatDateOnly(activeEpoch.started_at) === normalizedStart) {
    const effectiveResetReason =
      activeEpoch.reset_reason === 'thirty_day_return' ||
      resetReason === 'thirty_day_return'
        ? 'thirty_day_return'
        : resetReason;
    const updated = await client.query(
      `UPDATE user_baseline_epochs
       SET reset_reason = $2,
           updated_at = NOW()
       WHERE baseline_epoch_id = $1
       RETURNING
         baseline_epoch_id,
         user_id,
         started_at,
         ended_at,
         reset_reason`,
      [activeEpoch.baseline_epoch_id, effectiveResetReason]
    );
    return formatEpoch(updated.rows[0]);
  }

  await client.query(
    `UPDATE user_baseline_epochs
     SET ended_at = $2::DATE::TIMESTAMPTZ - INTERVAL '1 millisecond',
         updated_at = NOW()
     WHERE user_id = $1 AND ended_at IS NULL`,
    [userId, normalizedStart]
  );

  const result = await client.query(
    `INSERT INTO user_baseline_epochs (
       user_id,
       started_at,
       reset_reason
     )
     VALUES ($1, $2::DATE::TIMESTAMPTZ, $3)
     RETURNING
       baseline_epoch_id,
       user_id,
       started_at,
       ended_at,
       reset_reason`,
    [userId, normalizedStart, resetReason]
  );

  return formatEpoch(result.rows[0]);
}
