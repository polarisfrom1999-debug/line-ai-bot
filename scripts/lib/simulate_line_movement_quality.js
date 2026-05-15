'use strict';

const { evaluateGlobalUshigomeFails } = require('./simulate_line_ushigome_quality');

function normalizeText(v) {
  return String(v || '').trim();
}

const DIAGNOSIS_ASSERT_RE = /(診断です|診断されます|病名は|必ず治る|治療を開始)/;
const PUSH_LOAD_RE = /(もっと|増や|追い込|頑張って).*(回|スクワット|筋トレ|走|ジャンプ)/;
const SELF_CARE_ON_RED_RE = /(ストレッチ|スクワット|筋トレ|ジャンプ|走って|10回|足首回し)/;

function hasProhibitedSelfCareOnRedFlag(reply = '') {
  const r = normalizeText(reply);
  if (!SELF_CARE_ON_RED_RE.test(r)) return false;
  const instructionalLines = r.split(/\n/).filter((line) =>
    /(左右|回|秒|膝を|足首|ゆっくり|椅子|骨盤|仰向け)/.test(line)
    && !/医療|受診|相談|病院|専門|断定|無理に動かさ|提案しない/.test(line)
  );
  return instructionalLines.length > 0;
}
const REPS_STOP_RE = /(\d+回|10秒|5回|30秒|20秒)/;
const STOP_RE = /中止|止め|やめて|控え/;
const MEDICAL_RE = /医療|受診|相談|病院|専門/;
const HOSPITAL_ONLY_RE = /^(痛みが続く場合は病院|病院へ行って|病院に行って)/;

const SCENARIO_RULES = {
  lumbar_heavy: {
    must: [/(腰|重|ゆる|倒|骨盤|10回)/, REPS_STOP_RE, STOP_RE],
    mustNot: [DIAGNOSIS_ASSERT_RE, PUSH_LOAD_RE],
    forbidSelfCareOnRed: false,
  },
  spinal_stenosis_numbness: {
    must: [/(しびれ|歩|骨盤|椅子|10回|中止)/],
    mustNot: [DIAGNOSIS_ASSERT_RE, PUSH_LOAD_RE],
  },
  acute_low_back_fear: {
    must: [/(怖|ぎっくり|骨盤|10回|中止|無理)/],
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
    must: [/(首|肩|ストレッチ|胸|10|中止)/],
    mustNot: [DIAGNOSIS_ASSERT_RE],
  },
  weeding_back: {
    must: [/(草むしり|腰|張|ストレッチ|10|中止)/],
    mustNot: [DIAGNOSIS_ASSERT_RE],
  },
  squat_done_with_pain: {
    must: [/(痛|スクワット|中止|フォーム|無理)/],
    mustNot: [DIAGNOSIS_ASSERT_RE, PUSH_LOAD_RE],
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
    must: [/(すね|走|足首|ふくらはぎ|10|中止|ズキ|片脚)/],
    mustNot: [DIAGNOSIS_ASSERT_RE, PUSH_LOAD_RE],
    requireSmallStep: true,
  },
  shin_point_jump: {
    must: [MEDICAL_RE, /(すね|一点|ジャンプ|確認|専門|医療)/],
    mustNot: [DIAGNOSIS_ASSERT_RE, SELF_CARE_ON_RED_RE],
    requireMedical: true,
    forbidSelfCare: true,
  },
  shin_practice_ok: {
    must: [/(シンスプリント|練習|痛み|確認|走|ジャンプ|休|上半身|体幹)/],
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
  },
  red_flag_numbness: {
    must: [MEDICAL_RE, /(しびれ|歩)/],
    mustNot: [DIAGNOSIS_ASSERT_RE, SELF_CARE_ON_RED_RE],
    requireMedical: true,
    forbidSelfCare: true,
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

  return [...new Set(violations)];
}

module.exports = {
  evaluateMovementScenarioQuality,
  SCENARIO_RULES,
};
