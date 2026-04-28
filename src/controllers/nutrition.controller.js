import pool from '../config/db.js';
import {
  calculateTotals,
  detectFoodsFromManualInput,
  detectFoodsFromImage,
  enrichFoodsWithUsda,
  isValidDateString,
  isValidMealType,
  normalizeMealType,
  toNumber,
} from '../services/nutrition.service.js';

function getUserId(req) {
  const rawUserId = req.body?.user_id ?? req.query?.user_id;
  const userId = Number(rawUserId);
  return Number.isInteger(userId) && userId > 0 ? userId : null;
}

async function ensureUserExists(client, userId) {
  const result = await client.query('SELECT user_id FROM users WHERE user_id = $1', [userId]);
  return result.rowCount > 0;
}

function normalizeItems(items) {
  if (!Array.isArray(items)) {
    return [];
  }

  return items
    .map((item) => ({
      food_name: String(item?.food_name ?? '').trim(),
      usda_fdc_id: item?.usda_fdc_id == null || item.usda_fdc_id === ''
        ? null
        : Number(item.usda_fdc_id),
      serving_qty: toNumber(item?.serving_qty, 1),
      serving_unit: String(item?.serving_unit ?? 'serving').trim() || 'serving',
      calories: toNumber(item?.calories, 0),
      protein_g: toNumber(item?.protein_g, 0),
      carbs_g: toNumber(item?.carbs_g, 0),
      fat_g: toNumber(item?.fat_g, 0),
      confidence: item?.confidence == null ? null : toNumber(item.confidence, 0),
    }))
    .filter((item) => item.food_name.length > 0);
}

async function readLogWithItems(client, nutritionLogId) {
  const logResult = await client.query(
    `SELECT
       nutrition_log_id,
       user_id,
       log_date,
       meal_type,
       total_calories,
       total_protein_g,
       total_carbs_g,
       total_fat_g,
       notes,
       created_at,
       updated_at
     FROM nutrition_logs
     WHERE nutrition_log_id = $1`,
    [nutritionLogId]
  );

  const itemsResult = await client.query(
    `SELECT
       item_id,
       nutrition_log_id,
       food_name,
       usda_fdc_id,
       serving_qty,
       serving_unit,
       calories,
       protein_g,
       carbs_g,
       fat_g,
       confidence,
       created_at
     FROM nutrition_log_items
     WHERE nutrition_log_id = $1
     ORDER BY item_id ASC`,
    [nutritionLogId]
  );

  return {
    ...logResult.rows[0],
    items: itemsResult.rows,
  };
}

export async function analyzeNutrition(req, res) {
  const userId = getUserId(req);
  const mealType = normalizeMealType(req.body?.meal_type);
  const logDate = String(req.body?.log_date ?? '').trim();
  const inputType = String(req.body?.input_type ?? 'image').trim().toLowerCase();

  if (!userId) {
    return res.status(400).json({ message: 'Valid user_id is required' });
  }

  if (!isValidMealType(mealType)) {
    return res.status(400).json({ message: 'Valid meal_type is required' });
  }

  if (!isValidDateString(logDate)) {
    return res.status(400).json({ message: 'Valid log_date is required' });
  }

  if (inputType !== 'image' && inputType !== 'manual') {
    return res.status(400).json({ message: 'Valid input_type is required' });
  }

  if (inputType === 'image' && !req.file?.buffer) {
    return res.status(400).json({ message: 'Food image is required' });
  }

  const manualMeals = Array.isArray(req.body?.manual_items)
    ? req.body.manual_items
    : [{
        meal_name: req.body?.meal_name,
        quantity: req.body?.quantity,
        notes: req.body?.notes,
      }];

  if (
    inputType === 'manual' &&
    !manualMeals.some((meal) => String(meal?.meal_name ?? '').trim().length > 0)
  ) {
    return res.status(400).json({ message: 'Meal name is required' });
  }

  try {
    const userExists = await ensureUserExists(pool, userId);
    if (!userExists) {
      return res.status(404).json({ message: 'User not found' });
    }

    const detectedFoods = inputType === 'manual'
      ? await detectFoodsFromManualInput({ meals: manualMeals })
      : await detectFoodsFromImage({
          buffer: req.file.buffer,
          mimetype: req.file.mimetype,
        });

    if (detectedFoods.length === 0) {
      return res.status(422).json({
        message: inputType === 'manual'
          ? 'No food could be estimated from the manual log'
          : 'No food could be detected in the image',
      });
    }

    const items = await enrichFoodsWithUsda(detectedFoods);

    const attemptResult = await pool.query(
      `INSERT INTO nutrition_attempts (
         user_id,
         log_date,
         meal_type,
         image_url,
         ai_detected_foods,
         usda_results,
         status
       )
       VALUES ($1, $2, $3, NULL, $4, $5, 'pending')
       RETURNING attempt_id, user_id, log_date, meal_type, status, created_at`,
      [userId, logDate, mealType, JSON.stringify(detectedFoods), JSON.stringify(items)]
    );

    return res.status(200).json({
      message: 'Nutrition analysis ready for review',
      attempt: attemptResult.rows[0],
      items,
    });
  } catch (error) {
    console.error('Analyze nutrition error:', error);
    return res.status(500).json({
      message: error.message?.includes('configured')
        ? error.message
        : inputType === 'manual'
          ? 'Failed to analyze manual food log'
          : 'Failed to analyze food image',
    });
  }
}

export async function confirmNutrition(req, res) {
  const userId = getUserId(req);
  const attemptId = Number(req.body?.attempt_id);
  const mealType = normalizeMealType(req.body?.meal_type);
  const logDate = String(req.body?.log_date ?? '').trim();
  const notes = String(req.body?.notes ?? '').trim();
  const items = normalizeItems(req.body?.items);

  if (!userId) {
    return res.status(400).json({ message: 'Valid user_id is required' });
  }

  if (!Number.isInteger(attemptId) || attemptId <= 0) {
    return res.status(400).json({ message: 'Valid attempt_id is required' });
  }

  if (!isValidMealType(mealType)) {
    return res.status(400).json({ message: 'Valid meal_type is required' });
  }

  if (!isValidDateString(logDate)) {
    return res.status(400).json({ message: 'Valid log_date is required' });
  }

  if (items.length === 0) {
    return res.status(400).json({ message: 'At least one food item is required' });
  }

  const totals = calculateTotals(items);
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    const userExists = await ensureUserExists(client, userId);
    if (!userExists) {
      await client.query('ROLLBACK');
      return res.status(404).json({ message: 'User not found' });
    }

    const attemptResult = await client.query(
      `SELECT attempt_id
       FROM nutrition_attempts
       WHERE attempt_id = $1 AND user_id = $2
       FOR UPDATE`,
      [attemptId, userId]
    );

    if (attemptResult.rowCount === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ message: 'Nutrition attempt not found' });
    }

    const logResult = await client.query(
      `INSERT INTO nutrition_logs (
         user_id,
         log_date,
         meal_type,
         total_calories,
         total_protein_g,
         total_carbs_g,
         total_fat_g,
         notes
       )
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       ON CONFLICT (user_id, log_date, meal_type)
       DO UPDATE SET
         total_calories = EXCLUDED.total_calories,
         total_protein_g = EXCLUDED.total_protein_g,
         total_carbs_g = EXCLUDED.total_carbs_g,
         total_fat_g = EXCLUDED.total_fat_g,
         notes = EXCLUDED.notes,
         updated_at = CURRENT_TIMESTAMP
       RETURNING nutrition_log_id`,
      [
        userId,
        logDate,
        mealType,
        totals.total_calories,
        totals.total_protein_g,
        totals.total_carbs_g,
        totals.total_fat_g,
        notes || null,
      ]
    );

    const nutritionLogId = logResult.rows[0].nutrition_log_id;

    await client.query(
      'DELETE FROM nutrition_log_items WHERE nutrition_log_id = $1',
      [nutritionLogId]
    );

    for (const item of items) {
      await client.query(
        `INSERT INTO nutrition_log_items (
           nutrition_log_id,
           food_name,
           usda_fdc_id,
           serving_qty,
           serving_unit,
           calories,
           protein_g,
           carbs_g,
           fat_g,
           confidence
         )
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
        [
          nutritionLogId,
          item.food_name,
          item.usda_fdc_id,
          item.serving_qty,
          item.serving_unit,
          item.calories,
          item.protein_g,
          item.carbs_g,
          item.fat_g,
          item.confidence,
        ]
      );
    }

    await client.query(
      `UPDATE nutrition_attempts
       SET status = 'confirmed'
       WHERE attempt_id = $1 AND user_id = $2`,
      [attemptId, userId]
    );

    const savedLog = await readLogWithItems(client, nutritionLogId);

    await client.query('COMMIT');

    return res.status(200).json({
      message: 'Nutrition log saved successfully',
      log: savedLog,
    });
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Confirm nutrition error:', error);
    return res.status(500).json({ message: 'Failed to save nutrition log' });
  } finally {
    client.release();
  }
}

export async function discardNutritionAttempt(req, res) {
  const userId = getUserId(req);
  const attemptId = Number(req.body?.attempt_id);

  if (!userId) {
    return res.status(400).json({ message: 'Valid user_id is required' });
  }

  if (!Number.isInteger(attemptId) || attemptId <= 0) {
    return res.status(400).json({ message: 'Valid attempt_id is required' });
  }

  try {
    const result = await pool.query(
      `UPDATE nutrition_attempts
       SET status = 'discarded'
       WHERE attempt_id = $1 AND user_id = $2
       RETURNING attempt_id, status`,
      [attemptId, userId]
    );

    if (result.rowCount === 0) {
      return res.status(404).json({ message: 'Nutrition attempt not found' });
    }

    return res.status(200).json({
      message: 'Nutrition attempt discarded',
      attempt: result.rows[0],
    });
  } catch (error) {
    console.error('Discard nutrition attempt error:', error);
    return res.status(500).json({ message: 'Failed to discard nutrition attempt' });
  }
}

export async function getDailyNutrition(req, res) {
  const userId = getUserId(req);
  const logDate = String(req.query?.date ?? '').trim();

  if (!userId) {
    return res.status(400).json({ message: 'Valid user_id is required' });
  }

  if (!isValidDateString(logDate)) {
    return res.status(400).json({ message: 'Valid date is required' });
  }

  try {
    const logsResult = await pool.query(
      `SELECT
         nutrition_log_id,
         user_id,
         log_date,
         meal_type,
         total_calories,
         total_protein_g,
         total_carbs_g,
         total_fat_g,
         notes,
         created_at,
         updated_at
       FROM nutrition_logs
       WHERE user_id = $1 AND log_date = $2
       ORDER BY CASE meal_type
         WHEN 'breakfast' THEN 1
         WHEN 'lunch' THEN 2
         WHEN 'dinner' THEN 3
         ELSE 4
       END`,
      [userId, logDate]
    );

    const logIds = logsResult.rows.map((log) => log.nutrition_log_id);
    let itemsByLogId = {};

    if (logIds.length > 0) {
      const itemsResult = await pool.query(
        `SELECT *
         FROM nutrition_log_items
         WHERE nutrition_log_id = ANY($1::int[])
         ORDER BY item_id ASC`,
        [logIds]
      );

      itemsByLogId = itemsResult.rows.reduce((grouped, item) => {
        grouped[item.nutrition_log_id] = grouped[item.nutrition_log_id] ?? [];
        grouped[item.nutrition_log_id].push(item);
        return grouped;
      }, {});
    }

    const meals = logsResult.rows.map((log) => ({
      ...log,
      items: itemsByLogId[log.nutrition_log_id] ?? [],
    }));

    const dayTotals = calculateTotals(
      meals.map((meal) => ({
        calories: meal.total_calories,
        protein_g: meal.total_protein_g,
        carbs_g: meal.total_carbs_g,
        fat_g: meal.total_fat_g,
      }))
    );

    const loggedMealTypes = new Set(meals.map((meal) => meal.meal_type));

    return res.status(200).json({
      date: logDate,
      meals,
      day_totals: dayTotals,
      logged: {
        breakfast: loggedMealTypes.has('breakfast'),
        lunch: loggedMealTypes.has('lunch'),
        dinner: loggedMealTypes.has('dinner'),
        snack: loggedMealTypes.has('snack'),
      },
    });
  } catch (error) {
    console.error('Get daily nutrition error:', error);
    return res.status(500).json({ message: 'Failed to fetch daily nutrition' });
  }
}

export async function getNutritionHistory(req, res) {
  const userId = getUserId(req);
  const start = String(req.query?.start ?? '').trim();
  const end = String(req.query?.end ?? '').trim();

  if (!userId) {
    return res.status(400).json({ message: 'Valid user_id is required' });
  }

  if (!isValidDateString(start) || !isValidDateString(end)) {
    return res.status(400).json({ message: 'Valid start and end dates are required' });
  }

  try {
    const result = await pool.query(
      `SELECT
         log_date,
         COALESCE(SUM(total_calories), 0) AS total_calories,
         COALESCE(SUM(total_protein_g), 0) AS total_protein_g,
         COALESCE(SUM(total_carbs_g), 0) AS total_carbs_g,
         COALESCE(SUM(total_fat_g), 0) AS total_fat_g,
         COUNT(*)::INTEGER AS meal_count
       FROM nutrition_logs
       WHERE user_id = $1 AND log_date BETWEEN $2 AND $3
       GROUP BY log_date
       ORDER BY log_date ASC`,
      [userId, start, end]
    );

    return res.status(200).json({
      start,
      end,
      days: result.rows,
    });
  } catch (error) {
    console.error('Get nutrition history error:', error);
    return res.status(500).json({ message: 'Failed to fetch nutrition history' });
  }
}
