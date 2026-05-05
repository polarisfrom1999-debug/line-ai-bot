'use strict';

const contextualIntentInterpreterService = require('./contextual_intent_interpreter_service');
const userStateInferenceService = require('./user_state_inference_service');

function normalizeText(v) {
  return String(v || '').trim();
}

async function judgeWithCompassion(payload = {}) {
  const interpreted = await contextualIntentInterpreterService.interpretContextualIntent(payload);
  const deeper = userStateInferenceService.inferUserStateSignals(payload);
  const confidence = Number(interpreted.confidence || 0.5);
  const isNormalChat = interpreted.surface_intent === 'normal_chat';

  let riskLevel = 'low';
  if (deeper.possible_pain_or_discomfort || deeper.possible_overexertion) riskLevel = 'medium';
  if (/(消えたい|激痛|息苦しい|動けない)/.test(normalizeText(payload.userText))) riskLevel = 'high';

  let needsConfirmation =
    confidence < 0.85
    || deeper.possible_confusion
    || (interpreted.surface_intent === 'meal_correction' && confidence < 0.9);
  if (isNormalChat) needsConfirmation = false;

  let confirmationQuestion = null;
  if (needsConfirmation) {
    if (interpreted.surface_intent === 'meal_correction') {
      confirmationQuestion = '直前の食事を補正する意図で合っていますか？合っていれば調整します。';
    } else if (interpreted.surface_intent === 'meal_record_text') {
      confirmationQuestion = '今日は少なめの食事として記録しておきますか？';
    } else {
      confirmationQuestion = 'この内容を記録してよいか、確認してもいいですか？';
    }
  }

  let supportStyle = 'normal';
  if (deeper.possible_guilt_or_shame) supportStyle = 'reassure';
  else if (deeper.possible_overexertion) supportStyle = 'caution';
  else if (deeper.possible_fatigue) supportStyle = 'rest';
  else if (/exercise_record|meal_record_text|meal_correction/.test(interpreted.surface_intent)) supportStyle = 'encourage';
  else if (needsConfirmation) supportStyle = 'clarify';

  const shouldWriteDb = !isNormalChat && confidence >= 0.85 && !needsConfirmation && riskLevel !== 'high';
  const nextBestAction = riskLevel === 'high'
    ? 'suggest_rest'
    : needsConfirmation
      ? 'ask_confirmation'
      : shouldWriteDb
        ? 'record'
        : 'normal_reply';

  return {
    surface_intent: interpreted.surface_intent || 'unknown',
    deeper_state: deeper,
    confidence,
    risk_level: riskLevel,
    should_write_db: shouldWriteDb,
    needs_confirmation: needsConfirmation,
    confirmation_question: confirmationQuestion,
    reason: `confidence=${confidence.toFixed(2)} risk=${riskLevel}`,
    entities: interpreted.entities || {},
    support_style: supportStyle,
    reply_hint: needsConfirmation ? 'gentle_confirmation' : 'short_supportive_reply',
    next_best_action: nextBestAction
  };
}

module.exports = {
  judgeWithCompassion,
};

