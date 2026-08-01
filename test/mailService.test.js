import assert from 'node:assert/strict';
import test from 'node:test';

import axios from 'axios';

import { mailService } from '../src/services/mail.service.js';

async function withEnv(values, callback) {
  const previous = new Map();

  for (const key of Object.keys(values)) {
    previous.set(key, process.env[key]);
    const value = values[key];
    if (value == null) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }

  try {
    return await callback();
  } finally {
    for (const [key, value] of previous.entries()) {
      if (value == null) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  }
}

test('mail service sends auth emails through the Brevo HTTPS API when configured', async (t) => {
  let request = null;
  t.mock.method(axios, 'post', async (...args) => {
    request = args;
    return { data: { messageId: '<202608011200.abc@example>' } };
  });

  const result = await withEnv(
    {
      BREVO_API_KEY: 'xkeysib-test-key',
      SMTP_FROM: 'VitalySync <no-reply@vitalysync.xyz>',
      SMTP_HOST: 'smtp-relay.brevo.com',
      SMTP_PORT: '587',
      SMTP_SECURE: 'false',
    },
    () => mailService.sendVerificationEmail({
      to: 'student@example.com',
      username: 'Student',
      verificationCode: '123456',
    }),
  );

  assert.equal(result.provider, 'brevo-api');
  assert.deepEqual(result.accepted, ['student@example.com']);
  assert.equal(result.messageId, '<202608011200.abc@example>');

  assert.ok(request);
  const [url, body, options] = request;
  assert.equal(url, 'https://api.brevo.com/v3/smtp/email');
  assert.deepEqual(body.sender, {
    name: 'VitalySync',
    email: 'no-reply@vitalysync.xyz',
  });
  assert.deepEqual(body.to, [{ email: 'student@example.com' }]);
  assert.equal(body.subject, 'Verify your VitalySync email');
  assert.match(body.textContent, /123456/);
  assert.match(body.htmlContent, /123456/);
  assert.equal(options.headers['api-key'], 'xkeysib-test-key');
  assert.equal(options.timeout, 15000);
});

test('mail service exposes Brevo API status codes in delivery errors', async (t) => {
  const apiError = new Error('Unauthorized');
  apiError.response = { status: 401 };
  t.mock.method(axios, 'post', async () => {
    throw apiError;
  });

  await assert.rejects(
    () => withEnv(
      {
        BREVO_API_KEY: 'xkeysib-test-key',
        SMTP_FROM: 'VitalySync <no-reply@vitalysync.xyz>',
      },
      () => mailService.sendPasswordResetEmail({
        to: 'student@example.com',
        username: 'Student',
        resetCode: '654321',
      }),
    ),
    {
      message: 'Brevo email API request failed',
      code: 'BREVO_API_401',
    },
  );
});
