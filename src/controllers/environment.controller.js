import { fetchEnvironmentSnapshot } from '../services/environment.service.js';

function parseCoordinate(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export async function getEnvironmentSnapshot(req, res) {
  const lat = parseCoordinate(req.query.lat);
  const lon = parseCoordinate(req.query.lon);

  if (lat == null || lon == null) {
    return res.status(400).json({
      message: 'Valid lat and lon query parameters are required'
    });
  }

  try {
    const snapshot = await fetchEnvironmentSnapshot({ lat, lon });
    return res.status(200).json(snapshot);
  } catch (error) {
    console.error('Environment fetch error:', error.message);
    return res.status(500).json({
      message: 'Failed to fetch environment data'
    });
  }
}
