import { verifyAccessToken } from '../services/authToken.service.js';

function extractBearerToken(req) {
  const header = String(req.headers.authorization ?? '').trim();
  const [scheme, token] = header.split(/\s+/);

  if (scheme?.toLowerCase() !== 'bearer' || !token) {
    return null;
  }

  return token;
}

function parsePositiveInt(value) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

function findRequestedUserId(req) {
  const candidates = [
    req.params?.userId,
    req.params?.user_id,
    req.query?.user_id,
    req.body?.user_id
  ];

  for (const candidate of candidates) {
    const parsed = parsePositiveInt(candidate);
    if (parsed) {
      return parsed;
    }
  }

  return null;
}

export function requireAuth(req, res, next) {
  const token = extractBearerToken(req);

  if (!token) {
    return res.status(401).json({ message: 'Authentication token required' });
  }

  try {
    req.auth = verifyAccessToken(token);
    return next();
  } catch (_error) {
    return res.status(401).json({ message: 'Invalid or expired authentication token' });
  }
}

export function optionalAuth(req, res, next) {
  const token = extractBearerToken(req);

  if (!token) {
    return next();
  }

  try {
    req.auth = verifyAccessToken(token);
    return next();
  } catch (_error) {
    return res.status(401).json({ message: 'Invalid or expired authentication token' });
  }
}

export function enforceAuthenticatedUser(req, res, next) {
  const requestedUserId = findRequestedUserId(req);

  if (requestedUserId && !req.auth?.sub) {
    return res.status(401).json({ message: 'Authentication token required' });
  }

  if (requestedUserId && requestedUserId !== req.auth?.sub) {
    return res.status(403).json({
      message: 'Authenticated user does not match requested user'
    });
  }

  return next();
}

export function requireMatchingParamUser(paramName = 'userId') {
  return (req, res, next) => {
    const requestedUserId = parsePositiveInt(req.params?.[paramName]);

    if (!requestedUserId) {
      return res.status(400).json({ message: 'Valid user_id is required' });
    }

    if (requestedUserId !== req.auth?.sub) {
      return res.status(403).json({
        message: 'Authenticated user does not match requested user'
      });
    }

    return next();
  };
}
