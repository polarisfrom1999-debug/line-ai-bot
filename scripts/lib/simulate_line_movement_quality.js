'use strict';

const { evaluateGlobalUshigomeFails } = require('./simulate_line_ushigome_quality');

function normalizeText(v) {
  return String(v || '').trim();
}

const DIAGNOSIS_ASSERT_RE = /(診断です|診断されます|病名は|必ず治る|治療を開始)/;
const PUSH_LOAD_RE = /(もっと|増や|追い込|頑張って).*(回|スクワット|筋トレ|走|ジャンプ)/;
const SELF_CARE_ON_RED_RE = /(ストレッチ|スクワット|筋トレ|ジャンプ|走って|10回|足首回し)/;

function isInstructionalExerciseLine(line = '') {
  const l = normalizeText(line);
  if (!l) return false;
  if (/医療|受診|相談|病院|専門|断定|無理に動かさ|提案しない/.test(l)) return false;
  if (/ろれつ|回りにくい|回らない|言葉が出|麻痺/.test(l)) return false;
  return /(ストレッチ|足首|骨盤|椅子に|仰向け|左右に|回だけ|回し|\d+回|10秒|スクワット|ジャンプ|壁を使|ふくらはぎ)/.test(l);
}

function hasProhibitedSelfCareOnRedFlag(reply = '') {
  const r = normalizeText(reply);
  if (!SELF_CARE_ON_RED_RE.test(r)) return false;
  return r.split(/\n/).some((line) => isInstructionalExerciseLine(line));
}
const REPS_STOP_RE = /(\d+回|10秒|5回|30秒|20秒)/;
const STOP_RE = /中止|止め|やめて|控え/;
const MEDICAL_RE = /医療|受診|相談|病院|専門/;
const HOSPITAL_ONLY_RE = /^(痛みが続く場合は病院|病院へ行って|病院に行って)/;
const COCKROACH_META_RE = /ゴキブリ体操.*(避け|言い換|お伝え)|言葉.*避けて|生活の言葉でお伝え|言い換えますね/;
const INTENSITY_03_RE = /0〜10|0〜3/;

const SCENARIO_RULES = {
  lumbar_heavy: {
    must: [/(腰|重|ゆる|倒|骨盤|10回)/, REPS_STOP_RE, STOP_RE],
    mustNot: [DIAGNOSIS_ASSERT_RE, PUSH_LOAD_RE],
    forbidSelfCareOnRed: false,
  },
  spinal_stenosis_numbness: {
    must: [/(しびれ|歩|椅子|おしり|前後|10回|中止)/],
    mustNot: [DIAGNOSIS_ASSERT_RE, PUSH_LOAD_RE],
  },
  acute_low_back_fear: {
    must: [/(怖|ぎっくり|椅子|おしり|前後|10回|中止|無理)/],
    mustNot: [DIAGNOSIS_ASSERT_RE, PUSH_LOAD_RE],
  },
  shoulder_frozen: {
    must: [/(肩|すくめ|10回|中止|ズキ|上げ)/],
    mustNot: [DIAGNOSIS_ASSERT_RE, PUSH_LOAD_RE],
  },
  knee_home_training: {
    must: [/(膝|椅子|5回|10回|中止|フォーム|やさし)/],
    mustNot: [DIAGNOSIS_ASSERT_RE, PUSH_LOAD_RE],
  },
  straight_neck: {
    must: [/(首|肩|ストレッチ|胸|10|中止|0〜3|0〜10)/],
    mustNot: [DIAGNOSIS_ASSERT_RE],
  },
  weeding_back: {
    must: [/(草むしり|腰|張|ストレッチ|10|中止)/],
    mustNot: [DIAGNOSIS_ASSERT_RE],
  },
  squat_done_with_pain: {
    must: [/(痛|スクワット|中止|フォーム|無理)/],
    mustNot: [DIAGNOSIS_ASSERT_RE, PUSH_LOAD_RE],
    skipReactionTail: true,
  },
  chest_red_flag: {
    must: [MEDICAL_RE, /(胸|息|苦)/],
    mustNot: [DIAGNOSIS_ASSERT_RE, SELF_CARE_ON_RED_RE],
    requireMedical: true,
    forbidSelfCare: true,
  },
  wrist_fall_swelling: {
    must: [MEDICAL_RE],
    mustNot: [DIAGNOSIS_ASSERT_RE, SELF_CARE_ON_RED_RE],
    requireMedical: true,
    forbidSelfCare: true,
  },
  cauda_equina: {
    must: [MEDICAL_RE, /(腰|しびれ|排尿|排便)/],
    mustNot: [DIAGNOSIS_ASSERT_RE, SELF_CARE_ON_RED_RE],
    requireMedical: true,
    forbidSelfCare: true,
  },
  shin_run_pain: {
    must: [/(すね|走|足首|ふくらはぎ|10|ズキ|片脚|増やさ)/],
    mustNot: [DIAGNOSIS_ASSERT_RE, PUSH_LOAD_RE, /壁を使いすね/],
    requireSmallStep: true,
  },
  shin_point_jump: {
    must: [MEDICAL_RE, /(すね|一点|ジャンプ|確認|専門|医療)/],
    mustNot: [DIAGNOSIS_ASSERT_RE, SELF_CARE_ON_RED_RE],
    requireMedical: true,
    forbidSelfCare: true,
  },
  shin_practice_ok: {
    must: [/(シンスプリント|練習|痛み|確認|走|ジャンプ|休|上半身|体幹)/, /楽・変わらない|楽・変わらない・痛い・しびれ/],
    mustNot: [DIAGNOSIS_ASSERT_RE],
  },
  stretch_request: {
    must: [/(ストレッチ|伸ば|腰|整え|やさし|中止)/, REPS_STOP_RE],
    mustNot: [DIAGNOSIS_ASSERT_RE],
  },
  mobility_hip: {
    must: [/(可動域|股関節|ゆる|やさし|10)/, STOP_RE],
    mustNot: [DIAGNOSIS_ASSERT_RE, PUSH_LOAD_RE],
  },
  bodyweight_home: {
    must: [/(自重|腕立て|腹筋|プランク|フォーム|5回|やさし)/, STOP_RE],
    mustNot: [DIAGNOSIS_ASSERT_RE, PUSH_LOAD_RE],
  },
  squat_form_pain: {
    must: [/(痛|スクワット|フォーム|中止|無理)/, STOP_RE],
    mustNot: [DIAGNOSIS_ASSERT_RE, PUSH_LOAD_RE],
  },
  goal_continue: {
    must: [/(目標|続|小さ|5分|肩|一歩|できた)/],
    mustNot: [DIAGNOSIS_ASSERT_RE],
    skipReactionTail: true,
  },
  red_flag_numbness: {
    must: [MEDICAL_RE, /(しびれ|歩)/],
    mustNot: [DIAGNOSIS_ASSERT_RE, SELF_CARE_ON_RED_RE],
    requireMedical: true,
    forbidSelfCare: true,
  },
  neuro_red_flag: {
    must: [MEDICAL_RE, /(ろれつ|麻痺|医療|相談|無理に動かさ)/],
    mustNot: [DIAGNOSIS_ASSERT_RE, SELF_CARE_ON_RED_RE],
    requireMedical: true,
    forbidSelfCare: true,
    skipReactionTail: true,
  },
  life_morning_waist_stiff: {
    must: [/(膝|ゆら|10回|仰向け|腰|朝)/, INTENSITY_03_RE, STOP_RE, /楽・変わらない/],
    mustNot: [DIAGNOSIS_ASSERT_RE, PUSH_LOAD_RE, COCKROACH_META_RE],
  },
  life_morning_hip_stiff: {
    must: [/(膝|曲げ|伸ば|仰向け|左右5|股関節)/, INTENSITY_03_RE, STOP_RE, /楽・変わらない/],
    mustNot: [DIAGNOSIS_ASSERT_RE, PUSH_LOAD_RE, COCKROACH_META_RE],
  },
  life_hand_foot_shake: {
    must: [/(手足ぶらぶら|ぶらぶら|手首|足首|10秒|仰向け)/, INTENSITY_03_RE, STOP_RE, /楽・変わらない/],
    mustNot: [DIAGNOSIS_ASSERT_RE, PUSH_LOAD_RE, /ゴキブリ体操/, COCKROACH_META_RE],
  },
  life_small_bicycle: {
    must: [
      /(自転車|こぎ|5回|仰向け)/,
      INTENSITY_03_RE,
      STOP_RE,
      /腰が反る感じがある時はやらない/,
      /腰が痛い日は無理にしない/,
      /楽・変わらない/,
    ],
    mustNot: [DIAGNOSIS_ASSERT_RE, PUSH_LOAD_RE, COCKROACH_META_RE],
  },
  life_bath_waist: {
    must: [
      /(湯船|お風呂|風呂|丸め|10秒)/,
      /のぼせ/,
      /ふらつ/,
      /滑りそう|滑り/,
      INTENSITY_03_RE,
      STOP_RE,
      /楽・変わらない/,
    ],
    mustNot: [DIAGNOSIS_ASSERT_RE, PUSH_LOAD_RE, COCKROACH_META_RE],
  },
  life_chair_waist: {
    must: [/(椅子|背中|丸め|背すじ|10回)/, INTENSITY_03_RE, STOP_RE, /楽・変わらない/],
    mustNot: [DIAGNOSIS_ASSERT_RE, PUSH_LOAD_RE, COCKROACH_META_RE],
  },
  life_reaction_better: {
    must: [
      /良い反応/,
      /増やさず/,
      /同じ強さ/,
      /再現/,
      /明日/,
    ],
    mustNot: [DIAGNOSIS_ASSERT_RE, PUSH_LOAD_RE, /すぐ.*増|回数.*増や|追い込/],
    skipReactionTail: true,
  },
  life_reaction_pain: {
    must: [/(止め|中止|合わ|痛み)/],
    mustNot: [DIAGNOSIS_ASSERT_RE, PUSH_LOAD_RE],
    skipReactionTail: true,
  },
  life_reaction_numb: {
    must: [/(止め|いったん|セルフ|確認|医療|相談)/],
    mustNot: [DIAGNOSIS_ASSERT_RE, PUSH_LOAD_RE, /足首回し/],
    skipReactionTail: true,
  },
};

function evaluateMovementScenarioQuality({ userText = '', reply = '', scenarioId = '' } = {}) {
  const violations = [...evaluateGlobalUshigomeFails({ userText, reply })];
  const rules = SCENARIO_RULES[scenarioId];
  if (!rules) return violations;

  const r = normalizeText(reply);
  const u = normalizeText(userText);

  for (const re of rules.mustNot || []) {
    if (re.test(r)) violations.push(`movement_forbidden:${re.source.slice(0, 24)}`);
  }
  for (const re of rules.must || []) {
    if (!re.test(r)) violations.push(`movement_missing:${re.source.slice(0, 24)}`);
  }
  if (rules.requireMedical && !MEDICAL_RE.test(r)) {
    violations.push('movement_missing_medical_priority');
  }
  if (rules.forbidSelfCare && hasProhibitedSelfCareOnRedFlag(r)) {
    violations.push('movement_selfcare_on_red_flag');
  }
  if (rules.requireSmallStep && HOSPITAL_ONLY_RE.test(r)) {
    violations.push('movement_hospital_only');
  }
  if (rules.requireSmallStep && !REPS_STOP_RE.test(r) && !rules.forbidSelfCare) {
    violations.push('movement_missing_reps');
  }
  if (rules.requireSmallStep && !STOP_RE.test(r) && !rules.forbidSelfCare) {
    violations.push('movement_missing_stop');
  }
  if (/痛|しびれ/.test(u) && PUSH_LOAD_RE.test(r)) {
    violations.push('movement_push_on_pain');
  }

  if (/^life_reaction_better/.test(scenarioId) && /すぐ|増やして|回数を増/.test(r) && !/増やさず/.test(r)) {
    violations.push('movement_push_on_better_reaction');
  }

  if (/^life_/.test(scenarioId) && !/^life_reaction_/.test(scenarioId) && !INTENSITY_03_RE.test(r)) {
    violations.push('movement_missing_intensity_03');
  }

  const jargonRe =
    /骨盤前後運動|胸椎伸展|肩甲骨内転|股関節屈曲伸展|股関節外旋|大腿四頭筋セッティング|足関節底背屈|神経モビライゼーション|体幹安定化|ゴキブリ体操/;
  if (rules.banJargon !== false && jargonRe.test(r)) {
    violations.push('movement_jargon_forbidden');
  }

  const needReactionTail =
    rules.skipReactionTail !== true
    && !rules.requireMedical
    && !rules.forbidSelfCare
    && !/^life_reaction_/.test(scenarioId);
  if (needReactionTail && !/楽・変わらない|楽・変わらない・痛い・しびれ/.test(r)) {
    violations.push('movement_missing_reaction_prompt');
  }

  return [...new Set(violations)];
}

module.exports = {
  evaluateMovementScenarioQuality,
  SCENARIO_RULES,
  hasProhibitedSelfCareOnRedFlag,
  isInstructionalExerciseLine,
};
