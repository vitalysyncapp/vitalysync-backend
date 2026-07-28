const PRODUCE_PATTERN =
  /\b(fruit|apple|banana|orange|mango|berry|vegetable|salad|greens|spinach|kangkong|pechay|broccoli|carrot|tomato|beans|lentil|okra|cabbage)\b/;

function numberValue(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function normalizedSummary(summary) {
  const totals = summary?.day_totals ?? summary ?? {};
  return {
    date: String(summary?.date ?? summary?.log_date ?? ''),
    totalCalories: numberValue(
      totals.total_calories ?? totals.totalCalories
    ),
    totalProteinG: numberValue(
      totals.total_protein_g ?? totals.totalProteinG
    ),
    totalCarbsG: numberValue(totals.total_carbs_g ?? totals.totalCarbsG),
    totalFatG: numberValue(totals.total_fat_g ?? totals.totalFatG),
    meals: Array.isArray(summary?.meals) ? summary.meals : [],
    logged: summary?.logged ?? {}
  };
}

function macroShares(summary) {
  const proteinCalories = summary.totalProteinG * 4;
  const carbCalories = summary.totalCarbsG * 4;
  const fatCalories = summary.totalFatG * 9;
  const total = proteinCalories + carbCalories + fatCalories;

  if (total <= 0) {
    return { protein: 0, carbs: 0, fat: 0 };
  }

  return {
    protein: proteinCalories / total,
    carbs: carbCalories / total,
    fat: fatCalories / total
  };
}

function foodNames(summary) {
  return summary.meals
    .flatMap((meal) => (Array.isArray(meal.items) ? meal.items : []))
    .map((item) => String(item.food_name ?? item.foodName ?? '').toLowerCase())
    .join(' ');
}

function hasLongMealGap(summary) {
  const timestamps = summary.meals
    .map((meal) => new Date(meal.created_at ?? meal.createdAt ?? ''))
    .filter((date) => !Number.isNaN(date.getTime()))
    .sort((left, right) => left.getTime() - right.getTime());

  for (let index = 1; index < timestamps.length; index += 1) {
    const gapHours =
      (timestamps[index].getTime() - timestamps[index - 1].getTime()) /
      (1000 * 60 * 60);
    if (gapHours >= 7) {
      return true;
    }
  }

  return false;
}

function repeatedPattern(type, occurrences, observedDays) {
  if (occurrences < 2) {
    return null;
  }

  return {
    type,
    occurrences,
    observed_days: observedDays
  };
}

export function analyzeNutritionMealPatterns(summaries = []) {
  const days = summaries
    .slice(-7)
    .map(normalizedSummary)
    .filter((summary) => summary.meals.length > 0);
  const macroDays = days.filter((summary) => summary.totalCalories >= 200);
  const namedFoodDays = days.filter((summary) => foodNames(summary).length > 0);

  const lowProteinDays = macroDays.filter((summary) => {
    const shares = macroShares(summary);
    return shares.protein < 0.18 || summary.totalProteinG < 25;
  }).length;
  const highCarbShareDays = macroDays.filter(
    (summary) => macroShares(summary).carbs > 0.58
  ).length;
  const missingProduceDays = namedFoodDays.filter(
    (summary) => !PRODUCE_PATTERN.test(foodNames(summary))
  ).length;
  const missingBreakfastDays = days.filter((summary) => {
    if (summary.logged.breakfast === true) {
      return false;
    }
    return !summary.meals.some((meal) => meal.meal_type === 'breakfast');
  }).length;
  const irregularTimingDays = days.filter(hasLongMealGap).length;

  return {
    observed_days: days.length,
    patterns: [
      repeatedPattern('repeated_low_protein', lowProteinDays, macroDays.length),
      repeatedPattern(
        'repeated_missing_produce',
        missingProduceDays,
        namedFoodDays.length
      ),
      repeatedPattern(
        'repeated_missing_breakfast',
        missingBreakfastDays,
        days.length
      ),
      repeatedPattern(
        'repeated_high_carb_share',
        highCarbShareDays,
        macroDays.length
      ),
      repeatedPattern(
        'repeated_irregular_timing',
        irregularTimingDays,
        days.length
      )
    ].filter(Boolean)
  };
}
