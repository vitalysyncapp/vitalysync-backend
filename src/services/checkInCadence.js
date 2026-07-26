const DATE_ONLY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

function parseDateOnly(value) {
  const normalized = String(value ?? '').trim();
  if (!DATE_ONLY_PATTERN.test(normalized)) {
    return null;
  }

  const date = new Date(`${normalized}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== normalized) {
    return null;
  }

  return date;
}

function normalizeWeekday(value) {
  const weekday = Number(value);
  return Number.isInteger(weekday) && weekday >= 0 && weekday <= 6
    ? weekday
    : 1;
}

function addDays(value, days) {
  const date = new Date(value.getTime());
  date.setUTCDate(date.getUTCDate() + days);
  return date;
}

function formatDateOnly(value) {
  return value.toISOString().slice(0, 10);
}

function weekdayOnOrAfter(value, weekday) {
  const targetWeekday = normalizeWeekday(weekday);
  const offset = (targetWeekday - value.getUTCDay() + 7) % 7;
  return addDays(value, offset);
}

export function calculateFirstPulseDueDate(firstLogDate, weekday) {
  const firstLog = parseDateOnly(firstLogDate);
  if (!firstLog) {
    return null;
  }

  return formatDateOnly(weekdayOnOrAfter(addDays(firstLog, 7), weekday));
}

export function calculateNextPulseDueDate(completedDate, weekday) {
  const completed = parseDateOnly(completedDate);
  if (!completed) {
    return null;
  }

  const targetWeekday = normalizeWeekday(weekday);
  const rawOffset = (targetWeekday - completed.getUTCDay() + 7) % 7;
  return formatDateOnly(addDays(completed, rawOffset === 0 ? 7 : rawOffset));
}

export function calculateUpcomingPulseDate(localDate, weekday) {
  const current = parseDateOnly(localDate);
  if (!current) {
    return null;
  }

  return formatDateOnly(weekdayOnOrAfter(current, weekday));
}

export function calculateMostRecentPulseDate(localDate, weekday) {
  const current = parseDateOnly(localDate);
  if (!current) {
    return null;
  }

  const targetWeekday = normalizeWeekday(weekday);
  const offset = (current.getUTCDay() - targetWeekday + 7) % 7;
  return formatDateOnly(addDays(current, -offset));
}
