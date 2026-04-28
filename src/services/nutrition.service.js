import axios from 'axios';
import OpenAI from 'openai';

const ALLOWED_MEAL_TYPES = new Set(['breakfast', 'lunch', 'dinner', 'snack']);
const USDA_SEARCH_URL = 'https://api.nal.usda.gov/fdc/v1/foods/search';
const DEFAULT_OPENAI_MODEL = 'gpt-4o-mini';

let openaiClient = null;

export function isValidMealType(value) {
  return ALLOWED_MEAL_TYPES.has(String(value ?? '').trim().toLowerCase());
}

export function isValidDateString(value) {
  return /^\d{4}-\d{2}-\d{2}$/.test(String(value ?? '').trim());
}

export function normalizeMealType(value) {
  return String(value ?? '').trim().toLowerCase();
}

export function toNumber(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function getOpenAIClient() {
  if (!process.env.OPENAI_API_KEY) {
    throw new Error('OPENAI_API_KEY is not configured');
  }

  if (!openaiClient) {
    openaiClient = new OpenAI({
      apiKey: process.env.OPENAI_API_KEY,
    });
  }

  return openaiClient;
}

function extractJsonObject(text) {
  const trimmed = String(text ?? '').trim();

  try {
    return JSON.parse(trimmed);
  } catch {
    const start = trimmed.indexOf('{');
    const end = trimmed.lastIndexOf('}');
    if (start >= 0 && end > start) {
      return JSON.parse(trimmed.slice(start, end + 1));
    }
    throw new Error('OpenAI returned unreadable nutrition JSON');
  }
}

function normalizeDetectedFoods(payload) {
  const foods = Array.isArray(payload?.foods) ? payload.foods : [];

  return foods
    .map((food) => ({
      food_name: String(food?.food_name ?? '').trim(),
      estimated_quantity: Math.max(0, toNumber(food?.estimated_quantity, 1)),
      unit: String(food?.unit ?? 'serving').trim().toLowerCase() || 'serving',
      confidence: Math.min(1, Math.max(0, toNumber(food?.confidence, 0))),
    }))
    .filter((food) => food.food_name.length > 0)
    .slice(0, 8);
}

export async function detectFoodsFromImage({ buffer, mimetype }) {
  const client = getOpenAIClient();
  const dataUrl = `data:${mimetype};base64,${buffer.toString('base64')}`;

  const response = await client.responses.create({
    model: process.env.OPENAI_VISION_MODEL || DEFAULT_OPENAI_MODEL,
    input: [
      {
        role: 'user',
        content: [
          {
            type: 'input_text',
            text:
              'Identify visible edible foods in this meal photo. The system is deployed in the Philippines. Prioritize recognition of Filipino and Southeast Asian foods such as adobo, sinigang, sisig, pancit, lumpia, silog meals, rice-based meals, and common home-cooked dishes. Return strict JSON only with this shape: {"foods":[{"food_name":"string","estimated_quantity":number,"unit":"g | cup | piece | serving","confidence":number}]}. Use common USDA-searchable food names. When uncertain, return the most likely dish as the top guess for every dish in a single image if there are multiple dishes, using lower confidence when appropriate.',
          },
          {
            type: 'input_image',
            image_url: dataUrl,
          },
        ],
      },
    ],
    text: {
      format: {
        type: 'json_object',
      },
    },
  });

  const parsed = extractJsonObject(response.output_text);
  return normalizeDetectedFoods(parsed);
}

export async function detectFoodsFromManualInput({ meals }) {
  const client = getOpenAIClient();
  const cleanedMeals = Array.isArray(meals)
    ? meals
      .map((meal) => ({
        meal_name: String(meal?.meal_name ?? '').trim(),
        quantity: String(meal?.quantity ?? '').trim(),
        notes: String(meal?.notes ?? '').trim(),
      }))
      .filter((meal) => meal.meal_name.length > 0)
      .slice(0, 8)
    : [];

  if (cleanedMeals.length === 0) {
    return [];
  }

  const response = await client.responses.create({
    model: process.env.OPENAI_NUTRITION_MODEL || DEFAULT_OPENAI_MODEL,
    input: [
      {
        role: 'user',
        content: [
          {
            type: 'input_text',
            text:
              'Estimate edible foods from this manual nutrition log. Return strict JSON only with this shape: {"foods":[{"food_name":"string","estimated_quantity":number,"unit":"g | cup | piece | serving","confidence":number}]}. Use common USDA-searchable food names. Quantity and notes may be approximate; make the best practical estimate and lower confidence when uncertain.\n\nManual log entries:\n' +
              JSON.stringify(cleanedMeals),
          },
        ],
      },
    ],
    text: {
      format: {
        type: 'json_object',
      },
    },
  });

  const parsed = extractJsonObject(response.output_text);
  return normalizeDetectedFoods(parsed);
}

function findNutrient(food, aliases) {
  const nutrients = Array.isArray(food?.foodNutrients) ? food.foodNutrients : [];
  const normalizedAliases = aliases.map((alias) => alias.toLowerCase());

  const match = nutrients.find((item) => {
    const name = String(item?.nutrientName ?? item?.nutrient?.name ?? '').toLowerCase();
    const number = String(item?.nutrientNumber ?? item?.nutrient?.number ?? '');
    return normalizedAliases.some((alias) => name.includes(alias) || number === alias);
  });

  return toNumber(match?.value ?? match?.amount, 0);
}

function servingScale(quantity, unit) {
  const normalizedUnit = String(unit ?? '').toLowerCase();
  const qty = Math.max(0, toNumber(quantity, 1));

  if (normalizedUnit === 'g' || normalizedUnit === 'gram' || normalizedUnit === 'grams') {
    return qty / 100;
  }

  return qty > 0 ? qty : 1;
}

function roundMacro(value) {
  return Math.round(toNumber(value, 0) * 100) / 100;
}

export async function searchUsdaFood(food) {
  if (!process.env.USDA_API_KEY) {
    throw new Error('USDA_API_KEY is not configured');
  }

  const response = await axios.get(USDA_SEARCH_URL, {
    params: {
      api_key: process.env.USDA_API_KEY,
      query: food.food_name,
      pageSize: 1,
    },
    timeout: 12000,
  });

  const bestMatch = response.data?.foods?.[0] ?? null;
  const scale = servingScale(food.estimated_quantity, food.unit);

  if (!bestMatch) {
    return {
      food_name: food.food_name,
      usda_fdc_id: null,
      serving_qty: food.estimated_quantity,
      serving_unit: food.unit,
      calories: 0,
      protein_g: 0,
      carbs_g: 0,
      fat_g: 0,
      confidence: food.confidence,
      usda_match: null,
    };
  }

  const calories = findNutrient(bestMatch, ['energy', '208']);
  const protein = findNutrient(bestMatch, ['protein', '203']);
  const carbs = findNutrient(bestMatch, ['carbohydrate, by difference', 'carbohydrate', '205']);
  const fat = findNutrient(bestMatch, ['total lipid', 'fat', '204']);

  return {
    food_name: food.food_name,
    usda_fdc_id: bestMatch.fdcId ?? null,
    serving_qty: food.estimated_quantity,
    serving_unit: food.unit,
    calories: roundMacro(calories * scale),
    protein_g: roundMacro(protein * scale),
    carbs_g: roundMacro(carbs * scale),
    fat_g: roundMacro(fat * scale),
    confidence: food.confidence,
    usda_match: {
      fdc_id: bestMatch.fdcId ?? null,
      description: bestMatch.description ?? null,
      data_type: bestMatch.dataType ?? null,
    },
  };
}

export async function enrichFoodsWithUsda(foods) {
  const results = [];

  for (const food of foods) {
    results.push(await searchUsdaFood(food));
  }

  return results;
}

export function calculateTotals(items) {
  return items.reduce(
    (totals, item) => ({
      total_calories: roundMacro(totals.total_calories + toNumber(item.calories, 0)),
      total_protein_g: roundMacro(totals.total_protein_g + toNumber(item.protein_g, 0)),
      total_carbs_g: roundMacro(totals.total_carbs_g + toNumber(item.carbs_g, 0)),
      total_fat_g: roundMacro(totals.total_fat_g + toNumber(item.fat_g, 0)),
    }),
    {
      total_calories: 0,
      total_protein_g: 0,
      total_carbs_g: 0,
      total_fat_g: 0,
    }
  );
}
