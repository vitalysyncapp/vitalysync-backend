import assert from 'node:assert/strict';
import test from 'node:test';

import { login, signup } from '../src/controllers/auth.controller.js';
import {
  createAccessToken,
  verifyAccessToken,
} from '../src/services/authToken.service.js';
import { createMockResponse } from './controllerTestHelpers.js';

test('auth tokens round-trip signed user identity', () => {
  const token = createAccessToken({
    user_id: 42,
    email: 'student@example.com',
    username: 'student',
  });

  const payload = verifyAccessToken(token.access_token);

  assert.equal(payload.sub, 42);
  assert.equal(payload.email, undefined);
  assert.equal(payload.username, undefined);
  assert.equal(typeof payload.iat, 'number');
  assert.equal(typeof payload.exp, 'number');
});

test('auth token verification rejects tampered tokens', () => {
  const token = createAccessToken({
    user_id: 7,
    email: 'tester@example.com',
    username: 'tester',
  });
  const tampered = `${token.access_token.slice(0, -1)}x`;

  assert.throws(() => verifyAccessToken(tampered), /Invalid access token/);
});

test('signup validates required account fields before database work', async () => {
  const res = createMockResponse();

  await signup(
    {
      body: {
        username: 'new-user',
        email: 'new@example.com',
        password: 'secret123',
      },
    },
    res
  );

  assert.equal(res.statusCode, 400);
  assert.match(res.body.message, /age, and gender are required/);
});

test('login validates credentials before database work', async () => {
  const res = createMockResponse();

  await login({ body: { email: 'student@example.com' } }, res);

  assert.equal(res.statusCode, 400);
  assert.equal(res.body.message, 'Email and password required');
});
