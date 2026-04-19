import pool from '../config/db.js';

const OPENWEATHER_BASE_URL = 'https://api.openweathermap.org/data/2.5';
const OPENWEATHER_TIMEOUT_MS = 8000;

const AQI_LABELS = {
  1: 'Good',
  2: 'Fair',
  3: 'Moderate',
  4: 'Poor',
  5: 'Very Poor'
};

function buildOpenWeatherUrl(path, params) {
  const url = new URL(`${OPENWEATHER_BASE_URL}${path}`);

  for (const [key, value] of Object.entries(params)) {
    url.searchParams.set(key, String(value));
  }

  return url;
}

async function fetchJson(url) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), OPENWEATHER_TIMEOUT_MS);

  let response;
  try {
    response = await fetch(url, {
      signal: controller.signal
    });
  } catch (error) {
    if (error.name === 'AbortError') {
      throw new Error(`OpenWeather request timed out after ${OPENWEATHER_TIMEOUT_MS}ms`);
    }

    throw new Error(`OpenWeather request failed: ${error.message}`);
  } finally {
    clearTimeout(timeoutId);
  }

  if (!response.ok) {
    throw new Error(`OpenWeather request failed with status ${response.status}`);
  }

  return response.json();
}

function toNumber(value, fallback = 0) {
  return Number.isFinite(Number(value)) ? Number(value) : fallback;
}

function getDayPeriod(date = new Date()) {
  const hour = date.getHours();

  if (hour >= 5 && hour < 11) {
    return 'morning';
  }

  if (hour >= 11 && hour < 17) {
    return 'noon';
  }

  return 'night';
}

function getSnapshotDate(date = new Date()) {
  return date.toISOString().slice(0, 10);
}

export async function fetchEnvironmentSnapshot({ lat, lon, userId = null }) {
  const apiKey = String(process.env.OPENWEATHER_API_KEY ?? '').trim();

  if (!apiKey) {
    throw new Error('OpenWeather API key is not configured');
  }

  const weatherUrl = buildOpenWeatherUrl('/weather', {
    lat,
    lon,
    appid: apiKey,
    units: 'metric'
  });
  const airPollutionUrl = buildOpenWeatherUrl('/air_pollution', {
    lat,
    lon,
    appid: apiKey
  });

  const [weatherData, airData] = await Promise.all([
    fetchJson(weatherUrl),
    fetchJson(airPollutionUrl)
  ]);

  const weather = Array.isArray(weatherData.weather) && weatherData.weather.length > 0
    ? weatherData.weather[0]
    : {};
  const airQuality = Array.isArray(airData.list) && airData.list.length > 0
    ? airData.list[0]
    : {};
  const aqi = toNumber(airQuality.main?.aqi, 0);

  const snapshot = {
    location: String(weatherData.name ?? 'Unknown location'),
    coordinates: {
      lat: toNumber(weatherData.coord?.lat, lat),
      lon: toNumber(weatherData.coord?.lon, lon)
    },
    weather: {
      main: String(weather.main ?? 'Unknown'),
      description: String(weather.description ?? 'No description available'),
      icon: String(weather.icon ?? ''),
      temperature_c: toNumber(weatherData.main?.temp),
      feels_like_c: toNumber(weatherData.main?.feels_like),
      humidity: toNumber(weatherData.main?.humidity),
      pressure: toNumber(weatherData.main?.pressure),
      wind_speed: toNumber(weatherData.wind?.speed)
    },
    air_quality: {
      aqi,
      aqi_label: AQI_LABELS[aqi] ?? 'Unknown',
      components: {
        pm2_5: toNumber(airQuality.components?.pm2_5),
        pm10: toNumber(airQuality.components?.pm10),
        o3: toNumber(airQuality.components?.o3),
        no2: toNumber(airQuality.components?.no2),
        so2: toNumber(airQuality.components?.so2),
        co: toNumber(airQuality.components?.co)
      }
    },
    fetched_at: new Date().toISOString()
  };

  if (Number.isInteger(userId) && userId > 0) {
    await upsertEnvironmentSnapshot({
      userId,
      snapshot
    });
  }

  return snapshot;
}

export async function upsertEnvironmentSnapshot({ userId, snapshot }) {
  const fetchedAt = new Date(snapshot.fetched_at);
  const snapshotDate = getSnapshotDate(fetchedAt);
  const dayPeriod = getDayPeriod(fetchedAt);

  await pool.query(
    `INSERT INTO user_environment_snapshots (
       user_id,
       snapshot_date,
       day_period,
       location_name,
       latitude,
       longitude,
       weather_main,
       weather_description,
       weather_icon,
       temperature_c,
       feels_like_c,
       humidity,
       pressure,
       wind_speed,
       aqi,
       aqi_label,
       pm2_5,
       pm10,
       o3,
       no2,
       so2,
       co,
       fetched_at,
       updated_at
     )
     VALUES (
       $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12,
       $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, $23, NOW()
     )
     ON CONFLICT (user_id, snapshot_date, day_period)
     DO UPDATE SET
       location_name = EXCLUDED.location_name,
       latitude = EXCLUDED.latitude,
       longitude = EXCLUDED.longitude,
       weather_main = EXCLUDED.weather_main,
       weather_description = EXCLUDED.weather_description,
       weather_icon = EXCLUDED.weather_icon,
       temperature_c = EXCLUDED.temperature_c,
       feels_like_c = EXCLUDED.feels_like_c,
       humidity = EXCLUDED.humidity,
       pressure = EXCLUDED.pressure,
       wind_speed = EXCLUDED.wind_speed,
       aqi = EXCLUDED.aqi,
       aqi_label = EXCLUDED.aqi_label,
       pm2_5 = EXCLUDED.pm2_5,
       pm10 = EXCLUDED.pm10,
       o3 = EXCLUDED.o3,
       no2 = EXCLUDED.no2,
       so2 = EXCLUDED.so2,
       co = EXCLUDED.co,
       fetched_at = EXCLUDED.fetched_at,
       updated_at = NOW()`,
    [
      userId,
      snapshotDate,
      dayPeriod,
      snapshot.location,
      snapshot.coordinates.lat,
      snapshot.coordinates.lon,
      snapshot.weather.main,
      snapshot.weather.description,
      snapshot.weather.icon,
      snapshot.weather.temperature_c,
      snapshot.weather.feels_like_c,
      snapshot.weather.humidity,
      snapshot.weather.pressure,
      snapshot.weather.wind_speed,
      snapshot.air_quality.aqi,
      snapshot.air_quality.aqi_label,
      snapshot.air_quality.components.pm2_5,
      snapshot.air_quality.components.pm10,
      snapshot.air_quality.components.o3,
      snapshot.air_quality.components.no2,
      snapshot.air_quality.components.so2,
      snapshot.air_quality.components.co,
      snapshot.fetched_at
    ]
  );
}
