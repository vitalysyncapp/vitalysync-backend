import crypto from 'crypto';

import OpenAI from 'openai';

import {
  NUDGE_COPY_LIMITS,
  validateNudgeCopy
} from './nudgeCopyPolicy.js';
import { toUserFacingNudgeSeverity } from './nudgeSeverityPolicy.js';

const DEFAULT_OPENAI_NUDGE_MODEL = 'gpt-5.4-mini';
const PROMPT_VERSION = 'cbi-approved-wording-1.0.0';
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

export function buildAiContext(recommendation, summary, preferences, personalization = null, locale = 'en') {
  return {
    policy_version: recommendation.metadata?.policy_version,
    approved_action: recommendation.metadata?.approved_action,
    approved_messages: recommendation.metadata?.approved_messages ?? [],
    recorded_observation: recommendation.metadata?.observation,
    source_ids: recommendation.metadata?.source_ids ?? [],
    title: recommendation.title,
    action_label: recommendation.action_label,
    guardrails: {
      choose_approved_wording_only: true,
      do_not_change_action_observation_sources_or_trigger: true,
      do_not_calculate_scores_or_infer_diagnoses: true
    }
  };
}

export function isApprovedNudgeWording(output, recommendation) {
  return recommendation.metadata?.approved_messages?.includes(output?.message) === true
    && output.title === recommendation.title
    && output.suggested_action === recommendation.action_label
    && output.why_this_matters === recommendation.metadata.observation
    && (output.action_steps?.length ?? 0) === 0
    && !output.safety_note;
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
                'Select only an approved message from approved_messages. Copy title and action_label exactly. Copy recorded_observation into why_this_matters. Return no action_steps or safety_note. Do not add advice, evidence, scores, diagnoses, or change eligibility. Wording outside this approved set will be rejected. Return JSON only.'
            }
          ]
        },
        {
          role: 'user',
          content: [
            {
              type: 'input_text',
              text:
                'Choose approved wording from this context:\n' +
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
    const displayName = null;
    const normalized = normalizeAiOutput(
      {
        ...parsed,
        message: ensureNameInMessage(parsed?.message, displayName)
      },
      preferences.preferredNudgeStyle,
      displayName
    );

    if (!normalized || !isApprovedNudgeWording(parsed, recommendation)) {
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
