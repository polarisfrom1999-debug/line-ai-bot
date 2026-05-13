'use strict';

/**
 * 観察1点・文脈セレクタ単体（実LINE/LLMなし）。
 * simulate:line:quality からも呼ばれる。
 */

const contextualObservationSelectorService = require('../services/contextual_observation_selector_service');
const { PHASES } = require('../services/relationship_phase_service');

function runObservationLayerTests() {
  const failures = [];

  function runScenario(name, setup) {
    const sel = contextualObservationSelectorService.selectContextualObservation(setup.params);
    const checks = setup.expect(sel);
    const failed = checks.filter((c) => !c.ok);
    if (failed.length) {
      failures.push({ name, sel, failed });
      console.error(`[simulate:line:observation] FAIL ${name}`, { sel, failed });
    } else {
      console.info(`[simulate:line:observation] OK ${name}`, { observation_type: sel.observation_type });
    }
  }

  const baseUser = 'U_simulate_line_obs';

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
      { ok: /体重|歩数|流れ/.test(sel.observation_hint), label: 'hint_links_context' }
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
      { ok: sel.observation_type === 'stable_breakfast_candidate', label: 'stable_breakfast_candidate' },
      { ok: /白湯|卵|朝/.test(sel.observation_hint), label: 'hint_breakfast' }
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
      { ok: /ご褒美|軽め|次/.test(sel.observation_hint), label: 'hint_non_judgmental' }
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
      { ok: !/カロリー|kcal/.test(sel.observation_hint), label: 'no_calorie_pivot' }
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
      { ok: /身体|変化|気づ/.test(sel.observation_hint), label: 'hint_body' }
    ]
  });

  if (failures.length) {
    throw new Error(`[simulate:line:observation] ${failures.length} scenario(s) failed`);
  }
  console.info('[simulate:line:observation] scenarios complete');
}

module.exports = { runObservationLayerTests };

if (require.main === module) {
  try {
    runObservationLayerTests();
  } catch (e) {
    console.error(e?.message || e);
    process.exit(1);
  }
}
