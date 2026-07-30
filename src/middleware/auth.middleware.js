import pool from '../config/db.js';
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

export function getAuthenticatedUserId(req) {
  return parsePositiveInt(req.auth?.sub);
}

function findRequestedUserIds(req) {
  const candidates = [
    req.params?.userId,
    req.params?.user_id,
    req.query?.user_id,
    req.body?.user_id
  ];
  const requestedUserIds = [];

  for (const candidate of candidates) {
    const parsed = parsePositiveInt(candidate);
    if (parsed) {
      requestedUserIds.push(parsed);
    }
  }

  return [...new Set(requestedUserIds)];
}

export async function validateTokenVersion(payload, { db = pool, lookup } = {}) {
  const userId = parsePositiveInt(payload?.sub);
  if (!userId) {
    return false;
  }

  if (typeof lookup === 'function') {
    const version = await lookup(userId);
    return Number(version) === Number(payload.ver ?? 0);
  }

  const result = await db.query(
    `SELECT auth_token_version
     FROM users
     WHERE user_id = $1`,
    [userId],
  );
  const user = result.rows[0];
  return user != null && Number(user.auth_token_version ?? 0) === Number(payload.ver ?? 0);
}

async function authenticateToken(req, res, next, { optional }) {
  const token = extractBearerToken(req);

  if (!token) {
    if (optional) {
      return next();
    }
    return res.status(401).json({ message: 'Authentication token required' });
  }

  let payload;
  try {
    payload = verifyAccessToken(token);
  } catch (_error) {
    return res.status(401).json({ message: 'Invalid or expired authentication token' });
  }

  try {
    const validVersion = await validateTokenVersion(payload, {
      lookup: req.app?.locals?.authTokenVersionLookup,
    });
    if (!validVersion) {
      return res.status(401).json({ message: 'Invalid or expired authentication token' });
    }
  } catch (error) {
    return next(error);
  }

  req.auth = payload;
  return next();
}

export function requireAuth(req, res, next) {
  return authenticateToken(req, res, next, { optional: false });
}

export function optionalAuth(req, res, next) {
  return authenticateToken(req, res, next, { optional: true });
}

export function enforceAuthenticatedUser(req, res, next) {
  const authenticatedUserId = getAuthenticatedUserId(req);
  const requestedUserIds = findRequestedUserIds(req);

  if (requestedUserIds.length > 0 && !authenticatedUserId) {
    return res.status(401).json({ message: 'Authentication token required' });
  }

  if (requestedUserIds.some((userId) => userId !== authenticatedUserId)) {
    return res.status(403).json({
      message: 'Authenticated user does not match requested user'
    });
  }

  if (authenticatedUserId) {
    req.authenticatedUserId = authenticatedUserId;
    const contentType = String(req.headers['content-type'] ?? '').toLowerCase();
    const canInjectBodyUser =
      !contentType.startsWith('multipart/') &&
      !['GET', 'HEAD', 'OPTIONS'].includes(req.method);

    if (req.query && req.query.user_id == null) {
      req.query.user_id = String(authenticatedUserId);
    }

    if (
      canInjectBodyUser &&
      req.body &&
      typeof req.body === 'object' &&
      !Buffer.isBuffer(req.body) &&
      req.body.user_id == null
    ) {
      req.body.user_id = authenticatedUserId;
    }
  }

  return next();
}

export function requireMatchingParamUser(paramName = 'userId') {
  return (req, res, next) => {
    const requestedUserId = parsePositiveInt(req.params?.[paramName]);

    if (!requestedUserId) {
      return res.status(400).json({ message: 'Valid user_id is required' });
    }

    if (requestedUserId !== getAuthenticatedUserId(req)) {
      return res.status(403).json({
        message: 'Authenticated user does not match requested user'
      });
    }

    return next();
  };
}
