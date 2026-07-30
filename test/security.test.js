import assert from 'node:assert/strict';
import http from 'node:http';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

import cors from 'cors';
import express from 'express';

import app from '../src/app.js';
import { createCorsOptions } from '../src/config/cors.config.js';
import {
  enforceAuthenticatedUser,
  requireAuth,
  validateTokenVersion,
} from '../src/middleware/auth.middleware.js';
import { createAccessToken } from '../src/services/authToken.service.js';

app.locals.authTokenVersionLookup = async () => 0;

async function withServer(serverApp, callback) {
  const server = http.createServer(serverApp);

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

function bearerFor(userId, authTokenVersion = 0) {
  const token = createAccessToken({
    user_id: userId,
    auth_token_version: authTokenVersion,
  });
  return `Bearer ${token.access_token}`;
}

test('app sends security headers and request ids', async () => {
  await withServer(app, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/health`);

    assert.equal(response.status, 200);
    assert.equal(response.headers.get('x-powered-by'), null);
    assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
    assert.match(response.headers.get('x-request-id') ?? '', /.+/);
  });
});

test('production CORS allows configured browser origins only', async () => {
  const corsApp = express();
  corsApp.use(cors(createCorsOptions({
    NODE_ENV: 'production',
    CORS_ALLOWED_ORIGINS: 'https://app.vitalysync.example',
  })));
  corsApp.get('/health', (_req, res) => res.status(200).json({ ok: true }));

  await withServer(corsApp, async (baseUrl) => {
    const allowed = await fetch(`${baseUrl}/health`, {
      headers: { origin: 'https://app.vitalysync.example' },
    });
    const blocked = await fetch(`${baseUrl}/health`, {
      headers: { origin: 'https://evil.example' },
    });

    assert.equal(allowed.headers.get('access-control-allow-origin'), 'https://app.vitalysync.example');
    assert.equal(blocked.headers.get('access-control-allow-origin'), null);
  });
});

test('production CORS supports explicit loopback port wildcards', async () => {
  const corsApp = express();
  corsApp.use(cors(createCorsOptions({
    NODE_ENV: 'production',
    CORS_ALLOWED_ORIGINS: [
      'https://app.vitalysync.example',
      'http://localhost:*',
      'http://127.0.0.1:*',
    ].join(','),
  })));
  corsApp.get('/health', (_req, res) => res.status(200).json({ ok: true }));

  await withServer(corsApp, async (baseUrl) => {
    const localhost = await fetch(`${baseUrl}/health`, {
      headers: { origin: 'http://localhost:57763' },
    });
    const loopbackIp = await fetch(`${baseUrl}/health`, {
      headers: { origin: 'http://127.0.0.1:61234' },
    });
    const wrongProtocol = await fetch(`${baseUrl}/health`, {
      headers: { origin: 'https://localhost:57763' },
    });
    const remoteHost = await fetch(`${baseUrl}/health`, {
      headers: { origin: 'http://evil.example:57763' },
    });

    assert.equal(localhost.headers.get('access-control-allow-origin'), 'http://localhost:57763');
    assert.equal(loopbackIp.headers.get('access-control-allow-origin'), 'http://127.0.0.1:61234');
    assert.equal(wrongProtocol.headers.get('access-control-allow-origin'), null);
    assert.equal(remoteHost.headers.get('access-control-allow-origin'), null);
  });
});

test('authenticated middleware injects token user id when the client omits it', async () => {
  const authApp = express();
  authApp.locals.authTokenVersionLookup = async () => 0;
  authApp.use(express.json());
  authApp.use(requireAuth, enforceAuthenticatedUser);
  authApp.all('/resource', (req, res) => res.status(200).json({
    authenticated_user_id: req.authenticatedUserId,
    query_user_id: req.query.user_id ?? null,
    body_user_id: req.body?.user_id ?? null,
  }));

  await withServer(authApp, async (baseUrl) => {
    const headers = { authorization: bearerFor(12) };
    const getResponse = await fetch(`${baseUrl}/resource`, { headers });
    const postResponse = await fetch(`${baseUrl}/resource`, {
      method: 'POST',
      headers: {
        ...headers,
        'content-type': 'application/json',
      },
      body: JSON.stringify({ note: 'no user id here' }),
    });

    assert.deepEqual(await getResponse.json(), {
      authenticated_user_id: 12,
      query_user_id: '12',
      body_user_id: null,
    });
    assert.deepEqual(await postResponse.json(), {
      authenticated_user_id: 12,
      query_user_id: '12',
      body_user_id: 12,
    });
  });
});

test('token-version checks accept legacy zero tokens and reject stale sessions', async () => {
  assert.equal(
    await validateTokenVersion(
      { sub: 12 },
      { lookup: async () => 0 },
    ),
    true,
  );
  assert.equal(
    await validateTokenVersion(
      { sub: 12, ver: 1 },
      { lookup: async () => 2 },
    ),
    false,
  );
  assert.equal(
    await validateTokenVersion(
      { sub: 99, ver: 0 },
      { db: { query: async () => ({ rows: [] }) } },
    ),
    false,
  );
  assert.equal(
    await validateTokenVersion(
      { sub: 12, ver: 2 },
      {
        db: {
          query: async () => ({
            rows: [{
              auth_token_version: 2,
              deactivated_at: new Date(),
            }],
          }),
        },
      },
    ),
    false,
  );
  await assert.rejects(
    validateTokenVersion(
      { sub: 12, ver: 0 },
      { db: { query: async () => { throw new Error('database unavailable'); } } },
    ),
    /database unavailable/,
  );
});

test('authenticated API rejects missing, invalid, and mismatched users', async () => {
  await withServer(app, async (baseUrl) => {
    const missing = await fetch(`${baseUrl}/api/logs/latest`);
    const invalid = await fetch(`${baseUrl}/api/logs/latest`, {
      headers: { authorization: 'Bearer not-a-real-token' },
    });

    assert.equal(missing.status, 401);
    assert.equal(invalid.status, 401);

    const authorization = bearerFor(1);
    const cases = [
      ['/api/logs/latest?user_id=2', 'GET'],
      ['/api/nutrition/daily?user_id=2&date=2026-07-19', 'GET'],
      ['/api/burnout/scores/latest?user_id=2', 'GET'],
      ['/api/goals/2', 'GET'],
      ['/api/activity/today/2?date=2026-07-19', 'GET'],
      ['/api/adaptive/reminders?user_id=2', 'GET'],
      ['/api/profile/2', 'GET'],
      ['/api/streaks/2', 'GET'],
    ];

    for (const [path, method] of cases) {
      const response = await fetch(`${baseUrl}${path}`, {
        method,
        headers: { authorization },
      });
      assert.equal(response.status, 403, path);
    }
  });
});

test('multipart nutrition upload rejects fake images and parsed user mismatches', async () => {
  await withServer(app, async (baseUrl) => {
    const headers = { authorization: bearerFor(1) };
    const fakeImage = new FormData();
    fakeImage.set('user_id', '1');
    fakeImage.set('meal_type', 'breakfast');
    fakeImage.set('log_date', '2026-07-19');
    fakeImage.set('image', new Blob(['not an image'], { type: 'image/png' }), 'meal.png');

    const fakeImageResponse = await fetch(`${baseUrl}/api/nutrition/analyze`, {
      method: 'POST',
      headers,
      body: fakeImage,
    });
    assert.equal(fakeImageResponse.status, 400);

    const validPng = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
      'base64'
    );
    const mismatchedUser = new FormData();
    mismatchedUser.set('user_id', '2');
    mismatchedUser.set('meal_type', 'breakfast');
    mismatchedUser.set('log_date', '2026-07-19');
    mismatchedUser.set(
      'image',
      new Blob([validPng], { type: 'application/octet-stream' }),
      'meal.png'
    );

    const mismatchResponse = await fetch(`${baseUrl}/api/nutrition/analyze`, {
      method: 'POST',
      headers,
      body: mismatchedUser,
    });
    assert.equal(mismatchResponse.status, 403);

    const heicImage = Uint8Array.from([
      0x00, 0x00, 0x00, 0x18,
      0x66, 0x74, 0x79, 0x70,
      0x68, 0x65, 0x69, 0x63,
    ]);
    const unsupportedImage = new FormData();
    unsupportedImage.set('user_id', '1');
    unsupportedImage.set('meal_type', 'breakfast');
    unsupportedImage.set('log_date', '2026-07-19');
    unsupportedImage.set(
      'image',
      new Blob([heicImage], { type: 'image/heic' }),
      'meal.heic'
    );

    const unsupportedResponse = await fetch(
      `${baseUrl}/api/nutrition/analyze`,
      { method: 'POST', headers, body: unsupportedImage }
    );
    assert.equal(unsupportedResponse.status, 415);
    assert.deepEqual(await unsupportedResponse.json(), {
      message: 'Use a JPEG, PNG, or WebP food photo',
    });
  });
});

test('multipart nutrition upload rejects oversized food photos clearly', async () => {
  await withServer(app, async (baseUrl) => {
    const form = new FormData();
    form.set('user_id', '1');
    form.set('meal_type', 'lunch');
    form.set('log_date', '2026-07-19');
    form.set(
      'image',
      new Blob([new Uint8Array((8 * 1024 * 1024) + 1)], {
        type: 'image/jpeg',
      }),
      'large-meal.jpg'
    );

    const response = await fetch(`${baseUrl}/api/nutrition/analyze`, {
      method: 'POST',
      headers: { authorization: bearerFor(1) },
      body: form,
    });

    assert.equal(response.status, 413);
    assert.deepEqual(await response.json(), {
      message: 'Food photo must be smaller than 8 MB',
    });
  });
});

test('oversized JSON bodies fail before auth controller work', async () => {
  await withServer(app, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        email: 'student@example.com',
        password: 'x'.repeat(110 * 1024),
      }),
    });

    assert.equal(response.status, 413);
    assert.deepEqual(await response.json(), {
      message: 'Request body is too large',
    });
  });
});

test('production token secret must be strong', () => {
  const tokenServiceUrl = new URL(
    '../src/services/authToken.service.js',
    import.meta.url
  ).href;
  const result = spawnSync(
    process.execPath,
    [
      '--input-type=module',
      '--eval',
      `import(${JSON.stringify(tokenServiceUrl)}).then(({ createAccessToken }) => createAccessToken({ user_id: 1 }))`,
    ],
    {
      encoding: 'utf8',
      env: {
        ...process.env,
        NODE_ENV: 'production',
        AUTH_TOKEN_SECRET: 'short',
      },
    }
  );

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /AUTH_TOKEN_SECRET must be at least 32 characters/);
});
