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

function parseOrigin(value) {
  try {
    const url = new URL(value);

    if (url.pathname !== '/' || url.search || url.hash) {
      return null;
    }

    return url;
  } catch {
    return null;
  }
}

function isLoopbackHost(hostname) {
  const normalizedHost = hostname.toLowerCase();
  return normalizedHost === 'localhost'
    || normalizedHost === '127.0.0.1'
    || normalizedHost === '::1'
    || normalizedHost === '[::1]';
}

function isAllowedOrigin(origin, allowedOrigin) {
  if (origin === allowedOrigin) {
    return true;
  }

  if (!allowedOrigin.endsWith(':*')) {
    return false;
  }

  const wildcardOrigin = parseOrigin(allowedOrigin.slice(0, -2));
  const requestOrigin = parseOrigin(origin);

  return Boolean(
    wildcardOrigin
      && requestOrigin
      && isLoopbackHost(wildcardOrigin.hostname)
      && wildcardOrigin.protocol === requestOrigin.protocol
      && wildcardOrigin.hostname.toLowerCase() === requestOrigin.hostname.toLowerCase()
  );
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

      if (allowedOrigins.some((allowedOrigin) => isAllowedOrigin(origin, allowedOrigin))) {
        return callback(null, true);
      }

      return callback(null, !isProduction && allowedOrigins.length === 0);
    },
  };
}
