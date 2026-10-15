// Authored actions stay in charge of meaning; AI can soften the surrounding
// wording but cannot choose a new action, severity, or observation.
const ACTIONS = {
  recovery: [
    ['screen_break', 'A little breathing room', 'Before your next task, take a two-minute off-screen pause.', 'Take a pause', 'Kaunting pahinga muna', 'Bago ang susunod na task, mag-pause nang two minutes na walang screen.', 'Mag-pause'],
    ['quiet_break', 'Make room for a reset', 'Find a quiet spot for one short break. This moment can be yours.', 'Take a quiet break', 'Oras para mag-reset', 'Humanap ng tahimik na lugar para sa isang maikling break. Para sa iyo ang oras na ito.', 'Tahimik na break'],
    ['protect_break', 'One thing for yourself', 'Set aside one uninterrupted break today. Keep it small enough to fit.', 'Protect a break', 'Isang bagay para sa sarili', 'Maglaan ng isang break na walang istorbo ngayon. Kahit maikli lang, puwede.', 'Maglaan ng break']
  ],
  workload: [
    ['shrink_task', 'A smaller next step', 'Pick one demanding task and make its next step smaller. Start there.', 'Shrink one task', 'Mas maliit na next step', 'Pumili ng isang mabigat na task at paliitin ang next step. Doon muna magsimula.', 'Paliitin ang task'],
    ['defer_task', 'Give today some space', 'Choose one nonessential task that can wait. Let that space stay open.', 'Defer one task', 'Bigyan ng space ang araw', 'Pumili ng isang hindi kailangang task na puwedeng ipagpaliban. Hayaan munang bakante ang oras.', 'Ipagpaliban ang task'],
    ['set_boundary', 'An ending you can keep', 'Choose a realistic stopping point for one task today.', 'Set a stopping point', 'Hanggang dito muna', 'Pumili ng realistic na stopping point para sa isang task ngayon.', 'Magtakda ng hangganan']
  ],
  progress: [
    ['tiny_step', 'Small counts, too', 'Choose the smallest useful step on your list. Give that one your attention.', 'Choose one step', 'Bilang din ang maliit', 'Piliin ang pinakamaliit na useful step sa listahan mo. Iyon muna ang pagtuunan.', 'Pumili ng isang step'],
    ['define_finish', 'Make the finish visible', 'Write down what finishing one small task would look like today.', 'Define one finish', 'Linawin ang finish line', 'Isulat kung ano ang ibig sabihin ng matapos ang isang maliit na task ngayon.', 'Linawin ang isang task'],
    ['single_task', 'One thing at a time', 'Put the rest of your list aside while you work on one manageable task.', 'Focus on one task', 'Isa-isa lang muna', 'Itabi muna ang ibang nasa listahan habang ginagawa ang isang manageable na task.', 'Isang task muna']
  ],
  connection: [
    ['send_hello', 'A small hello', 'Send a brief hello to someone you trust. It does not need to be a big conversation.', 'Send a hello', 'Kumusta lang muna', 'Mag-send ng maikling kumusta sa taong pinagkakatiwalaan mo. Hindi kailangang mahabang usapan.', 'Mag-send ng kumusta'],
    ['invite_checkin', 'Make room for connection', 'Ask someone you trust when they have time for a short check-in.', 'Arrange a check-in', 'Oras para kumustahan', 'Tanungin ang taong pinagkakatiwalaan mo kung kailan siya may oras para sa maikling kumustahan.', 'Mag-set ng kumustahan'],
    ['share_moment', 'One moment to share', 'Share one small part of your day with someone you feel comfortable with.', 'Share a moment', 'May puwedeng ibahagi', 'Ibahagi ang isang maliit na bahagi ng araw mo sa taong komportable kang kausap.', 'Magbahagi ng sandali']
  ],
  maintenance: [
    ['keep_routine', 'Keep it manageable', 'Choose one recovery routine that fits today. Let simple be enough.', 'Keep one routine', 'Simple lang muna', 'Pumili ng isang recovery routine na kasya sa araw mo. Sapat na ang simple.', 'Isang routine muna'],
    ['save_space', 'A little space for you', 'Leave a small gap between two tasks today for a pause.', 'Leave a small gap', 'Kaunting space para sa iyo', 'Mag-iwan ng kaunting pagitan sa dalawang task ngayon para makapag-pause.', 'Maglaan ng pagitan'],
    ['easy_evening', 'An easier finish', 'Choose one simple way to wind down when your day is done.', 'Plan a wind-down', 'Mas magaan na pagtatapos', 'Pumili ng isang simpleng paraan para mag-wind down sa pagtatapos ng araw.', 'Magplano ng wind-down']
  ],
  data: [
    ['daily_checkin', 'Start with today', 'A quick check-in gives your next suggestion something personal to work with.', 'Log a check-in', 'Magsimula sa ngayon', 'Makakatulong ang quick check-in para mas personal ang susunod na suggestion.', 'Mag-check-in'],
    ['daily_checkin', 'A little context helps', 'When you have a moment, log how today feels. A short check-in is enough.', 'Log a check-in', 'Kaunting context muna', 'Kapag may sandali ka, i-log kung kumusta ang araw. Sapat na ang maikling check-in.', 'Mag-check-in'],
    ['daily_checkin', 'Your day, in a few taps', 'Share a quick check-in when it suits you. We are still learning your pattern.', 'Log a check-in', 'Ang araw mo sa ilang taps', 'Mag-share ng quick check-in kapag kaya mo. Binubuo pa natin ang pattern mo.', 'Mag-check-in']
  ],
  support: [
    ['trusted_support', 'You can ask for support', 'This pattern calls for extra support. Consider reaching out to someone you trust.', 'Reach out', 'Puwedeng humingi ng suporta', 'Kailangan ng dagdag na suporta sa pattern na ito. Pag-isipang lumapit sa taong pinagkakatiwalaan mo.', 'Lumapit sa pinagkakatiwalaan'],
    ['trusted_support', 'Make room for support', 'Recent strain is elevated. A check-in with someone you trust may be a manageable next step.', 'Reach out', 'Maglaan ng puwang sa suporta', 'Mataas ang recent strain. Maaaring maging next step ang kumustahan sa taong pinagkakatiwalaan mo.', 'Lumapit sa pinagkakatiwalaan'],
    ['trusted_support', 'One supportive next step', 'With strain staying elevated, consider telling someone you trust how today is going.', 'Reach out', 'Isang hakbang na may suporta', 'Dahil mataas pa ang strain, pag-isipang sabihin sa taong pinagkakatiwalaan mo kung kumusta ang araw.', 'Lumapit sa pinagkakatiwalaan']
  ]
};

export function wellnessVariants(recommendation, locale = 'en') {
  const focus = recommendation.recommended_focus ?? '';
  const family = recommendation.severity === 'needs support' ? 'support'
    : focus === 'data_completion' ? 'data'
      : /workload|load_reduction|stabilize/.test(focus) ? 'workload'
        : focus === 'progress' ? 'progress' : focus === 'connection' ? 'connection'
          : /maintenance|maintain/.test(focus) ? 'maintenance' : 'recovery';
  return ACTIONS[family].map((row, index) => {
    const offset = locale === 'fil' ? 4 : 1;
    return {
      ...recommendation, title: row[offset], message: row[offset + 1], action_label: row[offset + 2],
      metadata: { ...recommendation.metadata, action_id: row[0], variant_id: `${family}_${index}_${locale}` }
    };
  });
}

export function nutritionVariants(insight, locale = 'en') {
  const focus = insight.metadata.macro_focus;
  const options = {
    protein: [['Add a protein food you enjoy to your next meal.', 'Magdagdag ng protein food na gusto mo sa susunod na meal.'], ['Choose a familiar protein food for your next plate.', 'Pumili ng pamilyar na protein food para sa susunod na plate.'], ['Make room for a protein food in your next meal.', 'Maglaan ng puwang para sa protein food sa susunod na meal.']],
    carbs_fiber: [['Add a grain, starchy vegetable, or fruit you enjoy.', 'Magdagdag ng grain, starchy vegetable, o prutas na gusto mo.'], ['Choose a fiber-rich carb for your next plate.', 'Pumili ng fiber-rich carb para sa susunod na plate.'], ['Make space for a grain or fruit in your next meal.', 'Maglaan ng puwang para sa grain o prutas sa susunod na meal.']],
    healthy_fats: [['Add a small portion of nuts, avocado, or olive oil.', 'Magdagdag ng kaunting nuts, avocado, o olive oil.'], ['Try a small serving of a healthy fat you enjoy.', 'Subukan ang maliit na serving ng healthy fat na gusto mo.'], ['Make room for a little healthy fat in your next plate.', 'Maglaan ng kaunting healthy fat sa susunod na plate.']],
    produce: [['Add a fruit or vegetable you enjoy to your next meal.', 'Magdagdag ng prutas o gulay na gusto mo sa susunod na meal.'], ['Choose a familiar fruit for your next meal.', 'Pumili ng pamilyar na prutas para sa susunod na meal.'], ['Make room for a vegetable on your next plate.', 'Maglaan ng gulay sa susunod na plate.']],
    protein_produce: [['Pair the next carb food with protein or produce.', 'I-pair ang susunod na carb food sa protein o prutas at gulay.'], ['Add a protein food alongside your next carb food.', 'Magdagdag ng protein food kasabay ng susunod na carb food.'], ['Pair your next carb food with a fruit or vegetable.', 'I-pair ang susunod na carb food sa prutas o gulay.']],
    fiber_produce: [['Add a fiber-rich carb or produce to the next plate.', 'Magdagdag ng fiber-rich carb o prutas at gulay sa susunod na plate.'], ['Choose a fiber-rich carb for your next meal.', 'Pumili ng fiber-rich carb para sa susunod na meal.'], ['Add a fruit or vegetable to your next plate.', 'Magdagdag ng prutas o gulay sa susunod na plate.']],
    complete_meal: [['Log your next meal when you have a moment.', 'I-log ang susunod na meal kapag may sandali ka.'], ['Add the foods you had to your meal log.', 'Idagdag ang mga kinain mo sa meal log.'], ['Give your meal log a little detail when it suits you.', 'Dagdagan ng kaunting detalye ang meal log kapag kaya mo.']],
    breakfast_rhythm: [['If it fits your routine, try a simple morning meal.', 'Kung bagay sa routine mo, subukan ang simpleng morning meal.'], ['Consider a practical time for a morning meal.', 'Pag-isipan ang practical na oras para sa morning meal.'], ['Keep a morning meal simple if it suits your day.', 'Gawing simple ang morning meal kung bagay sa araw mo.']],
    meal_timing: [['Try a meal rhythm that feels practical for you.', 'Subukan ang meal rhythm na practical para sa iyo.'], ['Choose a manageable time for your next meal.', 'Pumili ng manageable na oras para sa susunod na meal.'], ['Make space for your next meal in your routine.', 'Maglaan ng oras para sa susunod na meal sa routine mo.']],
    balanced_plate: [['Keep choosing the foods that worked well for you.', 'Ipagpatuloy ang food choices na bagay sa iyo.'], ['Carry that variety into your next meal.', 'Dalhin ang variety na iyon sa susunod na meal.'], ['Keep a familiar balanced mix on your next plate.', 'Panatilihin ang pamilyar na balanced mix sa susunod na plate.']]
  };
  const selected = options[focus] ?? options.balanced_plate;
  return selected.map((pair, index) => {
    const food = ['protein', 'carbs_fiber', 'healthy_fats'].includes(focus) && index > 0
      ? insight.metadata.recommended_foods?.[index - 1] : null;
    const message = food ? (locale === 'fil'
      ? `Kung bagay sa iyo, magdagdag ng ${food} sa susunod na meal.`
      : `If it suits you, add ${food} to your next meal.`) : pair[locale === 'fil' ? 1 : 0];
    return {
    ...insight, message,
    metadata: { ...insight.metadata,
      action_id: `nutrition_${focus}_${food ? String(food).replace(/\W+/g, '_') : ['produce', 'protein_produce', 'fiber_produce', 'breakfast_rhythm', 'meal_timing'].includes(focus) ? index : 0}`,
      variant_id: `nutrition_${focus}_${index}_${locale}`,
      approved_action: message
    }
  }; });
}
