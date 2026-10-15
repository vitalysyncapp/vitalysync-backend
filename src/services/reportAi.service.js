import OpenAI from 'openai';

function cleanText(value, maxLength) {
  if (typeof value !== 'string') return null;
  const cleaned = value.replace(/\s+/g, ' ').trim();
  return cleaned ? cleaned.slice(0, maxLength) : null;
}

export async function generateReportAiContent(metrics, {
  apiKey = process.env.OPENAI_API_KEY,
  model = process.env.OPENAI_NUDGE_MODEL || 'gpt-5.4-mini',
  locale = 'en',
} = {}) {
  if (!apiKey) return null;

  const reportData = {
    current_30_days: metrics.wellness.month,
    previous_30_days: metrics.wellness.previousMonth,
    current_weekly_pulse_30_days: metrics.pulse.month,
    previous_weekly_pulse_30_days: metrics.pulse.previousMonth,
    current_activity_30_days: metrics.activity.month,
    latest_burnout: metrics.latestBurnout,
    weekly_questionnaire: metrics.questionnaire,
    previous_22_item_weekly_questionnaire: metrics.legacyQuestionnaire,
    latest_weekly_questionnaire: metrics.latestWeeklyAssessment,
  };

  try {
    const openai = new OpenAI({ apiKey });
    const response = await openai.chat.completions.create({
      model,
      messages: [
        {
          role: 'system',
          content: `Return valid JSON. Use supportive, non-clinical wellness language. Do not diagnose, infer missing facts, or overstate certainty. Write in ${locale === 'fil' ? 'natural conversational Taglish (Filipino), keeping familiar English wellness and technical terms' : 'English'}.`,
        },
        {
          role: 'user',
          content: `Use only the aggregated report data below. Write a concise highlight that connects the values or changes in the tables, plus 2-3 practical recommendations. If data is missing, acknowledge that instead of treating it as zero. Mood, energy, pressure, recovery, detachment, focus, and accomplishment come from daily logs on 1-5 scales. The weekly_questionnaire contains separate means for the custom 11-item weekly questionnaire: 5 exhaustion, 3 detachment, and 3 accomplishment items, each rated 1-5. Baselines retain 22 items. Previous 22-item weekly records are summarized separately; never pool versions or interpret changes between versions as an improvement or decline. Ordinary daily logs have 14 inputs; weekly-day daily logs have 9 practical inputs and omit the 5 daily reflections. Omitted answers are not zero. Higher accomplishment is positive. Never combine these dimensions or call them official MBI scores. Weekly pulse data is legacy and must be labeled as such. The daily wellness estimate uses 0-100 and is separate from the weekly questionnaire. Activity averages use logged days within each period, not every calendar day.\n\nReport data:\n${JSON.stringify(reportData)}\n\nReturn JSON with keys "highlight" (one or two sentences) and "recommendations" (an array of 2-3 short strings).`,
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
