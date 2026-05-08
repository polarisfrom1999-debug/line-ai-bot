'use strict';

function normalizeText(v) {
  return String(v || '').trim();
}

function detectModeFromText(text = '') {
  const safe = normalizeText(text);
  if (!safe) return 'casual_shift';
  if (/^(はい|うん|そう|OK|ok|お願いします|それで)$/i.test(safe)) return 'pending_answer';
  if (/(心が重い|気持ちが重い|寂しい|さみしい|つらい|しんどい|不安|嫌だった|疲れた|泣きたい|もう無理|落ち込/.test(safe)) return 'emotional_shift';
  if (/(TG|中性脂肪|HbA1c|hba1c|LDH|AST|ALT|血糖|クレアチニン).*(は|？|\?)?$/.test(safe)) return 'lab_shift';
  if (/(ご飯|ごはん|米|麺|パン|おかず|サラダ|卵|肉|魚).*(半分|少なめ|残した|食べてない|完食)|半分食べました/.test(safe)) return 'meal_correction_continuation';
  if (/(腰|膝|だるい|眠い|頭痛|痛い|重い)/.test(safe)) return 'body_condition_shift';
  if (/(腕立て|スクワット|ランニング|ウォーキング|走った|歩いた|筋トレ|回|分)/.test(safe)) return 'exercise_shift';
  return 'casual_shift';
}

function detectTopicShift({ text = '', activeContextType = '', hasPending = false } = {}) {
  const mode = detectModeFromText(text);
  const active = normalizeText(activeContextType);
  const activeMeal = /^meal_/.test(active) || active === 'meal';
  if (hasPending && mode === 'pending_answer') {
    return { should_continue_previous_context: false, new_conversation_mode: 'pending_answer', reason: 'pending_confirmation_response' };
  }
  if (activeMeal && mode === 'meal_correction_continuation') {
    return { should_continue_previous_context: true, new_conversation_mode: 'meal_correction', reason: 'meal_context_and_fraction_expression' };
  }
  if (activeMeal && (mode === 'lab_shift' || mode === 'emotional_shift' || mode === 'casual_shift')) {
    return { should_continue_previous_context: false, new_conversation_mode: mode === 'lab_shift' ? 'lab_followup' : (mode === 'emotional_shift' ? 'emotional_support' : 'casual_chat'), reason: 'topic_shift_from_meal_context' };
  }
  return {
    should_continue_previous_context: mode === 'meal_correction_continuation' && activeMeal,
    new_conversation_mode: mode === 'meal_correction_continuation' ? 'meal_correction' : (mode === 'lab_shift' ? 'lab_followup' : (mode === 'emotional_shift' ? 'emotional_support' : 'casual_chat')),
    reason: 'text_semantic_mode'
  };
}

module.exports = {
  detectTopicShift,
};

