import axios from 'axios';
import OpenAI from 'openai';

const ALLOWED_MEAL_TYPES = new Set(['breakfast', 'lunch', 'dinner', 'snack']);
const USDA_SEARCH_URL = 'https://api.nal.usda.gov/fdc/v1/foods/search';
const DEFAULT_OPENAI_MODEL = 'gpt-4o-mini';
const DEFAULT_USDA_TIMEOUT_MS = 20000;
const DEFAULT_OPENAI_TIMEOUT_MS = 75000;
const NUTRITION_CALORIE_GOAL_TYPE = 'nutrition_calories';
const NUTRITION_CALORIE_GOAL_UNIT = 'kcal';
const NUTRITION_CALORIE_GOAL_SOURCE = 'system_default';

// WHO adult BMI reference range is 18.5-24.9. The kcal estimator uses
// FAO/WHO/UNU-style age/sex/weight BMR equations scaled by profile activity.
const WHO_ADULT_REFERENCE_BMI = Object.freeze({
  MIN: 18.5,
  MAX: 24.9,
});

const MIN_ADULT_BMI_AGE = 18;
const DEFAULT_PROFILE_AGE = 30;
const DEFAULT_PROFILE_GENDER = 'Other';
const DEFAULT_LIFESTYLE_TYPE = 'Lightly Active';
const CALORIE_GOAL_MIN = 800;
const CALORIE_GOAL_MAX = 6000;

const PROFILE_ACTIVITY_LEVELS = Object.freeze({
  sedentary: 1.4,
  'lightly active': 1.55,
  'moderately active': 1.7,
  active: 1.85,
  'very active': 2.0,
});

let openaiClient = null;

function readPositiveInteger(value, fallback, name) {
  const raw = value == null ? '' : String(value).trim();
  if (raw === '') {
    return fallback;
  }

  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`${name} must be a positive integer`);
  }

  return parsed;
}

export function readNutritionTimeoutConfig(env = process.env) {
  return Object.freeze({
    usdaMs: readPositiveInteger(
      env.USDA_TIMEOUT_MS,
      DEFAULT_USDA_TIMEOUT_MS,
      'USDA_TIMEOUT_MS'
    ),
    openAiMs: readPositiveInteger(
      env.OPENAI_NUTRITION_TIMEOUT_MS,
      DEFAULT_OPENAI_TIMEOUT_MS,
      'OPENAI_NUTRITION_TIMEOUT_MS'
    ),
  });
}

function normalizedNumber(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function requirePositiveNumber(value, fieldName) {
  const parsed = normalizedNumber(value);
  if (parsed == null || parsed <= 0) {
    throw new TypeError(`Valid ${fieldName} is required`);
  }

  return parsed;
}

function normalizeProfileAge(age) {
  const parsed = Number.parseInt(String(age ?? ''), 10);
  return Number.isInteger(parsed) && parsed >= 1 && parsed <= 120
    ? parsed
    : DEFAULT_PROFILE_AGE;
}

function normalizeProfileGender(gender) {
  const normalized = String(gender ?? '').trim();
  return normalized === 'Male' || normalized === 'Female'
    ? normalized
    : DEFAULT_PROFILE_GENDER;
}

function profileActivityLevel(lifestyleType) {
  const normalized = String(lifestyleType ?? DEFAULT_LIFESTYLE_TYPE)
    .trim()
    .toLowerCase();
  return PROFILE_ACTIVITY_LEVELS[normalized] ?? PROFILE_ACTIVITY_LEVELS[
    DEFAULT_LIFESTYLE_TYPE.toLowerCase()
  ];
}

function calculateStoredBmi({ heightCm, weightKg, storedBmi }) {
  const parsedBmi = normalizedNumber(storedBmi);
  if (parsedBmi != null && parsedBmi > 0) {
    return parsedBmi;
  }

  const heightM = heightCm / 100;
  return weightKg / (heightM * heightM);
}

function balancedWeightKg({ age, heightCm, weightKg, bmi }) {
  if (age < MIN_ADULT_BMI_AGE) {
    return weightKg;
  }

  const heightM = heightCm / 100;
  const referenceBmi = Math.min(
    WHO_ADULT_REFERENCE_BMI.MAX,
    Math.max(WHO_ADULT_REFERENCE_BMI.MIN, bmi)
  );
  const referenceWeightKg = referenceBmi * heightM * heightM;

  return (referenceWeightKg * 0.7) + (weightKg * 0.3);
}

function basalMetabolicRate({ age, gender, weightKg }) {
  if (gender === 'Male') {
    return maleBasalMetabolicRate(age, weightKg);
  }

  if (gender === 'Female') {
    return femaleBasalMetabolicRate(age, weightKg);
  }

  return (
    maleBasalMetabolicRate(age, weightKg) +
    femaleBasalMetabolicRate(age, weightKg)
  ) / 2;
}

function maleBasalMetabolicRate(age, weightKg) {
  if (age < 3) return (59.512 * weightKg) - 30.4;
  if (age < 10) return (22.706 * weightKg) + 504.3;
  if (age < 18) return (17.686 * weightKg) + 658.2;
  if (age < 30) return (15.057 * weightKg) + 692.2;
  if (age < 60) return (11.472 * weightKg) + 873.1;
  return (11.711 * weightKg) + 587.7;
}

function femaleBasalMetabolicRate(age, weightKg) {
  if (age < 3) return (58.317 * weightKg) - 31.1;
  if (age < 10) return (20.315 * weightKg) + 485.9;
  if (age < 18) return (13.384 * weightKg) + 692.6;
  if (age < 30) return (14.818 * weightKg) + 486.6;
  if (age < 60) return (8.126 * weightKg) + 845.6;
  return (9.082 * weightKg) + 658.5;
}

function roundCalorieGoal(value) {
  const rounded = Math.round(value / 50) * 50;
  return Math.min(CALORIE_GOAL_MAX, Math.max(CALORIE_GOAL_MIN, rounded));
}

export function calorieGoalMetadata(targetValue) {
  return {
    balanced_kcal: targetValue,
    balanced_kcal_source: 'wellness_profile',
    calculation_basis: 'age_height_weight_bmi_lifestyle',
  };
}

export function defaultCalorieGoalForProfile(profile = {}) {
  const age = normalizeProfileAge(profile.age);
  const gender = normalizeProfileGender(profile.gender);
  const heightCm = requirePositiveNumber(
    profile.height_cm ?? profile.heightCm,
    'height_cm'
  );
  const weightKg = requirePositiveNumber(
    profile.weight_kg ?? profile.weightKg,
    'weight_kg'
  );
  const bmi = calculateStoredBmi({
    heightCm,
    weightKg,
    storedBmi: profile.bmi,
  });
  const bmrWeightKg = balancedWeightKg({ age, heightCm, weightKg, bmi });
  const bmr = basalMetabolicRate({ age, gender, weightKg: bmrWeightKg });
  const activityLevel = profileActivityLevel(
    profile.lifestyle_type ?? profile.activity_level ?? profile.lifestyleType
  );

  return roundCalorieGoal(bmr * activityLevel);
}

export function defaultCalorieGoalForStoredBmi(storedBmi) {
  const bmi = requirePositiveNumber(storedBmi, 'stored BMI');

  if (bmi < WHO_ADULT_REFERENCE_BMI.MIN) return 2200;
  if (bmi < 25) return 2000;
  if (bmi < 30) return 1900;
  if (bmi < 35) return 1800;
  if (bmi < 40) return 1700;
  return 1600;
}

export async function ensureDefaultNutritionCalorieGoal({
  client,
  userId,
  profile,
  storedBmi,
}) {
  const normalizedUserId = Number(userId);
  if (!Number.isInteger(normalizedUserId) || normalizedUserId <= 0) {
    throw new TypeError('Valid user_id is required');
  }

  if (!client || typeof client.query !== 'function') {
    throw new TypeError('Database client is required');
  }

  const targetValue = profile == null
    ? defaultCalorieGoalForStoredBmi(storedBmi)
    : defaultCalorieGoalForProfile(profile);
  const metadata = calorieGoalMetadata(targetValue);
  const result = await client.query(
    `INSERT INTO user_goals (
       user_id,
       goal_type,
       target_value,
       target_text,
       unit,
       source,
       metadata
     )
     VALUES ($1, $2, $3, NULL, $4, $5, $6::jsonb)
     ON CONFLICT (user_id, goal_type)
     DO UPDATE SET
       target_value = EXCLUDED.target_value,
       target_text = EXCLUDED.target_text,
       unit = EXCLUDED.unit,
       source = EXCLUDED.source,
       metadata = EXCLUDED.metadata,
       updated_at = NOW()
     WHERE user_goals.source = EXCLUDED.source
     RETURNING goal_id`,
    [
      normalizedUserId,
      NUTRITION_CALORIE_GOAL_TYPE,
      targetValue,
      NUTRITION_CALORIE_GOAL_UNIT,
      NUTRITION_CALORIE_GOAL_SOURCE,
      JSON.stringify(metadata),
    ]
  );

  return result.rowCount > 0;
}

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
    const { openAiMs } = readNutritionTimeoutConfig();
    openaiClient = new OpenAI({
      apiKey: process.env.OPENAI_API_KEY,
      timeout: openAiMs,
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

  const { usdaMs } = readNutritionTimeoutConfig();
  const response = await axios.get(USDA_SEARCH_URL, {
    params: {
      api_key: process.env.USDA_API_KEY,
      query: food.food_name,
      pageSize: 1,
    },
    timeout: usdaMs,
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
