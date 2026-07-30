import assert from 'node:assert/strict';
import dns from 'node:dns/promises';
import test from 'node:test';

import bcrypt from 'bcrypt';

import pool from '../src/config/db.js';
import {
  changePassword,
  confirmPasswordReset,
  confirmEmailVerification,
  login,
  requestPasswordReset,
  resendEmailVerification,
  signup,
  updateProfile,
  verifyPasswordResetCode,
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

async function waitFor(predicate, timeoutMs = 1500) {
  const startedAt = Date.now();
  while (!predicate()) {
    if (Date.now() - startedAt > timeoutMs) {
      throw new Error('Timed out waiting for asynchronous mail work');
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

test('auth tokens round-trip signed user identity', () => {
  const token = createAccessToken({
    user_id: 42,
    email: 'student@example.com',
    username: 'student',
  });

  const payload = verifyAccessToken(token.access_token);

  assert.equal(payload.sub, 42);
  assert.equal(payload.ver, 0);
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
  const originalConnect = pool.connect;

  pool.connect = async () => ({
    async query() {
      return { rows: [] };
    },
    release() {},
  });

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
    await waitFor(() => sentMail != null);

    assert.equal(res.statusCode, 200);
    assert.equal(res.body.user.email_verified, false);
    assert.equal(sentMail.to, 'new@example.com');
  } finally {
    pool.query = originalQuery;
    pool.connect = originalConnect;
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

test('login challenges eligible deactivated accounts and blocks expired reactivation', async () => {
  const passwordHash = await bcrypt.hash('secret123', 4);
  const originalQuery = pool.query;
  let reactivationDeadline = new Date(Date.now() + 24 * 60 * 60 * 1000);

  pool.query = async (sql) => {
    if (sql.includes('information_schema.columns')) {
      return {
        rows: [{
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
        }],
      };
    }
    if (sql.includes('FROM users') && sql.includes('LOWER(users.email)')) {
      return {
        rows: [{
          user_id: 7,
          username: 'Student',
          email: 'student@example.com',
          password: passwordHash,
          auth_token_version: 4,
          deactivated_at: new Date(),
          reactivation_deadline: reactivationDeadline,
          retention_expires_at: new Date('2031-07-30T00:00:00.000Z'),
        }],
      };
    }
    throw new Error(`Unexpected query: ${sql}`);
  };

  try {
    const eligible = createMockResponse();
    await login(
      { body: { email: 'student@example.com', password: 'secret123' } },
      eligible,
    );
    assert.equal(eligible.statusCode, 423);
    assert.equal(eligible.body.code, 'ACCOUNT_REACTIVATION_REQUIRED');
    assert.ok(eligible.body.reactivation_token);

    reactivationDeadline = new Date(Date.now() - 1000);
    const expired = createMockResponse();
    await login(
      { body: { email: 'student@example.com', password: 'secret123' } },
      expired,
    );
    assert.equal(expired.statusCode, 423);
    assert.equal(expired.body.code, 'ACCOUNT_REACTIVATION_EXPIRED');
    assert.equal(expired.body.reactivation_token, undefined);
  } finally {
    pool.query = originalQuery;
  }
});

test('password reset lookup excludes accounts beyond reactivation deadline', async () => {
  const originalQuery = pool.query;
  let lifecycleFilterSeen = false;
  pool.query = async (sql) => {
    if (sql.includes('information_schema.columns')) {
      return { rows: [{ has_auth_email_tokens: true }] };
    }
    if (sql.includes('FROM users') && sql.includes('LOWER(email)')) {
      lifecycleFilterSeen = sql.includes('reactivation_deadline > NOW()');
      return { rows: [] };
    }
    throw new Error(`Unexpected query: ${sql}`);
  };

  try {
    const res = createMockResponse();
    await requestPasswordReset(
      { body: { email: 'expired@example.com' } },
      res,
    );
    assert.equal(res.statusCode, 200);
    assert.equal(lifecycleFilterSeen, true);
  } finally {
    pool.query = originalQuery;
  }
});

test('email verification confirm consumes a code and returns JSON success', async () => {
  const res = createMockResponse();
  const code = '123456';
  const codeHash = await bcrypt.hash(code, 4);
  const originalConnect = pool.connect;

  pool.connect = async () => ({
    async query(sql) {
      if (sql.includes('SELECT token_id')) {
        return {
          rows: [{
            token_id: 11,
            user_id: 7,
            email: 'student@example.com',
            code_hash: codeHash,
          }],
        };
      }
      if (sql.includes('UPDATE users')) {
        return {
          rows: [{
            user_id: 7,
            email: 'student@example.com',
            email_verified: true,
            email_verified_at: new Date(),
          }],
        };
      }
      return { rows: [] };
    },
    release() {},
  });

  try {
    await confirmEmailVerification(
      { auth: { sub: 7 }, body: { code } },
      res,
    );

    assert.equal(res.statusCode, 200);
    assert.equal(res.body.message, 'Email verified successfully.');
    assert.equal(res.body.email_verified, true);
  } finally {
    pool.connect = originalConnect;
  }
});

test('email verification confirm rejects malformed codes', async () => {
  const res = createMockResponse();
  const originalConnect = pool.connect;

  pool.connect = async () => ({
    async query() {
      return { rows: [] };
    },
    release() {},
  });

  try {
    await confirmEmailVerification(
      { auth: { sub: 7 }, body: { code: '12x' } },
      res,
    );

    assert.equal(res.statusCode, 400);
    assert.equal(res.body.message, 'Invalid or expired verification code');
  } finally {
    pool.connect = originalConnect;
  }
});

test('resend email verification queues a six-digit code for the authenticated user', async (t) => {
  let sentMail = null;
  t.mock.method(mailService, 'sendVerificationEmail', async (message) => {
    sentMail = message;
    return { accepted: [message.to] };
  });

  const res = createMockResponse();
  const originalQuery = pool.query;
  const originalConnect = pool.connect;

  pool.query = async (sql, params) => {
    if (sql.includes('information_schema.columns')) {
      return {
        rows: [{
          has_email_verified: true,
          has_auth_email_tokens: true,
        }],
      };
    }
    if (sql.includes('FROM users')) {
      assert.equal(params[0], 7);
      return {
        rows: [{
          user_id: 7,
          username: 'Student',
          email: 'student@example.com',
          email_verified: false,
        }],
      };
    }
    throw new Error(`Unexpected query: ${sql}`);
  };
  pool.connect = async () => ({
    async query() {
      return { rows: [] };
    },
    release() {},
  });

  try {
    await resendEmailVerification({ auth: { sub: 7 }, body: {} }, res);
    await waitFor(() => sentMail != null);

    assert.equal(res.statusCode, 200);
    assert.equal(sentMail.to, 'student@example.com');
    assert.match(sentMail.verificationCode, /^\d{6}$/);
    assert.equal('verificationUrl' in sentMail, false);
  } finally {
    pool.query = originalQuery;
    pool.connect = originalConnect;
  }
});

test('password reset request returns a generic code response for missing users', async () => {
  const res = createMockResponse();
  const originalQuery = pool.query;

  pool.query = async (sql, params) => {
    if (sql.includes('information_schema.columns')) {
      return { rows: [{ has_auth_email_tokens: true }] };
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
    assert.match(res.body.message, /password reset code has been sent/);
  } finally {
    pool.query = originalQuery;
  }
});

test('password reset request sends a code instead of a link', async (t) => {
  let sentMail = null;
  t.mock.method(mailService, 'sendPasswordResetEmail', async (message) => {
    sentMail = message;
    return { accepted: [message.to] };
  });

  const res = createMockResponse();
  const originalQuery = pool.query;
  const originalConnect = pool.connect;

  pool.query = async (sql, params) => {
    if (sql.includes('information_schema.columns')) {
      return { rows: [{ has_auth_email_tokens: true }] };
    }
    if (sql.includes('FROM users')) {
      assert.equal(params[0], 'student@example.com');
      return {
        rows: [{ user_id: 7, username: 'Student', email: 'student@example.com' }],
      };
    }
    throw new Error(`Unexpected query: ${sql}`);
  };
  pool.connect = async () => ({
    async query() {
      return { rows: [] };
    },
    release() {},
  });

  try {
    await requestPasswordReset({ body: { email: 'Student@Example.com' } }, res);
    await waitFor(() => sentMail != null);

    assert.equal(res.statusCode, 200);
    assert.match(sentMail.resetCode, /^\d{6}$/);
    assert.equal('passwordResetUrl' in sentMail, false);
  } finally {
    pool.query = originalQuery;
    pool.connect = originalConnect;
  }
});

test('password reset code exchange returns an opaque reset grant', async () => {
  const res = createMockResponse();
  const code = '234567';
  const codeHash = await bcrypt.hash(code, 4);
  const originalConnect = pool.connect;

  pool.connect = async () => ({
    async query(sql) {
      if (sql.includes('SELECT token_id')) {
        return {
          rows: [{
            token_id: 22,
            user_id: 7,
            email: 'student@example.com',
            code_hash: codeHash,
          }],
        };
      }
      return { rows: [] };
    },
    release() {},
  });

  try {
    await verifyPasswordResetCode(
      { body: { email: 'student@example.com', code } },
      res,
    );

    assert.equal(res.statusCode, 200);
    assert.ok(res.body.reset_token.length > 20);
    assert.notEqual(res.body.reset_token, code);
    assert.ok(res.body.expires_at);
  } finally {
    pool.connect = originalConnect;
  }
});

test('password reset confirmation updates the password and revokes sessions', async () => {
  const res = createMockResponse();
  const currentHash = await bcrypt.hash('old-secret', 4);
  const originalConnect = pool.connect;

  pool.connect = async () => ({
    async query(sql, params) {
      if (sql.includes('FROM auth_email_tokens')) {
        assert.equal(params[0], hashEmailToken('reset-grant'));
        return {
          rows: [{ token_id: 33, user_id: 7, email: 'student@example.com' }],
        };
      }
      if (sql.includes('SELECT user_id, email, password')) {
        return {
          rows: [{ user_id: 7, email: 'student@example.com', password: currentHash }],
        };
      }
      if (sql.includes('UPDATE users')) {
        return {
          rows: [{ user_id: 7, email: 'student@example.com', auth_token_version: 3 }],
        };
      }
      return { rows: [] };
    },
    release() {},
  });

  try {
    await confirmPasswordReset(
      {
        body: {
          reset_token: 'reset-grant',
          new_password: 'new-secret',
          confirm_password: 'new-secret',
        },
      },
      res,
    );

    assert.equal(res.statusCode, 200);
    assert.equal(res.body.sessions_revoked, true);
  } finally {
    pool.connect = originalConnect;
  }
});

test('authenticated password change validates and revokes all sessions', async () => {
  const res = createMockResponse();
  const currentHash = await bcrypt.hash('old-secret', 4);
  const originalConnect = pool.connect;

  pool.connect = async () => ({
    async query(sql) {
      if (sql.includes('SELECT user_id, password')) {
        return { rows: [{ user_id: 7, password: currentHash }] };
      }
      if (sql.includes('UPDATE users')) {
        return { rows: [{ user_id: 7, auth_token_version: 4 }] };
      }
      return { rows: [] };
    },
    release() {},
  });

  try {
    await changePassword(
      {
        auth: { sub: 7 },
        body: {
          current_password: 'old-secret',
          new_password: 'new-secret',
          confirm_password: 'new-secret',
        },
      },
      res,
    );

    assert.equal(res.statusCode, 200);
    assert.equal(res.body.sessions_revoked, true);
  } finally {
    pool.connect = originalConnect;
  }
});
