import { fetchEnvironmentSnapshot } from '../services/environment.service.js';

function parseCoordinate(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function parseOptionalUserId(value) {
  if (value == null || String(value).trim().isEmpty) {
    return null;
  }

  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

export async function getEnvironmentSnapshot(req, res) {
  const lat = parseCoordinate(req.query.lat);
  const lon = parseCoordinate(req.query.lon);
  const rawUserId = req.query.user_id;
  const userId = parseOptionalUserId(rawUserId);

  if (lat == null || lon == null) {
    return res.status(400).json({
      message: 'Valid lat and lon query parameters are required'
    });
  }

  if (rawUserId != null && userId == null) {
    return res.status(400).json({
      message: 'Valid user_id is required when provided'
    });
  }

  try {
    const snapshot = await fetchEnvironmentSnapshot({ lat, lon, userId });
    return res.status(200).json(snapshot);
  } catch (error) {
    console.error('Environment fetch error:', error.message);
    const isTimeout = String(error?.message ?? '').includes('timed out');

    return res.status(isTimeout ? 504 : 500).json({
      message: isTimeout
        ? 'Environment provider timed out. Please try again.'
        : 'Failed to fetch environment data'
    });
  }
}
