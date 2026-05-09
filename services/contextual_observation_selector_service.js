'use strict';

const { PHASES } = require('./relationship_phase_service');

function normalizeText(v) {
  return String(v || '').trim();
}

/**
 * @param {{
 *   userId: string,
 *   userText: string,
 *   todayContext: object,
 *   intentTag: string,
 *   relationshipPhase?: string
 * }} params
 * @returns {{ observation_type: string, observation_text: string, reason: string }}
 */
function selectContextualObservation(params = {}) {
  const userId = normalizeText(params.userId || '');
  const userText = normalizeText(params.userText || '');
  const tc = params.todayContext && typeof params.todayContext === 'object' ? params.todayContext : {};
  const intent = normalizeText(params.intentTag || 'normal_chat');
  const phase = normalizeText(params.relationshipPhase || PHASES.P1);

  let observation_type = 'none';
  let observation_text = '';
  let reason = 'no_specific_observation';

  const distress = /(心が重|つらい|しんどい|限界|泣き|落ち込|苦しい|怖い|モヤモヤ|不安です|心配)/.test(userText);
  const weightWorry = /(kg|キロ|体重).*(早く|大丈夫|不安|心配|いいの)/.test(userText) || /(減りすぎ|早く減)/.test(userText);
  const learningJoy = /(食べてみて良かった|良かったです|嬉し|うれし|楽にな)/.test(userText);
  const rewardFood = /(おはぎ|ケーキ|ご褒美|食べちゃった|食べすぎ|ついでに)/.test(userText);
  const stableBreakfast = /(白湯|味付き卵|卵1|Ml|ml)/.test(userText) && userText.length < 80;

  if (distress && !/(kcal|カロリー|タンパク|脂質|糖質)/.test(userText)) {
    observation_type = 'emotional_context';
    observation_text = 'いまの気持ちを先に受け止めます。食事や数字より、呼吸が浅くなっていないかだけ一緒に見ましょう。';
    reason = 'distress_over_health_metrics';
  } else if (learningJoy) {
    observation_type = 'learning_success';
    observation_text = '「やってみて良かった」と感じられたのは、かなり大きいです。こういう小さな成功が積み上がると、続けやすさに直結します。';
    reason = 'positive_learning_signal';
  } else if (rewardFood) {
    observation_type = 'meal_balance';
    observation_text = 'たまのご褒美は生活の中で自然に起きます。責めずに、次の一回を少し軽めに整えられれば十分です。';
    reason = 'reward_food_non_judgmental';
  } else if (stableBreakfast && tc.has_breakfast_routine) {
    observation_type = 'stable_rhythm';
    const bp = normalizeText(tc.breakfast_pattern || userText).slice(0, 40);
    observation_text = `${bp ? `${bp}の` : 'この'}朝の形は、崩れにくいリズムとしてかなり安定してきていますね。無理に変えなくて大丈夫です。`;
    reason = 'stable_breakfast_respect';
  } else if (weightWorry && (tc.recent_success || tc.weight_trend)) {
    observation_type = 'past_effort_link';
    const parts = [];
    if (tc.weight_trend) parts.push(`体重は${tc.weight_trend}kg`);
    if (tc.recent_success) parts.push(tc.recent_success);
    observation_text = `${parts.join('、')}と、ここ最近の流れが今日の数字の背景に見えています。やった分は消えていません。`;
    reason = 'weight_anxiety_bridge_yesterday';
  } else if (intent === 'exercise' && /(伸びた|捻れ|しびれ|痛み|違和感)/.test(userText)) {
    observation_type = 'body_awareness';
    observation_text = '身体の変化に気づけているのは、ケアとしてとても良い流れです。次も同じペースで十分です。';
    reason = 'exercise_body_feedback';
  } else if (normalizeText(tc.life_context) && (intent === 'meal' || intent === 'exercise')) {
    observation_type = 'life_environment';
    observation_text = `生活の背景（${normalizeText(tc.life_context).slice(0, 72)}）も見えています。この条件なら、いまの形で十分です。`;
    reason = 'life_context_into_health_comment';
  } else if (tc.recent_correction && intent === 'meal') {
    observation_type = 'correction_trust';
    observation_text = '最近、あとから整えてくれる流れが続いています。推定より実感に寄せていく動きとしてとても良いです。';
    reason = 'recent_correction_positive';
  } else if (Array.isArray(tc.trust_signals) && tc.trust_signals.length && phase !== PHASES.P1) {
    observation_type = 'trust_signal';
    observation_text = '家族や周りに共有できた流れ、ちゃんと見えています。信頼のサインとして大事にします。';
    reason = 'family_share_signal';
  } else if (tc.recent_success && intent === 'meal') {
    observation_type = 'yesterday_carryover';
    observation_text = `${tc.recent_success}の積み重ねが、今日の食事の土台にもつながっているように見えます。`;
    reason = 'yesterday_success_meal_bridge';
  } else if (normalizeText(tc.body_note) && intent !== 'normal_chat') {
    observation_type = 'body_care';
    observation_text = `体の声（${normalizeText(tc.body_note).slice(0, 56)}）も横に置いておきます。無理に上乗せしなくて大丈夫です。`;
    reason = 'body_note_side_by_side';
  } else if (tc.latest_meal && intent === 'meal') {
    observation_type = 'today_continuity';
    observation_text = `${normalizeText(tc.latest_meal).slice(0, 40)}、今日の食卓の形としてちゃんと見えています。`;
    reason = 'meal_shape_visible';
  } else if (tc.exercise_today && intent === 'exercise') {
    observation_type = 'today_continuity';
    observation_text = `今日の動き（${normalizeText(tc.exercise_today).slice(0, 56)}）、記録として受け取れています。`;
    reason = 'exercise_today_ack';
  }

  if (!observation_text) {
    observation_type = 'none';
    reason = 'no_specific_observation';
  }

  console.info('[contextual_observation_selected]', {
    user_id: userId || '(anon)',
    observation_type,
    observation_text: observation_text.slice(0, 200),
    reason
  });

  return { observation_type, observation_text, reason };
}

module.exports = {
  selectContextualObservation
};
