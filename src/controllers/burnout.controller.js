import pool from '../config/db.js';
import {
  getBurnoutScoreHistory,
  getLatestBurnoutScore,
  upsertBurnoutScoreForDate
} from '../services/burnoutScoringService.js';
import { getBurnoutPatternSummary } from '../services/burnoutPatternService.js';

function isValidDateString(value) {
  return /^\d{4}-\d{2}-\d{2}$/.test(String(value ?? '').trim());
}

function todayKey() {
  return new Date().toISOString().slice(0, 10);
}

function parsePositiveInt(value) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

function parseLimit(value) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    return 30;
  }

  return Math.min(parsed, 90);
}

function parseOptionalBoolean(value, fallback = true) {
  if (value == null) {
    return fallback;
  }

  if (typeof value === 'boolean') {
    return value;
  }

  const normalized = String(value).trim().toLowerCase();
  if (normalized === 'true') {
    return true;
  }
  if (normalized === 'false') {
    return false;
  }

  return fallback;
}

function addDays(dateString, days) {
  const [year, month, day] = dateString.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

async function ensureUserExists(client, userId) {
  const result = await client.query(
    'SELECT user_id FROM users WHERE user_id = $1',
    [userId]
  );

  return result.rowCount > 0;
}

export async function getLatestScore(req, res) {
  const userId = parsePositiveInt(req.query.user_id);

  if (!userId) {
    return res.status(400).json({ message: 'Valid user_id is required' });
  }

  try {
    const userExists = await ensureUserExists(pool, userId);
    if (!userExists) {
      return res.status(404).json({ message: 'User not found' });
    }

    const score = await getLatestBurnoutScore(pool, userId);

    return res.status(200).json({
      has_score: score != null,
      score
    });
  } catch (error) {
    console.error('Get latest burnout score error:', error);
    return res.status(500).json({ message: 'Failed to fetch burnout score' });
  }
}

export async function getScoreHistory(req, res) {
  const userId = parsePositiveInt(req.query.user_id);
  const endDate = String(req.query.end ?? todayKey()).trim();
  const startDate = req.query.start == null
    ? isValidDateString(endDate)
      ? addDays(endDate, -29)
      : ''
    : String(req.query.start).trim();
  const limit = parseLimit(req.query.limit);

  if (!userId) {
    return res.status(400).json({ message: 'Valid user_id is required' });
  }

  if (!isValidDateString(startDate) || !isValidDateString(endDate)) {
    return res.status(400).json({ message: 'Valid start and end dates are required' });
  }

  if (startDate > endDate) {
    return res.status(400).json({ message: 'start must be before or equal to end' });
  }

  try {
    const userExists = await ensureUserExists(pool, userId);
    if (!userExists) {
      return res.status(404).json({ message: 'User not found' });
    }

    const scores = await getBurnoutScoreHistory(pool, userId, {
      startDate,
      endDate,
      limit
    });

    return res.status(200).json({
      start_date: startDate,
      end_date: endDate,
      scores
    });
  } catch (error) {
    console.error('Get burnout score history error:', error);
    return res.status(500).json({ message: 'Failed to fetch burnout history' });
  }
}

export async function recalculateScore(req, res) {
  const body = req.body ?? {};
  const userId = parsePositiveInt(body.user_id);
  const scoreDate = String(body.score_date ?? todayKey()).trim();

  if (!userId) {
    return res.status(400).json({ message: 'Valid user_id is required' });
  }

  if (!isValidDateString(scoreDate)) {
    return res.status(400).json({ message: 'Valid score_date is required' });
  }

  try {
    const userExists = await ensureUserExists(pool, userId);
    if (!userExists) {
      return res.status(404).json({ message: 'User not found' });
    }

    const score = await upsertBurnoutScoreForDate(pool, userId, scoreDate);

    if (!score) {
      return res.status(422).json({
        message: 'Not enough wellness data is available to calculate a burnout score'
      });
    }

    return res.status(200).json({
      message: 'Burnout score recalculated successfully',
      score
    });
  } catch (error) {
    console.error('Recalculate burnout score error:', error);
    return res.status(500).json({ message: 'Failed to recalculate burnout score' });
  }
}

export async function getPatternSummary(req, res) {
  const userId = parsePositiveInt(req.query.user_id);
  const endDate = String(req.query.end ?? todayKey()).trim();
  const refreshScores = parseOptionalBoolean(req.query.refresh, true);

  if (!userId) {
    return res.status(400).json({ message: 'Valid user_id is required' });
  }

  if (!isValidDateString(endDate)) {
    return res.status(400).json({ message: 'Valid end date is required' });
  }

  try {
    const userExists = await ensureUserExists(pool, userId);
    if (!userExists) {
      return res.status(404).json({ message: 'User not found' });
    }

    const summary = await getBurnoutPatternSummary(pool, userId, {
      endDate,
      refreshScores
    });

    return res.status(200).json(summary);
  } catch (error) {
    console.error('Get burnout pattern summary error:', error);
    return res.status(500).json({ message: 'Failed to fetch burnout patterns' });
  }
}
