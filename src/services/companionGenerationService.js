import OpenAI from 'openai';
import { contentHash } from './wellnessContentService.js';

export const COMPANION_PROMPT_VERSION = 'companion_v2';
export const companionModel = () => process.env.OPENAI_COMPANION_MODEL || 'gpt-6.1-sol';
const pending = new Map();
let openai;

// Reuse the audit table as a validated-output cache. Cache failures never block authored copy.
export async function generateCompanionJson({ client, userId, kind, context, instructions, schema, validate, generate, model = companionModel() }) {
  const { recent_openings: _recentOpenings, ...stableContext } = context;
  const hash = contentHash({ kind, context: stableContext, model, version: COMPANION_PROMPT_VERSION });
  const key = `${userId ?? 'test'}:${hash}`;
  if (!generate && pending.has(key)) return pending.get(key);
  const run = async () => {
    if (client && userId && !generate) {
      try {
        const cached = await client.query(
          `SELECT output_json FROM ai_nudge_generations WHERE user_id = $1 AND model = $2
           AND prompt_version = $3 AND context_hash = $4 AND validation_status = 'valid'
           AND created_at > NOW() - INTERVAL '24 hours' ORDER BY created_at DESC LIMIT 1`,
          [userId, model, COMPANION_PROMPT_VERSION, hash]);
        const output = cached.rows[0]?.output_json;
        if (output && validate(output)) return output;
      } catch { /* Cache is optional. */ }
    }
    let output = null;
    let status = 'fallback';
    try {
      if (generate) output = await generate(context);
      else {
        if (!process.env.OPENAI_API_KEY) return null;
        openai ??= new OpenAI({ apiKey: process.env.OPENAI_API_KEY, timeout: 12000, maxRetries: 0 });
        const response = await openai.responses.create({
          model, reasoning: { effort: 'low' }, max_output_tokens: 2048, store: false,
          input: [{ role: 'system', content: instructions }, { role: 'user', content: JSON.stringify(context) }],
          text: { format: { type: 'json_schema', name: kind, strict: true, schema } }
        }, { timeout: 12000, maxRetries: 0 });
        if (response.status !== 'completed') throw new Error('incomplete');
        output = JSON.parse(response.output_text);
      }
      status = validate(output) ? 'valid' : 'invalid';
    } catch { status = 'error'; }
    if (client && userId && !generate) {
      try {
        await client.query(
          `INSERT INTO ai_nudge_generations (user_id, nudge_type, model, prompt_version,
           context_hash, input_snapshot, output_json, validation_status)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
          [userId, kind, model, COMPANION_PROMPT_VERSION, hash, JSON.stringify(context), JSON.stringify(output ?? {}), status]);
      } catch { /* Audit persistence must not interrupt a nudge. */ }
    }
    return status === 'valid' ? output : null;
  };
  const work = run();
  if (!generate) pending.set(key, work);
  try { return await work; } finally { if (pending.get(key) === work) pending.delete(key); }
}
