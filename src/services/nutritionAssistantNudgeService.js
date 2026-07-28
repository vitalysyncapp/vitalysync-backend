import OpenAI from 'openai';

import { calculateTotals, toNumber } from './nutrition.service.js';
import { analyzeNutritionMealPatterns } from './nutritionPatternService.js';

const DEFAULT_OPENAI_NUTRITION_NUDGE_MODEL = 'gpt-4o-mini';
const PROMPT_VERSION = 'nutrition_assistant_nudge_v2';
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
  required: ['title', 'message', 'macro_focus', 'recommended_foods'],
  properties: {
    title: { type: 'string' },
    message: { type: 'string' },
    macro_focus: { type: 'string' },
    recommended_foods: {
      type: 'array',
      items: { type: 'string' }
    }
  }
};

const UNSAFE_NUTRITION_COPY_PATTERN =
  /\b(calorie|kcal|diet|weight|goal|target|lose|treat|treatment|diagnos|disease|medical|prescri|cure|prevent|cholesterol|immunity|metabolism|blood sugar)\b/i;
const FOOD_TERMS = [
  ...new Set([
    ...Object.values(FOOD_GROUPS).flat(),
    'salmon',
    'quinoa',
    'beef',
    'pork',
    'milk',
    'cheese'
  ])
];

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

function candidateDimensions(macroFocus) {
  switch (macroFocus) {
    case 'complete_meal':
      return { foodGroup: 'meal_log', nudgeType: 'meal_logging' };
    case 'protein':
      return { foodGroup: 'protein', nudgeType: 'macro_balance' };
    case 'carbs_fiber':
      return { foodGroup: 'fiber_rich_carbs', nudgeType: 'macro_balance' };
    case 'healthy_fats':
      return { foodGroup: 'healthy_fats', nudgeType: 'macro_balance' };
    case 'protein_produce':
      return { foodGroup: 'protein_produce', nudgeType: 'macro_balance' };
    case 'fiber_produce':
      return { foodGroup: 'fiber_produce', nudgeType: 'macro_balance' };
    case 'produce':
      return { foodGroup: 'produce', nudgeType: 'food_group' };
    case 'breakfast_rhythm':
    case 'meal_timing':
      return { foodGroup: 'meal_rhythm', nudgeType: 'meal_timing' };
    default:
      return {
        foodGroup: 'balanced_plate',
        nudgeType: 'positive_reinforcement'
      };
  }
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
  const dimensions = candidateDimensions(macroFocus);
  return {
    id: `${dateKey}_nutrition_${macroFocus}`,
    title,
    message,
    confidence,
    source: 'nutrition_assistant',
    generated_at: new Date().toISOString(),
    metadata: {
      macro_focus: macroFocus,
      food_group: dimensions.foodGroup,
      nutrition_nudge_type: dimensions.nudgeType,
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

function buildPatternCandidates({ recentSummaries, dateKey, summary }) {
  const analysis = analyzeNutritionMealPatterns(recentSummaries);

  return analysis.patterns.map((pattern) => {
    const sharedMetadata = {
      pattern_type: pattern.type,
      pattern_occurrences: pattern.occurrences,
      pattern_observed_days: pattern.observed_days,
      reason_basis: 'seven_day_logged_pattern'
    };

    switch (pattern.type) {
      case 'repeated_low_protein':
        return createCandidate({
          dateKey,
          macroFocus: 'protein',
          title: 'Add a protein food',
          message: `Protein was light in ${pattern.occurrences} recent logged days. Add a protein food you enjoy to your next meal.`,
          recommendedFoods: FOOD_GROUPS.protein,
          score: 0.12 + pattern.occurrences * 0.02,
          confidence: pattern.occurrences >= 4 ? 'high' : 'medium',
          summary,
          metadata: sharedMetadata
        });
      case 'repeated_missing_produce':
        return createCandidate({
          dateKey,
          macroFocus: 'produce',
          title: 'Add fruit or vegetables',
          message: `Produce was missing from ${pattern.occurrences} recent logged days. Add a fruit or vegetable you enjoy to your next meal.`,
          recommendedFoods: FOOD_GROUPS.produce,
          score: 0.1 + pattern.occurrences * 0.015,
          confidence: pattern.occurrences >= 4 ? 'high' : 'medium',
          summary,
          metadata: sharedMetadata
        });
      case 'repeated_missing_breakfast':
        return createCandidate({
          dateKey,
          macroFocus: 'breakfast_rhythm',
          title: 'Check your morning rhythm',
          message: `Breakfast was not logged on ${pattern.occurrences} recent logged days. If it fits your routine, try a simple morning meal.`,
          recommendedFoods: [],
          score: 0.09 + pattern.occurrences * 0.015,
          confidence: pattern.occurrences >= 4 ? 'high' : 'medium',
          summary,
          metadata: sharedMetadata
        });
      case 'repeated_high_carb_share':
        return createCandidate({
          dateKey,
          macroFocus: 'protein_produce',
          title: 'Pair carbs with balance',
          message: `Carbs made up most of ${pattern.occurrences} recent logged days. Pair your next carb food with protein or produce.`,
          recommendedFoods: [...FOOD_GROUPS.protein, ...FOOD_GROUPS.produce],
          score: 0.11 + pattern.occurrences * 0.02,
          confidence: pattern.occurrences >= 4 ? 'high' : 'medium',
          summary,
          metadata: sharedMetadata
        });
      default:
        return createCandidate({
          dateKey,
          macroFocus: 'meal_timing',
          title: 'Try a steadier meal rhythm',
          message: `Long gaps appeared between logged meals on ${pattern.occurrences} recent days. Try a meal rhythm that feels practical for you.`,
          recommendedFoods: [],
          score: 0.08 + pattern.occurrences * 0.015,
          confidence: pattern.occurrences >= 4 ? 'high' : 'medium',
          summary,
          metadata: sharedMetadata
        });
    }
  });
}

export function buildNutritionAssistantNudgeCandidates({
  summary,
  recentSummaries = [],
  now = new Date()
}) {
  const normalized = normalizeSummary(summary);
  const dateKey = safeDateKey(now);
  const shares = macroShares(normalized);
  const candidates = [];

  if (normalized.meals.length === 0 || normalized.total_calories < 50) {
    const hasMealLog = normalized.meals.length > 0;
    return [
      ...buildPatternCandidates({
        recentSummaries,
        dateKey,
        summary: normalized
      }),
      createCandidate({
        dateKey,
        macroFocus: 'complete_meal',
        title: hasMealLog ? 'Add meal details' : 'Log your next meal',
        message: hasMealLog
          ? 'Today\'s meal log has limited detail. Add the foods you had so suggestions can use the log accurately.'
          : 'No meals are logged today. Log your next meal so suggestions can reflect what you actually ate.',
        recommendedFoods: [],
        score: 0.08,
        confidence: 'low',
        summary: normalized,
        metadata: {
          meal_signal: hasMealLog ? 'limited_meal_detail' : 'no_meals_logged'
        }
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
          'Protein looks light in today\'s logged meals. Add a protein food you enjoy to your next meal.',
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
          'Fiber-rich carbs look light in today\'s logs. Add a grain, starchy vegetable, or fruit you enjoy.',
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
          'Healthy fats look light in today\'s logs. Add a small portion of nuts, avocado, or olive oil.',
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
          'Carbs make up most of today\'s logged balance. Pair the next carb food with protein or produce.',
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
        title: 'Add fiber and produce',
        message:
          'Fats make up most of today\'s logged balance. Add a fiber-rich carb or produce to the next plate.',
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
          'Produce is missing from today\'s logged foods. Add a fruit or vegetable you enjoy to your next meal.',
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
        'Today\'s logged meals show a balanced mix. Keep choosing the foods that worked well for you.',
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

  candidates.push(
    ...buildPatternCandidates({
      recentSummaries,
      dateKey,
      summary: normalized
    })
  );

  return candidates;
}

function feedbackForCandidate(recentEvents, candidate, now) {
  const dimensions = [
    ['macro_focus', candidate.metadata.macro_focus],
    ['food_group', candidate.metadata.food_group],
    ['nutrition_nudge_type', candidate.metadata.nutrition_nudge_type]
  ];
  const relevant = recentEvents
    .map((event) => {
      const metadata = normalizeMetadata(event.metadata);
      const matchedDimensions = dimensions
        .filter(([key, value]) => value && metadata[key] === value)
        .map(([key]) => key);
      return { event, matchedDimensions };
    })
    .filter((item) => item.matchedDimensions.length > 0);

  const dismissed = relevant.filter(
    ({ event }) =>
      event.status === 'dismissed' &&
      hoursSince(event.acted_at ?? event.created_at, now) <=
        NUTRITION_FEEDBACK_COOLDOWN_HOURS
  );
  const accepted = relevant.filter(
    ({ event }) =>
      ['accepted', 'completed'].includes(event.status) &&
      hoursSince(event.acted_at ?? event.created_at, now) <= 14 * 24
  );

  return {
    dismissedRecently: dismissed.length > 0,
    acceptedRecently: accepted.length > 0,
    dismissedDimensions: [
      ...new Set(dismissed.flatMap((item) => item.matchedDimensions))
    ],
    acceptedDimensions: [
      ...new Set(accepted.flatMap((item) => item.matchedDimensions))
    ]
  };
}

export function buildDeterministicNutritionAssistantNudge({
  summary,
  recentSummaries = [],
  recentEvents = [],
  now = new Date()
}) {
  const candidates = buildNutritionAssistantNudgeCandidates({
    summary,
    recentSummaries,
    now
  })
    .map((candidate) => {
      const feedback = feedbackForCandidate(recentEvents, candidate, now);
      return {
        ...candidate,
        metadata: {
          ...candidate.metadata,
          recently_dismissed: feedback.dismissedRecently,
          recently_accepted: feedback.acceptedRecently,
          dismissed_feedback_dimensions: feedback.dismissedDimensions,
          accepted_feedback_dimensions: feedback.acceptedDimensions
        }
      };
    });

  const visible = candidates.filter(
    (candidate) => candidate.metadata.recently_dismissed !== true
  );
  const ranked = visible.sort((left, right) => {
    const leftAccepted =
      0.02 * (left.metadata.accepted_feedback_dimensions?.length ?? 0);
    const rightAccepted =
      0.02 * (right.metadata.accepted_feedback_dimensions?.length ?? 0);
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
  const macroFocus = safeString(payload?.macro_focus);
  const recommendedFoods = Array.isArray(payload?.recommended_foods)
    ? payload.recommended_foods.map((food) => safeString(food)).filter(Boolean)
    : [];

  if (!title || !message || !macroFocus) {
    return null;
  }

  return { title, message, macroFocus, recommendedFoods };
}

function normalizedList(values) {
  return values.map((value) => safeString(value).toLowerCase()).sort();
}

function sameList(left, right) {
  return (
    JSON.stringify(normalizedList(left)) ===
    JSON.stringify(normalizedList(right))
  );
}

function mentionsUnapprovedFood(
  message,
  recommendedFoods,
  deterministicMessage
) {
  const normalizedMessage = message.toLowerCase();
  const allowedText =
    `${recommendedFoods.join(' ')} ${deterministicMessage}`.toLowerCase();

  return FOOD_TERMS.some((food) => {
    const normalizedFood = food.toLowerCase();
    return (
      normalizedMessage.includes(normalizedFood) &&
      !allowedText.includes(normalizedFood)
    );
  });
}

function safeEnhancedNudge(deterministic, enhanced) {
  if (!enhanced || typeof enhanced !== 'object') {
    return null;
  }

  const title = truncate(enhanced.title, 48);
  const message = truncate(enhanced.message, 220);
  const enhancedMetadata = normalizeMetadata(enhanced.metadata);
  const macroFocus = safeString(
    enhanced.macro_focus ?? enhancedMetadata.macro_focus,
    deterministic.metadata.macro_focus
  );
  const recommendedFoods =
    enhanced.recommended_foods ?? enhancedMetadata.recommended_foods;
  const deterministicFoods = deterministic.metadata.recommended_foods ?? [];

  if (
    !title ||
    !message ||
    macroFocus !== deterministic.metadata.macro_focus ||
    (recommendedFoods != null &&
      (!Array.isArray(recommendedFoods) ||
        !sameList(recommendedFoods, deterministicFoods))) ||
    UNSAFE_NUTRITION_COPY_PATTERN.test(`${title} ${message}`) ||
    mentionsUnapprovedFood(message, deterministicFoods, deterministic.message)
  ) {
    return null;
  }

  return {
    ...deterministic,
    title,
    message,
    metadata: {
      ...deterministic.metadata,
      ai_enhanced: enhancedMetadata.ai_enhanced === true,
      ...(enhancedMetadata.ai_model
        ? { ai_model: enhancedMetadata.ai_model }
        : {}),
      ...(enhancedMetadata.ai_prompt_version
        ? { ai_prompt_version: enhancedMetadata.ai_prompt_version }
        : {})
    }
  };
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
              'You polish short nutrition nudges for VitalySync. Keep advice general, practical, and non-medical. Do not prescribe calories, dieting rules, weight loss, or diagnosis. Return the exact macro_focus and recommended_foods values supplied. Do not add foods, meals, goals, or health claims. Use plain English.'
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

  if (
    normalized.macroFocus !== macroFocus ||
    !sameList(normalized.recommendedFoods, recommendedFoods)
  ) {
    throw new Error('AI nutrition nudge changed the deterministic decision');
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
  recentSummaries = [],
  recentEvents = [],
  now = new Date(),
  useAi = true,
  aiEnhancer = enhanceNutritionAssistantNudge
}) {
  const deterministic = buildDeterministicNutritionAssistantNudge({
    summary,
    recentSummaries,
    recentEvents,
    now
  });

  if (!deterministic || !useAi) {
    return deterministic;
  }

  try {
    const enhanced = await aiEnhancer(deterministic, { summary });
    const safe = safeEnhancedNudge(deterministic, enhanced);
    if (safe) {
      return safe;
    }

    throw new Error('AI nutrition nudge failed deterministic validation');
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

function recentDateKeys(endDate, count = 7) {
  const end = new Date(`${endDate}T12:00:00.000Z`);
  return Array.from({ length: count }, (_, index) => {
    const date = new Date(end);
    date.setUTCDate(end.getUTCDate() - (count - index - 1));
    return safeDateKey(date);
  });
}

async function loadNutritionWindow(client, userId, date) {
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
     WHERE user_id = $1
       AND log_date BETWEEN ($2::date - INTERVAL '6 days') AND $2::date
     ORDER BY log_date ASC, CASE meal_type
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

  const mealsByDate = logsResult.rows.reduce((grouped, log) => {
    const dateKey = safeDateKey(log.log_date);
    grouped[dateKey] = grouped[dateKey] ?? [];
    grouped[dateKey].push({
      ...log,
      items: itemsByLogId[log.nutrition_log_id] ?? []
    });
    return grouped;
  }, {});

  return recentDateKeys(date).map((dateKey) => {
    const meals = mealsByDate[dateKey] ?? [];
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
      date: dateKey,
      meals,
      day_totals: dayTotals,
      logged: {
        breakfast: loggedMealTypes.has('breakfast'),
        lunch: loggedMealTypes.has('lunch'),
        dinner: loggedMealTypes.has('dinner'),
        snack: loggedMealTypes.has('snack')
      }
    };
  });
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
  const recentSummaries = await loadNutritionWindow(client, userId, date);
  const summary = recentSummaries[recentSummaries.length - 1];
  const recentEvents = await loadRecentNutritionFeedback(client, userId);

  return buildNutritionAssistantNudgeResponse({
    summary,
    recentSummaries,
    recentEvents,
    now: new Date(`${date}T12:00:00.000Z`),
    useAi
  });
}
