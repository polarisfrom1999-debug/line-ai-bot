'use strict';

/**
 * Phase G: Movement & Goal Companion — 返信文は作らず判断ヒントのみ。
 * AI牛込 style hints と併用。診断AIにはしない。
 */

const ushigomeConversationStyleService = require('./ushigome_conversation_style_service');
const painSupportService = require('./pain_support_service');

const TOPIC = {
  MOBILITY: 'mobility',
  SELF_STRETCH: 'self_stretch',
  BODYWEIGHT: 'bodyweight',
  GOAL_SUPPORT: 'goal_support',
  PAIN_CARE: 'pain_care',
  SPORTS_FORM: 'sports_form',
  GENERAL: 'general_movement',
};

const MOVEMENT_AVOID = [
  '診断名の断定・治療指示',
  '痛みがあるのに回数・強度を増やす提案',
  '赤旗疑いでセルフケアだけで終わる',
  '「大丈夫です」「無理なく」だけで具体がない',
  '数値・カロリー中心の返答',
  '毎回同じ締め・定型安心文',
];

function normalizeText(v) {
  return String(v || '').trim();
}

function isMovementGoalCompanionText(text = '') {
  const safe = normalizeText(text);
  if (!safe) return false;
  if (/やった|できた|回しました|分しました|記録しました|楽になり|伸びた感じ|痛みが減/.test(safe)) {
    return false;
  }
  if (/可動域|セルフストレッチ|自重トレ|体幹メニュー|体幹トレ/.test(safe)) return true;
  if (/ストレッチ.*(教|したい|やり方|メニュー|おすすめ)|伸ばし.*(教|したい|やり方)/.test(safe)) return true;
  if (/股関節.*可動域|可動域.*広げ/.test(safe)) return true;
  if (/家で.*(運動|筋トレ|ストレッチ|メニュー)|(?:腰|膝|肩|首|股関節).*(?:ほぐ|伸ば|ストレッチ|整え)/.test(safe)) {
    return true;
  }
  if (/腕立て|腹筋|プランク|自重|スクワット.*(フォーム|やり方)|フォーム.*改善/.test(safe)) return true;
  if (/目標.*(達成|続|運動|筋トレ)|(?:続け|達成).*(?:目標|夢)/.test(safe)) return true;
  if (/痛.*(ストレッチ|伸ば|どうしたら)|(?:ストレッチ|伸ば).*(?:痛|つら)/.test(safe)) return true;
  if (/走り.*(フォーム|改善)|フォーム.*(見て|動画)/.test(safe)) return true;
  if (/リハビリ|怪我.*(相談|戻)|復帰.*(運動|トレ)/.test(safe)) return true;
  if (/しびれ|ビリビリ|ピリピリ/.test(safe) && /(足|腰|膝|手|腕|肩|首)/.test(safe)) return true;
  if (/歩けない|歩けません|体重をかけられない/.test(safe)) return true;
  return false;
}

function detectMovementTopic(text = '') {
  const t = normalizeText(text);
  if (/目標|達成|続けたい|夢/.test(t)) return TOPIC.GOAL_SUPPORT;
  if (/可動域|股関節.*広|動きやす/.test(t)) return TOPIC.MOBILITY;
  if (/自重|腕立て|腹筋|プランク|スクワット/.test(t)) return TOPIC.BODYWEIGHT;
  if (/フォーム|走り|投球|ジャンプ/.test(t)) return TOPIC.SPORTS_FORM;
  if (/ストレッチ|伸ば|ほぐ|セルフ/.test(t)) return TOPIC.SELF_STRETCH;
  if (/痛|しびれ|つら|違和感/.test(t)) return TOPIC.PAIN_CARE;
  return TOPIC.GENERAL;
}

function assessMovementSafety(text = '') {
  let painAnalysis = null;
  try {
    painAnalysis = painSupportService.analyzePainText(text);
  } catch (_e) {
    painAnalysis = null;
  }
  const redFlags = painAnalysis?.red_flags || [];
  const severity = painAnalysis?.severity || 'mild';
  const t = normalizeText(text);
  const needsMedicalFirst =
    severity === 'urgent'
    || redFlags.length > 0
    || /歩けない|歩けません|体重をかけられない|意識が|激しい痛|高熱|しびれが続|力が入らない/.test(t)
    || (/しびれ|ビリビリ/.test(t) && /歩けない|歩けません/.test(t));

  return {
    severity,
    redFlags: redFlags.map((r) => r.label || r.key).filter(Boolean),
    primaryArea: painAnalysis?.primary_part?.label || painSupportService.detectPainArea(text) || null,
    needsMedicalFirst,
    painDetected: Boolean(painAnalysis?.detected || /痛|しびれ/.test(text)),
  };
}

function buildSafeSelfCareCandidates(text = '', topic = '', safety = {}, area = '全身') {
  const candidates = [];
  const part = area || '全身';
  if (safety.needsMedicalFirst) {
    candidates.push('まず医療機関への相談を優先', '今日は強い運動・深いストレッチは控える');
    return candidates.slice(0, 3);
  }
  if (topic === TOPIC.MOBILITY || /可動域/.test(text)) {
    candidates.push(`${part}を大きく動かさず、やさしい可動域ストレッチ`, '股関節・お尻を一緒にゆるめる（痛みがなければ）', '1〜2種目に絞る');
  }
  if (topic === TOPIC.SELF_STRETCH || /ストレッチ|伸ば/.test(text)) {
    candidates.push(`${part}まわりを反らしすぎず軽く`, '呼吸を止めず30秒×1〜2セット', '痛みが増えたら中止');
  }
  if (topic === TOPIC.BODYWEIGHT || /自重|腕立て|腹筋|プランク/.test(text)) {
    candidates.push('膝つき・壁押しなど負荷を下げた版', '5回だけ・フォーム優先', '痛みが出たら回数より中止');
  }
  if (topic === TOPIC.GOAL_SUPPORT) {
    candidates.push('今日は5分・肩回しだけでも十分', '目標は週単位の小さな一歩に分ける', 'できたら「できた」で報告');
  }
  if (topic === TOPIC.PAIN_CARE || safety.painDetected) {
    candidates.push('痛みが増えない範囲だけ', '冷やす・休む・姿勢を楽にする', 'フォームより中止条件を先に');
  }
  if (!candidates.length) {
    candidates.push('今日は1分・やさしい版だけ', '無理に種目を増やさない');
  }
  return [...new Set(candidates)].slice(0, 4);
}

function buildObservedEffortMovement(text = '', topic = '') {
  const effort = [];
  if (/続け|コツコツ|毎日/.test(text)) effort.push('consistency_intent');
  if (/半分|調整/.test(text)) effort.push('self_regulation');
  if (/フォーム|姿勢/.test(text)) effort.push('form_awareness');
  if (topic === TOPIC.GOAL_SUPPORT) effort.push('goal_oriented');
  return effort;
}

/**
 * @param {{ userText?: string, conversationMode?: string, userContext?: object, longMemory?: object }} params
 */
function buildMovementGoalHints(params = {}) {
  const userText = normalizeText(params.userText || '');
  const topic = detectMovementTopic(userText);
  const safety = assessMovementSafety(userText);
  const area = safety.primaryArea || painSupportService.detectPainArea(userText) || '全身';
  const safeSelfCareCandidates = buildSafeSelfCareCandidates(userText, topic, safety, area);
  const ushigomeStyle = ushigomeConversationStyleService.buildUshigomeStyleHints({
    userText,
    conversationMode: params.conversationMode || 'movement_goal_companion',
    userContext: params.userContext,
    longMemory: params.userContext?.longMemory || params.longMemory,
  });

  const goalContext = normalizeText(
    params.userContext?.longMemory?.goal || params.longMemory?.goal || ''
  );

  const responseAngle = safety.needsMedicalFirst
    ? 'medical_consultation_first'
    : topic === TOPIC.GOAL_SUPPORT
      ? 'small_step_toward_goal'
      : topic === TOPIC.PAIN_CARE
        ? 'safety_then_gentle_care'
        : 'observe_body_then_one_gentle_action';

  const concernPoints = [];
  if (safety.needsMedicalFirst) concernPoints.push('red_flag_or_severe_pain');
  if (safety.painDetected) concernPoints.push('pain_present');
  if (topic === TOPIC.BODYWEIGHT && safety.painDetected) concernPoints.push('load_management');

  return {
    movement_topic: topic,
    body_area: area,
    safety_assessment: safety,
    safe_self_care_candidates: safeSelfCareCandidates,
    goal_context: goalContext || null,
    observed_effort: buildObservedEffortMovement(userText, topic),
    response_angle: responseAngle,
    avoid_response_patterns: MOVEMENT_AVOID,
    safety_priority: safety.needsMedicalFirst ? 'medical_first' : safety.painDetected ? 'pain_over_performance' : 'gentle_movement',
    recommended_small_next_step: safeSelfCareCandidates[0] || null,
    ushigomeStyle,
    user_emotional_state: ushigomeStyle.user_emotional_state,
    body_risk_state: safety.needsMedicalFirst ? 'red_flag' : safety.painDetected ? 'caution' : ushigomeStyle.body_risk_state,
    tone_hint: ushigomeStyle.tone_hint,
  };
}

function formatMovementHintsForPrompt(hints) {
  if (!hints || typeof hints !== 'object') return '';
  const ushi = ushigomeConversationStyleService.formatHintsForPrompt(hints.ushigomeStyle || hints);
  const lines = [
    '[Movement & Goal Companion — 診断ではなく伴走]',
    '痛み・可動域・セルフストレッチ・自重筋トレ・目標達成を、牛込の見方で自然に返す。',
    '診断名・治療指示はしない。赤旗・強い痛み・持続しびれは医療相談を先に。',
    '安全なセルフケア候補から今日できる小さな一歩を1つ。',
    '',
    `テーマ: ${hints.movement_topic || 'general'}`,
    `部位: ${hints.body_area || '全身'}`,
    `返しの角度: ${hints.response_angle || ''}`,
    `安全優先: ${hints.safety_priority || 'gentle_movement'}`,
  ];
  if (hints.goal_context) {
    lines.push(`利用者の目標（参照のみ）: ${hints.goal_context}`);
  }
  if (hints.safety_assessment?.needsMedicalFirst) {
    lines.push('⚠ 医療相談を先に。セルフケアは補助にとどめる。');
  } else if (hints.safety_assessment?.redFlags?.length) {
    lines.push(`注意: ${hints.safety_assessment.redFlags.join('、')}`);
  }
  if (hints.safe_self_care_candidates?.length) {
    lines.push(`セルフケア候補（1つ選び、コピーしない）: ${hints.safe_self_care_candidates.join(' / ')}`);
  }
  if (hints.avoid_response_patterns?.length) {
    lines.push(`避ける: ${hints.avoid_response_patterns.slice(0, 4).join('；')}`);
  }
  lines.push('');
  lines.push(ushi);
  return lines.join('\n');
}

module.exports = {
  TOPIC,
  isMovementGoalCompanionText,
  detectMovementTopic,
  assessMovementSafety,
  buildMovementGoalHints,
  formatMovementHintsForPrompt,
};
