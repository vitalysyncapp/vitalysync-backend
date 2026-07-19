const CORS_EXPOSED_HEADERS = [
  'RateLimit',
  'RateLimit-Policy',
  'Retry-After',
  'X-Request-Id',
];

function parseAllowedOrigins(value) {
  return String(value ?? '')
    .split(',')
    .map((origin) => origin.trim())
    .filter((origin) => origin.length > 0);
}

export function createCorsOptions(env = process.env) {
  const allowedOrigins = parseAllowedOrigins(env.CORS_ALLOWED_ORIGINS);
  const isProduction = env.NODE_ENV === 'production';

  return {
    exposedHeaders: CORS_EXPOSED_HEADERS,
    origin(origin, callback) {
      if (!origin) {
        return callback(null, true);
      }

      if (allowedOrigins.includes(origin)) {
        return callback(null, true);
      }

      return callback(null, !isProduction && allowedOrigins.length === 0);
    },
  };
}
