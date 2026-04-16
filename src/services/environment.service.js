const OPENWEATHER_BASE_URL = 'https://api.openweathermap.org/data/2.5';

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
  const response = await fetch(url);

  if (!response.ok) {
    throw new Error(`OpenWeather request failed with status ${response.status}`);
  }

  return response.json();
}

function toNumber(value, fallback = 0) {
  return Number.isFinite(Number(value)) ? Number(value) : fallback;
}

export async function fetchEnvironmentSnapshot({ lat, lon }) {
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

  return {
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
}
