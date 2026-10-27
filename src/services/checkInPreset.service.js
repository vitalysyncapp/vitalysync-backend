import pool from '../config/db.js';
import {
  normalizeDailyCheckIn,
} from './checkInValidation.service.js';
import {
  WEEKLY_QUESTIONNAIRE_VERSION,
  normalizeBurnoutAnswers,
} from './burnoutQuestionnaire.js';

export const CHECK_IN_PRESET_AVATAR_IDS = Object.freeze([
  'tired',
  'sad',
  'neutral',
  'calm',
  'happy',
  'celebrating',
  'focused',
  'sleepy',
  'loved',
  'relieved',
  'anxious',
  'energized',
]);

const AVATAR_ID_SET = new Set(CHECK_IN_PRESET_AVATAR_IDS);

export class CheckInPresetError extends Error {
  constructor(message, statusCode = 400) {
    super(message);
    this.name = 'CheckInPresetError';
    this.statusCode = statusCode;
  }
}

function normalizeUserId(value) {
  const userId = Number(value);
  if (!Number.isInteger(userId) || userId <= 0) {
    throw new CheckInPresetError('Authenticated user is required', 401);
  }
  return userId;
}

function normalizePresetId(value) {
  const presetId = Number(value);
  if (!Number.isInteger(presetId) || presetId <= 0) {
    throw new CheckInPresetError('Valid preset_id is required');
  }
  return presetId;
}

export function normalizeCheckInPresetPayload(payload, { existingMode } = {}) {
  const name = String(payload?.name ?? '').trim();
  if (name.length < 1 || name.length > 40) {
    throw new CheckInPresetError('Preset name must be between 1 and 40 characters');
  }

  const mode = String(payload?.check_in_type ?? '').trim().toLowerCase();
  if (!['daily', 'weekly'].includes(mode)) {
    throw new CheckInPresetError('Valid check_in_type is required');
  }
  if (existingMode != null && mode !== existingMode) {
    throw new CheckInPresetError('A preset type cannot be changed', 409);
  }

  const avatarId = String(payload?.avatar_id ?? '').trim();
  if (!AVATAR_ID_SET.has(avatarId)) {
    throw new CheckInPresetError('Valid avatar_id is required');
  }

  const expectedDailyVersion = mode === 'weekly'
    ? 'daily_core9_v3'
    : 'daily_14_v2';
  if (payload?.daily?.questionnaire_version !== expectedDailyVersion) {
    throw new CheckInPresetError(
      mode === 'weekly'
        ? 'Weekly presets require the nine-input daily questionnaire'
        : 'Daily presets require the fourteen-input daily questionnaire'
    );
  }

  let daily;
  try {
    daily = normalizeDailyCheckIn({
      schema_version: 3,
      daily: payload.daily,
    });
  } catch (error) {
    throw new CheckInPresetError(error.message);
  }

  let weeklyAnswers = null;
  if (mode === 'weekly') {
    try {
      weeklyAnswers = normalizeBurnoutAnswers(
        payload?.weekly_answers,
        WEEKLY_QUESTIONNAIRE_VERSION
      );
    } catch (error) {
      throw new CheckInPresetError(error.message);
    }
  } else if (payload?.weekly_answers != null) {
    throw new CheckInPresetError('Daily presets cannot include weekly answers');
  }

  return {
    name,
    check_in_type: mode,
    avatar_id: avatarId,
    daily_answers: daily,
    weekly_answers: weeklyAnswers,
  };
}

function publicPreset(row) {
  return row ? {
    preset_id: Number(row.preset_id),
    name: row.name,
    check_in_type: row.check_in_type,
    avatar_id: row.avatar_id,
    daily: row.daily_answers,
    weekly_answers: row.weekly_answers,
    created_at: row.created_at,
    updated_at: row.updated_at,
  } : null;
}

export async function listCheckInPresets(userIdValue, database = pool) {
  const userId = normalizeUserId(userIdValue);
  const result = await database.query(
    `SELECT preset_id, name, check_in_type, avatar_id, daily_answers,
            weekly_answers, created_at, updated_at
     FROM check_in_presets
     WHERE user_id = $1
     ORDER BY preset_id ASC`,
    [userId]
  );
  return result.rows.map(publicPreset);
}

export async function createCheckInPreset(
  userIdValue,
  payload,
  database = pool
) {
  const userId = normalizeUserId(userIdValue);
  const preset = normalizeCheckInPresetPayload(payload);
  const result = await database.query(
    `INSERT INTO check_in_presets (
       user_id, name, check_in_type, avatar_id, daily_answers, weekly_answers
     )
     VALUES ($1, $2, $3, $4, $5::jsonb, $6::jsonb)
     RETURNING preset_id, name, check_in_type, avatar_id, daily_answers,
               weekly_answers, created_at, updated_at`,
    [
      userId,
      preset.name,
      preset.check_in_type,
      preset.avatar_id,
      JSON.stringify(preset.daily_answers),
      preset.weekly_answers == null
        ? null
        : JSON.stringify(preset.weekly_answers),
    ]
  );
  return publicPreset(result.rows[0]);
}

export async function updateCheckInPreset(
  userIdValue,
  presetIdValue,
  payload,
  database = pool
) {
  const userId = normalizeUserId(userIdValue);
  const presetId = normalizePresetId(presetIdValue);
  const existing = await database.query(
    `SELECT check_in_type
     FROM check_in_presets
     WHERE user_id = $1 AND preset_id = $2`,
    [userId, presetId]
  );
  if (existing.rowCount === 0) {
    throw new CheckInPresetError('Preset not found', 404);
  }

  const preset = normalizeCheckInPresetPayload(payload, {
    existingMode: existing.rows[0].check_in_type,
  });
  const result = await database.query(
    `UPDATE check_in_presets
     SET name = $3,
         avatar_id = $4,
         daily_answers = $5::jsonb,
         weekly_answers = $6::jsonb,
         updated_at = NOW()
     WHERE user_id = $1 AND preset_id = $2
     RETURNING preset_id, name, check_in_type, avatar_id, daily_answers,
               weekly_answers, created_at, updated_at`,
    [
      userId,
      presetId,
      preset.name,
      preset.avatar_id,
      JSON.stringify(preset.daily_answers),
      preset.weekly_answers == null
        ? null
        : JSON.stringify(preset.weekly_answers),
    ]
  );
  if (result.rowCount === 0) {
    throw new CheckInPresetError('Preset not found', 404);
  }
  return publicPreset(result.rows[0]);
}

export async function deleteCheckInPreset(
  userIdValue,
  presetIdValue,
  database = pool
) {
  const userId = normalizeUserId(userIdValue);
  const presetId = normalizePresetId(presetIdValue);
  const result = await database.query(
    `DELETE FROM check_in_presets
     WHERE user_id = $1 AND preset_id = $2
     RETURNING preset_id`,
    [userId, presetId]
  );
  if (result.rowCount === 0) {
    throw new CheckInPresetError('Preset not found', 404);
  }
  return Number(result.rows[0].preset_id);
}
