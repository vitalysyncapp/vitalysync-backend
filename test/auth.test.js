import assert from 'node:assert/strict';
import dns from 'node:dns/promises';
import test from 'node:test';

import bcrypt from 'bcrypt';

import pool from '../src/config/db.js';
import {
  confirmPasswordReset,
  confirmEmailVerification,
  login,
  requestPasswordReset,
  resendEmailVerification,
  showPasswordResetForm,
  signup,
  updateProfile,
} from '../src/controllers/auth.controller.js';
import {
  createAccessToken,
  verifyAccessToken,
} from '../src/services/authToken.service.js';
import { hashEmailToken } from '../src/services/authEmailToken.service.js';
import { mailService } from '../src/services/mail.service.js';
import { createMockResponse } from './controllerTestHelpers.js';

function dnsError(code) {
  const error = new Error(code);
  error.code = code;
  return error;
}

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
    res,
  );

  assert.equal(res.statusCode, 400);
  assert.match(res.body.message, /age, and gender are required/);
});

test('signup rejects malformed emails before database work', async () => {
  const res = createMockResponse();
  const originalQuery = pool.query;
  let queryCount = 0;
  pool.query = async () => {
    queryCount += 1;
    throw new Error('Database should not be queried');
  };

  try {
    await signup(
      {
        body: {
          username: 'new-user',
          email: 'new@example',
          password: 'secret123',
          age: 21,
          gender: 'Other',
        },
      },
      res,
    );

    assert.equal(res.statusCode, 400);
    assert.equal(res.body.message, 'Enter a valid email address');
    assert.equal(queryCount, 0);
  } finally {
    pool.query = originalQuery;
  }
});

test('signup rejects emails from unverifiable domains before database work', async (t) => {
  t.mock.method(dns, 'resolveMx', async () => {
    throw dnsError('ENOTFOUND');
  });
  t.mock.method(dns, 'resolve4', async () => {
    throw dnsError('ENOTFOUND');
  });
  t.mock.method(dns, 'resolve6', async () => {
    throw dnsError('ENOTFOUND');
  });

  const res = createMockResponse();
  const originalQuery = pool.query;
  let queryCount = 0;
  pool.query = async () => {
    queryCount += 1;
    throw new Error('Database should not be queried');
  };

  try {
    await signup(
      {
        body: {
          username: 'new-user',
          email: 'new@missing-domain.example',
          password: 'secret123',
          age: 21,
          gender: 'Other',
        },
      },
      res,
    );

    assert.equal(res.statusCode, 400);
    assert.equal(res.body.message, 'Email domain could not be verified');
    assert.equal(queryCount, 0);
  } finally {
    pool.query = originalQuery;
  }
});

test('signup normalizes valid email before duplicate lookup', async (t) => {
  t.mock.method(dns, 'resolveMx', async () => [{ exchange: 'mail.example.com', priority: 10 }]);

  const res = createMockResponse();
  const originalQuery = pool.query;
  let queryCount = 0;
  pool.query = async (sql, params) => {
    queryCount += 1;
    assert.match(sql, /LOWER\(email\)/);
    assert.equal(params[0], 'student@example.com');
    return { rows: [{ user_id: 1 }] };
  };

  try {
    await signup(
      {
        body: {
          username: 'new-user',
          email: '  Student@Example.COM  ',
          password: 'secret123',
          age: 21,
          gender: 'Other',
        },
      },
      res,
    );

    assert.equal(res.statusCode, 400);
    assert.equal(res.body.message, 'Email or username already exists');
    assert.equal(queryCount, 1);
  } finally {
    pool.query = originalQuery;
  }
});

test('profile update rejects malformed emails before database work', async () => {
  const res = createMockResponse();
  const originalQuery = pool.query;
  let queryCount = 0;
  pool.query = async () => {
    queryCount += 1;
    throw new Error('Database should not be queried');
  };

  try {
    await updateProfile(
      {
        body: {
          user_id: 7,
          username: 'existing-user',
          email: 'existing@example',
          age: 21,
          gender: 'Other',
          user_type: 'Student',
        },
      },
      res,
    );

    assert.equal(res.statusCode, 400);
    assert.equal(res.body.message, 'Enter a valid email address');
    assert.equal(queryCount, 0);
  } finally {
    pool.query = originalQuery;
  }
});

test('profile email changes reset verification and queue a new email', async (t) => {
  t.mock.method(dns, 'resolveMx', async () => [{ exchange: 'mail.example.com', priority: 10 }]);

  let sentMail = null;
  t.mock.method(mailService, 'sendVerificationEmail', async (message) => {
    sentMail = message;
    return { accepted: [message.to] };
  });

  const res = createMockResponse();
  const originalQuery = pool.query;

  pool.query = async (sql, params) => {
    if (sql.includes('information_schema.columns')) {
      return {
        rows: [
          {
            has_onboarding_completed: true,
            has_user_onboarding: false,
            has_user_onboarding_profiles: false,
            has_user_onboarding_answers: false,
            has_user_preferences: false,
            has_role: true,
            has_lifestyle_type: true,
            has_wellness_goal: true,
            has_age: true,
            has_gender: true,
            has_email_verified: true,
            has_email_verified_at: true,
            has_auth_email_tokens: true,
          },
        ],
      };
    }

    if (sql.includes('SELECT user_id, email')) {
      return {
        rows: [
          {
            user_id: 7,
            email: 'old@example.com',
            email_verified: true,
          },
        ],
      };
    }

    if (sql.includes('WHERE (LOWER(email) = $1 OR username = $2)')) {
      assert.equal(params[0], 'new@example.com');
      return { rows: [] };
    }

    if (sql.includes('UPDATE users') && sql.includes('RETURNING')) {
      assert.match(sql, /email_verified = FALSE/);
      assert.match(sql, /email_verified_at = NULL/);
      return {
        rows: [
          {
            user_id: 7,
            username: 'Student',
            email: 'new@example.com',
            email_verified: false,
            age: 21,
            gender: 'Other',
            role: 'Student',
            lifestyle_type: null,
            wellness_goal: null,
            onboarding_completed: false,
          },
        ],
      };
    }

    if (sql.includes('UPDATE auth_email_tokens')) {
      return { rows: [] };
    }

    if (sql.includes('INSERT INTO auth_email_tokens')) {
      return { rows: [] };
    }

    throw new Error(`Unexpected query: ${sql}`);
  };

  try {
    await updateProfile(
      {
        body: {
          user_id: 7,
          username: 'Student',
          email: 'New@Example.com',
          age: 21,
          gender: 'Other',
          user_type: 'Student',
        },
        protocol: 'https',
        get: () => 'api.vitalysync.test',
      },
      res,
    );
    await new Promise((resolve) => setImmediate(resolve));

    assert.equal(res.statusCode, 200);
    assert.equal(res.body.user.email_verified, false);
    assert.equal(sentMail.to, 'new@example.com');
  } finally {
    pool.query = originalQuery;
  }
});

test('login validates credentials before database work', async () => {
  const res = createMockResponse();

  await login({ body: { email: 'student@example.com' } }, res);

  assert.equal(res.statusCode, 400);
  assert.equal(res.body.message, 'Email and password required');
});

test('login allows unverified email accounts and exposes verification state', async () => {
  const res = createMockResponse();
  const passwordHash = await bcrypt.hash('secret123', 4);
  const originalQuery = pool.query;

  pool.query = async (sql, params) => {
    if (sql.includes('information_schema.columns')) {
      return {
        rows: [
          {
            has_onboarding_completed: true,
            has_user_onboarding: false,
            has_user_onboarding_profiles: false,
            has_user_onboarding_answers: false,
            has_user_preferences: false,
            has_role: true,
            has_lifestyle_type: true,
            has_wellness_goal: true,
            has_age: true,
            has_gender: true,
            has_email_verified: true,
            has_email_verified_at: true,
            has_auth_email_tokens: true,
          },
        ],
      };
    }

    if (sql.includes('FROM users') && sql.includes('LOWER(users.email)')) {
      assert.equal(params[0], 'student@example.com');
      return {
        rows: [
          {
            user_id: 7,
            username: 'Student',
            email: 'student@example.com',
            email_verified: false,
            age: 21,
            gender: 'Other',
            password: passwordHash,
            role: 'Student',
            lifestyle_type: null,
            wellness_goal: null,
            onboarding_completed: false,
            user_type: 'Student',
            has_onboarding_profile: false,
          },
        ],
      };
    }

    if (sql.includes('INSERT INTO user_streaks')) {
      return { rows: [] };
    }

    if (sql.includes('FROM user_streaks')) {
      return {
        rows: [
          {
            current_streak: 0,
            longest_streak: 0,
            last_logged_date: null,
          },
        ],
      };
    }

    throw new Error(`Unexpected query: ${sql}`);
  };

  try {
    await login({ body: { email: 'Student@Example.com', password: 'secret123' } }, res);

    assert.equal(res.statusCode, 200);
    assert.equal(res.body.user.email_verified, false);
    assert.ok(res.body.access_token);
  } finally {
    pool.query = originalQuery;
  }
});

test('email verification confirm consumes a token and returns JSON success', async () => {
  const res = createMockResponse();
  const originalQuery = pool.query;
  const token = 'raw-token';

  pool.query = async (sql, params) => {
    if (sql.includes('UPDATE auth_email_tokens')) {
      assert.equal(params[0], hashEmailToken(token));
      return {
        rows: [{ user_id: 7, email: 'student@example.com' }],
      };
    }

    if (sql.includes('UPDATE users')) {
      return {
        rows: [
          {
            user_id: 7,
            email: 'student@example.com',
            email_verified: true,
            email_verified_at: new Date(),
          },
        ],
      };
    }

    throw new Error(`Unexpected query: ${sql}`);
  };

  try {
    await confirmEmailVerification(
      {
        query: { token },
        accepts: () => 'json',
      },
      res,
    );

    assert.equal(res.statusCode, 200);
    assert.equal(res.body.message, 'Email verified successfully. You can return to VitalySync.');
  } finally {
    pool.query = originalQuery;
  }
});

test('email verification confirm rejects used or expired tokens', async () => {
  const res = createMockResponse();
  const originalQuery = pool.query;

  pool.query = async (sql) => {
    assert.match(sql, /UPDATE auth_email_tokens/);
    return { rows: [] };
  };

  try {
    await confirmEmailVerification(
      {
        query: { token: 'used-token' },
        accepts: () => 'json',
      },
      res,
    );

    assert.equal(res.statusCode, 400);
    assert.equal(res.body.message, 'Invalid or expired verification link');
  } finally {
    pool.query = originalQuery;
  }
});

test('resend email verification returns a generic response for missing users', async () => {
  const res = createMockResponse();
  const originalQuery = pool.query;

  pool.query = async (sql, params) => {
    if (sql.includes('information_schema.columns')) {
      return {
        rows: [
          {
            has_email_verified: true,
            has_auth_email_tokens: true,
          },
        ],
      };
    }

    if (sql.includes('FROM users')) {
      assert.equal(params[0], 'missing@example.com');
      return { rows: [] };
    }

    throw new Error(`Unexpected query: ${sql}`);
  };

  try {
    await resendEmailVerification({ body: { email: 'missing@example.com' } }, res);

    assert.equal(res.statusCode, 200);
    assert.match(res.body.message, /verification link has been sent/);
  } finally {
    pool.query = originalQuery;
  }
});

test('resend email verification queues mail for unverified accounts', async (t) => {
  let sentMail = null;
  t.mock.method(mailService, 'sendVerificationEmail', async (message) => {
    sentMail = message;
    return { accepted: [message.to] };
  });

  const res = createMockResponse();
  const originalQuery = pool.query;

  pool.query = async (sql, params) => {
    if (sql.includes('information_schema.columns')) {
      return {
        rows: [
          {
            has_email_verified: true,
            has_auth_email_tokens: true,
          },
        ],
      };
    }

    if (sql.includes('FROM users')) {
      assert.equal(params[0], 'student@example.com');
      return {
        rows: [
          {
            user_id: 7,
            username: 'Student',
            email: 'student@example.com',
            email_verified: false,
          },
        ],
      };
    }

    if (sql.includes('UPDATE auth_email_tokens')) {
      return { rows: [] };
    }

    if (sql.includes('INSERT INTO auth_email_tokens')) {
      return { rows: [] };
    }

    throw new Error(`Unexpected query: ${sql}`);
  };

  try {
    await resendEmailVerification(
      {
        body: { email: 'Student@Example.com' },
        protocol: 'https',
        get: () => 'api.vitalysync.test',
      },
      res,
    );
    await new Promise((resolve) => setImmediate(resolve));

    assert.equal(res.statusCode, 200);
    assert.equal(sentMail.to, 'student@example.com');
    assert.match(sentMail.verificationUrl, /^https:\/\/api\.vitalysync\.test\/api\/auth\/email-verification\/confirm\?token=/);
  } finally {
    pool.query = originalQuery;
  }
});

test('password reset request returns a generic response for missing users', async () => {
  const res = createMockResponse();
  const originalQuery = pool.query;

  pool.query = async (sql, params) => {
    if (sql.includes('information_schema.columns')) {
      return {
        rows: [
          {
            has_auth_email_tokens: true,
          },
        ],
      };
    }

    if (sql.includes('FROM users')) {
      assert.equal(params[0], 'missing@example.com');
      return { rows: [] };
    }

    throw new Error(`Unexpected query: ${sql}`);
  };

  try {
    await requestPasswordReset({ body: { email: 'missing@example.com' } }, res);

    assert.equal(res.statusCode, 200);
    assert.match(res.body.message, /password reset link has been sent/);
  } finally {
    pool.query = originalQuery;
  }
});

test('password reset request queues mail for existing accounts', async (t) => {
  let sentMail = null;
  t.mock.method(mailService, 'sendPasswordResetEmail', async (message) => {
    sentMail = message;
    return { accepted: [message.to] };
  });

  const res = createMockResponse();
  const originalQuery = pool.query;

  pool.query = async (sql, params) => {
    if (sql.includes('information_schema.columns')) {
      return {
        rows: [
          {
            has_auth_email_tokens: true,
          },
        ],
      };
    }

    if (sql.includes('FROM users')) {
      assert.equal(params[0], 'student@example.com');
      return {
        rows: [
          {
            user_id: 7,
            username: 'Student',
            email: 'student@example.com',
          },
        ],
      };
    }

    if (sql.includes('UPDATE auth_email_tokens')) {
      return { rows: [] };
    }

    if (sql.includes('INSERT INTO auth_email_tokens')) {
      return { rows: [] };
    }

    throw new Error(`Unexpected query: ${sql}`);
  };

  try {
    await requestPasswordReset(
      {
        body: { email: 'Student@Example.com' },
        protocol: 'https',
        get: () => 'api.vitalysync.test',
      },
      res,
    );
    await new Promise((resolve) => setImmediate(resolve));

    assert.equal(res.statusCode, 200);
    assert.equal(sentMail.to, 'student@example.com');
    assert.match(sentMail.passwordResetUrl, /^https:\/\/api\.vitalysync\.test\/api\/auth\/password-reset\/confirm\?token=/);
  } finally {
    pool.query = originalQuery;
  }
});

test('password reset form returns HTML for emailed links', async () => {
  const res = {
    statusCode: 200,
    contentType: '',
    body: '',
    status(code) {
      this.statusCode = code;
      return this;
    },
    type(value) {
      this.contentType = value;
      return this;
    },
    send(payload) {
      this.body = payload;
      return this;
    },
    json(payload) {
      this.body = payload;
      return this;
    },
  };

  await showPasswordResetForm({ query: { token: 'reset-token' }, accepts: () => 'html' }, res);

  assert.equal(res.statusCode, 200);
  assert.equal(res.contentType, 'html');
  assert.match(res.body, /Reset your password/);
  assert.match(res.body, /name="token" value="reset-token"/);
});

test('password reset confirm consumes token and updates password', async () => {
  const res = createMockResponse();
  const originalQuery = pool.query;

  pool.query = async (sql, params) => {
    if (sql.includes('UPDATE auth_email_tokens')) {
      assert.equal(params[0], hashEmailToken('reset-token'));
      assert.equal(params[1], 'password_reset');
      return {
        rows: [{ user_id: 7, email: 'student@example.com' }],
      };
    }

    if (sql.includes('UPDATE users')) {
      assert.equal(params[0], 7);
      assert.equal(params[1], 'student@example.com');
      assert.equal(await bcrypt.compare('newsecret', params[2]), true);
      return {
        rows: [{ user_id: 7, email: 'student@example.com' }],
      };
    }

    throw new Error(`Unexpected query: ${sql}`);
  };

  try {
    await confirmPasswordReset(
      {
        body: { token: 'reset-token', password: 'newsecret' },
        accepts: () => 'json',
      },
      res,
    );

    assert.equal(res.statusCode, 200);
    assert.match(res.body.message, /Password reset successfully/);
  } finally {
    pool.query = originalQuery;
  }
});

test('password reset confirm rejects used or expired tokens', async () => {
  const res = createMockResponse();
  const originalQuery = pool.query;

  pool.query = async (sql, params) => {
    if (sql.includes('UPDATE auth_email_tokens')) {
      assert.equal(params[0], hashEmailToken('expired-token'));
      assert.equal(params[1], 'password_reset');
      return { rows: [] };
    }

    throw new Error(`Unexpected query: ${sql}`);
  };

  try {
    await confirmPasswordReset(
      {
        body: { token: 'expired-token', password: 'newsecret' },
        accepts: () => 'json',
      },
      res,
    );

    assert.equal(res.statusCode, 400);
    assert.match(res.body.message, /Invalid or expired password reset link/);
  } finally {
    pool.query = originalQuery;
  }
});
