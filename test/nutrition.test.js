import assert from 'node:assert/strict';
import test from 'node:test';

import {
  analyzeNutrition,
  confirmNutrition,
} from '../src/controllers/nutrition.controller.js';
import {
  calculateTotals,
  isValidDateString,
  isValidMealType,
  normalizeMealType,
} from '../src/services/nutrition.service.js';
import { createMockResponse } from './controllerTestHelpers.js';

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
