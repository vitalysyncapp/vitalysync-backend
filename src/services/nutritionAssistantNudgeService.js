import OpenAI from 'openai';

import { calculateTotals, toNumber } from './nutrition.service.js';

const DEFAULT_OPENAI_NUTRITION_NUDGE_MODEL = 'gpt-4o-mini';
const PROMPT_VERSION = 'nutrition_assistant_nudge_v1';
const NUTRITION_FEEDBACK_COOLDOWN_HOURS = 48;

const FOOD_GROUPS = {
  protein: ['eggs', 'chicken', 'tuna or fish', 'tofu', 'beans', 'Greek yogurt'],
  carbs_fiber: ['rice', 'oats', 'sweet potato', 'banana', 'whole-grain bread'],
  healthy_fats: ['avocado', 'nuts', 'peanut butter', 'olive oil', 'eggs'],
  produce: ['leafy vegetables', 'carrots', 'tomatoes', 'fruit']
};

const NUTRITION_NUDGE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['title', 'message'],
  properties: {
    title: { type: 'string' },
    message: { type: 'string' }
  }
};

let openaiClient = null;

function getOpenAIClient() {
  if (!process.env.OPENAI_API_KEY) {
    throw new Error('OPENAI_API_KEY is not configured');
  }

  if (!openaiClient) {
    openaiClient = new OpenAI({
      apiKey: process.env.OPENAI_API_KEY
    });
  }

  return openaiClient;
}

function safeDateKey(value = new Date()) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) {
    return new Date().toISOString().slice(0, 10);
  }

  return date.toISOString().slice(0, 10);
}

function safeString(value, fallback = '') {
  return String(value ?? fallback).trim();
}

function truncate(value, maxLength) {
  const normalized = safeString(value);
  if (normalized.length <= maxLength) {
    return normalized;
  }

  return `${normalized.slice(0, Math.max(0, maxLength - 3)).trim()}...`;
}

function foodList(foods) {
  if (foods.length <= 1) {
    return foods.join('');
  }

  return `${foods.slice(0, -1).join(', ')}, or ${foods[foods.length - 1]}`;
}

function normalizeMetadata(value) {
  if (value == null) {
    return {};
  }

  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value);
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
        ? parsed
        : {};
    } catch (_) {
      return {};
    }
  }

  return typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function hoursSince(value, now = new Date()) {
  const date = value instanceof Date ? value : new Date(value);
  const diff = now.getTime() - date.getTime();
  return Number.isFinite(diff) ? diff / (1000 * 60 * 60) : Number.POSITIVE_INFINITY;
}

function normalizeSummary(summary) {
  const totals = summary?.day_totals ?? summary ?? {};
  const meals = Array.isArray(summary?.meals) ? summary.meals : [];

  return {
    total_calories: toNumber(totals.total_calories ?? totals.totalCalories, 0),
    total_protein_g: toNumber(totals.total_protein_g ?? totals.totalProteinG, 0),
    total_carbs_g: toNumber(totals.total_carbs_g ?? totals.totalCarbsG, 0),
    total_fat_g: toNumber(totals.total_fat_g ?? totals.totalFatG, 0),
    meals
  };
}

function macroShares(summary) {
  const proteinCalories = summary.total_protein_g * 4;
  const carbCalories = summary.total_carbs_g * 4;
  const fatCalories = summary.total_fat_g * 9;
  const macroCalories = proteinCalories + carbCalories + fatCalories;
  const denominator = macroCalories > 0 ? macroCalories : summary.total_calories;

  if (denominator <= 0) {
    return {
      protein: 0,
      carbs: 0,
      fat: 0
    };
  }

  return {
    protein: proteinCalories / denominator,
    carbs: carbCalories / denominator,
    fat: fatCalories / denominator
  };
}

function foodNames(summary) {
  return summary.meals
    .flatMap((meal) => Array.isArray(meal.items) ? meal.items : [])
    .map((item) => safeString(item.food_name ?? item.foodName).toLowerCase())
    .join(' ');
}

const PRODUCE_PATTERN = /\b(fruit|apple|banana|orange|mango|berry|vegetable|salad|greens|spinach|kangkong|pechay|broccoli|carrot|tomato|beans|lentil|okra|cabbage)\b/;

function hasProduceSignal(summary) {
  const names = foodNames(summary);
  return names.length > 0 && PRODUCE_PATTERN.test(names);
}

function createCandidate({
  dateKey,
  macroFocus,
  title,
  message,
  recommendedFoods,
  score,
  confidence,
  summary,
  metadata = {}
}) {
  return {
    id: `${dateKey}_nutrition_${macroFocus}`,
    title,
    message,
    confidence,
    source: 'nutrition_assistant',
    generated_at: new Date().toISOString(),
    metadata: {
      macro_focus: macroFocus,
      recommended_foods: recommendedFoods,
      ai_enhanced: false,
      deterministic_title: title,
      deterministic_message: message,
      total_calories: summary.total_calories,
      total_protein_g: summary.total_protein_g,
      total_carbs_g: summary.total_carbs_g,
      total_fat_g: summary.total_fat_g,
      selection_score: Math.round(score * 1000) / 1000,
      ...metadata
    }
  };
}

export function buildNutritionAssistantNudgeCandidates({
  summary,
  now = new Date()
}) {
  const normalized = normalizeSummary(summary);
  const dateKey = safeDateKey(now);
  const shares = macroShares(normalized);
  const candidates = [];

  if (normalized.meals.length === 0 || normalized.total_calories < 50) {
    return [
      createCandidate({
        dateKey,
        macroFocus: 'complete_meal',
        title: 'Build a simple plate',
        message:
          `No meals are logged yet. For your next meal, aim for protein, a fiber-rich carb, and produce, such as eggs with rice and ${FOOD_GROUPS.produce[0]}.`,
        recommendedFoods: [
          'eggs',
          'rice',
          'leafy vegetables',
          'fruit'
        ],
        score: 1,
        confidence: 'low',
        summary: normalized,
        metadata: { meal_signal: 'no_meals_logged' }
      })
    ];
  }

  if (shares.protein < 0.18 || normalized.total_protein_g < 25) {
    const score = Math.max(0.20 - shares.protein, normalized.total_protein_g < 25 ? 0.08 : 0);
    candidates.push(
      createCandidate({
        dateKey,
        macroFocus: 'protein',
        title: 'Add protein next',
        message:
          `Protein looks light compared with the rest of today's macros. At your next meal, add ${foodList(FOOD_GROUPS.protein)} to make the plate steadier.`,
        recommendedFoods: FOOD_GROUPS.protein,
        score,
        confidence: score >= 0.12 ? 'high' : 'medium',
        summary: normalized,
        metadata: { protein_share: shares.protein }
      })
    );
  }

  if (shares.carbs < 0.36) {
    const score = 0.42 - shares.carbs;
    candidates.push(
      createCandidate({
        dateKey,
        macroFocus: 'carbs_fiber',
        title: 'Add fiber-rich carbs',
        message:
          `Carbs are low in today's balance. A simple option like ${foodList(FOOD_GROUPS.carbs_fiber)} can add steady energy without making the meal complicated.`,
        recommendedFoods: FOOD_GROUPS.carbs_fiber,
        score,
        confidence: score >= 0.12 ? 'high' : 'medium',
        summary: normalized,
        metadata: { carbs_share: shares.carbs }
      })
    );
  }

  if (shares.fat < 0.18) {
    const score = 0.22 - shares.fat;
    candidates.push(
      createCandidate({
        dateKey,
        macroFocus: 'healthy_fats',
        title: 'Add healthy fats',
        message:
          `Fat is low in today's macro mix. Add a small serving of ${foodList(FOOD_GROUPS.healthy_fats)} with your next meal to round it out.`,
        recommendedFoods: FOOD_GROUPS.healthy_fats,
        score,
        confidence: score >= 0.10 ? 'high' : 'medium',
        summary: normalized,
        metadata: { fat_share: shares.fat }
      })
    );
  }

  if (shares.carbs > 0.58) {
    const foods = [
      'eggs',
      'tofu',
      'chicken',
      ...FOOD_GROUPS.produce
    ];
    candidates.push(
      createCandidate({
        dateKey,
        macroFocus: 'protein_produce',
        title: 'Balance carbs with protein',
        message:
          `Carbs are carrying most of today's macros. Balance the next meal with protein and produce, such as eggs, tofu, chicken, leafy vegetables, tomatoes, or fruit.`,
        recommendedFoods: foods,
        score: shares.carbs - 0.50,
        confidence: shares.carbs >= 0.68 ? 'high' : 'medium',
        summary: normalized,
        metadata: { carbs_share: shares.carbs }
      })
    );
  }

  if (shares.fat > 0.42) {
    const foods = [
      'oats',
      'sweet potato',
      'rice',
      ...FOOD_GROUPS.produce
    ];
    candidates.push(
      createCandidate({
        dateKey,
        macroFocus: 'fiber_produce',
        title: 'Lighten the next plate',
        message:
          `Fat is taking a large share today. Balance the next meal with fiber-rich carbs and produce like oats, sweet potato, rice, leafy vegetables, tomatoes, or fruit.`,
        recommendedFoods: foods,
        score: shares.fat - 0.34,
        confidence: shares.fat >= 0.52 ? 'high' : 'medium',
        summary: normalized,
        metadata: { fat_share: shares.fat }
      })
    );
  }

  if (!hasProduceSignal(normalized)) {
    candidates.push(
      createCandidate({
        dateKey,
        macroFocus: 'produce',
        title: 'Add produce',
        message:
          `Produce is missing from today's logged foods. Add ${foodList(FOOD_GROUPS.produce)} to bring in fiber, color, and a steadier plate.`,
        recommendedFoods: FOOD_GROUPS.produce,
        score: 0.09,
        confidence: 'low',
        summary: normalized,
        metadata: { produce_signal: 'not_found_in_food_names' }
      })
    );
  }

  candidates.push(
    createCandidate({
      dateKey,
      macroFocus: 'balanced_plate',
      title: 'Keep the plate balanced',
      message:
        'Your macros look reasonably balanced today. Keep the next meal simple with protein, fiber-rich carbs, healthy fats, and produce.',
      recommendedFoods: [
        'eggs',
        'rice',
        'avocado',
        'leafy vegetables'
      ],
      score: 0.01,
      confidence: 'low',
      summary: normalized
    })
  );

  return candidates;
}

function feedbackForFocus(recentEvents, macroFocus, now) {
  const relevant = recentEvents.filter((event) => {
    const metadata = normalizeMetadata(event.metadata);
    return metadata.macro_focus === macroFocus;
  });

  const dismissedRecently = relevant.some((event) =>
    event.status === 'dismissed' &&
    hoursSince(event.created_at ?? event.acted_at, now) <= NUTRITION_FEEDBACK_COOLDOWN_HOURS
  );
  const acceptedRecently = relevant.some((event) =>
    ['accepted', 'completed'].includes(event.status) &&
    hoursSince(event.created_at ?? event.acted_at, now) <= 14 * 24
  );

  return {
    dismissedRecently,
    acceptedRecently
  };
}

export function buildDeterministicNutritionAssistantNudge({
  summary,
  recentEvents = [],
  now = new Date()
}) {
  const candidates = buildNutritionAssistantNudgeCandidates({ summary, now })
    .map((candidate) => {
      const feedback = feedbackForFocus(
        recentEvents,
        candidate.metadata.macro_focus,
        now
      );
      return {
        ...candidate,
        metadata: {
          ...candidate.metadata,
          recently_dismissed_macro_focus: feedback.dismissedRecently,
          recently_accepted_macro_focus: feedback.acceptedRecently
        }
      };
    });

  const visible = candidates.filter(
    (candidate) => candidate.metadata.recently_dismissed_macro_focus !== true
  );
  const ranked = (visible.length > 0 ? visible : candidates).sort((left, right) => {
    const leftAccepted = left.metadata.recently_accepted_macro_focus === true ? 0.02 : 0;
    const rightAccepted = right.metadata.recently_accepted_macro_focus === true ? 0.02 : 0;
    return (
      (right.metadata.selection_score + rightAccepted) -
      (left.metadata.selection_score + leftAccepted)
    );
  });

  return ranked[0] ?? null;
}

function parseJsonResponse(response) {
  const outputText = safeString(response?.output_text);
  if (!outputText) {
    throw new Error('OpenAI returned an empty nutrition nudge response');
  }

  return JSON.parse(outputText);
}

function normalizeAiOutput(payload) {
  const title = truncate(payload?.title, 48);
  const message = truncate(payload?.message, 220);

  if (!title || !message) {
    return null;
  }

  return { title, message };
}

export async function enhanceNutritionAssistantNudge(insight, { summary }) {
  const model =
    process.env.OPENAI_NUTRITION_NUDGE_MODEL ||
    process.env.OPENAI_NUTRITION_MODEL ||
    DEFAULT_OPENAI_NUTRITION_NUDGE_MODEL;
  const macroFocus = insight.metadata.macro_focus;
  const recommendedFoods = insight.metadata.recommended_foods ?? [];
  const openai = getOpenAIClient();
  const response = await openai.responses.create({
    model,
    input: [
      {
        role: 'system',
        content: [
          {
            type: 'input_text',
            text:
              'You write short nutrition nudges for VitalySync. Keep advice general, practical, and non-medical. Do not prescribe calories, dieting rules, weight loss, or diagnosis. Preserve the macro focus and recommended foods. Use plain English and one actionable sentence.'
          }
        ]
      },
      {
        role: 'user',
        content: [
          {
            type: 'input_text',
            text:
              'Polish this deterministic nutrition nudge without changing the meaning or food list. Return JSON only.\n\nContext:\n' +
              JSON.stringify({
                deterministic_title: insight.title,
                deterministic_message: insight.message,
                macro_focus: macroFocus,
                recommended_foods: recommendedFoods,
                totals: normalizeSummary(summary)
              })
          }
        ]
      }
    ],
    text: {
      format: {
        type: 'json_schema',
        name: 'vitalysync_nutrition_nudge',
        strict: true,
        schema: NUTRITION_NUDGE_SCHEMA
      }
    }
  });
  const parsed = parseJsonResponse(response);
  const normalized = normalizeAiOutput(parsed);

  if (!normalized) {
    return insight;
  }

  return {
    ...insight,
    title: normalized.title,
    message: normalized.message,
    metadata: {
      ...insight.metadata,
      ai_enhanced: true,
      ai_model: model,
      ai_prompt_version: PROMPT_VERSION,
      deterministic_title: insight.metadata.deterministic_title ?? insight.title,
      deterministic_message: insight.metadata.deterministic_message ?? insight.message
    }
  };
}

export async function buildNutritionAssistantNudgeResponse({
  summary,
  recentEvents = [],
  now = new Date(),
  useAi = true,
  aiEnhancer = enhanceNutritionAssistantNudge
}) {
  const deterministic = buildDeterministicNutritionAssistantNudge({
    summary,
    recentEvents,
    now
  });

  if (!deterministic || !useAi) {
    return deterministic;
  }

  try {
    return await aiEnhancer(deterministic, { summary });
  } catch (error) {
    return {
      ...deterministic,
      metadata: {
        ...deterministic.metadata,
        ai_enhanced: false,
        ai_fallback: true,
        ai_error: error.message
      }
    };
  }
}

async function loadDailyNutritionSummary(client, userId, date) {
  const logsResult = await client.query(
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
    [userId, date]
  );
  const logIds = logsResult.rows.map((log) => log.nutrition_log_id);
  let itemsByLogId = {};

  if (logIds.length > 0) {
    const itemsResult = await client.query(
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
    items: itemsByLogId[log.nutrition_log_id] ?? []
  }));
  const dayTotals = calculateTotals(
    meals.map((meal) => ({
      calories: meal.total_calories,
      protein_g: meal.total_protein_g,
      carbs_g: meal.total_carbs_g,
      fat_g: meal.total_fat_g
    }))
  );
  const loggedMealTypes = new Set(meals.map((meal) => meal.meal_type));

  return {
    date,
    meals,
    day_totals: dayTotals,
    logged: {
      breakfast: loggedMealTypes.has('breakfast'),
      lunch: loggedMealTypes.has('lunch'),
      dinner: loggedMealTypes.has('dinner'),
      snack: loggedMealTypes.has('snack')
    }
  };
}

async function loadRecentNutritionFeedback(client, userId) {
  const result = await client.query(
    `SELECT status, metadata, acted_at, created_at
     FROM nudge_events
     WHERE user_id = $1
       AND nudge_type = 'nutrition_insight'
       AND created_at >= NOW() - INTERVAL '14 days'
     ORDER BY created_at DESC`,
    [userId]
  );

  return result.rows;
}

export async function getNutritionAssistantNudge(
  client,
  userId,
  { date = safeDateKey(), useAi = true } = {}
) {
  const summary = await loadDailyNutritionSummary(client, userId, date);
  const recentEvents = await loadRecentNutritionFeedback(client, userId);

  return buildNutritionAssistantNudgeResponse({
    summary,
    recentEvents,
    now: new Date(`${date}T12:00:00.000Z`),
    useAi
  });
}
