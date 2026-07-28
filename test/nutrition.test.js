import assert from 'node:assert/strict';
import test from 'node:test';

import {
  analyzeNutrition,
  confirmNutrition,
  nutritionAnalysisFailure,
} from '../src/controllers/nutrition.controller.js';
import {
  calculateTotals,
  defaultCalorieGoalForProfile,
  defaultCalorieGoalForStoredBmi,
  ensureDefaultNutritionCalorieGoal,
  isValidDateString,
  isValidMealType,
  normalizeMealType,
  readNutritionTimeoutConfig,
} from '../src/services/nutrition.service.js';
import {
  buildDeterministicNutritionAssistantNudge,
  buildNutritionAssistantNudgeCandidates,
  buildNutritionAssistantNudgeResponse,
  getNutritionAssistantNudge,
} from '../src/services/nutritionAssistantNudgeService.js';
import { analyzeNutritionMealPatterns } from '../src/services/nutritionPatternService.js';
import { createMockResponse } from './controllerTestHelpers.js';

function summary({
  calories = 500,
  protein = 25,
  carbs = 55,
  fat = 18,
  foodName = 'rice bowl',
  meals = null,
} = {}) {
  return {
    day_totals: {
      total_calories: calories,
      total_protein_g: protein,
      total_carbs_g: carbs,
      total_fat_g: fat,
    },
    meals: meals ?? [
      {
        meal_type: 'lunch',
        items: [{ food_name: foodName }],
      },
    ],
  };
}

function recentDay({
  date,
  calories = 500,
  protein = 25,
  carbs = 55,
  fat = 18,
  foodName = 'chicken rice tomato',
  mealType = 'lunch',
  createdAt = `${date}T12:00:00Z`,
} = {}) {
  return {
    date,
    day_totals: {
      total_calories: calories,
      total_protein_g: protein,
      total_carbs_g: carbs,
      total_fat_g: fat,
    },
    meals: [
      {
        meal_type: mealType,
        created_at: createdAt,
        items: [{ food_name: foodName }],
      },
    ],
    logged: {
      breakfast: mealType === 'breakfast',
      lunch: mealType === 'lunch',
      dinner: mealType === 'dinner',
      snack: mealType === 'snack',
    },
  };
}

test('nutrition helpers validate meal type and date inputs', () => {
  assert.equal(normalizeMealType(' Breakfast '), 'breakfast');
  assert.equal(isValidMealType('breakfast'), true);
  assert.equal(isValidMealType('midnight'), false);
  assert.equal(isValidDateString('2026-05-18'), true);
  assert.equal(isValidDateString('05/18/2026'), false);
});

test('nutrition totals sum calories and macros safely', () => {
  const totals = calculateTotals([
    { calories: 120.125, protein_g: 5, carbs_g: 20, fat_g: 2.5 },
    { calories: '80.1', protein_g: '3', carbs_g: '10', fat_g: '1.25' },
  ]);

  assert.deepEqual(totals, {
    total_calories: 200.23,
    total_protein_g: 8,
    total_carbs_g: 30,
    total_fat_g: 3.75,
  });
});

test('default calorie goals use wellness profile energy inputs', () => {
  const profile = {
    age: 30,
    gender: 'Female',
    height_cm: 160,
    weight_kg: 60,
    bmi: 23.4,
    lifestyle_type: 'Sedentary',
  };

  assert.equal(defaultCalorieGoalForProfile(profile), 1850);
  assert.equal(
    defaultCalorieGoalForProfile({ ...profile, age: 60 }),
    1700
  );
  assert.equal(
    defaultCalorieGoalForProfile({ ...profile, lifestyle_type: 'Very Active' }),
    2650
  );
  assert.equal(
    defaultCalorieGoalForProfile({ ...profile, weight_kg: 80, bmi: 31.3 }),
    1950
  );
  assert.equal(defaultCalorieGoalForStoredBmi(30), 1800);
});

test('default calorie goals require valid body metrics', () => {
  assert.throws(
    () => defaultCalorieGoalForProfile({ age: 30, height_cm: 170 }),
    /Valid weight_kg is required/
  );
});

test('nutrition service timeout config uses defaults and validates overrides', () => {
  assert.deepEqual(readNutritionTimeoutConfig({}), {
    usdaMs: 20000,
    openAiMs: 75000,
  });
  assert.deepEqual(
    readNutritionTimeoutConfig({
      USDA_TIMEOUT_MS: '25000',
      OPENAI_NUTRITION_TIMEOUT_MS: '90000',
    }),
    {
      usdaMs: 25000,
      openAiMs: 90000,
    }
  );
  assert.throws(
    () => readNutritionTimeoutConfig({ USDA_TIMEOUT_MS: '0' }),
    /USDA_TIMEOUT_MS must be a positive integer/
  );
});

test('default calorie goal persistence refreshes only system-generated goals', async () => {
  const queries = [];
  const client = {
    async query(text, values) {
      queries.push({ text, values });
      return { rowCount: 0, rows: [] };
    },
  };

  const created = await ensureDefaultNutritionCalorieGoal({
    client,
    userId: 7,
    profile: {
      age: 30,
      gender: 'Female',
      height_cm: 160,
      weight_kg: 80,
      bmi: '31.3',
      lifestyle_type: 'Sedentary',
    },
  });

  assert.equal(created, false);
  assert.equal(queries.length, 1);
  assert.deepEqual(queries[0].values.slice(0, 5), [
    7,
    'nutrition_calories',
    1950,
    'kcal',
    'system_default',
  ]);
  assert.deepEqual(JSON.parse(queries[0].values[5]), {
    balanced_kcal: 1950,
    balanced_kcal_source: 'wellness_profile',
    calculation_basis: 'age_height_weight_bmi_lifestyle',
  });
  assert.match(queries[0].text, /ON CONFLICT \(user_id, goal_type\)/);
  assert.match(queries[0].text, /DO UPDATE SET/);
  assert.match(
    queries[0].text,
    /WHERE user_goals\.source = EXCLUDED\.source/
  );
  assert.doesNotMatch(
    JSON.stringify(queries[0]),
    /underweight|pre_obesity|obesity_class/i
  );
});

test('nutrition assistant nudge recommends protein when protein is low', () => {
  const insight = buildDeterministicNutritionAssistantNudge({
    summary: summary({ protein: 5, carbs: 45, fat: 15 }),
    now: new Date('2026-05-22T12:00:00Z'),
  });

  assert.equal(insight.metadata.macro_focus, 'protein');
  assert.ok(insight.metadata.recommended_foods.includes('eggs'));
});

test('nutrition assistant nudge recommends fiber carbs when carbs are low', () => {
  const insight = buildDeterministicNutritionAssistantNudge({
    summary: summary({ protein: 40, carbs: 8, fat: 20, foodName: 'egg salad' }),
    now: new Date('2026-05-22T12:00:00Z'),
  });

  assert.equal(insight.metadata.macro_focus, 'carbs_fiber');
  assert.ok(insight.metadata.recommended_foods.includes('oats'));
});

test('nutrition assistant nudge recommends healthy fats when fat is low', () => {
  const insight = buildDeterministicNutritionAssistantNudge({
    summary: summary({ protein: 35, carbs: 60, fat: 2, foodName: 'chicken rice tomato' }),
    now: new Date('2026-05-22T12:00:00Z'),
  });

  assert.equal(insight.metadata.macro_focus, 'healthy_fats');
  assert.ok(insight.metadata.recommended_foods.includes('avocado'));
});

test('nutrition assistant nudge balances very high carbs with protein and produce', () => {
  const insight = buildDeterministicNutritionAssistantNudge({
    summary: summary({ protein: 28, carbs: 140, fat: 8 }),
    now: new Date('2026-05-22T12:00:00Z'),
  });

  assert.equal(insight.metadata.macro_focus, 'protein_produce');
  assert.ok(insight.metadata.recommended_foods.includes('tofu'));
});

test('nutrition assistant nudge balances very high fat with fiber and produce', () => {
  const insight = buildDeterministicNutritionAssistantNudge({
    summary: summary({ protein: 40, carbs: 35, fat: 55, foodName: 'egg pork tomato' }),
    now: new Date('2026-05-22T12:00:00Z'),
  });

  assert.equal(insight.metadata.macro_focus, 'fiber_produce');
  assert.ok(insight.metadata.recommended_foods.includes('sweet potato'));
});

test('nutrition assistant nudge handles no meals logged', () => {
  const insight = buildDeterministicNutritionAssistantNudge({
    summary: summary({ calories: 0, protein: 0, carbs: 0, fat: 0, meals: [] }),
    now: new Date('2026-05-22T12:00:00Z'),
  });

  assert.equal(insight.metadata.macro_focus, 'complete_meal');
  assert.ok(insight.message.includes('No meals are logged today'));
  assert.deepEqual(insight.metadata.recommended_foods, []);
});

test('nutrition assistant describes partial logs without treating them as a full day', () => {
  const insight = buildDeterministicNutritionAssistantNudge({
    summary: summary({ protein: 5, carbs: 45, fat: 15 }),
    now: new Date('2026-05-22T12:00:00Z'),
  });

  assert.equal(insight.metadata.macro_focus, 'protein');
  assert.match(insight.message, /today's logged meals/i);
  assert.doesNotMatch(insight.message, /daily target|should have eaten/i);
});

test('nutrition meal patterns require repeated evidence from logged days', () => {
  const analysis = analyzeNutritionMealPatterns([
    recentDay({
      date: '2026-05-19',
      protein: 8,
      foodName: 'rice tomato',
    }),
    recentDay({
      date: '2026-05-20',
      protein: 9,
      foodName: 'rice tomato',
    }),
    recentDay({
      date: '2026-05-21',
      protein: 10,
      foodName: 'rice tomato',
    }),
  ]);

  const pattern = analysis.patterns.find(
    (item) => item.type === 'repeated_low_protein'
  );
  assert.equal(pattern.occurrences, 3);
  assert.equal(pattern.observed_days, 3);
});

test('nutrition assistant uses a repeated seven-day pattern when today is empty', () => {
  const insight = buildDeterministicNutritionAssistantNudge({
    summary: summary({ calories: 0, protein: 0, carbs: 0, fat: 0, meals: [] }),
    recentSummaries: [
      recentDay({ date: '2026-05-19', protein: 8, foodName: 'rice tomato' }),
      recentDay({ date: '2026-05-20', protein: 9, foodName: 'rice tomato' }),
      recentDay({ date: '2026-05-21', protein: 10, foodName: 'rice tomato' }),
    ],
    now: new Date('2026-05-22T12:00:00Z'),
  });

  assert.equal(insight.metadata.pattern_type, 'repeated_low_protein');
  assert.equal(insight.metadata.pattern_occurrences, 3);
  assert.match(insight.message, /3 recent logged days/i);
});

test('nutrition assistant nudge suppresses a recently dismissed macro focus', () => {
  const insight = buildDeterministicNutritionAssistantNudge({
    summary: summary({ protein: 5, carbs: 45, fat: 15 }),
    recentEvents: [
      {
        status: 'dismissed',
        created_at: new Date('2026-05-22T11:30:00Z'),
        metadata: { macro_focus: 'protein' },
      },
    ],
    now: new Date('2026-05-22T12:00:00Z'),
  });

  assert.notEqual(insight.metadata.macro_focus, 'protein');
});

test('nutrition assistant uses food-group and nudge-type feedback', () => {
  const now = new Date('2026-05-22T12:00:00Z');
  const input = summary({ protein: 28, carbs: 140, fat: 8 });
  const dismissedFoodGroup = buildDeterministicNutritionAssistantNudge({
    summary: input,
    recentEvents: [
      {
        status: 'dismissed',
        acted_at: new Date('2026-05-22T11:30:00Z'),
        metadata: { food_group: 'protein_produce' },
      },
    ],
    now,
  });
  const dismissedType = buildDeterministicNutritionAssistantNudge({
    summary: input,
    recentEvents: [
      {
        status: 'dismissed',
        acted_at: new Date('2026-05-22T11:30:00Z'),
        metadata: { nutrition_nudge_type: 'macro_balance' },
      },
    ],
    now,
  });

  assert.notEqual(dismissedFoodGroup.metadata.food_group, 'protein_produce');
  assert.notEqual(dismissedType.metadata.nutrition_nudge_type, 'macro_balance');
});

test('nutrition assistant slightly boosts an accepted focus', () => {
  const insight = buildDeterministicNutritionAssistantNudge({
    summary: summary({ protein: 5, carbs: 45, fat: 15 }),
    recentEvents: [
      {
        status: 'accepted',
        acted_at: new Date('2026-05-22T11:30:00Z'),
        metadata: {
          macro_focus: 'produce',
          food_group: 'produce',
          nutrition_nudge_type: 'food_group',
        },
      },
    ],
    now: new Date('2026-05-22T12:00:00Z'),
  });

  assert.equal(insight.metadata.macro_focus, 'produce');
  assert.equal(insight.metadata.recently_accepted, true);
});

test('balanced logs produce positive reinforcement', () => {
  const insight = buildDeterministicNutritionAssistantNudge({
    summary: summary({
      protein: 25,
      carbs: 55,
      fat: 18,
      foodName: 'chicken rice tomato avocado',
    }),
    now: new Date('2026-05-22T12:00:00Z'),
  });

  assert.equal(insight.metadata.macro_focus, 'balanced_plate');
  assert.match(insight.message, /balanced mix/i);
});

test('deterministic nutrition copy stays short and non-prescriptive', () => {
  const candidates = buildNutritionAssistantNudgeCandidates({
    summary: summary({ protein: 5, carbs: 140, fat: 2 }),
    recentSummaries: [
      recentDay({ date: '2026-05-20', protein: 7, foodName: 'rice' }),
      recentDay({ date: '2026-05-21', protein: 8, foodName: 'rice' }),
    ],
    now: new Date('2026-05-22T12:00:00Z'),
  });

  for (const candidate of candidates) {
    assert.ok(candidate.message.length <= 180);
    assert.doesNotMatch(
      `${candidate.title} ${candidate.message}`,
      /calorie target|kcal|diet plan|weight loss|diagnos|treat|medical/i
    );
  }
});

test('nutrition assistant nudge falls back when AI enhancement fails', async () => {
  const insight = await buildNutritionAssistantNudgeResponse({
    summary: summary({ protein: 5, carbs: 45, fat: 15 }),
    now: new Date('2026-05-22T12:00:00Z'),
    useAi: true,
    aiEnhancer: async () => {
      throw new Error('model unavailable');
    },
  });

  assert.equal(insight.metadata.macro_focus, 'protein');
  assert.equal(insight.metadata.ai_fallback, true);
});

test('nutrition assistant rejects AI changes to focus or foods', async () => {
  const insight = await buildNutritionAssistantNudgeResponse({
    summary: summary({ protein: 5, carbs: 45, fat: 15 }),
    now: new Date('2026-05-22T12:00:00Z'),
    useAi: true,
    aiEnhancer: async (deterministic) => ({
      ...deterministic,
      message: 'Try salmon with your next meal.',
      metadata: {
        ...deterministic.metadata,
        macro_focus: 'healthy_fats',
        recommended_foods: ['salmon'],
        ai_enhanced: true,
      },
    }),
  });

  assert.equal(insight.metadata.macro_focus, 'protein');
  assert.equal(insight.metadata.ai_enhanced, false);
  assert.equal(insight.metadata.ai_fallback, true);
  assert.doesNotMatch(insight.message, /salmon/i);
});

test('nutrition assistant loads one bounded seven-day database window', async () => {
  const queries = [];
  const client = {
    async query(text, values) {
      queries.push({ text, values });
      return { rows: [] };
    },
  };

  const insight = await getNutritionAssistantNudge(client, 7, {
    date: '2026-05-22',
    useAi: false,
  });

  assert.equal(queries.length, 2);
  assert.match(queries[0].text, /INTERVAL '6 days'/);
  assert.deepEqual(queries[0].values, [7, '2026-05-22']);
  assert.match(queries[1].text, /nudge_events/);
  assert.equal(insight.metadata.macro_focus, 'complete_meal');
});

test('nutrition analysis validates required image input before database work', async () => {
  const res = createMockResponse();

  await analyzeNutrition(
    {
      body: {
        user_id: 1,
        meal_type: 'breakfast',
        log_date: '2026-05-18',
      },
    },
    res
  );

  assert.equal(res.statusCode, 400);
  assert.equal(res.body.message, 'Food image is required');
});

test('nutrition analysis maps scanner failures to safe actionable responses', () => {
  assert.deepEqual(
    nutritionAnalysisFailure(
      new Error('OPENAI_API_KEY is not configured'),
      'image'
    ),
    {
      status: 503,
      message: 'Nutrition analysis is not configured on this server',
    }
  );
  assert.deepEqual(
    nutritionAnalysisFailure(
      Object.assign(new Error('Invalid image format'), { status: 400 }),
      'image'
    ),
    {
      status: 422,
      message: 'This food photo could not be processed. Try a clear JPEG or PNG photo',
    }
  );
  assert.equal(
    nutritionAnalysisFailure(
      Object.assign(new Error('request timed out'), { status: 408 }),
      'manual'
    ).status,
    503
  );
});

test('nutrition confirmation requires reviewed food items before database work', async () => {
  const res = createMockResponse();

  await confirmNutrition(
    {
      body: {
        user_id: 1,
        attempt_id: 10,
        meal_type: 'lunch',
        log_date: '2026-05-18',
        items: [],
      },
    },
    res
  );

  assert.equal(res.statusCode, 400);
  assert.equal(res.body.message, 'At least one food item is required');
});
