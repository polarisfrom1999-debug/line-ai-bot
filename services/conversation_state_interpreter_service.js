'use strict';

const topicShiftDetectorService = require('./topic_shift_detector_service');
const EMOTIONAL_SUPPORT_RE = /(心が重い|気持ちが重い|寂しい|さみしい|つらい|しんどい|不安|嫌だった|疲れた|泣きたい|もう無理|落ち込む|落ち込んだ)/;

function normalizeText(v) {
  return String(v || '').trim();
}

function yesToken(text = '') {
  return /^(はい|うん|そう|OK|ok|お願いします|それで)$/i.test(normalizeText(text));
}

function detectPrimaryMode(text = '') {
  const safe = normalizeText(text);
  if (!safe) return 'casual_chat';
  if (EMOTIONAL_SUPPORT_RE.test(safe)) return 'emotional_support';
  if (/(仕事で嫌|仕事.*嫌な|家族|恋愛|人間関係|相談|聞いて|実は|本当は|どう思う)/.test(safe)) return 'life_companion';
  if (/(TG|中性脂肪|HbA1c|hba1c|LDH|AST|ALT|血糖|クレアチニン).*(は|？|\?)?$|何読み取れ/.test(safe)) return 'lab_followup';
  if (/(ご飯|ごはん|米|麺|パン|おかず|サラダ|卵|肉|魚).*(半分|少なめ|残した|食べてない|完食)|半分食べました/.test(safe)) return 'meal_correction';
  if (/(腰|膝|だるい|眠い|頭痛|痛い|重い)/.test(safe)) return 'body_condition_note';
  if (/(腕立て|スクワット|ランニング|ウォーキング|走った|歩いた|筋トレ).*(した|やった)?|\d+\s*(分|回|km)/.test(safe)) return 'exercise_record';
  if (/^(こんにちは|こんばんは|おはよう|やあ|ありがとう|なるほど|そうなんだ)$/u.test(safe)) return 'casual_chat';
  return 'casual_chat';
}

function mapModeToRoute(mode) {
  if (mode === 'emotional_support' || mode === 'life_companion') return 'life_companion';
  if (mode === 'meal_correction') return 'meal_correction';
  if (mode === 'lab_followup') return 'lab_followup';
  if (mode === 'body_condition_note') return 'body_condition_note';
  if (mode === 'exercise_record') return 'exercise_record';
  if (mode === 'pending_answer') return 'pending_answer';
  return 'normal_chat';
}

function replyDepthForMode(mode, text) {
  if (mode === 'emotional_support') return 'deep';
  if (mode === 'life_companion') return /(寂しい|さみしい|しんどい|つらい|心が重い|不安|もう無理)/.test(normalizeText(text)) ? 'deep' : 'normal';
  if (mode === 'casual_chat') return 'short';
  if (mode === 'meal_correction' || mode === 'exercise_record' || mode === 'lab_followup') return 'normal';
  return 'normal';
}

function toneForMode(mode) {
  if (mode === 'emotional_support') return 'emotional_safety';
  if (mode === 'life_companion') return 'safe_openness';
  if (mode === 'casual_chat') return 'professional_calm';
  return 'professional_calm';
}

function riskForMode(mode, text = '') {
  if (mode !== 'emotional_support') return 'low';
  if (/(もう無理|消えたい|限界)/.test(normalizeText(text))) return 'high';
  return 'medium';
}

function interpretConversationState({
  userId = '',
  text = '',
  shortMemory = {},
  hasPendingConfirmation = false
} = {}) {
  const safe = normalizeText(text);
  const activeContextType = normalizeText(shortMemory?.activeContext?.type || shortMemory?.followUpContext?.imageType || '');
  const pendingAnswer = hasPendingConfirmation && yesToken(safe);
  const mode = pendingAnswer ? 'pending_answer' : detectPrimaryMode(safe);
  const shift = topicShiftDetectorService.detectTopicShift({
    text: safe,
    activeContextType,
    hasPending: hasPendingConfirmation
  });
  const shouldContinue = pendingAnswer ? false : Boolean(shift?.should_continue_previous_context);
  const route = pendingAnswer ? 'pending_answer' : mapModeToRoute(mode);
  const out = {
    primary_conversation_mode: mode,
    surface_intent: mode === 'casual_chat' ? 'normal_chat' : mode,
    route,
    should_continue_previous_context: shouldContinue,
    should_apply_pending_confirmation: pendingAnswer,
    should_route_to_feature: ['meal_correction', 'lab_followup', 'exercise_record', 'body_condition_note'].includes(mode),
    reply_depth: replyDepthForMode(mode, safe),
    tone_mode: toneForMode(mode),
    risk_level: riskForMode(mode, safe),
    reason: shift?.reason || 'conversation_state_semantic'
  };
  console.info('[conversation_state_interpreted]', {
    user_id: userId,
    text: safe.slice(0, 120),
    primary_conversation_mode: out.primary_conversation_mode,
    surface_intent: out.surface_intent,
    route: out.route,
    should_continue_previous_context: out.should_continue_previous_context,
    should_apply_pending_confirmation: out.should_apply_pending_confirmation,
    reply_depth: out.reply_depth,
    tone_mode: out.tone_mode,
    reason: out.reason
  });
  console.info('[conversation_context_switch_decision]', {
    user_id: userId,
    text: safe.slice(0, 120),
    active_context_type: activeContextType,
    previous_context_summary: activeContextType,
    should_continue_previous_context: out.should_continue_previous_context,
    new_conversation_mode: out.primary_conversation_mode,
    reason: out.reason
  });
  return out;
}

module.exports = {
  interpretConversationState,
};

