export function validInsightDate(value) {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) &&
    !Number.isNaN(Date.parse(`${value}T00:00:00Z`)) && new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value;
}

function shift(date, days) {
  const result = new Date(`${date}T12:00:00Z`);
  result.setUTCDate(result.getUTCDate() + days);
  return result.toISOString().slice(0, 10);
}
const dateKey = (value) => value instanceof Date ? value.toISOString().slice(0, 10) : String(value).slice(0, 10);
const number = (value) => value === null || value === undefined || value === '' ? null : Number.isFinite(Number(value)) ? Number(value) : null;
const rounded = (value) => Math.round(value * 10) / 10;

export async function loadPersonalInsightContext(client, userId, endDate) {
  const start = shift(endDate, -13);
  const [daily, activity, nutrition, goals] = await Promise.all([
    client.query(`SELECT log_date::text AS log_date, sleep_hours, mood_index, energy_level, hydration_liters
      FROM daily_logs WHERE user_id = $1 AND log_date BETWEEN $2 AND $3 ORDER BY log_date`, [userId, start, endDate]),
    client.query(`SELECT log_date::text AS log_date, steps, active_minutes FROM daily_activity_logs
      WHERE user_id = $1 AND log_date BETWEEN $2 AND $3 ORDER BY log_date`, [userId, start, endDate]),
    client.query(`SELECT log_date::text AS log_date, COUNT(*)::integer AS meal_count FROM nutrition_logs
      WHERE user_id = $1 AND log_date BETWEEN $2 AND $3 GROUP BY log_date ORDER BY log_date`, [userId, start, endDate]),
    client.query(`SELECT goal_type, target_value, target_text FROM user_goals WHERE user_id = $1 ORDER BY goal_type`, [userId])
  ]);
  return { end_date: endDate, daily: daily.rows, activity: activity.rows, nutrition: nutrition.rows, goals: goals.rows };
}

export function buildPersonalHighlights(data, summary = {}, profile = {}, locale = 'en') {
  const end = data.end_date;
  const start = shift(end, -6);
  const previousStart = shift(start, -7);
  const fil = locale === 'fil';
  const goalText = [profile.wellness_goal, ...(profile.wellness_goals ?? []),
    ...(data.goals ?? []).map((goal) => `${goal.goal_type} ${goal.target_text ?? ''}`)].join(' ').toLowerCase();
  function stats(rows, field, from, to, transform = (v) => v) {
    const days = new Map();
    for (const row of rows ?? []) {
      const date = dateKey(row.log_date);
      const value = number(row[field]);
      if (date >= from && date <= to && value !== null && value >= 0) days.set(date, transform(value));
    }
    const values = [...days.values()];
    return { count: values.length, average: values.length ? rounded(values.reduce((a, b) => a + b, 0) / values.length) : null };
  }
  const highlights = [];
  function metric(topic, label, rows, field, unit, goalPattern, transform) {
    const current = stats(rows, field, start, end, transform);
    const previous = stats(rows, field, previousStart, shift(start, -1), transform);
    if (!current.count) return null;
    const change = current.count >= 3 && previous.count >= 3 ? rounded(current.average - previous.average) : null;
    const observed = fil
      ? `${label}: average na ${current.average}${unit} sa ${current.count} araw na may log.`
      : `${label} averaged ${current.average}${unit} across ${current.count} recorded day${current.count === 1 ? '' : 's'}.`;
    const comparison = change === null ? '' : change === 0
      ? (fil ? ' Kapareho ng average sa nakaraang linggo.' : ' This matches the previous week’s recorded average.')
      : fil ? ` ${Math.abs(change)}${unit} na ${change > 0 ? 'mas mataas' : 'mas mababa'} sa nakaraang linggo.`
        : ` That is ${Math.abs(change)}${unit} ${change > 0 ? 'higher' : 'lower'} than the previous week.`;
    const item = { topic, label, observation: observed + comparison,
      coverage: { recorded_days: current.count, period_days: 7, previous_recorded_days: previous.count },
      value: current.average, unit, change, goal_related: goalPattern.test(goalText) };
    highlights.push(item);
    return item;
  }
  metric('sleep', fil ? 'Tulog' : 'Sleep', data.daily, 'sleep_hours', ' h', /sleep|tulog/);
  const mood = metric('mood_energy', 'Mood', data.daily, 'mood_index', '/5', /stress|focus|burnout/, (v) => v + 1);
  const energy = metric('mood_energy', fil ? 'Enerhiya' : 'Energy', data.daily, 'energy_level', '/5', /stress|focus|burnout/);
  if (mood && energy) {
    mood.label = fil ? 'Mood at enerhiya' : 'Mood & energy';
    mood.observation += ` ${energy.observation}`;
    mood.energy = { value: energy.value, coverage: energy.coverage, change: energy.change };
    highlights.splice(highlights.indexOf(energy), 1);
  }
  const movement = metric('activity', 'Daily steps', data.activity, 'steps', '', /active|activity|movement|exercise|steps/);
  if (!movement) metric('activity', fil ? 'Aktibong minuto' : 'Active minutes', data.activity, 'active_minutes', ' min', /active|activity|movement|exercise|steps/);
  metric('hydration', fil ? 'Logged na tubig' : 'Logged water', data.daily, 'hydration_liters', ' L', /habit|hydrat|water/);
  const mealDays = (data.nutrition ?? []).filter((row) => dateKey(row.log_date) >= start && dateKey(row.log_date) <= end && number(row.meal_count) > 0);
  if (mealDays.length) {
    const count = mealDays.reduce((sum, row) => sum + Number(row.meal_count), 0);
    highlights.push({ topic: 'nutrition', label: fil ? 'Meal logs' : 'Meal logging',
      observation: fil ? `${count} meals ang na-log sa ${mealDays.length} araw. Ipinapakita nito ang logging coverage, hindi ang lahat ng kinain mo.`
        : `You recorded ${count} meals across ${mealDays.length} days. This describes your logs, not everything you ate.`,
      coverage: { recorded_days: mealDays.length, period_days: 7 }, value: count, unit: 'meals', change: null,
      goal_related: /habit|nutrition|food|meal/.test(goalText) });
  }
  const score = number(summary.latest_score?.overall_score);
  const scoreDate = dateKey(summary.latest_score?.score_date ?? '');
  if (score !== null && scoreDate >= start && scoreDate <= end) {
    highlights.push({ topic: 'burnout', label: fil ? 'Check-in context' : 'Check-in context',
      observation: fil ? `${score}/100 ang pinakahuling daily wellness estimate. Isang bahagi lang ito ng iyong wellness picture.`
        : `Your latest daily wellness estimate is ${score}/100. This is one part of your wider wellness picture.`,
      coverage: { recorded_days: summary.windows?.['7_day']?.available_days ?? 1, period_days: 7 },
      value: score, unit: '/100', change: null, goal_related: /burnout/.test(goalText) });
  }
  const selected = [...highlights].sort((a, b) => Number(b.goal_related) - Number(a.goal_related) ||
    Number(b.change !== null && b.change !== 0) - Number(a.change !== null && a.change !== 0) ||
    b.coverage.recorded_days - a.coverage.recorded_days).slice(0, 3);
  return { period: { start_date: start, end_date: end, days: 7 }, highlights: selected };
}
