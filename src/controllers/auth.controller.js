import bcrypt from 'bcrypt';
import pool from '../config/db.js';
import { getAuthenticatedUserId } from '../middleware/auth.middleware.js';
import { createAccessToken } from '../services/authToken.service.js';
import {
  consumeEmailVerificationCode,
  createEmailVerificationCode,
  createPasswordResetCode,
  exchangePasswordResetCode,
} from '../services/authEmailToken.service.js';
import {
  changeAuthenticatedPassword,
  resetPasswordWithGrant,
} from '../services/password.service.js';
import {
  normalizeEmail,
  validateEmailSyntax,
  validateEmailAddress,
} from '../services/emailValidation.service.js';
import { mailService } from '../services/mail.service.js';
import { logApiError } from '../utils/errorLogging.js';

let authSchemaSupportCache = null;
let authSchemaSupportFetchedAt = 0;
const AUTH_SCHEMA_CACHE_TTL_MS = 5 * 60 * 1000;
const ALLOWED_GENDERS = new Set(['Male', 'Female', 'Other']);
const RESEND_VERIFICATION_MESSAGE =
  'A verification code has been sent to your account email.';
const PASSWORD_RESET_REQUEST_MESSAGE =
  'If this email belongs to a VitalySync account, a password reset code has been sent.';
const PASSWORD_RESET_SUCCESS_MESSAGE =
  'Password reset successfully. Sign in again with your new password.';

function normalizeNullableText(value) {
  const trimmed = String(value ?? '').trim();
  return trimmed || null;
}

function normalizeOptionalAge(value) {
  const trimmed = String(value ?? '').trim();
  if (!trimmed) {
    return { value: null };
  }

  const parsedAge = Number.parseInt(trimmed, 10);
  if (!Number.isInteger(parsedAge) || parsedAge < 1 || parsedAge > 120) {
    return { error: 'Age must be a whole number between 1 and 120' };
  }

  return { value: parsedAge };
}

function normalizeOptionalGender(value) {
  const normalizedGender = normalizeNullableText(value);
  if (normalizedGender == null) {
    return { value: null };
  }

  if (!ALLOWED_GENDERS.has(normalizedGender)) {
    return { error: 'Gender must be Male, Female, or Other' };
  }

  return { value: normalizedGender };
}

function normalizeResetPassword(value) {
  const password = String(value ?? '').trim();

  if (!password) {
    return { error: 'Password is required' };
  }

  if (password.length < 6) {
    return { error: 'Password must be at least 6 characters' };
  }

  return { value: password };
}

async function getAuthSchemaSupport() {
  const now = Date.now();
  if (
    authSchemaSupportCache &&
    now - authSchemaSupportFetchedAt < AUTH_SCHEMA_CACHE_TTL_MS
  ) {
    return authSchemaSupportCache;
  }

  const result = await pool.query(`
    SELECT
      EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'users'
          AND column_name = 'onboarding_completed'
      ) AS has_onboarding_completed,
      EXISTS (
        SELECT 1
        FROM information_schema.tables
        WHERE table_schema = 'public'
          AND table_name = 'user_onboarding'
      ) AS has_user_onboarding,
      EXISTS (
        SELECT 1
        FROM information_schema.tables
        WHERE table_schema = 'public'
          AND table_name = 'user_onboarding_profiles'
      ) AS has_user_onboarding_profiles,
      EXISTS (
        SELECT 1
        FROM information_schema.tables
        WHERE table_schema = 'public'
          AND table_name = 'user_onboarding_answers'
      ) AS has_user_onboarding_answers,
      EXISTS (
        SELECT 1
        FROM information_schema.tables
        WHERE table_schema = 'public'
          AND table_name = 'user_preferences'
      ) AS has_user_preferences,
      EXISTS (
        SELECT 1
        FROM information_schema.tables
        WHERE table_schema = 'public'
          AND table_name = 'user_onboarding_profiles'
      ) AS has_user_onboarding_profiles,
      EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'users'
          AND column_name = 'role'
      ) AS has_role,
      EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'users'
          AND column_name = 'lifestyle_type'
      ) AS has_lifestyle_type,
      EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'users'
          AND column_name = 'wellness_goal'
      ) AS has_wellness_goal,
      EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'users'
          AND column_name = 'age'
      ) AS has_age,
      EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'users'
          AND column_name = 'gender'
      ) AS has_gender,
      EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'users'
          AND column_name = 'email_verified'
      ) AS has_email_verified,
      EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'users'
          AND column_name = 'email_verified_at'
      ) AS has_email_verified_at,
      EXISTS (
        SELECT 1
        FROM information_schema.tables
        WHERE table_schema = 'public'
          AND table_name = 'auth_email_tokens'
      ) AS has_auth_email_tokens
  `);

  authSchemaSupportCache = result.rows[0] ?? {
    has_onboarding_completed: false,
    has_user_onboarding: false,
    has_user_preferences: false,
    has_user_onboarding_profiles: false,
    has_role: false,
    has_lifestyle_type: false,
    has_wellness_goal: false,
    has_age: false,
    has_gender: false,
    has_email_verified: false,
    has_email_verified_at: false,
    has_auth_email_tokens: false,
  };
  authSchemaSupportFetchedAt = now;

  return authSchemaSupportCache;
}

function remainingMinutes(expiresAt) {
  return Math.max(1, Math.ceil((expiresAt.getTime() - Date.now()) / (60 * 1000)));
}

async function sendVerificationEmailForUser(user) {
  const code = await createEmailVerificationCode({
    userId: user.user_id,
    email: user.email,
  });

  await mailService.sendVerificationEmail({
    to: user.email,
    username: user.username,
    verificationCode: code.code,
    expiresInMinutes: remainingMinutes(code.expiresAt),
  });
}

async function sendPasswordResetEmailForUser(user) {
  const code = await createPasswordResetCode({
    userId: user.user_id,
    email: user.email,
  });

  await mailService.sendPasswordResetEmail({
    to: user.email,
    username: user.username,
    resetCode: code.code,
    expiresInMinutes: remainingMinutes(code.expiresAt),
  });
}

function queueVerificationEmail(req, user, schema) {
  if (
    schema.has_auth_email_tokens !== true ||
    schema.has_email_verified !== true ||
    user.email_verified === true
  ) {
    return;
  }

  sendVerificationEmailForUser(user).catch((error) => {
    logApiError(req, 'Email verification send error', error);
  });
}

function queuePasswordResetEmail(req, user, schema) {
  if (schema.has_auth_email_tokens !== true) {
    return;
  }

  sendPasswordResetEmailForUser(user).catch((error) => {
    logApiError(req, 'Password reset send error', error);
  });
}

async function ensureUserStreak(userId) {
  await pool.query(
    `INSERT INTO user_streaks (user_id)
     VALUES ($1)
     ON CONFLICT (user_id) DO NOTHING`,
    [userId],
  );

  const streakResult = await pool.query(
    `SELECT current_streak, longest_streak, last_logged_date
     FROM user_streaks
     WHERE user_id = $1`,
    [userId],
  );

  return (
    streakResult.rows[0] ?? {
      current_streak: 0,
      longest_streak: 0,
      last_logged_date: null,
    }
  );
}

function formatUserPayload(user) {
  const normalizedRole = normalizeNullableText(user.role);
  const normalizedUserType = normalizeNullableText(user.user_type) ?? normalizedRole;
  const normalizedGender = normalizeNullableText(user.gender);
  const normalizedLifestyleType = normalizeNullableText(user.lifestyle_type);
  const normalizedWellnessGoal = normalizeNullableText(user.wellness_goal);
  const age = user.age == null ? null : Number.parseInt(String(user.age), 10);

  return {
    user_id: user.user_id,
    username: user.username,
    email: user.email,
    email_verified: user.email_verified == true,
    age: Number.isInteger(age) ? age : null,
    gender: normalizedGender,
    user_type: normalizedUserType,
    role: normalizedRole ?? normalizedUserType,
    lifestyle_type: normalizedLifestyleType,
    wellness_goal: normalizedWellnessGoal,
    onboarding_completed: user.onboarding_completed == true && user.has_onboarding_profile == true,
  };
}

export async function signup(req, res) {
  try {
    const { username, email, password, age, gender } = req.body;
    const normalizedUsername = String(username ?? '').trim();
    const normalizedEmail = normalizeEmail(email);
    const normalizedPassword = String(password ?? '').trim();
    const normalizedAge = normalizeOptionalAge(age);
    const normalizedGender = normalizeOptionalGender(gender);

    if (normalizedAge.error) {
      return res.status(400).json({ message: normalizedAge.error });
    }

    if (normalizedGender.error) {
      return res.status(400).json({ message: normalizedGender.error });
    }

    // Validate required fields
    if (!normalizedUsername || !normalizedEmail || !normalizedPassword || normalizedAge.value == null || normalizedGender.value == null) {
      return res.status(400).json({
        message: 'Username, email, password, age, and gender are required',
      });
    }

    const emailValidation = await validateEmailAddress(normalizedEmail);
    if (emailValidation.error) {
      return res.status(400).json({ message: emailValidation.error });
    }

    // Check if email or username already exists
    const userCheck = await pool.query('SELECT * FROM users WHERE LOWER(email) = $1 OR username = $2', [emailValidation.email, normalizedUsername]);
    if (userCheck.rows.length > 0) {
      return res.status(400).json({ message: 'Email or username already exists' });
    }

    // Hash the password
    const hashedPassword = await bcrypt.hash(normalizedPassword, 10);
    const schema = await getAuthSchemaSupport();
    const insertColumns = ['username', 'email', 'password'];
    const insertValues = [normalizedUsername, emailValidation.email, hashedPassword];

    if (schema.has_age) {
      insertColumns.push('age');
      insertValues.push(normalizedAge.value);
    }

    if (schema.has_gender) {
      insertColumns.push('gender');
      insertValues.push(normalizedGender.value);
    }

    const valuePlaceholders = insertColumns.map((_, index) => `$${index + 1}`).join(', ');
    const ageSelect = schema.has_age ? 'age' : 'NULL::INTEGER AS age';
    const genderSelect = schema.has_gender ? 'gender' : 'NULL::TEXT AS gender';
    const roleSelect = schema.has_role ? 'role' : 'NULL::TEXT AS role';
    const lifestyleSelect = schema.has_lifestyle_type ? 'lifestyle_type' : 'NULL::TEXT AS lifestyle_type';
    const wellnessGoalSelect = schema.has_wellness_goal ? 'wellness_goal' : 'NULL::TEXT AS wellness_goal';
    const emailVerifiedSelect = schema.has_email_verified ? 'email_verified' : 'FALSE AS email_verified';

    // Insert user
    const signupQuery = `INSERT INTO users
         (${insertColumns.join(', ')})
         VALUES (${valuePlaceholders})
         RETURNING
           user_id,
           username,
           email,
           auth_token_version,
           ${emailVerifiedSelect},
           ${ageSelect},
           ${genderSelect},
           ${roleSelect},
           ${lifestyleSelect},
           ${wellnessGoalSelect},
           ${schema.has_onboarding_completed ? 'onboarding_completed' : 'FALSE AS onboarding_completed'},
           NULL::TEXT AS user_type,
           FALSE AS has_onboarding_profile`;
    const newUser = await pool.query(signupQuery, insertValues);
    queueVerificationEmail(req, newUser.rows[0], schema);

    const streak = await ensureUserStreak(newUser.rows[0].user_id);

    const token = createAccessToken(newUser.rows[0]);

    res.status(201).json({
      message: 'User created successfully',
      user: formatUserPayload(newUser.rows[0]),
      streak,
      ...token,
    });
  } catch (err) {
    logApiError(req, 'Signup error', err);
    res.status(500).json({
      message: 'Signup failed',
    });
  }
}

export async function login(req, res) {
  try {
    const { email, password } = req.body;
    const normalizedEmail = normalizeEmail(email);
    const normalizedPassword = String(password ?? '').trim();

    if (!normalizedEmail || !normalizedPassword) return res.status(400).json({ message: 'Email and password required' });

    const schema = await getAuthSchemaSupport();
    const ageSelect = schema.has_age ? 'users.age' : 'NULL::INTEGER AS age';
    const genderSelect = schema.has_gender ? 'users.gender' : 'NULL::TEXT AS gender';
    const userRoleSelect = schema.has_role ? 'users.role' : 'NULL::TEXT';
    const userLifestyleSelect = schema.has_lifestyle_type ? 'users.lifestyle_type' : 'NULL::TEXT';
    const userWellnessSelect = schema.has_wellness_goal ? 'users.wellness_goal' : 'NULL::TEXT';
    const emailVerifiedSelect = schema.has_email_verified ? 'users.email_verified' : 'FALSE AS email_verified';
    const profileJoin = schema.has_user_onboarding_profiles
      ? `LEFT JOIN user_onboarding_profiles onboarding_profile
           ON onboarding_profile.user_id = users.user_id`
      : '';
    const legacyOnboardingJoin = schema.has_user_onboarding
      ? `LEFT JOIN user_onboarding onboarding
           ON onboarding.user_id = users.user_id`
      : '';
    const profileRoleSelect = schema.has_user_onboarding_profiles ? 'onboarding_profile.role' : 'NULL::TEXT';
    const profileLifestyleSelect = schema.has_user_onboarding_profiles ? 'onboarding_profile.lifestyle_type' : 'NULL::TEXT';
    const profileWellnessSelect = schema.has_user_onboarding_profiles ? 'onboarding_profile.wellness_goal' : 'NULL::TEXT';
    const legacyRoleSelect = schema.has_user_onboarding ? 'onboarding.role_type' : 'NULL::TEXT';
    const hasProfileQuery = schema.has_user_onboarding_profiles
      ? `EXISTS (
           SELECT 1
           FROM user_onboarding_profiles profile
           WHERE profile.user_id = users.user_id
         ) AS has_onboarding_profile`
      : 'FALSE AS has_onboarding_profile';
    const loginQuery = `SELECT
         users.user_id,
         users.username,
         users.email,
         ${emailVerifiedSelect},
         ${ageSelect},
         ${genderSelect},
         users.password,
         users.auth_token_version,
         COALESCE(${profileRoleSelect}, ${userRoleSelect}) AS role,
         COALESCE(${profileLifestyleSelect}, ${userLifestyleSelect}) AS lifestyle_type,
         COALESCE(${profileWellnessSelect}, ${userWellnessSelect}) AS wellness_goal,
         ${schema.has_onboarding_completed ? 'users.onboarding_completed' : 'FALSE AS onboarding_completed'},
         COALESCE(${profileRoleSelect}, ${userRoleSelect}, ${legacyRoleSelect}) AS user_type,
         ${hasProfileQuery}
       FROM users
       ${profileJoin}
       ${legacyOnboardingJoin}
       WHERE LOWER(users.email) = $1`;
    const userQuery = await pool.query(loginQuery, [normalizedEmail]);
    const user = userQuery.rows[0];

    if (!user) return res.status(401).json({ message: 'Invalid credentials' });

    const validPassword = await bcrypt.compare(normalizedPassword, user.password);
    if (!validPassword) return res.status(401).json({ message: 'Invalid credentials' });

    const streak = await ensureUserStreak(user.user_id);

    const token = createAccessToken(user);

    res.status(200).json({
      message: 'Login successful',
      user: formatUserPayload(user),
      streak,
      ...token,
    });
  } catch (err) {
    logApiError(req, 'Login error', err);
    res.status(500).json({
      message: 'Login failed',
    });
  }
}

export async function updateProfile(req, res) {
  try {
    const { user_id, username, email, age, gender, user_type = null } = req.body;
    const normalizedUsername = String(username ?? '').trim();
    const normalizedEmail = normalizeEmail(email);
    const normalizedUserType = normalizeNullableText(user_type);
    const normalizedAge = normalizeOptionalAge(age);
    const normalizedGender = normalizeOptionalGender(gender);

    const authenticatedUserId = getAuthenticatedUserId(req);
    const effectiveUserId = authenticatedUserId ?? Number(user_id);

    if (!effectiveUserId || !normalizedUsername || !normalizedEmail) {
      return res.status(400).json({
        message: 'User ID, username, and email are required',
      });
    }

    if (normalizedAge.error) {
      return res.status(400).json({ message: normalizedAge.error });
    }

    if (normalizedGender.error) {
      return res.status(400).json({ message: normalizedGender.error });
    }

    const emailValidation = await validateEmailAddress(normalizedEmail);
    if (emailValidation.error) {
      return res.status(400).json({ message: emailValidation.error });
    }

    const schema = await getAuthSchemaSupport();
    const existingEmailVerifiedSelect = schema.has_email_verified ? 'email_verified' : 'FALSE AS email_verified';

    const existingUser = await pool.query(
      `SELECT user_id, email, ${existingEmailVerifiedSelect}
       FROM users
       WHERE user_id = $1`,
      [effectiveUserId],
    );

    if (existingUser.rows.length === 0) {
      return res.status(404).json({ message: 'User not found' });
    }

    const currentUser = existingUser.rows[0];
    const emailChanged = normalizeEmail(currentUser.email) !== emailValidation.email;

    const duplicateUser = await pool.query(
      `SELECT user_id
       FROM users
       WHERE (LOWER(email) = $1 OR username = $2) AND user_id <> $3`,
      [emailValidation.email, normalizedUsername, effectiveUserId],
    );

    if (duplicateUser.rows.length > 0) {
      return res.status(400).json({
        message: 'Email or username already exists',
      });
    }

    const updateAssignments = ['username = $1', 'email = $2'];
    const updateValues = [normalizedUsername, emailValidation.email];

    if (schema.has_age) {
      updateValues.push(normalizedAge.value);
      updateAssignments.push(`age = $${updateValues.length}`);
    }

    if (schema.has_gender) {
      updateValues.push(normalizedGender.value);
      updateAssignments.push(`gender = $${updateValues.length}`);
    }

    if (schema.has_role) {
      updateValues.push(normalizedUserType);
      updateAssignments.push(`role = $${updateValues.length}`);
    }

    if (schema.has_email_verified && emailChanged) {
      updateAssignments.push('email_verified = FALSE');
      if (schema.has_email_verified_at) {
        updateAssignments.push('email_verified_at = NULL');
      }
    }

    updateValues.push(effectiveUserId);
    const userIdPlaceholder = `$${updateValues.length}`;
    const ageSelect = schema.has_age ? 'age' : 'NULL::INTEGER AS age';
    const genderSelect = schema.has_gender ? 'gender' : 'NULL::TEXT AS gender';
    const roleSelect = schema.has_role ? 'role' : 'NULL::TEXT AS role';
    const lifestyleSelect = schema.has_lifestyle_type ? 'lifestyle_type' : 'NULL::TEXT AS lifestyle_type';
    const wellnessGoalSelect = schema.has_wellness_goal ? 'wellness_goal' : 'NULL::TEXT AS wellness_goal';
    const emailVerifiedSelect = schema.has_email_verified ? 'email_verified' : 'FALSE AS email_verified';

    const updateQuery = `UPDATE users
         SET ${updateAssignments.join(', ')}
         WHERE user_id = ${userIdPlaceholder}
         RETURNING
           user_id,
           username,
           email,
           ${emailVerifiedSelect},
           ${ageSelect},
           ${genderSelect},
           ${roleSelect},
           ${lifestyleSelect},
           ${wellnessGoalSelect},
           ${schema.has_onboarding_completed ? 'onboarding_completed' : 'FALSE AS onboarding_completed'}`;
    const updatedUser = await pool.query(updateQuery, updateValues);
    if (emailChanged) {
      queueVerificationEmail(req, updatedUser.rows[0], schema);
    }

    if (schema.has_user_onboarding_profiles && normalizedUserType) {
      await pool.query(
        `UPDATE user_onboarding_profiles
         SET role = $2,
             updated_at = CURRENT_TIMESTAMP
         WHERE user_id = $1`,
        [effectiveUserId, normalizedUserType],
      );
    }

    if (schema.has_user_onboarding && normalizedUserType) {
      await pool.query(
        `INSERT INTO user_onboarding (user_id, role_type)
         VALUES ($1, $2)
         ON CONFLICT (user_id) DO UPDATE SET
           role_type = EXCLUDED.role_type,
           updated_at = NOW()`,
        [effectiveUserId, normalizedUserType],
      );
    }

    const roleResult = schema.has_user_onboarding
      ? await pool.query(
          `SELECT role_type AS user_type
           FROM user_onboarding
           WHERE user_id = $1`,
          [effectiveUserId],
        )
      : { rows: [] };
    const profileResult = schema.has_user_onboarding_profiles
      ? await pool.query(
          `SELECT EXISTS (
             SELECT 1
             FROM user_onboarding_profiles
             WHERE user_id = $1
           ) AS has_onboarding_profile`,
          [effectiveUserId],
        )
      : { rows: [{ has_onboarding_profile: false }] };

    res.status(200).json({
      message: 'Profile updated successfully',
      user: formatUserPayload({
        ...updatedUser.rows[0],
        user_type: normalizedUserType ?? updatedUser.rows[0]?.role ?? roleResult.rows[0]?.user_type ?? null,
        has_onboarding_profile: profileResult.rows[0]?.has_onboarding_profile == true,
      }),
    });
  } catch (err) {
    logApiError(req, 'Profile update error', err);
    res.status(500).json({
      message: 'Failed to update profile',
    });
  }
}

export async function resendEmailVerification(req, res) {
  try {
    const userId = getAuthenticatedUserId(req);
    const schema = await getAuthSchemaSupport();

    if (!userId) {
      return res.status(401).json({ message: 'Authentication token required' });
    }
    if (schema.has_auth_email_tokens !== true || schema.has_email_verified !== true) {
      return res.status(503).json({ message: 'Email verification is not available right now' });
    }

    const userResult = await pool.query(
      `SELECT user_id, username, email, email_verified
       FROM users
       WHERE user_id = $1`,
      [userId],
    );
    const user = userResult.rows[0];
    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }
    if (user.email_verified === true) {
      return res.status(200).json({ message: 'Email is already verified.' });
    }

    queueVerificationEmail(req, user, schema);

    return res.status(200).json({
      message: RESEND_VERIFICATION_MESSAGE,
    });
  } catch (err) {
    logApiError(req, 'Resend email verification error', err);
    return res.status(500).json({
      message: 'Unable to send verification email right now',
    });
  }
}

export async function confirmEmailVerification(req, res) {
  try {
    const result = await consumeEmailVerificationCode({
      userId: getAuthenticatedUserId(req),
      code: req.body?.code,
    });

    if (result.error) {
      return res.status(400).json({
        message: result.error,
      });
    }

    return res.status(200).json({
      message: 'Email verified successfully.',
      email_verified: true,
    });
  } catch (err) {
    logApiError(req, 'Confirm email verification error', err);
    return res.status(500).json({
      message: 'Unable to verify this email right now.',
    });
  }
}

export async function requestPasswordReset(req, res) {
  try {
    const normalizedEmail = normalizeEmail(req.body?.email);

    if (!normalizedEmail) {
      return res.status(400).json({ message: 'Email is required' });
    }

    const emailSyntax = validateEmailSyntax(normalizedEmail);
    if (emailSyntax.error) {
      return res.status(400).json({ message: emailSyntax.error });
    }

    const schema = await getAuthSchemaSupport();

    if (schema.has_auth_email_tokens === true) {
      const userResult = await pool.query(
        `SELECT user_id, username, email
         FROM users
         WHERE LOWER(email) = $1`,
        [normalizedEmail],
      );
      const user = userResult.rows[0];

      if (user) {
        queuePasswordResetEmail(req, user, schema);
      }
    }

    return res.status(200).json({
      message: PASSWORD_RESET_REQUEST_MESSAGE,
    });
  } catch (err) {
    logApiError(req, 'Request password reset error', err);
    return res.status(500).json({
      message: 'Unable to send password reset email right now',
    });
  }
}

export async function verifyPasswordResetCode(req, res) {
  const normalizedEmail = normalizeEmail(req.body?.email);
  const emailSyntax = validateEmailSyntax(normalizedEmail);
  if (!normalizedEmail || emailSyntax.error) {
    return res.status(400).json({ message: 'Invalid or expired password reset code' });
  }

  try {
    const result = await exchangePasswordResetCode({
      email: normalizedEmail,
      code: req.body?.code,
    });
    if (result.error) {
      return res.status(400).json({ message: result.error });
    }

    return res.status(200).json({
      message: 'Code verified. Choose a new password.',
      reset_token: result.resetToken,
      expires_at: result.expiresAt.toISOString(),
    });
  } catch (err) {
    logApiError(req, 'Verify password reset code error', err);
    return res.status(500).json({ message: 'Unable to verify this code right now.' });
  }
}

export async function confirmPasswordReset(req, res) {
  const resetToken = String(req.body?.reset_token ?? '').trim();
  const normalizedPassword = normalizeResetPassword(req.body?.new_password);
  const confirmPassword = String(req.body?.confirm_password ?? '').trim();

  if (!resetToken) {
    return res.status(400).json({ message: 'Password reset session is required.' });
  }

  if (normalizedPassword.error) {
    return res.status(400).json({ message: normalizedPassword.error });
  }

  if (!confirmPassword || confirmPassword !== normalizedPassword.value) {
    return res.status(400).json({ message: 'Passwords do not match.' });
  }

  try {
    const result = await resetPasswordWithGrant({
      resetToken,
      newPassword: normalizedPassword.value,
    });

    if (result.error) {
      return res.status(400).json({ message: result.error });
    }

    return res.status(200).json({
      message: PASSWORD_RESET_SUCCESS_MESSAGE,
      sessions_revoked: true,
    });
  } catch (err) {
    logApiError(req, 'Confirm password reset error', err);
    return res.status(500).json({
      message: 'Unable to reset this password right now.',
    });
  }
}

export async function changePassword(req, res) {
  const currentPassword = String(req.body?.current_password ?? '').trim();
  const normalizedPassword = normalizeResetPassword(req.body?.new_password);
  const confirmPassword = String(req.body?.confirm_password ?? '').trim();

  if (!currentPassword) {
    return res.status(400).json({ message: 'Current password is required' });
  }
  if (normalizedPassword.error) {
    return res.status(400).json({ message: normalizedPassword.error });
  }
  if (!confirmPassword || confirmPassword !== normalizedPassword.value) {
    return res.status(400).json({ message: 'Passwords do not match.' });
  }

  try {
    const result = await changeAuthenticatedPassword({
      userId: getAuthenticatedUserId(req),
      currentPassword,
      newPassword: normalizedPassword.value,
    });
    if (result.error) {
      return res.status(400).json({ message: result.error });
    }

    return res.status(200).json({
      message: 'Password changed successfully. Sign in again with your new password.',
      sessions_revoked: true,
    });
  } catch (err) {
    logApiError(req, 'Change password error', err);
    return res.status(500).json({ message: 'Unable to change this password right now.' });
  }
}

async function getAccountDeletionSupport(client) {
  const result = await client.query(`
    SELECT
      EXISTS (
        SELECT 1
        FROM information_schema.tables
        WHERE table_schema = 'public'
          AND table_name = 'daily_logs'
      ) AS has_daily_logs,
      EXISTS (
        SELECT 1
        FROM information_schema.tables
        WHERE table_schema = 'public'
          AND table_name = 'daily_activity_logs'
      ) AS has_daily_activity_logs,
      EXISTS (
        SELECT 1
        FROM information_schema.tables
        WHERE table_schema = 'public'
          AND table_name = 'daily_exercise_goals'
      ) AS has_daily_exercise_goals,
      EXISTS (
        SELECT 1
        FROM information_schema.tables
        WHERE table_schema = 'public'
          AND table_name = 'user_streaks'
      ) AS has_user_streaks,
      EXISTS (
        SELECT 1
        FROM information_schema.tables
        WHERE table_schema = 'public'
          AND table_name = 'user_busy_days'
      ) AS has_user_busy_days,
      EXISTS (
        SELECT 1
        FROM information_schema.tables
        WHERE table_schema = 'public'
          AND table_name = 'user_preferences'
      ) AS has_user_preferences,
      EXISTS (
        SELECT 1
        FROM information_schema.tables
        WHERE table_schema = 'public'
          AND table_name = 'user_onboarding'
      ) AS has_user_onboarding,
      EXISTS (
        SELECT 1
        FROM information_schema.tables
        WHERE table_schema = 'public'
          AND table_name = 'user_environment_snapshots'
      ) AS has_user_environment_snapshots
  `);

  return (
    result.rows[0] ?? {
      has_daily_logs: false,
      has_daily_activity_logs: false,
      has_daily_exercise_goals: false,
      has_user_streaks: false,
      has_user_busy_days: false,
      has_user_preferences: false,
      has_user_onboarding: false,
      has_user_onboarding_profiles: false,
      has_user_onboarding_answers: false,
      has_user_environment_snapshots: false,
    }
  );
}

export async function deleteAccount(req, res) {
  const { user_id: rawUserId, email, password } = req.body;

  const userId = getAuthenticatedUserId(req) ?? Number(rawUserId);
  const normalizedEmail = String(email ?? '')
    .trim()
    .toLowerCase();
  const normalizedPassword = String(password ?? '').trim();

  if (!Number.isInteger(userId) || userId <= 0) {
    return res.status(400).json({ message: 'Valid user_id is required' });
  }

  if (!normalizedEmail || !normalizedPassword) {
    return res.status(400).json({ message: 'Email and password are required' });
  }

  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    const userResult = await client.query(
      `SELECT user_id, email, password
       FROM users
       WHERE user_id = $1`,
      [userId],
    );

    const user = userResult.rows[0];

    if (!user) {
      await client.query('ROLLBACK');
      return res.status(404).json({ message: 'User not found' });
    }

    if (
      String(user.email ?? '')
        .trim()
        .toLowerCase() !== normalizedEmail
    ) {
      await client.query('ROLLBACK');
      return res.status(401).json({ message: 'Invalid credentials' });
    }

    const validPassword = await bcrypt.compare(normalizedPassword, user.password);
    if (!validPassword) {
      await client.query('ROLLBACK');
      return res.status(401).json({ message: 'Invalid credentials' });
    }

    const schema = await getAccountDeletionSupport(client);

    if (schema.has_user_environment_snapshots) {
      await client.query('DELETE FROM user_environment_snapshots WHERE user_id = $1', [userId]);
    }

    if (schema.has_daily_logs) {
      await client.query('DELETE FROM daily_logs WHERE user_id = $1', [userId]);
    }

    if (schema.has_daily_activity_logs) {
      await client.query('DELETE FROM daily_activity_logs WHERE user_id = $1', [userId]);
    }

    if (schema.has_daily_exercise_goals) {
      await client.query('DELETE FROM daily_exercise_goals WHERE user_id = $1', [userId]);
    }

    if (schema.has_user_streaks) {
      await client.query('DELETE FROM user_streaks WHERE user_id = $1', [userId]);
    }

    if (schema.has_user_busy_days) {
      await client.query('DELETE FROM user_busy_days WHERE user_id = $1', [userId]);
    }

    if (schema.has_user_preferences) {
      await client.query('DELETE FROM user_preferences WHERE user_id = $1', [userId]);
    }

    if (schema.has_user_onboarding) {
      await client.query('DELETE FROM user_onboarding WHERE user_id = $1', [userId]);
    }

    if (schema.has_user_onboarding_answers) {
      await client.query('DELETE FROM user_onboarding_answers WHERE user_id = $1', [userId]);
    }

    if (schema.has_user_onboarding_profiles) {
      await client.query('DELETE FROM user_onboarding_profiles WHERE user_id = $1', [userId]);
    }

    await client.query('DELETE FROM users WHERE user_id = $1', [userId]);

    await client.query('COMMIT');

    return res.status(200).json({
      message: 'Account deleted successfully',
    });
  } catch (err) {
    await client.query('ROLLBACK');
    logApiError(req, 'Delete account error', err);
    return res.status(500).json({ message: 'Failed to delete account' });
  } finally {
    client.release();
  }
}
