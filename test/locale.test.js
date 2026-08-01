import assert from 'node:assert/strict';
import test from 'node:test';

import {
  defaultResponseCode,
  localizeApiMessage,
  normalizeLocale,
} from '../src/i18n/locale.js';
import {
  localizeNudgeRecommendation,
  localizeNutritionNudge,
} from '../src/i18n/generatedCopy.js';
import { localizeInsightReport } from '../src/i18n/insightReportCopy.js';
import { buildAiContext } from '../src/services/aiNudgeService.js';
import {
  buildPasswordResetEmail,
  buildVerificationEmail,
} from '../src/services/mail.service.js';

test('normalizes Filipino locale aliases and falls back to English', () => {
  assert.equal(normalizeLocale('fil-PH,fil;q=0.9,en;q=0.8'), 'fil');
  assert.equal(normalizeLocale('tl-PH'), 'fil');
  assert.equal(normalizeLocale('en-US'), 'en');
  assert.equal(normalizeLocale('fr-FR'), 'en');
  assert.equal(normalizeLocale(undefined), 'en');
});

test('localizes catalogued and patterned API messages in Tagalog', () => {
  assert.equal(localizeApiMessage('User not found', 'fil'), 'Hindi makita ang user.');
  assert.equal(
    localizeApiMessage('Valid user_id is required', 'tl'),
    'May kulang o hindi valid na detalye sa request.',
  );
  assert.equal(localizeApiMessage('User not found', 'en'), 'User not found');
});

test('provides stable fallback error codes', () => {
  assert.equal(defaultResponseCode(400), 'VALIDATION_ERROR');
  assert.equal(defaultResponseCode(404), 'NOT_FOUND');
  assert.equal(defaultResponseCode(500), 'SERVER_ERROR');
});

test('localizes deterministic adaptive and nutrition copy with metadata', () => {
  const adaptive = localizeNudgeRecommendation({
    nudge_type: 'micro_recovery_break',
    title: 'Take a small reset',
    message: 'Pressure is trending up. Take one short reset before the next task.',
    action_label: 'Take a reset',
    trigger_reason: 'Burnout risk is rising',
    metadata: {},
  }, 'fil');
  const nutrition = localizeNutritionNudge({
    title: 'Add protein next',
    message: "Protein looks light in today's logged meals. Add a protein food you enjoy to your next meal.",
    metadata: { macro_focus: 'protein' },
  }, 'fil');

  assert.match(adaptive.message, /Tumataas ang pressure/);
  assert.equal(adaptive.metadata.locale, 'fil');
  assert.equal(adaptive.metadata.message_key, 'nudge.micro_recovery_break');
  assert.match(nutrition.message, /protein/);
  assert.equal(nutrition.metadata.locale, 'fil');
  assert.equal(nutrition.metadata.message_key, 'nutrition.protein');
});

test('AI nudge context explicitly requests conversational Taglish', () => {
  const context = buildAiContext(
    {
      nudge_type: 'recovery_break',
      priority: 'medium',
      title: 'Take a small reset',
      message: 'Take a short reset.',
      action_label: 'Take a reset',
      metadata: {},
    },
    { windows: {}, patterns: [] },
    { preferredNudgeStyle: 'Gentle', cooldownHours: 8, maxDailyNudges: 2 },
    null,
    'fil',
  );

  assert.match(context.guardrails.output_language, /Taglish/);
});

test('auth email templates use precise Taglish when Filipino is requested', () => {
  const verification = buildVerificationEmail({
    username: 'Alex',
    verificationCode: '123456',
    expiresInMinutes: 10,
    locale: 'fil',
  });
  const reset = buildPasswordResetEmail({
    username: 'Alex',
    resetCode: '654321',
    expiresInMinutes: 10,
    locale: 'fil',
  });

  assert.match(verification.subject, /I-verify/);
  assert.match(verification.text, /Mag-e-expire/);
  assert.match(reset.subject, /I-reset/);
  assert.match(reset.text, /password reset code/);
});

test('historical deterministic insight reports localize at response time', () => {
  const report = localizeInsightReport({
    report_type: 'daily',
    title: 'Daily wellness report',
    summary: "A daily wellness snapshot is available from yesterday's tracked data.",
  }, 'tl-PH');

  assert.match(report.summary, /Available na/);
  assert.equal(report.locale, 'fil');
  assert.equal(report.message_key, 'report.daily');
});
