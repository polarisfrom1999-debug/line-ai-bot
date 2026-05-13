'use strict';

const { PHASES } = require('./relationship_phase_service');

function normalizeText(v) {
  return String(v || '').trim();
}

/**
 * 返信文ではなく observation_hint のみ返す（自然返信生成器が参照）。
 * @returns {{ observation_type: string, observation_hint: string, evidence_count: number, reason: string }}
 */
function selectContextualObservation(params = {}) {
  const userId = normalizeText(params.userId || '');
  const userText = normalizeText(params.userText || '');
  const tc = params.todayContext && typeof params.todayContext === 'object' ? params.todayContext : {};
  const intent = normalizeText(params.intentTag || 'normal_chat');
  const phase = normalizeText(params.relationshipPhase || PHASES.P1);

  let observation_type = 'none';
  let observation_hint = '';
  let evidence_count = 0;
  let reason = 'no_specific_observation';

  const distress = /(心が重|つらい|しんどい|限界|泣き|落ち込|苦しい|怖い|モヤモヤ|不安です|心配)/.test(userText);
  const weightWorry = /(kg|キロ|体重).*(早く|大丈夫|不安|心配|いいの)/.test(userText) || /(減りすぎ|早く減)/.test(userText);
  const learningJoy = /(食べてみて良かった|良かったです|嬉し|うれし|楽にな)/.test(userText);
  const rewardFood = /(おはぎ|ケーキ|ご褒美|食べちゃった|食べすぎ|ついでに)/.test(userText);
  const stableBreakfast = /(白湯|味付き卵|卵1|Ml|ml)/.test(userText) && userText.length < 80;

  if (distress && !/(kcal|カロリー|タンパク|脂質|糖質)/.test(userText)) {
    observation_type = 'emotional_context';
    observation_hint = '感情優先・数字より呼吸と気持ち';
    reason = 'distress_over_health_metrics';
  } else if (learningJoy) {
    observation_type = 'learning_success';
    observation_hint = '試して良かったという小さな成功';
    reason = 'positive_learning_signal';
  } else if (rewardFood) {
    observation_type = 'meal_balance';
    observation_hint = 'たまのご褒美・次を少し軽めに';
    reason = 'reward_food_non_judgmental';
  } else if (stableBreakfast && tc.has_breakfast_routine) {
    observation_type = 'stable_breakfast_candidate';
    const bp = normalizeText(tc.breakfast_pattern || '白湯と卵').slice(0, 40);
    observation_hint = `${bp || '白湯と卵'}の軽い朝食`;
    evidence_count = Number(tc.breakfast_routine_count || 0);
    reason = 'stable_breakfast_hint';
  } else if (weightWorry && (tc.recent_success || tc.weight_trend)) {
    observation_type = 'past_effort_link';
    const parts = [];
    if (tc.weight_trend) parts.push(`体重${tc.weight_trend}kg`);
    if (tc.recent_success) parts.push(tc.recent_success);
    observation_hint = parts.join('・') || '最近の歩数や体重の流れ';
    reason = 'weight_anxiety_bridge_yesterday';
  } else if (intent === 'exercise' && /(伸びた|捻れ|しびれ|痛み|違和感)/.test(userText)) {
    observation_type = 'body_awareness';
    observation_hint = '身体の変化への気づき';
    reason = 'exercise_body_feedback';
  } else if (normalizeText(tc.life_context) && (intent === 'meal' || intent === 'exercise')) {
    observation_type = 'life_environment';
    observation_hint = normalizeText(tc.life_context).slice(0, 72);
    reason = 'life_context_hint';
  } else if (tc.recent_correction && intent === 'meal') {
    observation_type = 'correction_trust';
    observation_hint = 'あとから整えてくれる流れ';
    reason = 'recent_correction_positive';
  } else if (Array.isArray(tc.trust_signals) && tc.trust_signals.length && phase !== PHASES.P1) {
    observation_type = 'trust_signal';
    observation_hint = '家族や周りへの共有';
    reason = 'family_share_signal';
  } else if (tc.recent_success && intent === 'meal') {
    observation_type = 'yesterday_carryover';
    observation_hint = normalizeText(tc.recent_success).slice(0, 72);
    reason = 'yesterday_success_meal_bridge';
  } else if (normalizeText(tc.body_note) && intent !== 'normal_chat') {
    observation_type = 'body_care';
    observation_hint = normalizeText(tc.body_note).slice(0, 56);
    reason = 'body_note_side_by_side';
  } else if (tc.latest_meal && intent === 'meal') {
    observation_type = 'today_continuity';
    observation_hint = normalizeText(tc.latest_meal).slice(0, 40);
    reason = 'meal_shape_visible';
  } else if (tc.exercise_today && intent === 'exercise') {
    observation_type = 'today_continuity';
    observation_hint = normalizeText(tc.exercise_today).slice(0, 56);
    reason = 'exercise_today_ack';
  }

  if (!observation_hint) {
    observation_type = 'none';
    reason = 'no_specific_observation';
  }

  console.info('[contextual_observation_selected]', {
    user_id: userId || '(anon)',
    observation_type,
    observation_hint: observation_hint.slice(0, 120),
    evidence_count,
    reason
  });

  return { observation_type, observation_hint, evidence_count, reason };
}

module.exports = {
  selectContextualObservation
};
