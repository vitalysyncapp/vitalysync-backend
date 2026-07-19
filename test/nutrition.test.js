import assert from 'node:assert/strict';
import test from 'node:test';

import {
  analyzeNutrition,
  confirmNutrition,
} from '../src/controllers/nutrition.controller.js';
import {
  calculateTotals,
  defaultCalorieGoalForStoredBmi,
  ensureDefaultNutritionCalorieGoal,
  isValidDateString,
  isValidMealType,
  normalizeMealType,
} from '../src/services/nutrition.service.js';
import {
  buildDeterministicNutritionAssistantNudge,
  buildNutritionAssistantNudgeResponse,
} from '../src/services/nutritionAssistantNudgeService.js';
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

test('default calorie goals use stored BMI across WHO adult boundaries', () => {
  assert.equal(defaultCalorieGoalForStoredBmi(18.4), 2200);
  assert.equal(defaultCalorieGoalForStoredBmi(18.5), 2000);
  assert.equal(defaultCalorieGoalForStoredBmi(24.9), 2000);
  assert.equal(defaultCalorieGoalForStoredBmi(25), 1900);
  assert.equal(defaultCalorieGoalForStoredBmi(30), 1800);
  assert.equal(defaultCalorieGoalForStoredBmi(35), 1700);
  assert.equal(defaultCalorieGoalForStoredBmi(40), 1600);
});

test('default calorie goals require a valid stored BMI', () => {
  assert.throws(
    () => defaultCalorieGoalForStoredBmi(null),
    /Valid stored BMI is required/
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
    storedBmi: '30',
  });

  assert.equal(created, false);
  assert.equal(queries.length, 1);
  assert.deepEqual(queries[0].values, [
    7,
    'nutrition_calories',
    1800,
    'kcal',
    'system_default',
  ]);
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
  assert.ok(insight.message.includes('No meals are logged yet'));
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
