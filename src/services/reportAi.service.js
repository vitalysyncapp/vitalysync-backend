import OpenAI from 'openai';

function cleanText(value, maxLength) {
  if (typeof value !== 'string') return null;
  const cleaned = value.replace(/\s+/g, ' ').trim();
  return cleaned ? cleaned.slice(0, maxLength) : null;
}

export async function generateReportAiContent(metrics, {
  apiKey = process.env.OPENAI_API_KEY,
  model = process.env.OPENAI_NUDGE_MODEL || 'gpt-5.4-mini',
} = {}) {
  if (!apiKey) return null;

  const reportData = {
    current_30_days: metrics.wellness.month,
    previous_30_days: metrics.wellness.previousMonth,
    current_activity_30_days: metrics.activity.month,
    latest_burnout: metrics.latestBurnout,
  };

  try {
    const openai = new OpenAI({ apiKey });
    const response = await openai.chat.completions.create({
      model,
      messages: [
        {
          role: 'system',
          content: 'Return valid JSON. Use supportive, non-clinical wellness language. Do not diagnose, infer missing facts, or overstate certainty.',
        },
        {
          role: 'user',
          content: `Use only the aggregated report data below. Write a concise highlight that connects the values or changes in the tables, plus 2-3 practical recommendations. If data is missing, acknowledge that instead of treating it as zero. Mood is scored 0-4; energy and stress are scored 1-5; burnout values are 0-100.\n\nReport data:\n${JSON.stringify(reportData)}\n\nReturn JSON with keys "highlight" (one or two sentences) and "recommendations" (an array of 2-3 short strings).`,
        },
      ],
      response_format: { type: 'json_object' },
    });
    const parsed = JSON.parse(response.choices[0].message.content);
    const highlight = cleanText(parsed.highlight, 600);
    const recommendations = Array.isArray(parsed.recommendations)
      ? parsed.recommendations
          .map((item) => cleanText(item, 300))
          .filter(Boolean)
          .slice(0, 3)
      : [];

    if (!highlight && recommendations.length === 0) return null;
    return { highlight, recommendations };
  } catch (error) {
    console.warn('AI report content unavailable:', error.message);
    return null;
  }
}
