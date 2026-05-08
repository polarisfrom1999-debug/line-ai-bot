'use strict';

/**
 * 牛込先生会話レイヤー（観察1点・文脈）のシナリオ検証。
 * 実LINE/LLMは使わず、selector とスタブ today_context のみ検証する。
 */

const contextualObservationSelectorService = require('../services/contextual_observation_selector_service');
const { PHASES } = require('../services/relationship_phase_service');

function runScenario(name, setup) {
  const sel = contextualObservationSelectorService.selectContextualObservation(setup.params);
  const checks = setup.expect(sel);
  const failed = checks.filter((c) => !c.ok);
  if (failed.length) {
    console.error(`[simulate:line] FAIL ${name}`, { sel, failed });
    process.exitCode = 1;
    return;
  }
  console.info(`[simulate:line] OK ${name}`, { observation_type: sel.observation_type });
}

const baseUser = 'U_simulate_line';

runScenario('morning_support', {
  params: {
    userId: baseUser,
    userText: '55.0kgでした。こんなに早く減っていいのかな？',
    todayContext: {
      weight_trend: '55.2→55.0',
      recent_success: '昨日9,700歩',
      latest_meal: '親子丼'
    },
    intentTag: 'meal',
    relationshipPhase: PHASES.P3
  },
  expect: (sel) => [
    { ok: sel.observation_type === 'past_effort_link', label: 'past_effort_link' },
    { ok: /流れ|背景|やった分/.test(sel.observation_text), label: 'links_flow' }
  ]
});

runScenario('stable_breakfast', {
  params: {
    userId: baseUser,
    userText: '白湯300ml、味付き卵1個',
    todayContext: { has_breakfast_routine: true, breakfast_pattern: '白湯と卵' },
    intentTag: 'meal',
    relationshipPhase: PHASES.P2
  },
  expect: (sel) => [
    { ok: sel.observation_type === 'stable_rhythm', label: 'stable_rhythm' },
    { ok: /安定|リズム|無理に変え/.test(sel.observation_text), label: 'respect_routine' }
  ]
});

runScenario('reward_food', {
  params: {
    userId: baseUser,
    userText: 'おはぎ2個食べちゃいました〜',
    todayContext: {},
    intentTag: 'meal',
    relationshipPhase: PHASES.P3
  },
  expect: (sel) => [
    { ok: sel.observation_type === 'meal_balance', label: 'meal_balance' },
    { ok: /ご褒美|責めず|次/.test(sel.observation_text), label: 'non_judgmental' }
  ]
});

runScenario('emotional_after_meal', {
  params: {
    userId: baseUser,
    userText: '心が重いです',
    todayContext: { latest_meal: 'カレー' },
    intentTag: 'meal',
    relationshipPhase: PHASES.P3
  },
  expect: (sel) => [
    { ok: sel.observation_type === 'emotional_context', label: 'emotional_context' },
    { ok: !/カロリー|kcal/.test(sel.observation_text), label: 'no_calorie_pivot' }
  ]
});

runScenario('exercise_feedback', {
  params: {
    userId: baseUser,
    userText: 'ストレッチしたら腕が伸びたまま捻れました',
    todayContext: {},
    intentTag: 'exercise',
    relationshipPhase: PHASES.P2
  },
  expect: (sel) => [
    { ok: sel.observation_type === 'body_awareness', label: 'body_awareness' },
    { ok: /変化|気づ|ペース/.test(sel.observation_text), label: 'body_positive' }
  ]
});

console.info('[simulate:line] scenarios complete');
