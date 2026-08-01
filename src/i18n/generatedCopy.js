import { normalizeLocale } from './locale.js';

const TAGALOG_COPY = new Map([
  ['Extra support may help', 'Makakatulong ang dagdag na suporta'],
  ['Today calls for extra support. Lower one demand and reach out to someone you trust if needed.', 'Mukhang kailangan mo ng dagdag na suporta ngayon. Bawasan ang isang gawain at lumapit sa taong pinagkakatiwalaan mo kung kailangan.'],
  ['Protect recovery today', 'Unahin ang recovery ngayon'],
  ['Recent strain is staying high. Make one task smaller and protect a real break.', 'Mataas pa rin ang recent strain. Gawing mas maliit ang isang task at maglaan ng totoong break.'],
  ['Recovery is the clearest signal. Protect one real break before your next hard task.', 'Recovery ang pinakamalinaw na signal. Maglaan ng totoong break bago ang susunod na mabigat na task.'],
  ['Take a small reset', 'Mag-small reset muna'],
  ['Pressure is trending up. Take one short reset before the next task.', 'Tumataas ang pressure. Mag-short reset bago ang susunod na task.'],
  ['Keep what is working', 'Ipagpatuloy ang gumagana'],
  ['Your recent pattern is steady. Keep one recovery habit simple today.', 'Steady ang recent pattern mo. Panatilihing simple ang isang recovery habit ngayon.'],
  ['Make workload lighter', 'Pagaanin ang workload'],
  ['Workload is the clearest signal. Make one task smaller today.', 'Workload ang pinakamalinaw na signal. Gawing mas maliit ang isang task ngayon.'],
  ['Shrink the next step', 'Liitan ang next step'],
  ['Progress strain is staying high. Cut one task down to its next manageable step.', 'Mataas pa rin ang progress strain. Hatiin ang isang task sa susunod na kayang gawin na step.'],
  ['Ease the recent load', 'Bawasan ang recent load'],
  ['Pressure has stayed elevated. Make one task smaller today.', 'Mataas pa rin ang pressure. Gawing mas maliit ang isang task ngayon.'],
  ['Protect a recovery break', 'Maglaan ng recovery break'],
  ['Workload is outpacing recovery. Protect one break before the next hard task.', 'Mas mabilis ang workload kaysa recovery. Maglaan ng break bago ang susunod na mabigat na task.'],
  ['Keep the next step steady', 'Panatilihing steady ang next step'],
  ['Recent check-ins have shifted. Keep the next task simple, then pause.', 'Nagbago-bago ang recent check-ins. Panatilihing simple ang susunod na task, tapos mag-pause.'],
  ['Give energy room to recover', 'Bigyan ng oras ang energy na bumawi'],
  ['Emotional energy is the clearest signal. Choose an earlier wind-down tonight.', 'Emotional energy ang pinakamalinaw na signal. Mag-wind down nang mas maaga ngayong gabi.'],
  ['Make space for recovery', 'Maglaan ng space para sa recovery'],
  ['Recovery is the clearest signal. Take one off-screen break before your next task.', 'Recovery ang pinakamalinaw na signal. Mag-off-screen break bago ang susunod na task.'],
  ['Reconnect in one small way', 'Mag-reconnect sa maliit na paraan'],
  ['Connection is the clearest signal. Check in briefly with someone you trust.', 'Connection ang pinakamalinaw na signal. Kumustahin sandali ang taong pinagkakatiwalaan mo.'],
  ['Make one win visible', 'Gawing visible ang isang win'],
  ['Progress feels harder in recent check-ins. Finish one small task and mark it done.', 'Mas mahirap ang progress sa recent check-ins. Tapusin ang isang maliit na task at markahan itong done.'],
  ['Build a clearer pattern', 'Bumuo ng mas malinaw na pattern'],
  ['Recent coverage is limited. Complete the check-in currently due when you can.', 'Kulang pa ang recent data. Kumpletuhin ang kasalukuyang check-in kapag kaya mo.'],
  ['Build your recent pattern', 'Buuin ang recent pattern mo'],
  ['A few recent check-ins will make guidance clearer. Log one quick check-in today.', 'Makakatulong ang ilang recent check-in para luminaw ang guidance. Mag-log ng isang mabilis na check-in ngayon.'],
  ['Keep what is helping', 'Ipagpatuloy ang nakakatulong'],
  ['Your recent pattern is improving. Keep one recovery habit simple today.', 'Gumaganda ang recent pattern mo. Panatilihing simple ang isang recovery habit ngayon.'],
  ['Reach out', 'Lumapit sa iba'],
  ['Reduce one task', 'Bawasan ang isang task'],
  ['Protect a break', 'Maglaan ng break'],
  ['Take a reset', 'Mag-reset muna'],
  ['Shrink one task', 'Liitan ang isang task'],
  ['Simplify one task', 'Pasimplehin ang isang task'],
  ['Wind down earlier', 'Mag-wind down nang maaga'],
  ['Take a break', 'Mag-break muna'],
  ['Check in', 'Kumustahin sila'],
  ['Finish one task', 'Tapusin ang isang task'],
  ['Complete check-in', 'Kumpletuhin ang check-in'],
  ['Log today', 'Mag-log ngayon'],
  ['Keep it simple', 'Panatilihing simple'],
  ['More recent check-ins needed', 'Kailangan pa ng recent check-ins'],
  ['Burnout risk is rising', 'Tumataas ang wellness risk'],
  ['Risk has stayed elevated', 'Mataas pa rin ang wellness risk'],
  ['Recent recovery is improving', 'Gumaganda ang recent recovery'],
  ['Risk is fluctuating', 'Nagbabago-bago ang wellness risk'],
  ['High load with weak recovery', 'Mataas ang load at kulang ang recovery'],
  ['Score confidence is limited', 'Limitado pa ang score confidence'],
  ['Pattern is currently stable', 'Stable ang kasalukuyang pattern'],
  ['Emotional exhaustion', 'Emotional exhaustion'],
  ['Detachment', 'Detachment'],
  ['Reduced accomplishment', 'Reduced accomplishment'],
  ['Workload strain', 'Workload strain'],
  ['Recovery deficit', 'Recovery deficit'],
  ['More data needed', 'Kailangan pa ng data'],
  ['Limited confidence', 'Limitado pa ang confidence'],
  ['Critical pattern', 'Pattern na kailangan ng suporta'],
  ['High risk pattern', 'Mataas na risk pattern'],
  ['Watch trend', 'Bantayan ang trend'],
  ['Improving', 'Gumaganda'],
  ['Stable', 'Stable'],
  ['Recent score coverage is too low for adaptive decisions.', 'Masyadong kulang ang recent score coverage para sa adaptive decisions.'],
  ['Recent daily signals or weekly context are incomplete.', 'Hindi pa kumpleto ang recent daily signals o weekly context.'],
  ['Recent risk is trending down.', 'Bumababa ang recent risk trend.'],
  ['No escalating pattern detected.', 'Walang nakitang tumataas na pattern.'],
  ['VitalySync needs more recent score snapshots before making a strong pattern call.', 'Kailangan pa ng VitalySync ng recent score snapshots bago gumawa ng malinaw na pattern summary.'],
  ['The recent score trend is moving upward fast enough to treat it as a short-term signal.', 'Mabilis na tumataas ang recent score trend kaya dapat itong bantayan bilang short-term signal.'],
  ['The medium-range average is high, which is more important than a single difficult day.', 'Mataas ang medium-range average, na mas mahalagang pattern kaysa sa isang mahirap na araw.'],
  ['The recent score trend is moving down, which suggests the current routine may be helping.', 'Bumababa ang recent score trend, kaya posibleng nakakatulong ang current routine.'],
  ['Recent scores are moving sharply between days, so the app should avoid overreacting to one entry.', 'Malaki ang pagbabago ng recent scores kada araw, kaya hindi dapat mag-base sa isang entry lang.'],
  ['Among the tracked dimensions, this area is contributing the most to the current pattern.', 'Sa tracked dimensions, ito ang may pinakamalaking ambag sa current pattern.'],
  ['Workload strain and recovery deficit are both high, which is a strong adaptive nudge trigger.', 'Parehong mataas ang workload strain at recovery deficit, kaya malinaw itong signal para sa adaptive nudge.'],
  ['Recent check-ins have limited coverage, so recommendations should stay gentle until the daily signals and weekly context are clearer.', 'Limitado ang coverage ng recent check-ins, kaya gentle muna ang recommendations habang hinihintay ang mas malinaw na daily signals at weekly context.'],
  ['Recent scores are not showing a sharp rise or sustained high-risk pattern.', 'Walang matarik na pagtaas o tuloy-tuloy na high-risk pattern sa recent scores.'],
  ['Add a protein food', 'Magdagdag ng protein food'],
  ['Add fruit or vegetables', 'Magdagdag ng prutas o gulay'],
  ['Check your morning rhythm', 'I-check ang morning rhythm mo'],
  ['Pair carbs with balance', 'I-balance ang carbs'],
  ['Try a steadier meal rhythm', 'Subukan ang mas steady na meal rhythm'],
  ['Add meal details', 'Magdagdag ng meal details'],
  ['Log your next meal', 'I-log ang susunod mong meal'],
  ['Add protein next', 'Magdagdag ng protein sa susunod'],
  ['Add fiber-rich carbs', 'Magdagdag ng fiber-rich carbs'],
  ['Add healthy fats', 'Magdagdag ng healthy fats'],
  ['Balance carbs with protein', 'I-balance ang carbs sa protein'],
  ['Add fiber and produce', 'Magdagdag ng fiber at produce'],
  ['Add produce', 'Magdagdag ng prutas o gulay'],
  ['Keep the plate balanced', 'Panatilihing balanced ang plate'],
  ["Today's meal log has limited detail. Add the foods you had so suggestions can use the log accurately.", 'Kulang pa ang details ng meal log ngayon. Idagdag ang mga kinain mo para mas akma ang suggestions.'],
  ['No meals are logged today. Log your next meal so suggestions can reflect what you actually ate.', 'Wala pang meal na naka-log ngayon. I-log ang susunod mong meal para naka-base ang suggestions sa aktwal mong kinain.'],
  ["Protein looks light in today's logged meals. Add a protein food you enjoy to your next meal.", 'Mukhang kaunti ang protein sa meals na naka-log ngayon. Magdagdag ng protein food na gusto mo sa susunod na meal.'],
  ["Fiber-rich carbs look light in today's logs. Add a grain, starchy vegetable, or fruit you enjoy.", 'Mukhang kaunti ang fiber-rich carbs sa logs ngayon. Magdagdag ng grain, starchy vegetable, o prutas na gusto mo.'],
  ["Healthy fats look light in today's logs. Add a small portion of nuts, avocado, or olive oil.", 'Mukhang kaunti ang healthy fats sa logs ngayon. Magdagdag ng kaunting nuts, avocado, o olive oil.'],
  ["Carbs make up most of today's logged balance. Pair the next carb food with protein or produce.", 'Carbs ang malaking bahagi ng naka-log ngayon. I-pair ang susunod na carb food sa protein o prutas at gulay.'],
  ["Fats make up most of today's logged balance. Add a fiber-rich carb or produce to the next plate.", 'Fats ang malaking bahagi ng naka-log ngayon. Magdagdag ng fiber-rich carb o prutas at gulay sa susunod na plate.'],
  ["Produce is missing from today's logged foods. Add a fruit or vegetable you enjoy to your next meal.", 'Walang prutas o gulay sa foods na naka-log ngayon. Magdagdag ng gusto mong prutas o gulay sa susunod na meal.'],
  ["Today's logged meals show a balanced mix. Keep choosing the foods that worked well for you.", 'Balanced ang mix ng meals na naka-log ngayon. Ipagpatuloy ang food choices na gumagana para sa iyo.'],
]);

function tagalogCopy(value) {
  if (typeof value !== 'string') return value;
  const exact = TAGALOG_COPY.get(value);
  if (exact) return exact;

  const curatedPrefixes = [
    ['A steady choice: ', 'Isang steady na choice: '],
    ['A gentle option: ', 'Isang gentle na option: '],
    ['Nice work - ', 'Nice work—'],
    ['One easy next step: ', 'Isang madaling next step: '],
  ];
  for (const [prefix, localizedPrefix] of curatedPrefixes) {
    if (value.startsWith(prefix)) {
      const source = value.slice(prefix.length);
      const sentence = `${source[0].toUpperCase()}${source.slice(1)}`;
      const localized = TAGALOG_COPY.get(sentence) ?? tagalogCopy(sentence);
      return `${localizedPrefix}${localized[0].toLowerCase()}${localized.slice(1)}`;
    }
  }

  const personalized = value.match(/^([^,]{1,36}), (.+)$/);
  if (personalized) {
    const sentence = `${personalized[2][0].toUpperCase()}${personalized[2].slice(1)}`;
    const localized = TAGALOG_COPY.get(sentence);
    if (localized) return `${personalized[1]}, ${localized[0].toLowerCase()}${localized.slice(1)}`;
  }

  const patternRules = [
    [/^(.+) is the strongest signal$/, (_, label) => `${tagalogCopy(label)} ang pinakamalinaw na signal`],
    [/^Protein was light in (\d+) recent logged days\. Add a protein food you enjoy to your next meal\.$/, (_, count) => `Kaunti ang protein sa ${count} recent logged days. Magdagdag ng protein food na gusto mo sa susunod na meal.`],
    [/^Produce was missing from (\d+) recent logged days\. Add a fruit or vegetable you enjoy to your next meal\.$/, (_, count) => `Walang prutas o gulay sa ${count} recent logged days. Magdagdag ng gusto mong prutas o gulay sa susunod na meal.`],
    [/^Breakfast was not logged on (\d+) recent logged days\. If it fits your routine, try a simple morning meal\.$/, (_, count) => `Walang breakfast log sa ${count} recent days. Kung akma sa routine mo, subukan ang simpleng morning meal.`],
    [/^Carbs made up most of (\d+) recent logged days\. Pair your next carb food with protein or produce\.$/, (_, count) => `Carbs ang malaking bahagi ng ${count} recent logged days. I-pair ang susunod na carb food sa protein o prutas at gulay.`],
    [/^Long gaps appeared between logged meals on (\d+) recent days\. Try a meal rhythm that feels practical for you\.$/, (_, count) => `May mahahabang pagitan sa logged meals sa ${count} recent days. Subukan ang meal rhythm na practical para sa iyo.`],
  ];
  for (const [pattern, replacement] of patternRules) {
    if (pattern.test(value)) return value.replace(pattern, replacement);
  }
  return value;
}

export function localizeNudgeRecommendation(recommendation, locale) {
  if (!recommendation) return recommendation;
  const normalizedLocale = normalizeLocale(locale);
  if (normalizedLocale !== 'fil') {
    return {
      ...recommendation,
      metadata: {
        ...recommendation.metadata,
        locale: 'en',
        message_key: recommendation.metadata?.message_key ?? `nudge.${recommendation.nudge_type}`,
      },
    };
  }
  return {
    ...recommendation,
    title: tagalogCopy(recommendation.title),
    message: tagalogCopy(recommendation.message),
    action_label: tagalogCopy(recommendation.action_label),
    trigger_reason: tagalogCopy(recommendation.trigger_reason),
    metadata: {
      ...recommendation.metadata,
      locale: 'fil',
      message_key: recommendation.metadata?.message_key ?? `nudge.${recommendation.nudge_type}`,
    },
  };
}

export function localizeNutritionNudge(insight, locale) {
  if (!insight) return insight;
  const normalizedLocale = normalizeLocale(locale);
  if (normalizedLocale !== 'fil') {
    return {
      ...insight,
      metadata: { ...insight.metadata, locale: 'en', message_key: `nutrition.${insight.metadata?.macro_focus ?? 'general'}` },
    };
  }
  return {
    ...insight,
    title: tagalogCopy(insight.title),
    message: tagalogCopy(insight.message),
    metadata: {
      ...insight.metadata,
      locale: 'fil',
      message_key: `nutrition.${insight.metadata?.macro_focus ?? 'general'}`,
    },
  };
}

export function localizeAdaptiveSummary(summary, locale) {
  if (!summary || normalizeLocale(locale) !== 'fil') return summary;
  return {
    ...summary,
    patterns: (summary.patterns ?? []).map((pattern) => ({
      ...pattern,
      title: tagalogCopy(pattern.title),
      message: tagalogCopy(pattern.message),
    })),
    adaptive_state: summary.adaptive_state
      ? {
          ...summary.adaptive_state,
          label: tagalogCopy(summary.adaptive_state.label),
          reason: tagalogCopy(summary.adaptive_state.reason),
        }
      : summary.adaptive_state,
  };
}

export { tagalogCopy };
