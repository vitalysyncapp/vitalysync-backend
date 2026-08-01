import db from '../config/db.js';

const DEFAULT_READINESS_TIMEOUT_MS = 5000;

export async function checkReadiness({
  database = db,
  timeoutMs = Number(process.env.READINESS_TIMEOUT_MS),
} = {}) {
  const queryTimeout = Number.isFinite(timeoutMs) && timeoutMs > 0
    ? timeoutMs
    : DEFAULT_READINESS_TIMEOUT_MS;

  try {
    await database.query({
      text: 'SELECT 1',
      query_timeout: queryTimeout,
    });
    return true;
  } catch (_error) {
    return false;
  }
}
