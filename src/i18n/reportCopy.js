import { normalizeLocale } from './locale.js';

const TAGALOG_REPORT_COPY = new Map([
  ['VitalySync User Wellness Report', 'VitalySync User Wellness Report'],
  ['A personal summary of logged wellness, burnout, and activity patterns.', 'Personal summary ng naka-log na wellness, burnout, at activity patterns.'],
  ['User information', 'Impormasyon ng user'],
  ['Name: ', 'Pangalan: '],
  ['Gender: ', 'Gender: '],
  ['Role: ', 'Role: '],
  ['Report date: ', 'Petsa ng report: '],
  ['Report overview', 'Buod ng report'],
  ['AI-generated highlight: ', 'AI-generated highlight: '],
  ['Burnout status and dimensions', 'Burnout status at dimensions'],
  ['Wellness averages', 'Wellness averages'],
  ['Weekly pulse context', 'Weekly pulse context'],
  ['Exercise and activity', 'Exercise at activity'],
  ['Recommendations', 'Mga rekomendasyon'],
  ['Signals', 'Mga signal'],
  ['Insight: ', 'Insight: '],
  ['Important: ', 'Mahalaga: '],
  ['Indicator guide: ', 'Gabay sa indicator: '],
  ['Good', 'Maganda'],
  ['Okay', 'Okay'],
  ['Warning', 'Bantayan'],
  ['High risk', 'Mataas na risk'],
  ['AI-generated', 'AI-generated'],
  ['Limited', 'Limitado'],
  ['Very limited', 'Napakalimitado'],
  ['No data', 'Walang data'],
  ['Good coverage', 'Magandang coverage'],
  ['Okay coverage', 'Okay na coverage'],
  ['Limited data', 'Limitadong data'],
  ['Very limited data', 'Napakalimitadong data'],
  ['Unknown', 'Hindi alam'],
  ['low', 'mababa'],
  ['moderate', 'katamtaman'],
  ['high', 'mataas'],
  ['critical', 'kailangan ng suporta'],
  ['Latest risk level', 'Pinakabagong risk level'],
  ['Overall burnout score', 'Kabuuang burnout score'],
  ['Emotional exhaustion', 'Emotional exhaustion'],
  ['Detachment', 'Detachment'],
  ['Reduced accomplishment', 'Reduced accomplishment'],
  ['Latest result', 'Pinakabagong resulta'],
  ['Metric', 'Metric'],
  ['Value', 'Value'],
  ['Indicator', 'Indicator'],
  ['Period', 'Period'],
  ['Sleep', 'Tulog'],
  ['Mood', 'Mood'],
  ['Energy', 'Energy'],
  ['Logged days', 'Mga araw na naka-log'],
  ['Pressure', 'Pressure'],
  ['Recovery', 'Recovery'],
  ['Focus', 'Focus'],
  ['Accomplishment', 'Accomplishment'],
  ['Pulses', 'Pulse logs'],
  ['Avg steps/day', 'Avg steps/araw'],
  ['Avg active time', 'Avg active time'],
  ['Avg calories/logged day', 'Avg calories/logged day'],
  ['Last 7 days', 'Huling 7 araw'],
  ['Last 30 days', 'Huling 30 araw'],
  ['Previous 30 days', 'Nakaraang 30 araw'],
  ['Last 365 days', 'Huling 365 araw'],
  ['This report supports personal wellness tracking and is not medical advice, a diagnosis, or treatment. Color indicators summarize app-defined patterns and should be read alongside the underlying values and data coverage.', 'Ang report na ito ay suporta para sa personal wellness tracking at hindi medical advice, diagnosis, o treatment. Ang color indicators ay buod ng app-defined patterns at dapat basahin kasama ng aktwal na values at data coverage.'],
  ['The following suggestions are AI-generated from the aggregated values in this report.', 'Ang mga sumusunod na suggestion ay AI-generated mula sa pinagsama-samang values sa report na ito.'],
  ['There is not enough recent data to summarize a reliable wellness pattern.', 'Kulang pa ang recent data para makagawa ng maaasahang buod ng wellness pattern.'],
  ['No burnout score is available for the selected reporting period, so a current risk pattern cannot be summarized.', 'Walang burnout score para sa napiling period, kaya hindi pa maibuod ang kasalukuyang risk pattern.'],
  ['No recent burnout score is available.', 'Walang recent burnout score.'],
  ['No short daily logs were recorded in the last 30 days, so recent sleep, mood, and energy patterns cannot be compared.', 'Walang short daily logs sa huling 30 araw, kaya hindi pa maikukumpara ang recent sleep, mood, at energy patterns.'],
  ['No wellness logs were recorded in the last 30 days.', 'Walang wellness logs sa huling 30 araw.'],
  ['No weekly pulse was recorded in the last 30 days, so pressure, recovery, detachment, focus, and accomplishment context is unavailable.', 'Walang weekly pulse sa huling 30 araw, kaya wala pang context para sa pressure, recovery, detachment, focus, at accomplishment.'],
  ['No weekly pulse was recorded in the last 30 days.', 'Walang weekly pulse sa huling 30 araw.'],
  ['No activity logs were recorded in the last 30 days, so recent movement patterns cannot be compared.', 'Walang activity logs sa huling 30 araw, kaya hindi pa maikukumpara ang recent movement patterns.'],
  ['No activity logs were recorded in the last 30 days.', 'Walang activity logs sa huling 30 araw.'],
  ['Protect recovery time this week by reducing nonessential load, adding regular breaks, and checking in with a trusted person or qualified professional if concerns persist.', 'Protektahan ang recovery time ngayong linggo: bawasan ang hindi kailangang load, mag-regular breaks, at lumapit sa pinagkakatiwalaang tao o qualified professional kung tuloy-tuloy ang concern.'],
  ['Choose one realistic sleep routine to repeat consistently, such as a regular wind-down time or a steadier wake time.', 'Pumili ng isang realistic na sleep routine na kayang ulitin, gaya ng regular wind-down time o mas steady na wake time.'],
  ['Plan short recovery pauses around the most demanding part of the week and compare pressure at the next weekly pulse.', 'Magplano ng maiikling recovery pause sa pinakamabigat na bahagi ng linggo at ikumpara ang pressure sa susunod na weekly pulse.'],
  ['Add a manageable block of movement to a routine you already have, then increase it gradually if it feels sustainable.', 'Magdagdag ng kayang movement block sa routine mo, saka dahan-dahang dagdagan kung sustainable ang pakiramdam.'],
  ['Keep short daily logs and weekly pulses consistent so future comparisons are based on a clearer pattern.', 'Panatilihing consistent ang short daily logs at weekly pulses para mas malinaw ang basehan ng future comparisons.'],
  ['Keep the routines that support your current pattern and continue logging so changes are easier to notice early.', 'Ipagpatuloy ang routines na sumusuporta sa current pattern mo at mag-log para mas madaling mapansin ang pagbabago.'],
  ['Review the next 30-day report for meaningful shifts in daily signals, weekly context, and activity rather than reacting to one entry.', 'I-review ang susunod na 30-day report para sa makabuluhang pagbabago sa daily signals, weekly context, at activity, sa halip na mag-base sa isang entry.'],
]);

export function reportText(value, locale) {
  if (normalizeLocale(locale) !== 'fil' || typeof value !== 'string') return value;
  const exact = TAGALOG_REPORT_COPY.get(value);
  if (exact) return exact;

  const rules = [
    [/^The current report contains (.+)\. Review the section-level indicators for the specific values behind this summary\.$/, (_, summary) => `Ang current report ay may ${summary === 'mostly supportive signals' ? 'karamihan ay supportive na signals' : summary === 'generally steady signals' ? 'generally steady na signals' : summary === 'some warning signals worth watching' ? 'ilang warning signals na dapat bantayan' : 'high-risk signals na kailangang bigyang-pansin'}. Tingnan ang section indicators para sa specific values sa likod ng buod na ito.`],
    [/^The latest burnout result is (.+) with a (.+) status\.(.*)$/, (_, score, status, extra) => `Ang latest burnout result ay ${score} na may ${reportText(status, 'fil')} na status.${extra}`],
    [/^Latest overall burnout status is (.+?)( at .+)?\.$/, (_, status, score = '') => `Ang latest overall burnout status ay ${reportText(status, 'fil')}${score}.`],
    [/^(.+) is (.+)\/100\.$/, (_, label, score) => `${reportText(label, 'fil')} ay ${score}/100.`],
    [/^Sleep averaged (.+) across the last 30 days\.$/, (_, value) => `Ang average na tulog ay ${value} sa huling 30 araw.`],
    [/^Mood averaged (.+) across the last 30 days\.$/, (_, value) => `Ang average mood ay ${value} sa huling 30 araw.`],
    [/^Energy averaged (.+) across the last 30 days\.$/, (_, value) => `Ang average energy ay ${value} sa huling 30 araw.`],
    [/^(\d+) of (\d+) days include a wellness log\.$/, (_, count, total) => `${count} sa ${total} araw ang may wellness log.`],
    [/^Pressure averaged (.+) across recent weekly pulses\.$/, (_, value) => `Ang average pressure ay ${value} sa recent weekly pulses.`],
    [/^Recovery and rest averaged (.+)\.$/, (_, value) => `Ang average recovery at rest ay ${value}.`],
    [/^Detachment averaged (.+)\.$/, (_, value) => `Ang average detachment ay ${value}.`],
    [/^Focus averaged (.+)\.$/, (_, value) => `Ang average focus ay ${value}.`],
    [/^Accomplishment averaged (.+)\.$/, (_, value) => `Ang average accomplishment ay ${value}.`],
    [/^(\d+) of (\d+) expected weekly pulses are available\.$/, (_, count, total) => `${count} sa ${total} expected weekly pulses ang available.`],
    [/^Daily steps averaged (.+) in the last 30 days\.$/, (_, value) => `Ang average daily steps ay ${value} sa huling 30 araw.`],
    [/^Active time averaged (.+)\.$/, (_, value) => `Ang average active time ay ${value}.`],
    [/^(\d+) of (\d+) days include an activity log\.$/, (_, count, total) => `${count} sa ${total} araw ang may activity log.`],
    [/^Across (\d+) short daily logs, the 30-day averages are (.+) of sleep, (.+) mood, and (.+) energy\.(.*)$/, (_, count, sleep, mood, energy, extra) => `Sa ${count} short daily logs, ang 30-day averages ay ${sleep} na tulog, ${mood} mood, at ${energy} energy.${extra}`],
    [/^Across (\d+) weekly pulses?, pressure averaged (.+), recovery (.+), detachment (.+), focus (.+), and accomplishment (.+)\.$/, (_, count, pressure, recovery, detachment, focus, accomplishment) => `Sa ${count} weekly pulse, ang averages ay ${pressure} pressure, ${recovery} recovery, ${detachment} detachment, ${focus} focus, at ${accomplishment} accomplishment.`],
    [/^Across (\d+) logged days, activity averaged (.+), (.+), and (.+) per day\.(.*)$/, (_, count, steps, active, calories, extra) => `Sa ${count} logged days, ang daily activity averages ay ${steps}, ${active}, at ${calories}.${extra}`],
  ];
  for (const [pattern, replacement] of rules) {
    if (pattern.test(value)) return value.replace(pattern, replacement);
  }
  return value;
}

export function localizeReportInsights(insights, locale) {
  if (!insights || normalizeLocale(locale) !== 'fil') return insights;
  const localizeSection = (section) => ({
    ...section,
    insight: reportText(section.insight, locale),
    signals: (section.signals ?? []).map((signal) => ({
      ...signal,
      label: reportText(signal.label, locale),
      text: reportText(signal.text, locale),
    })),
  });
  return {
    ...insights,
    overview: reportText(insights.overview, locale),
    sections: Object.fromEntries(
      Object.entries(insights.sections).map(([key, section]) => [key, localizeSection(section)]),
    ),
    recommendations: insights.recommendations.map((item) => reportText(item, locale)),
  };
}
