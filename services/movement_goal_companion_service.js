'use strict';

/**
 * Phase G: Movement & Goal Companion — 返信文は作らず判断ヒントのみ。
 * condition map / red flag / classifier / selfcare library + AI牛込 style hints。
 */

const ushigomeConversationStyleService = require('./ushigome_conversation_style_service');
const movementConditionMap = require('./movement_condition_map_service');
const movementRedFlagGuard = require('./movement_red_flag_guard_service');
const movementSupportClassifier = require('./movement_support_classifier_service');
const movementSelfcareLibrary = require('./movement_selfcare_library_service');
const painSupportService = require('./pain_support_service');

const TOPIC = {
  MOBILITY: 'mobility',
  SELF_STRETCH: 'self_stretch',
  BODYWEIGHT: 'bodyweight',
  GOAL_SUPPORT: 'goal_support',
  PAIN_CARE: 'pain_care',
  SPORTS_OVERUSE: 'sports_overuse',
  MOVEMENT_FEEDBACK: 'movement_feedback',
  GENERAL: 'general_movement',
};

const MOVEMENT_AVOID = [
  '診断名の断定・治療指示',
  '赤旗にセルフケア・筋トレを提案',
  '痛みがあるのに回数・強度を増やす提案',
  '回数・強さ・中止条件なしの運動提案',
  '「病院へ」だけで終わる（安全な一歩を添える）',
  '「大丈夫です」「無理なく」だけで具体がない',
  '数値・カロリー中心の返答',
];

const MOVEMENT_TEXT_RE =
  /可動域|セルフストレッチ|自重|体幹|ストレッチ|伸ば|ほぐ|筋トレ|メニュー|フォーム|リハビリ|目標|達成|練習していい|シンスプリント|shin|MTSS|脊柱管|狭窄|ぎっくり|五十肩|インピンジ|ヘルニア|坐骨|猫背|側弯|ストレートネック|寝違え|頸肩|肩こり|変形性|アキレス|テニス肘|野球肘|骨粗|捻挫|打撲|骨折|脱臼|転ん|胸が苦|息が苦|排尿|排便|しびれ|歩けない|腰が重|肩が上が|膝が痛|すね|脛|走ると.*痛|ジャンプ.*痛|草むしり.*腰|楽になり|伸びた|動きやす|腰痛と/;

function normalizeText(v) {
  return String(v || '').trim();
}

function isMovementGoalCompanionText(text = '') {
  const safe = normalizeText(text);
  if (!safe) return false;
  if (/記録しました|回しました|分しました/.test(safe) && /やった|できた/.test(safe)) return false;
  if (/楽になり|伸びた感じ|痛みが減った/.test(safe) && !/教えて|メニュー|どうしたら/.test(safe)) {
    return movementSupportClassifier.isMovementFeedback(safe);
  }
  if (MOVEMENT_TEXT_RE.test(safe)) return true;
  if (movementConditionMap.matchConditions(safe).length > 0) return true;
  if (/家で.*(運動|筋トレ|ストレッチ)|痛.*(ストレッチ|伸ば)/.test(safe)) return true;
  return false;
}

function detectMovementTopic(text = '', classification = {}) {
  if (classification.conversation_subtype === movementConditionMap.CONV_MODE.MOVEMENT_FEEDBACK) {
    return TOPIC.MOVEMENT_FEEDBACK;
  }
  if (classification.conversation_subtype === movementConditionMap.CONV_MODE.SPORTS_OVERUSE) {
    return TOPIC.SPORTS_OVERUSE;
  }
  if (classification.conversation_subtype === movementConditionMap.CONV_MODE.GOAL_SUPPORT) {
    return TOPIC.GOAL_SUPPORT;
  }
  const t = normalizeText(text);
  if (/可動域|股関節.*広/.test(t)) return TOPIC.MOBILITY;
  if (/自重|腕立て|腹筋|プランク|スクワット.*(家|教)/.test(t)) return TOPIC.BODYWEIGHT;
  if (/ストレッチ|伸ば|ほぐ/.test(t)) return TOPIC.SELF_STRETCH;
  if (/走る|ジャンプ|すね|シンスプリント|shin/i.test(t)) return TOPIC.SPORTS_OVERUSE;
  if (/目標|達成|続け/.test(t)) return TOPIC.GOAL_SUPPORT;
  if (/楽になり|伸び/.test(t)) return TOPIC.MOVEMENT_FEEDBACK;
  return TOPIC.PAIN_CARE;
}

/**
 * @param {{ userText?: string, conversationMode?: string, userContext?: object, longMemory?: object }} params
 */
function buildMovementGoalHints(params = {}) {
  const userText = normalizeText(params.userText || '');
  const longMemory = params.userContext?.longMemory || params.longMemory || {};
  const classification = movementSupportClassifier.classifyMovementSupport({
    userText,
    longMemory,
  });
  const topic = detectMovementTopic(userText, classification);
  const bodyRegion = classification.body_region;
  const area = painSupportService.detectPainArea(userText) || bodyRegion;

  const ushigomeStyle = ushigomeConversationStyleService.buildUshigomeStyleHints({
    userText,
    conversationMode: params.conversationMode || 'movement_goal_companion',
    userContext: params.userContext,
    longMemory,
  });

  let recommendedMenu = null;
  let menuCandidates = [];
  if (!classification.block_self_care) {
    menuCandidates = movementSelfcareLibrary.pickMenus({
      bodyRegion,
      conditionIds: classification.condition_ids,
      safetyLevel: classification.safety_level,
      text: userText,
    });
    recommendedMenu = menuCandidates[0] || null;
  }

  const intensityRule = '痛み0〜10のうち0〜3。気持ちいい〜少し張る。鋭い痛み・しびれ・ズキッは中止';
  const frequencyRule = classification.safety_level === movementSupportClassifier.SAFETY_LEVEL.SAFE_SELF_CARE
    ? '慢性こわばりは1日1〜2回、筋トレは週2〜3から'
    : '痛みが強い日は1日1回・軽い可動域中心';

  const responseAngle = classification.safety_level === movementSupportClassifier.SAFETY_LEVEL.RED_FLAG
    ? 'medical_consultation_first_with_empathy'
    : classification.safety_level === movementSupportClassifier.SAFETY_LEVEL.NEEDS_MEDICAL_CHECK
      ? 'medical_check_then_rest_only'
      : classification.safety_level === movementSupportClassifier.SAFETY_LEVEL.MOVEMENT_FEEDBACK
        ? 'celebrate_change_no_intensity_up'
        : recommendedMenu
          ? 'one_menu_with_reps_and_stop'
          : 'listen_then_small_step';

  const safeSelfCareCandidates = classification.block_self_care
    ? ['医療機関・専門家への相談を優先', '今日は強いストレッチ・ジャンプ・走る練習は控える']
    : menuCandidates.map((m) => `${m.purpose}: ${m.reps}`).slice(0, 4);

  if (!safeSelfCareCandidates.length && !classification.block_self_care) {
    safeSelfCareCandidates.push('今日は1種目・5〜10回だけ', '痛みが増えたら中止');
  }

  return {
    movement_topic: topic,
    safety_level: classification.safety_level,
    conversation_subtype: classification.conversation_subtype,
    body_region: bodyRegion,
    body_area: area,
    classification,
    matched_conditions: classification.matched_conditions,
    confirm_questions: classification.confirm_questions,
    caution_notes: classification.caution_notes,
    recommended_menu: recommendedMenu,
    menu_candidates: menuCandidates,
    intensity_rule: intensityRule,
    frequency_rule: frequencyRule,
    safe_self_care_candidates: safeSelfCareCandidates,
    goal_context: classification.goal_context || longMemory?.goal || null,
    response_angle: responseAngle,
    avoid_response_patterns: MOVEMENT_AVOID,
    safety_priority: classification.safety_level,
    recommended_small_next_step: recommendedMenu
      ? `${recommendedMenu.instructions}（${recommendedMenu.reps}）`
      : safeSelfCareCandidates[0] || null,
    red_flag_message: classification.red_flag_result?.priorityMessage || null,
    block_self_care: classification.block_self_care,
    ushigomeStyle,
    user_emotional_state: ushigomeStyle.user_emotional_state,
    body_risk_state: classification.safety_level === movementSupportClassifier.SAFETY_LEVEL.RED_FLAG
      ? 'red_flag'
      : classification.safety_level === movementSupportClassifier.SAFETY_LEVEL.NEEDS_MEDICAL_CHECK
        ? 'caution'
        : ushigomeStyle.body_risk_state,
    tone_hint: ushigomeStyle.tone_hint,
    safety_assessment: {
      needsMedicalFirst: classification.block_self_care,
      redFlags: (classification.red_flag_result?.flags || []).map((f) => f.label),
      severity: classification.pain_analysis_summary?.severity,
      primaryArea: area,
      painDetected: /痛|しびれ|つら/.test(userText),
    },
  };
}

function formatMovementHintsForPrompt(hints) {
  if (!hints || typeof hints !== 'object') return '';
  const ushi = ushigomeConversationStyleService.formatHintsForPrompt(hints.ushigomeStyle || hints);
  const lines = [
    '[Movement & Goal Companion — 柔道整復・障害者スポーツトレーナー思想／診断AIではない]',
    '流れ: 今の言葉を受ける → 決めつけず整理 → 赤旗確認 → 安全なセルフケア1つ → 回数・強さ・中止条件 → 余白',
    '症状名だけでメニューを決めない。痛みの強さ・しびれ・外傷・夜間痛などを見る。',
    '',
    `安全レベル: ${hints.safety_level || ''}`,
    `会話サブタイプ: ${hints.conversation_subtype || ''}`,
    `部位: ${hints.body_region || hints.body_area || ''}`,
    `返しの角度: ${hints.response_angle || ''}`,
    `強さ: ${hints.intensity_rule || ''}`,
    `頻度: ${hints.frequency_rule || ''}`,
  ];
  if (hints.matched_conditions?.length) {
    lines.push(`参照条件（断定しない）: ${hints.matched_conditions.map((c) => c.labels?.[0] || c.id).join('、')}`);
  }
  if (hints.caution_notes?.length) {
    lines.push(`注意: ${hints.caution_notes.slice(0, 3).join('；')}`);
  }
  if (hints.confirm_questions?.length && hints.safety_level !== 'red_flag') {
    lines.push(`不足時のみ1つ質問: ${hints.confirm_questions.slice(0, 2).join('、')}`);
  }
  if (hints.block_self_care || hints.safety_level === 'red_flag') {
    lines.push(hints.red_flag_message || movementRedFlagGuard.evaluateRedFlags('').priorityMessage);
    lines.push('ストレッチ・筋トレ・走る・ジャンプの提案は禁止。');
  } else if (hints.recommended_menu) {
    lines.push(movementSelfcareLibrary.formatMenuForPrompt(hints.recommended_menu));
  } else if (hints.safe_self_care_candidates?.length) {
    lines.push(`候補: ${hints.safe_self_care_candidates.join(' / ')}`);
  }
  if (hints.goal_context) lines.push(`目標（参照）: ${hints.goal_context}`);
  if (hints.avoid_response_patterns?.length) {
    lines.push(`避ける: ${hints.avoid_response_patterns.slice(0, 5).join('；')}`);
  }
  lines.push('');
  lines.push(ushi);
  return lines.join('\n');
}

module.exports = {
  TOPIC,
  isMovementGoalCompanionText,
  detectMovementTopic,
  buildMovementGoalHints,
  formatMovementHintsForPrompt,
};
