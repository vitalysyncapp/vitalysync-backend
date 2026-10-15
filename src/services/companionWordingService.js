import OpenAI from 'openai';
import { validateNudgeCopy } from './nudgeCopyPolicy.js';

let openai;
const EDITORIAL_WORDS = new Set(('a an the your you for to of in with and or one small little next step space room moment pause reset simple enough today now gentle quiet steady manageable easy choice option idea beginning together at own pace that this is can be keep it just only something worthwhile support time care bit no pressure when feels right on terms counts count too worth try ' +
  'isang ang ng sa para mo iyo ka tayo muna lang ngayon maliit kaunting sandali puwang pahinga simple sapat dahan susunod hakbang oras alaga bagay konting maikli kaya natin may kasama bawat mas').split(' '));
// Facts and actions remain server-authored. A short optional bridge lets the
// companion sound natural without asking a model to reinterpret health data.
export function applyCompanionWording(candidate, output, { maxLength = 140, locale = 'en' } = {}) {
  const title = String(output?.title ?? '').trim();
  const bridge = String(output?.bridge ?? '').trim();
  if (output?.action_id !== candidate.metadata?.action_id || !title || bridge.length > 40) return null;
  const editorial = `${title} ${bridge}`;
  // Only neutral connective language is model-authored. New food names,
  // symptoms, measurements and claims cannot enter through this channel.
  const words = editorial.toLowerCase().match(/[\p{L}]+/gu) ?? [];
  if (!words.every((word) => EDITORIAL_WORDS.has(word))) return null;
  if (/\d|\b(slept|sleeping|improv\w*|wors\w*|always|never|missed|skipped|because|since|score|protein|carbs|fat|calorie|weight|burnout|diagnos\w*|cure\w*|pagbuti|lumala|kulang|dahil|tumaas|bumaba|natulog|kumain)\b/i.test(editorial)) return null;
  const message = [bridge, candidate.message].filter(Boolean).join(' ');
  if (title.length > 48 || message.length > maxLength) return null;
  const validation = validateNudgeCopy({ title, message: message.slice(0, 140), actionLabel: 'Continue' });
  if (!validation.valid) return null;
  return { ...candidate, title, message, metadata: { ...candidate.metadata,
    title, locale, ai_enhanced: true, ai_prompt_version: 'companion_bridge_v1',
    deterministic_title: candidate.title, deterministic_message: candidate.message } };
}

export async function enhanceCompanionWording(candidate, {
  model = process.env.OPENAI_NUDGE_MODEL || 'gpt-5.4-mini',
  maxLength = 140, locale = 'en', style = 'Gentle', recentMessages = [],
  generate = null
} = {}) {
  if (candidate.metadata?.reused_content) return candidate;
  try {
    const context = {
      title: candidate.title, approved_message: candidate.message,
      action_id: candidate.metadata?.action_id,
      evidence: candidate.metadata?.evidence,
      style, locale, recent_openings: recentMessages.slice(0, 8),
      remaining_characters: Math.max(0, maxLength - candidate.message.length - 1)
    };
    let output;
    if (generate) output = await generate(context);
    else {
      if (!process.env.OPENAI_API_KEY) throw new Error('unavailable');
      openai ??= new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
      const response = await openai.responses.create({
        model,
        input: [{ role: 'system', content:
          'Write a short title and an optional conversational bridge for a warm, observant wellness companion. The approved message is appended unchanged. The bridge is at most 40 characters and must fit remaining_characters; an empty bridge is welcome. Follow the requested Gentle, Direct, Motivational or Data-Driven style without hype. Use natural Taglish for fil and English for en. Do not repeat recent openings. Do not add facts, measurements, actions, praise for unconfirmed actions, medical or nutrition claims, names, commands or questions. Do not restate the approved message. Preserve action_id exactly. Use only words from this neutral editorial vocabulary (punctuation and capitalization are free): ' + [...EDITORIAL_WORDS].join(', ') + '. Return JSON only.' },
        { role: 'user', content: JSON.stringify(context) }],
        text: { format: { type: 'json_schema', name: 'companion_wording', strict: true,
          schema: { type: 'object', additionalProperties: false,
            required: ['title', 'bridge', 'action_id'], properties: {
              title: { type: 'string', maxLength: 48 }, bridge: { type: 'string', maxLength: 40 },
              action_id: { type: 'string', enum: [candidate.metadata.action_id] }
            } } } }
      });
      output = JSON.parse(response.output_text);
    }
    const result = applyCompanionWording(candidate, output, { maxLength, locale });
    if (result) return result;
  } catch { /* Authored, localized copy is always available. */ }
  return { ...candidate, metadata: { ...candidate.metadata, ai_enhanced: false, ai_fallback: true, ai_prompt_version: 'companion_bridge_v1' } };
}
