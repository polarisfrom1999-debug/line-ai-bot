'use strict';

const movementConditionMap = require('./movement_condition_map_service');
const movementRedFlagGuard = require('./movement_red_flag_guard_service');
const painSupportService = require('./pain_support_service');

const SAFETY_LEVEL = {
  RED_FLAG: 'red_flag',
  NEEDS_MEDICAL_CHECK: 'needs_medical_check',
  NEEDS_CAUTION: 'needs_caution',
  SAFE_SELF_CARE: 'safe_self_care_candidate',
  GOAL_TRAINING: 'goal_training',
  MOVEMENT_FEEDBACK: 'movement_feedback',
};

function normalizeText(v) {
  return String(v || '').trim();
}

function isMovementFeedback(text = '') {
  return /楽になり|伸びた|動きやす|軽くなった|痛みが減った|スムーズ/.test(normalizeText(text));
}

function isGoalTraining(text = '') {
  const t = normalizeText(text);
  return /目標|達成|続けたい|夢|練習していい|トレーニングしたい/.test(t) && !isMovementFeedback(t);
}

function classifyMovementSupport({ userText = '', longMemory = {} } = {}) {
  const text = normalizeText(userText);
  const redFlagResult = movementRedFlagGuard.evaluateRedFlags(text);
  const medicalSignals = movementRedFlagGuard.evaluateMedicalCheckSignals(text);
  const matchedConditions = movementConditionMap.matchConditions(text);
  const primaryCondition = matchedConditions[0] || null;

  let painAnalysis = null;
  try {
    painAnalysis = painSupportService.analyzePainText(text);
  } catch (_e) {
    painAnalysis = null;
  }

  if (isMovementFeedback(text)) {
    return buildResult(SAFETY_LEVEL.MOVEMENT_FEEDBACK, text, matchedConditions, redFlagResult, medicalSignals, painAnalysis, longMemory);
  }

  if (redFlagResult.isRedFlag) {
    return buildResult(SAFETY_LEVEL.RED_FLAG, text, matchedConditions, redFlagResult, medicalSignals, painAnalysis, longMemory);
  }

  if (/腰痛/.test(text) && /排尿|排便/.test(text) && /変|出ない|困難|できない|しびれ/.test(text)) {
    return buildResult(SAFETY_LEVEL.RED_FLAG, text, matchedConditions, redFlagResult, medicalSignals, painAnalysis, longMemory, 'cauda_equina');
  }

  if (/胸が苦|息が苦|胸痛/.test(text)) {
    return buildResult(SAFETY_LEVEL.RED_FLAG, text, matchedConditions, redFlagResult, medicalSignals, painAnalysis, longMemory);
  }

  if (movementRedFlagGuard.isShinSplintRedFlag(text)) {
    return buildResult(SAFETY_LEVEL.NEEDS_MEDICAL_CHECK, text, matchedConditions, redFlagResult, medicalSignals, painAnalysis, longMemory, 'shin_splint');
  }

  if (primaryCondition?.defaultRisk === movementConditionMap.RISK.RED_FLAG) {
    return buildResult(SAFETY_LEVEL.RED_FLAG, text, matchedConditions, redFlagResult, medicalSignals, painAnalysis, longMemory);
  }

  if (
    primaryCondition?.defaultRisk === movementConditionMap.RISK.NEEDS_MEDICAL
    || medicalSignals.length >= 2
    || painAnalysis?.severity === 'urgent'
    || /骨折|脱臼|転んで.*腫れ/.test(text)
  ) {
    return buildResult(SAFETY_LEVEL.NEEDS_MEDICAL_CHECK, text, matchedConditions, redFlagResult, medicalSignals, painAnalysis, longMemory);
  }

  if (isGoalTraining(text)) {
    return buildResult(SAFETY_LEVEL.GOAL_TRAINING, text, matchedConditions, redFlagResult, medicalSignals, painAnalysis, longMemory);
  }

  const hasStrongPain = /激しい|強い痛|痛くて動けない|ズキッ/.test(text);
  const hasNumbness = /しびれ/.test(text);
  const hasSwelling = /腫れ|熱感/.test(text);
  const hasInjury = /捻挫|打撲|怪我|外傷/.test(text);

  if (
    hasStrongPain
    || (hasNumbness && /腰|脚|足/.test(text))
    || hasSwelling
    || hasInjury
    || primaryCondition?.defaultRisk === movementConditionMap.RISK.NEEDS_CAUTION
    || painAnalysis?.severity === 'moderate'
    || /夜.*痛|夜間痛/.test(text)
  ) {
    return buildResult(SAFETY_LEVEL.NEEDS_CAUTION, text, matchedConditions, redFlagResult, medicalSignals, painAnalysis, longMemory);
  }

  if (/重い|張り|こわばり|違和感|つらい|硬い/.test(text) && !hasStrongPain) {
    return buildResult(SAFETY_LEVEL.SAFE_SELF_CARE, text, matchedConditions, redFlagResult, medicalSignals, painAnalysis, longMemory);
  }

  if (/ストレッチ|可動域|筋トレ|自重|教えて|メニュー/.test(text)) {
    return buildResult(SAFETY_LEVEL.SAFE_SELF_CARE, text, matchedConditions, redFlagResult, medicalSignals, painAnalysis, longMemory);
  }

  return buildResult(SAFETY_LEVEL.NEEDS_CAUTION, text, matchedConditions, redFlagResult, medicalSignals, painAnalysis, longMemory);
}

function inferConversationSubtype(text, matchedConditions) {
  if (isMovementFeedback(text)) return movementConditionMap.CONV_MODE.MOVEMENT_FEEDBACK;
  if (/走る|ジャンプ|すね|シンスプリント|shin|MTSS|過労/i.test(text)) {
    return movementConditionMap.CONV_MODE.SPORTS_OVERUSE;
  }
  if (/目標|達成|続け|練習していい/.test(text)) return movementConditionMap.CONV_MODE.GOAL_SUPPORT;
  if (/ストレッチ|伸ば|メニュー/.test(text)) return movementConditionMap.CONV_MODE.SELF_STRETCH;
  if (matchedConditions[0]?.conversationModes?.[0]) return matchedConditions[0].conversationModes[0];
  return movementConditionMap.CONV_MODE.PAIN_SUPPORT;
}

function buildResult(safetyLevel, text, matchedConditions, redFlagResult, medicalSignals, painAnalysis, longMemory, tag = '') {
  const bodyRegion = movementConditionMap.inferBodyRegion(text, matchedConditions);
  const confirmQuestions = movementConditionMap.getConfirmQuestions(text, matchedConditions);
  const cautionNotes = movementConditionMap.getCautionNotes(text, matchedConditions);
  const conditionIds = matchedConditions.map((c) => c.id);

  return {
    safety_level: safetyLevel,
    conversation_subtype: inferConversationSubtype(text, matchedConditions),
    body_region: bodyRegion,
    matched_conditions: matchedConditions.map((c) => ({ id: c.id, labels: c.labels.slice(0, 2) })),
    condition_ids: conditionIds,
    primary_condition_id: conditionIds[0] || null,
    confirm_questions: confirmQuestions.slice(0, 6),
    caution_notes: cautionNotes,
    red_flag_result: redFlagResult,
    medical_check_signals: medicalSignals,
    pain_analysis_summary: painAnalysis
      ? { severity: painAnalysis.severity, primary_part: painAnalysis.primary_part?.label }
      : null,
    block_self_care: redFlagResult.blockSelfCare || safetyLevel === SAFETY_LEVEL.RED_FLAG,
    block_exercise_proposal: redFlagResult.blockExerciseProposal || safetyLevel === SAFETY_LEVEL.RED_FLAG,
    allow_light_self_care: safetyLevel === SAFETY_LEVEL.SAFE_SELF_CARE || safetyLevel === SAFETY_LEVEL.NEEDS_CAUTION,
    tag,
    goal_context: longMemory?.goal || null,
  };
}

module.exports = {
  SAFETY_LEVEL,
  classifyMovementSupport,
  isMovementFeedback,
  isGoalTraining,
};
