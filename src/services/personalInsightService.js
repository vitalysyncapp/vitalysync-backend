import { getBurnoutPatternSummary } from './burnoutPatternService.js';
import { loadNudgePersonalizationProfile, loadNudgeThrottlePreferences } from './adaptiveNudgeService.js';
import { buildWellnessContext, identifyContent, loadContentHistory, selectContent, personalEvidence } from './wellnessContentService.js';
import { enhanceCompanionWording } from './companionWordingService.js';
import { toUserFacingNudgeSeverity } from './nudgeSeverityPolicy.js';

const OBSERVATIONS = {
  learning: [
    ['Getting to know your pattern', 'There is not enough recent check-in coverage to describe a reliable trend yet.', 'Kinilala pa ang pattern mo', 'Kulang pa ang recent check-ins para mailarawan ang isang maaasahang trend.'],
    ['Your picture is still taking shape', 'Your recent check-ins are a starting point. A longer pattern is not clear yet.', 'Nabubuo pa ang larawan', 'Simula pa lang ang recent check-ins mo. Hindi pa malinaw ang mas mahabang pattern.'],
    ['A little early for conclusions', 'The available check-ins do not yet give enough context for a clear trend.', 'Maaga pa para sa konklusyon', 'Hindi pa sapat ang available check-ins para sa malinaw na trend.']
  ],
  improving: [
    ['A shift worth noticing', 'Your recent check-in scores have eased. That is a change worth noticing.', 'Pagbabagong kapansin-pansin', 'Bumaba ang recent check-in scores mo. Isang pagbabago itong kapansin-pansin.'],
    ['Your recent pattern is easing', 'Your recent check-ins show an improving pattern, rather than rising strain.', 'Gumagaan ang recent pattern', 'May improving pattern sa recent check-ins mo, sa halip na tumataas na strain.'],
    ['A gentler recent trend', 'The recent score trend points toward lower strain in your logged check-ins.', 'Mas magaan na recent trend', 'Mas mababang strain ang ipinapakita ng recent score trend sa logged check-ins mo.']
  ],
  elevated: [
    ['Your recent pattern deserves care', 'Recent check-ins show elevated strain. This reflects the logs available so far.', 'Kailangan ng pag-alaga sa pattern', 'May mataas na strain sa recent check-ins. Naka-base ito sa logs na available ngayon.'],
    ['A pattern to pay attention to', 'Strain is elevated in your recent check-ins. The pattern deserves some attention.', 'Pattern na dapat pansinin', 'Mataas ang strain sa recent check-ins mo. Kailangan ng kaunting atensyon ang pattern.'],
    ['What your check-ins are showing', 'Your recent logged pattern shows elevated strain; it does not define how every moment feels.', 'Ang ipinapakita ng check-ins', 'Mataas ang strain sa recent logged pattern; hindi nito inilalarawan ang bawat sandali.']
  ],
  watch: [
    ['A change to keep in view', 'Your recent check-ins show a pattern worth watching as more context comes in.', 'Pagbabagong dapat bantayan', 'May pattern sa recent check-ins na dapat bantayan habang nadaragdagan ang context.'],
    ['Your recent pattern is shifting', 'There is a watch signal in your recent check-ins. More context can help clarify it.', 'Nagbabago ang recent pattern', 'May watch signal sa recent check-ins mo. Makakatulong ang dagdag na context para luminaw ito.'],
    ['Something to notice', 'Your logged pattern has a watch signal. It is a prompt to pay attention, not a conclusion about you.', 'May dapat mapansin', 'May watch signal sa logged pattern mo. Paalala itong bigyang-pansin, hindi konklusyon tungkol sa iyo.']
  ],
  steady: [
    ['A steadier recent picture', 'Your recent check-ins show no escalating pattern. That describes the logs available so far.', 'Mas steady na recent picture', 'Walang escalating pattern sa recent check-ins mo. Naka-base ito sa logs na available ngayon.'],
    ['What looks steady', 'The available recent check-ins are not showing an escalating strain pattern.', 'Ang mukhang steady', 'Walang escalating strain pattern na ipinapakita ang available recent check-ins.'],
    ['Your recent baseline', 'Your logged check-ins currently show a steady pattern, with no escalating signal detected.', 'Ang recent baseline mo', 'Steady ang pattern sa logged check-ins ngayon, at walang nakitang escalating signal.']
  ]
};

export function buildPersonalInsightCandidates(summary, { context = {}, locale = 'en', now = new Date() } = {}) {
  if (!summary.latest_score && !summary.patterns?.length) return [];
  const state = summary.adaptive_state?.state;
  const confidence = Number(summary.adaptive_state?.confidence_score ?? summary.latest_score?.confidence_score ?? 0);
  const family = confidence < 55 || ['learning', 'insufficient_data'].includes(state) ? 'learning'
    : ['critical', 'high_risk'].includes(state) ? 'elevated'
      : state === 'improving' ? 'improving' : state === 'watch' ? 'watch' : 'steady';
  const end = summary.end_date ?? summary.latest_score?.score_date;
  const source = locale === 'fil'
    ? `Batay sa available check-ins hanggang ${end}. Confidence: ${confidence}/100.`
    : `Based on available check-ins through ${end}. Confidence: ${confidence}/100.`;
  const evidence = [source, personalEvidence(summary, context.profile, 'observation', locale)].filter(Boolean).join(' ');
  const window = summary.windows?.['7_day'];
  const hasComparison = confidence >= 55 && window?.available_days >= 3 &&
    Number.isFinite(window.latest_score) && Number.isFinite(window.delta_from_start);
  const comparison = hasComparison ? (locale === 'fil' ? [
    `Sa ${window.available_days} check-ins nitong 7 araw, mula ${Math.round(window.latest_score - window.delta_from_start)} naging ${Math.round(window.latest_score)} ang score mo.`,
    `Ang latest logged score mo ay ${Math.round(window.latest_score)}/100, kumpara sa ${Math.round(window.latest_score - window.delta_from_start)} sa unang check-in nitong 7 araw.`,
    `${window.available_days} check-ins ang nasa recent picture mo: ${Math.round(window.latest_score - window.delta_from_start)} ang unang score at ${Math.round(window.latest_score)} ang latest.`
  ] : [
    `Across ${window.available_days} check-ins in the past 7 days, your score moved from ${Math.round(window.latest_score - window.delta_from_start)} to ${Math.round(window.latest_score)}.`,
    `Your latest logged score is ${Math.round(window.latest_score)}/100, compared with ${Math.round(window.latest_score - window.delta_from_start)} at your first check-in in the past 7 days.`,
    `${window.available_days} check-ins shape your recent picture: a starting score of ${Math.round(window.latest_score - window.delta_from_start)} and a latest score of ${Math.round(window.latest_score)}.`
  ]) : null;
  return OBSERVATIONS[family].map((row, index) => identifyContent({
    nudge_type: 'personal_insight', title: row[locale === 'fil' ? 2 : 0],
    message: comparison?.[index] ?? row[locale === 'fil' ? 3 : 1], action_label: '',
    priority: summary.adaptive_state?.priority ?? 'low',
    severity: toUserFacingNudgeSeverity(state), confidence_score: confidence,
    trigger_reason: evidence, recommended_focus: 'observation',
    metadata: { action_id: `observe_${family}`, variant_id: `insight_${family}_${index}_${locale}`, evidence }
  }, { surface: 'dashboard', context, locale, now }));
}

export async function getPersonalInsight(client, userId, { locale = 'en', useAi = true } = {}) {
  const summary = await getBurnoutPatternSummary(client, userId);
  const [profile, preferences, history] = await Promise.all([
    loadNudgePersonalizationProfile(client, userId), loadNudgeThrottlePreferences(client, userId),
    loadContentHistory(client, userId)
  ]);
  const context = buildWellnessContext(summary, profile, preferences, locale);
  const candidates = buildPersonalInsightCandidates(summary, { context, locale });
  const insight = selectContent(candidates, history, { persistent: true });
  if (!insight) return null;
  const result = useAi ? await enhanceCompanionWording(insight, {
    locale, style: preferences.preferredNudgeStyle, recentMessages: history.map((event) => event.message)
  }) : insight;
  return { ...result, id: result.metadata.content_id, generated_at: result.metadata.generated_at };
}
