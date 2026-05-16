'use strict';

/**
 * Phase G-4: 生活場面ベースのセルフケア（専門用語を使わない短文メニュー）
 * 返信本文は line_natural / ChatGPT が組み立てる前提で、構造化データと検出のみ担当。
 */

const SCENES = {
  morning_in_bed: 'morning_in_bed',
  bath_relax: 'bath_relax',
  chair_reset: 'chair_reset',
  before_sleep: 'before_sleep',
  after_activity: 'after_activity',
};

/** 利用者向けメニュー（禁止語に近い解剖名は使わない） */
const EXERCISES = {
  ankle_pat_bed: {
    scene: SCENES.morning_in_bed,
    bodyRegion: 'lower_leg',
    purpose: '足首とふくらはぎを起こす',
    userFriendlyName: '足首ぱたぱた',
    userFriendlyInstructions:
      '仰向けのまま、つま先を上げる、下げる。左右10回ずつ。',
    reps: '左右10回ずつ',
    intensity: '痛みは0〜10のうち0〜3まで。「少し張る」か「痛気持ちいい手前」まで。',
    stopCondition:
      'ズキッとする痛み、しびれ、痛みが強くなる、終わったあと悪化、めまい・ふらつき、息苦しさで中止。',
    avoidIf: 'めまいが強い日、足を高く上げると気持ち悪くなる時はやらない。',
    followupPrompt: '終わったら「楽・変わらない・痛い・しびれ」で教えてください。',
  },
  knee_sway_bed: {
    scene: SCENES.morning_in_bed,
    bodyRegion: 'lumbar_pelvis',
    purpose: '腰まわりを大きく動かさず起こす',
    userFriendlyName: '膝ゆらし',
    userFriendlyInstructions:
      '仰向けのまま膝を立てて、両膝を小さく左右にゆらす。大きく倒さなくて大丈夫です。',
    reps: 'まず10回だけ',
    intensity: '痛みは0〜10のうち0〜3まで。「少し張る」か「痛気持ちいい手前」まで。',
    stopCondition:
      'ズキッとする痛み、しびれ、痛みが強くなる、終わったあと悪化、めまい・ふらつき、息苦しさで中止。',
    avoidIf: '鋭い腰痛の急性期は控えめに、無理なら中止。',
    followupPrompt: '終わったら「楽・変わらない・痛い・しびれ」で教えてください。',
  },
  knee_flex_one_leg_bed: {
    scene: SCENES.morning_in_bed,
    bodyRegion: 'hip_knee',
    purpose: '股関節まわりをやさしく起こす',
    userFriendlyName: '片足ずつ膝の曲げ伸ばし',
    userFriendlyInstructions:
      '仰向けのまま、片方の膝をゆっくり曲げる。次に、ゆっくり伸ばす。腰が反らないくらいの小さな動きで大丈夫です。',
    reps: '左右5回ずつ',
    intensity: '痛みは0〜10のうち0〜3まで。「少し張る」か「痛気持ちいい手前」まで。',
    stopCondition:
      'ズキッとする痛み、しびれ、痛みが強くなる、終わったあと悪化、めまい・ふらつき、息苦しさで中止。',
    avoidIf: '股関節に引っかかる痛みがある時は中止。',
    followupPrompt: '終わったら「楽・変わらない・痛い・しびれ」で教えてください。',
  },
  hand_foot_shake_bed: {
    scene: SCENES.morning_in_bed,
    bodyRegion: 'general',
    purpose: '手足をゆるめて血流を整える',
    userFriendlyName: '手足ぶらぶら体操',
    userFriendlyInstructions:
      '仰向けのまま、両手と両足を少し上げます。手首と足首を小さくぶらぶら揺らします。力を入れすぎず、ゆるく動かしてください。',
    reps: 'まず10秒だけ',
    intensity: '痛みは0〜10のうち0〜3まで。「少し張る」か「痛気持ちいい手前」まで。',
    stopCondition:
      'ズキッとする痛み、しびれ、痛みが強くなる、終わったあと悪化、めまい・ふらつき、息苦しさで中止。',
    avoidIf: '腰が反りやすい人は足を高く上げない。首に力を入れない。めまいがある日はやらない。',
    followupPrompt: '終わったら「楽・変わらない・痛い・しびれ」で教えてください。',
  },
  small_bicycle_bed: {
    scene: SCENES.morning_in_bed,
    bodyRegion: 'hip_knee',
    purpose: '脚を軽く回して起こす',
    userFriendlyName: '小さな自転車こぎ',
    userFriendlyInstructions:
      '仰向けのまま、膝を軽く曲げて、空中で小さく自転車をこぐように動かします。大きく回さなくて大丈夫です。',
    reps: 'まず5回ずつ',
    intensity: '痛みは0〜10のうち0〜3まで。「少し張る」か「痛気持ちいい手前」まで。',
    stopCondition:
      'ズキッとする痛み、しびれ、痛みが強くなる、終わったあと悪化、めまい・ふらつき、息苦しさで中止。',
    avoidIf: '腰が反る感じがある時はやらない。腰痛が強い日は無理にしない。股関節に引っかかる痛みがある時も中止。',
    followupPrompt: '終わったら「楽・変わらない・痛い・しびれ」で教えてください。',
  },
  side_lying_getup: {
    scene: SCENES.morning_in_bed,
    bodyRegion: 'lumbar_pelvis',
    purpose: '起き上がりの負担を減らす',
    userFriendlyName: '横向き起き上がり',
    userFriendlyInstructions:
      '起きる時は、まっすぐ腹筋で起き上がらず、一度横向きになってから、手で布団を押して起きる。',
    reps: 'そのまま1セット',
    intensity: '痛みは0〜10のうち0〜3まで。無理に起きない。',
    stopCondition: '痛みが強くなる、しびれ、めまいで中止。',
    avoidIf: 'めまいが強い日はゆっくり。転倒しそうなら中止。',
    followupPrompt: '終わったら「楽・変わらない・痛い・しびれ」で教えてください。',
  },
  bath_round_back: {
    scene: SCENES.bath_relax,
    bodyRegion: 'lumbar_pelvis',
    purpose: '温まった状態で腰・背中を休ませる',
    userFriendlyName: '湯船で背中を丸める',
    userFriendlyInstructions:
      '湯船の中で、無理のない姿勢で座ります。両手を膝か太ももに置いて、背中を少し丸めます。息を止めず、ゆっくり吐きます。',
    reps: '10秒だけ',
    intensity: '痛みは0〜10のうち0〜3まで。無理に伸ばさない。',
    stopCondition:
      'のぼせ、動悸、息苦しめまい、ふらつき、しびれ増、痛み増で中止。滑りやすいので急がない。',
    avoidIf: 'のぼせる、ふらつく、滑りそうな時はやらない。動悸・息苦しさがある時も中止。',
    followupPrompt: '終わったら「楽・変わらない・痛い・しびれ」で教えてください。',
  },
  bath_knee_to_chest: {
    scene: SCENES.bath_relax,
    bodyRegion: 'lumbar_pelvis',
    purpose: '腰・お尻をやわらげる',
    userFriendlyName: '湯船で片膝を胸に近づける',
    userFriendlyInstructions:
      '湯船の中で座ったまま、片方の膝を胸の方に少しだけ近づけます。腰やお尻がじんわり伸びるくらいで止めます。',
    reps: '左右10秒ずつ',
    intensity: '痛みは0〜10のうち0〜3まで。',
    stopCondition: 'のぼせ、動悸、息苦しめまい、ふらつき、痛み増、しびれで中止。',
    avoidIf: 'のぼせやすい人、滑って危ないと感じたらやらない。',
    followupPrompt: '終わったら「楽・変わらない・痛い・しびれ」で教えてください。',
  },
  bath_shrug_drop: {
    scene: SCENES.bath_relax,
    bodyRegion: 'shoulder',
    purpose: '肩の力を抜く',
    userFriendlyName: '湯船で肩すくめストン',
    userFriendlyInstructions: '肩を少しすくめて、ストンと力を抜きます。',
    reps: '10回だけ',
    intensity: '痛みは0〜10のうち0〜3まで。',
    stopCondition: 'のぼせ、めまい、ふらつき、息苦しさで中止。',
    avoidIf: 'のぼせやすい人は短く、無理ならやらない。',
    followupPrompt: '終わったら「楽・変わらない・痛い・しびれ」で教えてください。',
  },
  bath_short_seiza: {
    scene: SCENES.bath_relax,
    bodyRegion: 'knee',
    purpose: '膝に負担が少ない人だけ足首まわりを整える',
    userFriendlyName: '膝が痛くない人だけ短い正座に近い姿勢',
    userFriendlyInstructions:
      '膝が痛くなければ、湯船の中で短い時間だけ正座に近い姿勢を取ります。腰を反らさず、少し丸めて10秒。',
    reps: '10秒',
    intensity: '痛みは0〜10のうち0〜3まで。',
    stopCondition: '膝痛、のぼせ、めまい、ふらつきで中止。',
    avoidIf: '膝が痛い人はやらなくて大丈夫。のぼせやすい人は控える。',
    followupPrompt: '終わったら「楽・変わらない・痛い・しびれ」で教えてください。',
  },
  chair_round_straight: {
    scene: SCENES.chair_reset,
    bodyRegion: 'spine_posture',
    purpose: '座りっぱなしの背中をゆるめる',
    userFriendlyName: '背中丸め → 背すじ起こし',
    userFriendlyInstructions:
      '椅子に浅く座ります。背中を少し丸める。次に、背すじを少し起こす。',
    reps: 'ゆっくり10回',
    intensity: '痛みは0〜10のうち0〜3まで。「少し張る」か「痛気持ちいい手前」まで。',
    stopCondition: 'ズキッとする痛み、しびれ、めまい、痛み増で中止。',
    avoidIf: '立ち上がりでふらつく日はゆっくり。',
    followupPrompt: '終わったら「楽・変わらない・痛い・しびれ」で教えてください。',
  },
  chair_shrug_drop: {
    scene: SCENES.chair_reset,
    bodyRegion: 'shoulder',
    purpose: '肩の力を抜く',
    userFriendlyName: '肩すくめストン',
    userFriendlyInstructions: '肩を少しすくめて、ストンと力を抜く。',
    reps: '10回',
    intensity: '痛みは0〜10のうち0〜3まで。',
    stopCondition: 'しびれ、痛み増、めまいで中止。',
    avoidIf: '',
    followupPrompt: '終わったら「楽・変わらない・痛い・しびれ」で教えてください。',
  },
  chair_knee_extend: {
    scene: SCENES.chair_reset,
    bodyRegion: 'knee',
    purpose: '膝をゆっくり伸ばす',
    userFriendlyName: '膝伸ばし',
    userFriendlyInstructions:
      '椅子に座って、片足ずつ膝をゆっくり伸ばします。つま先を軽く上に向けて。',
    reps: '左右5回ずつ',
    intensity: '痛みは0〜10のうち0〜3まで。',
    stopCondition: '膝の鋭痛、しびれ、めまいで中止。',
    avoidIf: '',
    followupPrompt: '終わったら「楽・変わらない・痛い・しびれ」で教えてください。',
  },
  chair_ankle_pat: {
    scene: SCENES.chair_reset,
    bodyRegion: 'lower_leg',
    purpose: '足首を起こす',
    userFriendlyName: '足首ぱたぱた',
    userFriendlyInstructions: '椅子に座ったまま、つま先を上げる、下げる。',
    reps: '左右10回ずつ',
    intensity: '痛みは0〜10のうち0〜3まで。',
    stopCondition: 'しびれ、痛み増、めまいで中止。',
    avoidIf: '',
    followupPrompt: '終わったら「楽・変わらない・痛い・しびれ」で教えてください。',
  },
};

const BANNED_TERMS_RE =
  /骨盤前後運動|胸椎伸展|肩甲骨内転|股関節屈曲伸展|股関節外旋|大腿四頭筋セッティング|足関節底背屈|神経モビライゼーション|体幹安定化|ゴキブリ体操/;

function normalizeText(v) {
  return String(v || '').trim();
}

/**
 * @param {{ userText?: string, blockSelfCare?: boolean, safetyLevel?: string }} params
 * @returns {{ scenarioKey: string, exerciseKey: string, exercise: object } | null}
 */
function pickLifeSceneExercise(params = {}) {
  const userText = normalizeText(params.userText);
  if (!userText || params.blockSelfCare) return null;
  const sl = params.safetyLevel || '';
  if (sl === 'red_flag' || sl === 'needs_medical_check') return null;

  const t = userText;

  if (/お風呂|おふろ|風呂|湯船/.test(t) && /腰|背中|伸ば|ゆる|温/.test(t)) {
    return { scenarioKey: 'life_bath_waist', exerciseKey: 'bath_round_back', exercise: EXERCISES.bath_round_back };
  }

  if (/椅子で|椅子に.*座って|椅子に浅く|仕事中|テレビ/.test(t) && /腰|体操|固い|こわば|リセット|できる/.test(t)) {
    return { scenarioKey: 'life_chair_waist', exerciseKey: 'chair_round_straight', exercise: EXERCISES.chair_round_straight };
  }

  if (/ゴキブリ|ごきぶり/.test(t)) {
    return { scenarioKey: 'life_hand_foot_shake', exerciseKey: 'hand_foot_shake_bed', exercise: EXERCISES.hand_foot_shake_bed };
  }

  if ((/布団|布団の中|寝ながら/.test(t) && /自転車|こぎ/.test(t)) || (/朝/.test(t) && /自転車|こぎ/.test(t) && /(布団|寝|いいですか|して)/.test(t))) {
    if (/腰痛.*(強い|激|ひどい)|激しい.*腰痛|痛みが強い.*腰|腰が.*激痛/.test(t)) return null;
    return { scenarioKey: 'life_small_bicycle', exerciseKey: 'small_bicycle_bed', exercise: EXERCISES.small_bicycle_bed };
  }

  const morning = /朝|起き|布団|寝床|寝たあと/.test(t);
  if (morning && /股関節|股が|股の/.test(t) && /固|こわば|重|つら/.test(t)) {
    return { scenarioKey: 'life_morning_hip_stiff', exerciseKey: 'knee_flex_one_leg_bed', exercise: EXERCISES.knee_flex_one_leg_bed };
  }
  if (morning && /腰.*(固|こわば)|腰が固|起きると腰|起きたら腰/.test(t)) {
    return { scenarioKey: 'life_morning_waist_stiff', exerciseKey: 'knee_sway_bed', exercise: EXERCISES.knee_sway_bed };
  }
  if (morning && /体が重い|重だる|だるい/.test(t) && !/股関節|腰が固|腰.*固/.test(t)) {
    return { scenarioKey: 'life_hand_foot_shake', exerciseKey: 'hand_foot_shake_bed', exercise: EXERCISES.hand_foot_shake_bed };
  }

  return null;
}

function formatLifeSceneForPrompt(pick) {
  if (!pick?.exercise) return '';
  const e = pick.exercise;
  return [
    '[生活場面セルフケア — 専門用語を使わず生活の言葉で1手だけ]',
    `場面: ${e.scene}`,
    `名前: ${e.userFriendlyName}`,
    `やり方: ${e.userFriendlyInstructions}`,
    `回数: ${e.reps}`,
    `強さ: ${e.intensity}`,
    `中止: ${e.stopCondition}`,
    `避ける: ${e.avoidIf || '（特になし）'}`,
    `最後に必ず反応確認: ${e.followupPrompt}`,
  ].join('\n');
}

const INTENSITY_SHORT = '痛みは0〜10のうち0〜3まで。';
const STOP_SHORT =
  'ズキッとする痛み、しびれ、痛みが強くなる、めまい・ふらつきが出たら中止です。';

function buildLifeSceneFallbackLines(pick, openingLine = '', userText = '') {
  if (!pick?.exercise) return [];
  const e = pick.exercise;
  const key = pick.exerciseKey || '';
  const repsLine = /^まず/.test(e.reps) ? e.reps : `まず${e.reps}`;

  if (key === 'hand_foot_shake_bed' || /ゴキブリ|ごきぶり/.test(userText)) {
    return [
      openingLine || '朝、体が重い時には「手足ぶらぶら体操」が合います。',
      '仰向けのまま、手首と足首を小さくぶらぶら10秒だけ動かしましょう。',
      INTENSITY_SHORT,
      '腰が反りやすい時は足を高く上げないで。首に力を入れすぎないで。',
      STOP_SHORT,
      e.followupPrompt,
    ];
  }

  if (key === 'small_bicycle_bed') {
    return [
      openingLine || '布団の中で少し足を動かしたいんですね。',
      e.userFriendlyInstructions,
      repsLine,
      INTENSITY_SHORT,
      '腰が反る感じがある時はやらない。腰が痛い日は無理にしない。',
      STOP_SHORT,
      e.followupPrompt,
    ];
  }

  if (key === 'bath_round_back') {
    return [
      openingLine || 'お風呂で温まったあと、腰を強く伸ばすより休ませる方が合いそうです。',
      e.userFriendlyInstructions,
      repsLine,
      INTENSITY_SHORT,
      'のぼせる、ふらつく、滑りそうな時は、この体操はやらないでください。',
      STOP_SHORT,
      e.followupPrompt,
    ];
  }

  if (key === 'knee_sway_bed') {
    return [
      openingLine || '朝起きた時に腰が固いんですね。起きてすぐ立つより、布団の中で少し体を起こす準備をしましょう。',
      e.userFriendlyInstructions,
      repsLine,
      INTENSITY_SHORT,
      STOP_SHORT,
      e.followupPrompt,
    ];
  }

  if (key === 'knee_flex_one_leg_bed') {
    return [
      openingLine || '朝、股関節が固い感じですね。',
      e.userFriendlyInstructions,
      repsLine,
      INTENSITY_SHORT,
      '腰が反るほど大きく動かさなくて大丈夫です。',
      STOP_SHORT,
      e.followupPrompt,
    ];
  }

  if (key === 'chair_round_straight') {
    return [
      openingLine || '椅子で腰を整えたいんですね。',
      e.userFriendlyInstructions,
      repsLine,
      INTENSITY_SHORT,
      STOP_SHORT,
      e.followupPrompt,
    ];
  }

  const lines = [];
  if (openingLine) lines.push(openingLine);
  lines.push(e.userFriendlyInstructions);
  lines.push(repsLine);
  lines.push(INTENSITY_SHORT);
  lines.push(STOP_SHORT);
  if (e.avoidIf) lines.push(e.avoidIf);
  lines.push(e.followupPrompt);
  return lines;
}

module.exports = {
  SCENES,
  EXERCISES,
  BANNED_TERMS_RE,
  pickLifeSceneExercise,
  formatLifeSceneForPrompt,
  buildLifeSceneFallbackLines,
};
