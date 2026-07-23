import assert from 'node:assert/strict';
import http from 'node:http';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

import express from 'express';

import app from '../src/app.js';
import { rateLimitConfig } from '../src/config/rateLimit.config.js';
import { createRateLimiters } from '../src/middleware/rateLimit.middleware.js';

const DEFAULT_TEST_POLICY = Object.freeze({
  limit: 100,
  windowMs: 60 * 1000,
});

function createTestConfig(overrides = {}) {
  const policyNames = [
    'perimeter',
    'general',
    'authBurst',
    'loginFailure',
    'signup',
    'emailVerification',
    'nutritionAnalysis',
    'aiNudge',
    'reportRefresh',
  ];

  return Object.fromEntries(
    policyNames.map((name) => [
      name,
      {
        ...DEFAULT_TEST_POLICY,
        ...overrides[name],
      },
    ])
  );
}

async function withServer(app, callback) {
  const server = http.createServer(app);

  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });

  const address = server.address();
  const baseUrl = `http://127.0.0.1:${address.port}`;

  try {
    await callback(baseUrl);
  } finally {
    server.closeAllConnections?.();
    await new Promise((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
  }
}

function userAuthFromHeader(req, _res, next) {
  const userId = Number(req.get('x-test-user'));
  if (Number.isInteger(userId) && userId > 0) {
    req.auth = { sub: userId };
  }
  next();
}

test('app configures the trusted proxy and exposes rate-limit headers', async () => {
  assert.equal(app.get('trust proxy'), rateLimitConfig.trustProxyHops);

  await withServer(app, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/health`, {
      headers: { origin: 'https://app.vitalysync.test' },
    });
    const exposedHeaders = response.headers.get('access-control-expose-headers');

    assert.equal(response.status, 200);
    assert.match(exposedHeaders ?? '', /RateLimit/);
    assert.match(exposedHeaders ?? '', /RateLimit-Policy/);
    assert.match(exposedHeaders ?? '', /Retry-After/);
  });
});

test('perimeter limits by forwarded IP while health and preflight bypass it', async () => {
  const limiters = createRateLimiters(createTestConfig({
    perimeter: { limit: 1, windowMs: 40 },
  }));
  const app = express();
  app.set('trust proxy', 1);

  app.get('/api/health', (_req, res) => res.status(200).json({ status: 'ok' }));
  app.use('/api', limiters.perimeter);
  app.options('/api/data', (_req, res) => res.sendStatus(204));
  app.get('/api/data', (_req, res) => res.status(200).json({ ok: true }));

  await withServer(app, async (baseUrl) => {
    const firstIpHeaders = { 'x-forwarded-for': '203.0.113.10' };
    const secondIpHeaders = { 'x-forwarded-for': '203.0.113.11' };

    assert.equal((await fetch(`${baseUrl}/api/health`)).status, 200);
    assert.equal((await fetch(`${baseUrl}/api/health`)).status, 200);
    assert.equal((await fetch(`${baseUrl}/api/data`, {
      method: 'OPTIONS',
      headers: firstIpHeaders,
    })).status, 204);

    const first = await fetch(`${baseUrl}/api/data`, { headers: firstIpHeaders });
    assert.equal(first.status, 200);

    const blocked = await fetch(`${baseUrl}/api/data`, { headers: firstIpHeaders });
    const blockedBody = await blocked.json();
    assert.equal(blocked.status, 429);
    assert.equal(
      blockedBody.message,
      'Too many requests. Please wait 1 second before trying again.'
    );
    assert.ok(Number.isInteger(blockedBody.retry_after_seconds));
    assert.ok(Number(blocked.headers.get('retry-after')) >= 1);
    assert.match(blocked.headers.get('ratelimit') ?? '', /perimeter/);
    assert.match(blocked.headers.get('ratelimit-policy') ?? '', /perimeter/);

    assert.equal((await fetch(`${baseUrl}/api/data`, {
      headers: secondIpHeaders,
    })).status, 200);

    await new Promise((resolve) => setTimeout(resolve, 70));
    assert.equal((await fetch(`${baseUrl}/api/data`, {
      headers: firstIpHeaders,
    })).status, 200);
  });
});

test('general API quotas isolate authenticated users', async () => {
  const limiters = createRateLimiters(createTestConfig({
    general: { limit: 2 },
  }));
  const app = express();
  app.use(userAuthFromHeader);
  app.use(limiters.general);
  app.get('/data', (_req, res) => res.status(200).json({ ok: true }));

  await withServer(app, async (baseUrl) => {
    const userOneHeaders = { 'x-test-user': '1' };
    const userTwoHeaders = { 'x-test-user': '2' };

    assert.equal((await fetch(`${baseUrl}/data`, { headers: userOneHeaders })).status, 200);
    assert.equal((await fetch(`${baseUrl}/data`, { headers: userOneHeaders })).status, 200);
    assert.equal((await fetch(`${baseUrl}/data`, { headers: userOneHeaders })).status, 429);
    assert.equal((await fetch(`${baseUrl}/data`, { headers: userTwoHeaders })).status, 200);
  });
});

test('login failures share a case-insensitive identity bucket and successes do not count', async () => {
  const limiters = createRateLimiters(createTestConfig({
    authBurst: { limit: 50 },
    loginFailure: { limit: 2 },
  }));
  const app = express();
  app.use(express.json());
  app.post(
    '/login',
    limiters.authBurst,
    limiters.loginFailure,
    (req, res) => res.status(req.body.password === 'correct' ? 200 : 401).json({})
  );

  const login = (baseUrl, email, password) => fetch(`${baseUrl}/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });

  await withServer(app, async (baseUrl) => {
    assert.equal((await login(baseUrl, 'ok@example.com', 'correct')).status, 200);
    assert.equal((await login(baseUrl, 'ok@example.com', 'correct')).status, 200);
    assert.equal((await login(baseUrl, 'ok@example.com', 'correct')).status, 200);

    assert.equal((await login(baseUrl, 'Student@Example.com', 'wrong')).status, 401);
    assert.equal((await login(baseUrl, 'student@example.com', 'wrong')).status, 401);
    assert.equal((await login(baseUrl, 'STUDENT@example.com', 'wrong')).status, 429);
    assert.equal((await login(baseUrl, 'other@example.com', 'wrong')).status, 401);
  });
});

test('signup quota stacks with the shared authentication burst quota', async () => {
  const limiters = createRateLimiters(createTestConfig({
    authBurst: { limit: 3 },
    signup: { limit: 2 },
  }));
  const app = express();

  app.post(
    '/signup',
    limiters.authBurst,
    limiters.signup,
    (_req, res) => res.status(201).json({})
  );
  app.post(
    '/login',
    limiters.authBurst,
    (_req, res) => res.status(200).json({})
  );

  await withServer(app, async (baseUrl) => {
    assert.equal((await fetch(`${baseUrl}/signup`, { method: 'POST' })).status, 201);
    assert.equal((await fetch(`${baseUrl}/signup`, { method: 'POST' })).status, 201);

    const signupBlocked = await fetch(`${baseUrl}/signup`, { method: 'POST' });
    assert.equal(signupBlocked.status, 429);
    assert.match(signupBlocked.headers.get('ratelimit') ?? '', /signup/);

    const authBurstBlocked = await fetch(`${baseUrl}/login`, { method: 'POST' });
    assert.equal(authBurstBlocked.status, 429);
    assert.match(authBurstBlocked.headers.get('ratelimit') ?? '', /auth/);
  });
});

test('costly policies are user-scoped and share only the intended AI quota', async () => {
  const limiters = createRateLimiters(createTestConfig({
    nutritionAnalysis: { limit: 1 },
    aiNudge: { limit: 2 },
    reportRefresh: { limit: 1 },
  }));
  const app = express();
  const adaptiveRouter = express.Router();
  const nutritionRouter = express.Router();

  app.use(userAuthFromHeader);
  app.use('/api', limiters.general);

  adaptiveRouter.get(
    '/nudges/recommendations',
    limiters.aiNudge,
    (_req, res) => res.status(200).json({ ok: true })
  );
  adaptiveRouter.post(
    '/insight-reports/refresh',
    limiters.reportRefresh,
    (_req, res) => res.status(200).json({ ok: true })
  );
  nutritionRouter.get(
    '/assistant-nudge',
    limiters.aiNudge,
    (_req, res) => res.status(200).json({ ok: true })
  );
  nutritionRouter.post(
    '/analyze',
    limiters.nutritionAnalysis,
    (_req, res) => res.status(200).json({ ok: true })
  );

  app.use('/api/adaptive', adaptiveRouter);
  app.use('/api/nutrition', nutritionRouter);

  await withServer(app, async (baseUrl) => {
    const userOneHeaders = { 'x-test-user': '1' };
    const userTwoHeaders = { 'x-test-user': '2' };

    assert.equal((await fetch(
      `${baseUrl}/api/adaptive/nudges/recommendations?ai=false`,
      { headers: userOneHeaders }
    )).status, 200);
    assert.equal((await fetch(
      `${baseUrl}/api/nutrition/assistant-nudge?ai=false`,
      { headers: userOneHeaders }
    )).status, 200);

    assert.equal((await fetch(
      `${baseUrl}/api/adaptive/nudges/recommendations?ai=true`,
      { headers: userOneHeaders }
    )).status, 200);
    assert.equal((await fetch(
      `${baseUrl}/api/nutrition/assistant-nudge`,
      { headers: userOneHeaders }
    )).status, 200);
    assert.equal((await fetch(
      `${baseUrl}/api/adaptive/nudges/recommendations?ai=true`,
      { headers: userOneHeaders }
    )).status, 429);
    assert.equal((await fetch(
      `${baseUrl}/api/adaptive/nudges/recommendations?ai=true`,
      { headers: userTwoHeaders }
    )).status, 200);

    const analysis = await fetch(`${baseUrl}/api/nutrition/analyze`, {
      method: 'POST',
      headers: userOneHeaders,
    });
    assert.equal(analysis.status, 200);
    assert.match(
      analysis.headers.get('ratelimit-policy') ?? '',
      /api.*nutrition-analysis|nutrition-analysis.*api/
    );
    assert.equal((await fetch(`${baseUrl}/api/nutrition/analyze`, {
      method: 'POST',
      headers: userOneHeaders,
    })).status, 429);

    assert.equal((await fetch(`${baseUrl}/api/adaptive/insight-reports/refresh`, {
      method: 'POST',
      headers: userOneHeaders,
    })).status, 200);
    assert.equal((await fetch(`${baseUrl}/api/adaptive/insight-reports/refresh`, {
      method: 'POST',
      headers: userOneHeaders,
    })).status, 429);
  });
});

test('invalid rate-limit environment values fail configuration at startup', () => {
  const configUrl = new URL(
    '../src/config/rateLimit.config.js',
    import.meta.url
  ).href;

  for (const [name, value, expectedMessage] of [
    ['RATE_LIMIT_API_MAX', '0', 'RATE_LIMIT_API_MAX must be a positive integer'],
    ['TRUST_PROXY_HOPS', '-1', 'TRUST_PROXY_HOPS must be a non-negative integer'],
  ]) {
    const result = spawnSync(
      process.execPath,
      ['--input-type=module', '--eval', `import(${JSON.stringify(configUrl)})`],
      {
        encoding: 'utf8',
        env: {
          ...process.env,
          [name]: value,
        },
      }
    );

    assert.notEqual(result.status, 0);
    assert.match(result.stderr, new RegExp(expectedMessage));
  }
});
