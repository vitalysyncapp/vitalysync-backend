import crypto from 'crypto';

import OpenAI from 'openai';

import {
  NUDGE_COPY_LIMITS,
  validateNudgeCopy
} from './nudgeCopyPolicy.js';
import { toUserFacingNudgeSeverity } from './nudgeSeverityPolicy.js';

const DEFAULT_OPENAI_NUDGE_MODEL = 'gpt-5.4-mini';
const PROMPT_VERSION = 'ai_nudge_v5_locale';
const MAX_TITLE_LENGTH = NUDGE_COPY_LIMITS.title;
const MAX_MESSAGE_LENGTH = NUDGE_COPY_LIMITS.message;
const MAX_WHY_LENGTH = NUDGE_COPY_LIMITS.reason;
const MAX_ACTION_LENGTH = NUDGE_COPY_LIMITS.actionLabel;
const MAX_SAFETY_LENGTH = NUDGE_COPY_LIMITS.safetyNote;

let openaiClient = null;

const AI_NUDGE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: [
    'title',
    'message',
    'why_this_matters',
    'suggested_action',
    'action_steps',
    'tone',
    'safety_note'
  ],
  properties: {
    title: { type: 'string', minLength: 1, maxLength: MAX_TITLE_LENGTH },
    message: { type: 'string', minLength: 1, maxLength: MAX_MESSAGE_LENGTH },
    why_this_matters: { type: 'string', maxLength: MAX_WHY_LENGTH },
    suggested_action: {
      type: 'string',
      minLength: 1,
      maxLength: MAX_ACTION_LENGTH
    },
    action_steps: {
      type: 'array',
      maxItems: 1,
      items: {
        type: 'string',
        minLength: 1,
        maxLength: NUDGE_COPY_LIMITS.actionStep
      }
    },
    tone: {
      type: 'string',
      enum: ['Gentle', 'Direct', 'Motivational', 'Data-Driven']
    },
    safety_note: { type: 'string', maxLength: MAX_SAFETY_LENGTH }
  }
};

function getOpenAIClient() {
  if (!process.env.OPENAI_API_KEY) {
    throw new Error('OPENAI_API_KEY is not configured');
  }

  if (!openaiClient) {
    openaiClient = new OpenAI({
      apiKey: process.env.OPENAI_API_KEY
    });
  }

  return openaiClient;
}

function hashContext(value) {
  return crypto
    .createHash('sha256')
    .update(JSON.stringify(value))
    .digest('hex');
}

function safeString(value, fallback = '') {
  return String(value ?? fallback).trim();
}

export function ensureNameInMessage(message, displayName) {
  const normalized = safeString(message);
  const name = safeString(displayName);
  if (!normalized || !name) {
    return normalized;
  }

  if (normalized.toLowerCase().includes(name.toLowerCase())) {
    return normalized;
  }

  const shouldLowerFirst = !normalized.startsWith('VitalySync');
  const personalizedMessage = shouldLowerFirst
    ? `${normalized[0].toLowerCase()}${normalized.slice(1)}`
    : normalized;

  return `${name}, ${personalizedMessage}`;
}

function normalizeActionSteps(value) {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((step) => safeString(step))
    .filter((step) => step.length > 0)
    .slice(0, 1);
}

function normalizeAiOutput(payload, fallbackTone, displayName) {
  const normalized = {
    title: safeString(payload?.title),
    message: safeString(payload?.message),
    why_this_matters: safeString(payload?.why_this_matters),
    suggested_action: safeString(payload?.suggested_action),
    action_steps: normalizeActionSteps(payload?.action_steps),
    tone: safeString(payload?.tone, fallbackTone),
    safety_note: safeString(payload?.safety_note)
  };
  const detailsWithinLimits =
    normalized.why_this_matters.length <= MAX_WHY_LENGTH &&
    normalized.safety_note.length <= MAX_SAFETY_LENGTH &&
    normalized.action_steps.every(
      (step) => step.length <= NUDGE_COPY_LIMITS.actionStep
    );
  const validation = validateNudgeCopy({
    title: normalized.title,
    message: normalized.message,
    actionLabel: normalized.suggested_action,
    displayName,
    additionalText: [
      normalized.why_this_matters,
      normalized.safety_note,
      ...normalized.action_steps
    ]
  });

  if (!detailsWithinLimits || !validation.valid) {
    return null;
  }

  normalized.title = validation.copy.title;
  normalized.message = validation.copy.message;
  normalized.suggested_action = validation.copy.actionLabel;

  if (!['Gentle', 'Direct', 'Motivational', 'Data-Driven'].includes(normalized.tone)) {
    normalized.tone = fallbackTone;
  }

  return normalized;
}

function parseJsonResponse(response) {
  const outputText = safeString(response?.output_text);
  if (!outputText) {
    throw new Error('OpenAI returned an empty nudge response');
  }

  return JSON.parse(outputText);
}

function pickWindow(summary, days) {
  return summary?.windows?.[`${days}_day`] ?? {};
}

export function buildAiContext(
  recommendation,
  summary,
  preferences,
  personalization = null,
  locale = 'en'
) {
  const window7 = pickWindow(summary, 7);
  const window14 = pickWindow(summary, 14);
  const metadata = recommendation?.metadata ?? {};
  const userDisplayName =
    personalization?.displayName ?? metadata.user_display_name ?? null;
  const personalizationProfile =
    personalization?.profile ?? metadata.personalization_profile ?? {};

  return {
    deterministic_recommendation: {
      nudge_type: recommendation.nudge_type,
      priority: recommendation.priority,
      title: recommendation.title,
      message: recommendation.message,
      action_label: recommendation.action_label,
      trigger_reason: recommendation.trigger_reason,
      recommended_focus: recommendation.recommended_focus,
      pattern_type: recommendation.pattern_type,
      severity: recommendation.severity,
      internal_severity: metadata.internal_severity ?? null,
      confidence_score: recommendation.confidence_score
    },
    burnout_context: {
      latest_risk_level: summary?.latest_score?.risk_level ?? 'unknown',
      latest_score: summary?.latest_score?.overall_score ?? null,
      adaptive_state: summary?.adaptive_state ?? null,
      seven_day: {
        average_score: window7.average_score ?? null,
        trend_direction: window7.trend_direction ?? null,
        delta_from_start: window7.delta_from_start ?? null,
        average_confidence_score: window7.average_confidence_score ?? null,
        dominant_dimension: window7.dominant_dimension ?? null
      },
      fourteen_day: {
        average_score: window14.average_score ?? null,
        trend_direction: window14.trend_direction ?? null,
        dominant_dimension: window14.dominant_dimension ?? null
      },
      patterns: (summary?.patterns ?? []).slice(0, 3).map((pattern) => ({
        type: pattern.type,
        severity: pattern.severity,
        title: pattern.title,
        recommended_focus: pattern.recommended_focus
      }))
    },
    user_preferences: {
      preferred_nudge_style: preferences.preferredNudgeStyle,
      nudge_cooldown_hours: preferences.cooldownHours,
      max_daily_nudges: preferences.maxDailyNudges
    },
    personal_context: {
      user_display_name: userDisplayName,
      profile: personalizationProfile,
      variables_available: metadata.profile_variables_used ?? [],
      visible_personalization: {
        use_username_once_when_available: Boolean(userDisplayName),
        use_at_most_one_profile_detail: true,
        keep_profile_details_subtle: true
      }
    },
    guardrails: {
      do_not_change_priority_or_risk: true,
      do_not_diagnose: true,
      user_facing_severity: toUserFacingNudgeSeverity(
        recommendation.severity,
        recommendation.priority
      ),
      message_max_characters: MAX_MESSAGE_LENGTH,
      use_one_concrete_action: true,
      keep_behavioral_and_small: true,
      do_not_reference_email_age_or_gender: true,
      output_language: locale === 'fil'
        ? 'Conversational Taglish (Filipino), with familiar English wellness terms'
        : 'English'
    }
  };
}

async function recordAiGeneration(
  client,
  {
    userId,
    recommendation,
    model,
    context,
    output,
    validationStatus,
    errorMessage = null
  }
) {
  try {
    await client.query(
      `INSERT INTO ai_nudge_generations (
         user_id,
         nudge_event_id,
         nudge_type,
         model,
         prompt_version,
         context_hash,
         input_snapshot,
         output_json,
         validation_status,
         error_message
       )
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
      [
        userId,
        recommendation.nudge_event_id,
        recommendation.nudge_type,
        model,
        PROMPT_VERSION,
        hashContext(context),
        JSON.stringify(context),
        JSON.stringify(output ?? {}),
        validationStatus,
        errorMessage
      ]
    );
  } catch (error) {
    console.warn('AI nudge generation audit log failed:', error.message);
  }
}

export async function enhanceNudgeRecommendation(
  client,
  userId,
  recommendation,
  { summary, preferences, personalization = null, locale = 'en' }
) {
  const model = process.env.OPENAI_NUDGE_MODEL || DEFAULT_OPENAI_NUDGE_MODEL;
  const context = buildAiContext(
    recommendation,
    summary,
    preferences,
    personalization,
    locale
  );

  try {
    const openai = getOpenAIClient();
    const response = await openai.responses.create({
      model,
      input: [
        {
          role: 'system',
          content: [
            {
              type: 'input_text',
              text:
                'You write short, human wellness nudges for VitalySync. Preserve deterministic priority, trigger, focus, and user-facing severity. Never show the words critical or urgent; use needs support for the strongest state. Do not diagnose burnout and do not invent data. Start the message with the username followed by a comma when one is available, and use that username exactly once across the full output. Use at most one subtle profile detail only when useful. Do not mention email, age, or gender. Give one concrete action and at most one short reason. Return no more than one action step, and make it restate the same action instead of adding another. Keep the message at 140 characters or fewer. Sound warm, direct, natural, and non-clinical. Avoid hype, promises, generic lectures, and unsupported claims. Follow guardrails.output_language exactly; for Filipino use natural conversational Taglish and keep common wellness and app terms in English. Return JSON only.'
            }
          ]
        },
        {
          role: 'user',
          content: [
            {
              type: 'input_text',
              text:
                'Polish the deterministic nudge without changing its meaning or intensity. Keep one action, one useful reason at most, and stay inside the supplied context.\n\nContext JSON:\n' +
                JSON.stringify(context)
            }
          ]
        }
      ],
      text: {
        format: {
          type: 'json_schema',
          name: 'vitalysync_ai_nudge',
          strict: true,
          schema: AI_NUDGE_SCHEMA
        }
      }
    });
    const parsed = parseJsonResponse(response);
    const displayName = context.personal_context.user_display_name;
    const normalized = normalizeAiOutput(
      {
        ...parsed,
        message: ensureNameInMessage(parsed?.message, displayName)
      },
      preferences.preferredNudgeStyle,
      displayName
    );

    if (!normalized) {
      await recordAiGeneration(client, {
        userId,
        recommendation,
        model,
        context,
        output: parsed,
        validationStatus: 'invalid',
        errorMessage: 'AI nudge output failed local validation'
      });
      return recommendation;
    }

    const enhancedRecommendation = {
      ...recommendation,
      title: normalized.title,
      message: normalized.message,
      action_label: normalized.suggested_action,
      metadata: {
        ...recommendation.metadata,
        title: normalized.title,
        ai_enhanced: true,
        ai_model: model,
        ai_prompt_version: PROMPT_VERSION,
        ai_why_this_matters: normalized.why_this_matters,
        ai_action_steps: normalized.action_steps,
        ai_tone: normalized.tone,
        ai_safety_note: normalized.safety_note,
        deterministic_title: recommendation.title,
        deterministic_message: recommendation.message,
        deterministic_action_label: recommendation.action_label
      }
    };

    await recordAiGeneration(client, {
      userId,
      recommendation: enhancedRecommendation,
      model,
      context,
      output: normalized,
      validationStatus: 'valid'
    });

    return enhancedRecommendation;
  } catch (error) {
    await recordAiGeneration(client, {
      userId,
      recommendation,
      model,
      context,
      output: {},
      validationStatus: process.env.OPENAI_API_KEY ? 'error' : 'fallback',
      errorMessage: error.message
    });

    return {
      ...recommendation,
      metadata: {
        ...recommendation.metadata,
        ai_enhanced: false,
        ai_fallback: true,
        ai_prompt_version: PROMPT_VERSION
      }
    };
  }
}

export async function enhanceNudgeRecommendations(
  client,
  userId,
  recommendations,
  { summary, preferences, personalization = null, locale = 'en', enhanceThrottled = false }
) {
  const enhanced = [];

  for (const recommendation of recommendations) {
    if (recommendation.metadata?.throttled === true && !enhanceThrottled) {
      enhanced.push(recommendation);
      continue;
    }

    enhanced.push(
      await enhanceNudgeRecommendation(client, userId, recommendation, {
        summary,
        preferences,
        personalization,
        locale
      })
    );
  }

  return enhanced;
}
