import crypto from 'crypto';

const TOKEN_VERSION = 'VS1';
const REACTIVATION_TOKEN_VERSION = 'VS-REACTIVATE1';
const DEFAULT_EXPIRES_IN_SECONDS = 60 * 60 * 24 * 90;
const DEFAULT_REACTIVATION_GRANT_TTL_MINUTES = 10;
const MIN_PRODUCTION_SECRET_LENGTH = 32;

function base64UrlEncode(value) {
  return Buffer.from(value)
    .toString('base64')
    .replaceAll('+', '-')
    .replaceAll('/', '_')
    .replaceAll('=', '');
}

function base64UrlDecode(value) {
  const padded = value.padEnd(value.length + ((4 - (value.length % 4)) % 4), '=');
  return Buffer.from(
    padded.replaceAll('-', '+').replaceAll('_', '/'),
    'base64'
  ).toString('utf8');
}

function getTokenSecret() {
  const secret = String(process.env.AUTH_TOKEN_SECRET ?? '').trim();

  if (secret) {
    if (
      process.env.NODE_ENV === 'production' &&
      (
        secret.length < MIN_PRODUCTION_SECRET_LENGTH ||
        secret === 'replace-with-a-long-random-secret'
      )
    ) {
      throw new Error(
        `AUTH_TOKEN_SECRET must be at least ${MIN_PRODUCTION_SECRET_LENGTH} characters in production`
      );
    }

    return secret;
  }

  if (process.env.NODE_ENV === 'production') {
    throw new Error('AUTH_TOKEN_SECRET is required in production');
  }

  return 'vitalysync-local-development-token-secret';
}

function sign(unsignedToken) {
  return crypto
    .createHmac('sha256', getTokenSecret())
    .update(unsignedToken)
    .digest('base64')
    .replaceAll('+', '-')
    .replaceAll('/', '_')
    .replaceAll('=', '');
}

function signedToken(header, payload) {
  const encodedHeader = base64UrlEncode(JSON.stringify(header));
  const encodedPayload = base64UrlEncode(JSON.stringify(payload));
  const unsignedToken = `${encodedHeader}.${encodedPayload}`;
  return `${unsignedToken}.${sign(unsignedToken)}`;
}

function readSignedToken(token) {
  const parts = String(token ?? '').split('.');
  if (parts.length !== 3) {
    throw new Error('Invalid signed token');
  }

  const [encodedHeader, encodedPayload, signature] = parts;
  const unsignedToken = `${encodedHeader}.${encodedPayload}`;
  const expectedSignature = sign(unsignedToken);
  const signatureBuffer = Buffer.from(signature);
  const expectedBuffer = Buffer.from(expectedSignature);
  if (
    signatureBuffer.length !== expectedBuffer.length ||
    !crypto.timingSafeEqual(signatureBuffer, expectedBuffer)
  ) {
    throw new Error('Invalid signed token signature');
  }

  return {
    header: JSON.parse(base64UrlDecode(encodedHeader)),
    payload: JSON.parse(base64UrlDecode(encodedPayload)),
  };
}

export function createAccessToken(user) {
  const now = Math.floor(Date.now() / 1000);
  const configuredExpiresIn = Number(process.env.AUTH_TOKEN_TTL_SECONDS);
  const expiresIn =
    Number.isInteger(configuredExpiresIn) && configuredExpiresIn > 0
      ? configuredExpiresIn
      : DEFAULT_EXPIRES_IN_SECONDS;
  const header = {
    alg: 'HS256',
    typ: TOKEN_VERSION
  };
  const payload = {
    sub: Number(user.user_id),
    ver: Number.isInteger(Number(user.auth_token_version))
      ? Number(user.auth_token_version)
      : 0,
    iat: now,
    exp: now + expiresIn
  };
  return {
    access_token: signedToken(header, payload),
    token_type: 'Bearer',
    expires_at: new Date(payload.exp * 1000).toISOString()
  };
}

export function verifyAccessToken(token) {
  let decoded;
  try {
    decoded = readSignedToken(token);
  } catch (_error) {
    throw new Error('Invalid access token');
  }
  const { header, payload } = decoded;
  const now = Math.floor(Date.now() / 1000);

  if (header.typ !== TOKEN_VERSION || header.alg !== 'HS256') {
    throw new Error('Unsupported access token');
  }

  if (!Number.isInteger(payload.sub) || payload.sub <= 0) {
    throw new Error('Invalid access token subject');
  }

  if (payload.ver == null) {
    payload.ver = 0;
  }

  if (!Number.isInteger(payload.ver) || payload.ver < 0) {
    throw new Error('Invalid access token version');
  }

  if (!Number.isInteger(payload.exp) || payload.exp <= now) {
    throw new Error('Access token expired');
  }

  return payload;
}

export function createAccountReactivationGrant(user, { now = new Date() } = {}) {
  const issuedAt = Math.floor(now.getTime() / 1000);
  const configuredTtl = Number(process.env.ACCOUNT_REACTIVATION_GRANT_TTL_MINUTES);
  const ttlMinutes = Number.isInteger(configuredTtl) && configuredTtl > 0
    ? configuredTtl
    : DEFAULT_REACTIVATION_GRANT_TTL_MINUTES;
  const payload = {
    sub: Number(user.user_id),
    ver: Number(user.auth_token_version ?? 0),
    purpose: 'account_reactivation',
    iat: issuedAt,
    exp: issuedAt + ttlMinutes * 60,
  };
  const header = { alg: 'HS256', typ: REACTIVATION_TOKEN_VERSION };
  return {
    reactivation_token: signedToken(header, payload),
    expires_at: new Date(payload.exp * 1000).toISOString(),
  };
}

export function verifyAccountReactivationGrant(token, { now = new Date() } = {}) {
  const { header, payload } = readSignedToken(token);
  const nowSeconds = Math.floor(now.getTime() / 1000);
  if (
    header.typ !== REACTIVATION_TOKEN_VERSION ||
    header.alg !== 'HS256' ||
    payload.purpose !== 'account_reactivation' ||
    !Number.isInteger(payload.sub) ||
    payload.sub <= 0 ||
    !Number.isInteger(payload.ver) ||
    payload.ver < 0 ||
    !Number.isInteger(payload.exp) ||
    payload.exp <= nowSeconds
  ) {
    throw new Error('Invalid or expired account reactivation grant');
  }
  return payload;
}
