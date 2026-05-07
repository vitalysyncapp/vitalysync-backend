import crypto from 'crypto';

import OpenAI from 'openai';

const DEFAULT_OPENAI_NUDGE_MODEL = 'gpt-5.4-mini';
const PROMPT_VERSION = 'ai_nudge_v2';
const MAX_TITLE_LENGTH = 48;
const MAX_MESSAGE_LENGTH = 180;
const MAX_WHY_LENGTH = 120;
const MAX_ACTION_LENGTH = 52;
const MAX_SAFETY_LENGTH = 100;

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
    title: { type: 'string' },
    message: { type: 'string' },
    why_this_matters: { type: 'string' },
    suggested_action: { type: 'string' },
    action_steps: {
      type: 'array',
      items: { type: 'string' }
    },
    tone: {
      type: 'string',
      enum: ['Gentle', 'Direct', 'Motivational', 'Data-Driven']
    },
    safety_note: { type: 'string' }
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

function truncate(value, maxLength) {
  const normalized = safeString(value);
  if (normalized.length <= maxLength) {
    return normalized;
  }

  return `${normalized.slice(0, Math.max(0, maxLength - 3)).trim()}...`;
}

function normalizeActionSteps(value) {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((step) => truncate(step, 58))
    .filter((step) => step.length > 0)
    .slice(0, 2);
}

function containsUnsafeDiagnosisLanguage(payload) {
  const text = [
    payload.title,
    payload.message,
    payload.why_this_matters,
    payload.suggested_action,
    payload.safety_note,
    ...(payload.action_steps ?? [])
  ].join(' ').toLowerCase();

  return [
    'you are burned out',
    'you have burnout',
    'diagnosed',
    'clinical diagnosis',
    'medical diagnosis'
  ].some((phrase) => text.includes(phrase));
}

function normalizeAiOutput(payload, fallbackTone) {
  const normalized = {
    title: truncate(payload?.title, MAX_TITLE_LENGTH),
    message: truncate(payload?.message, MAX_MESSAGE_LENGTH),
    why_this_matters: truncate(payload?.why_this_matters, MAX_WHY_LENGTH),
    suggested_action: truncate(payload?.suggested_action, MAX_ACTION_LENGTH),
    action_steps: normalizeActionSteps(payload?.action_steps),
    tone: safeString(payload?.tone, fallbackTone),
    safety_note: truncate(payload?.safety_note, MAX_SAFETY_LENGTH)
  };

  if (
    !normalized.title ||
    !normalized.message ||
    !normalized.suggested_action ||
    containsUnsafeDiagnosisLanguage(normalized)
  ) {
    return null;
  }

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

function buildAiContext(recommendation, summary, preferences) {
  const window7 = pickWindow(summary, 7);
  const window14 = pickWindow(summary, 14);

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
    guardrails: {
      do_not_change_priority_or_risk: true,
      do_not_diagnose: true,
      keep_behavioral_and_small: true,
      output_language: 'English'
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
  { summary, preferences }
) {
  const model = process.env.OPENAI_NUDGE_MODEL || DEFAULT_OPENAI_NUDGE_MODEL;
  const context = buildAiContext(recommendation, summary, preferences);

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
                'You write short, human wellness nudges for VitalySync. Preserve deterministic risk, priority, trigger, and focus. Do not diagnose burnout. Do not invent data. Sound warm, direct, and natural, not clinical. Use plain everyday language that is easy to understand on a quick read. Keep it brief: one complete message sentence, one short reason sentence, and at most two small action steps. Keep the message objective and based only on the supplied trend or pattern. Avoid hype, vague encouragement, or generic wellness advice. Return JSON only.'
            }
          ]
        },
        {
          role: 'user',
          content: [
            {
              type: 'input_text',
              text:
                'Rewrite this nudge so it feels personal, concise, and easy to act on. Use complete thoughts, not fragments. Make the wording more human and understandable while staying objective. No long explanations. No generic wellness lecture. Stay inside the supplied context.\n\nContext JSON:\n' +
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
    const normalized = normalizeAiOutput(
      parsed,
      preferences.preferredNudgeStyle
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
  { summary, preferences, enhanceThrottled = false }
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
        preferences
      })
    );
  }

  return enhanced;
}
