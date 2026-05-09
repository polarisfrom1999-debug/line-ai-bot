'use strict';

const conversationStateInterpreterService = require('../services/conversation_state_interpreter_service');

function assert(name, cond, detail) {
  if (!cond) {
    console.error(`[routing_smoke] FAIL ${name}`, detail || '');
    process.exitCode = 1;
  } else {
    console.info(`[routing_smoke] OK ${name}`);
  }
}

function run(text, pending = false) {
  return conversationStateInterpreterService.interpretConversationState({
    userId: 'U_smoke',
    text,
    shortMemory: {},
    hasPendingConfirmation: pending
  });
}

const heart = run('心が重いです');
assert('heart_emotional', heart.primary_conversation_mode === 'emotional_support', heart);

const meal = run('白湯300ml、味付き卵一個');
assert('meal_text', meal.primary_conversation_mode === 'meal_text_record', meal);

const reward = run('おはぎ二個食べちゃいました');
assert('reward_food', reward.primary_conversation_mode === 'reward_food', reward);

const stretch = run('ストレッチしたら腕が伸びた感じがしました');
assert('exercise_feedback', stretch.primary_conversation_mode === 'exercise_feedback', stretch);

const err = run('間違えてますよ');
assert('assistant_error', err.primary_conversation_mode === 'assistant_error_feedback', err);
assert('error_route', err.route === 'correction_feedback', err);

console.info('[routing_smoke] done');
