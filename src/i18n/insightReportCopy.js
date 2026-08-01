import { normalizeLocale } from './locale.js';

function tagalogInsightSummary(value) {
  if (typeof value !== 'string') return value;
  if (value === "A daily wellness snapshot is available from yesterday's tracked data.") {
    return 'Available na ang daily wellness snapshot mula sa tracked data kahapon.';
  }

  const rules = [
    [/^Burnout risk is (.+) at (.+)\/100\. Yesterday's short check-in shows (.+)h sleep, (.+)\/5 energy, (.+)\/5 mood, and (.+)L hydration\. Weekly dimension context is included in the score when available\.$/, (_, risk, score, sleep, energy, mood, hydration) => `Ang burnout risk ay ${risk} sa ${score}/100. Sa short check-in kahapon: ${sleep}h na tulog, ${energy}/5 energy, ${mood}/5 mood, at ${hydration}L hydration. Kasama sa score ang weekly dimension context kapag available.`],
    [/^Yesterday's short log shows (.+)h sleep, (.+)\/5 energy, (.+)L hydration, (.+), and (.+)\.$/, (_, sleep, energy, hydration, symptoms, habits) => `Sa short log kahapon: ${sleep}h na tulog, ${energy}/5 energy, ${hydration}L hydration, ${symptoms}, at ${habits}.`],
    [/^Yesterday's tracked data shows (.+) steps and (\d+) logged meals?\. Add a daily check-in to complete the burnout report\.$/, (_, steps, meals) => `Sa tracked data kahapon: ${steps} steps at ${meals} logged meal. Magdagdag ng daily check-in para makumpleto ang burnout report.`],
    [/^(No burnout score trend is available yet|Latest burnout risk is .+ at .+\/100)\. This week has (\d+)\/7 short daily logs, (.+)h average sleep, (.+)L average hydration, (\d+) movement days?, and (.+)\.$/, (_, burnout, logs, sleep, hydration, movement, pulse) => `${burnout === 'No burnout score trend is available yet' ? 'Wala pang available na burnout score trend' : burnout.replace('Latest burnout risk is', 'Ang latest burnout risk ay')}. Ngayong linggo: ${logs}/7 short daily logs, ${sleep}h average sleep, ${hydration}L average hydration, ${movement} movement day, at ${pulse}.`],
  ];
  for (const [pattern, replacement] of rules) {
    if (pattern.test(value)) return value.replace(pattern, replacement);
  }
  return value;
}

export function localizeInsightReport(report, locale) {
  const normalizedLocale = normalizeLocale(locale);
  if (!report) return report;
  if (normalizedLocale !== 'fil') {
    return { ...report, locale: 'en', message_key: `report.${report.report_type}` };
  }
  return {
    ...report,
    title: report.report_type === 'weekly'
      ? 'Weekly wellness report'
      : 'Daily wellness report',
    summary: tagalogInsightSummary(report.summary),
    locale: 'fil',
    message_key: `report.${report.report_type}`,
  };
}
