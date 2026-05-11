'use strict';

/**
 * LINE 実機なしで orchestrateConversation を回し、分類・返信・禁止テンプレ・
 * 食事バケット保存・重複・誤ルートを検証する。
 *
 * --only=meal|conversation|all|meal,conversation,quality
 */

require('dotenv').config();

const conversationStateInterpreterService = require('../services/conversation_state_interpreter_service');
const { orchestrateConversation } = require('../services/conversation_orchestrator_service');
const contextMemoryService = require('../services/context_memory_service');
const dailyNutritionSummaryService = require('../services/daily_nutrition_summary_service');
const { runObservationLayerTests } = require('./simulate_line_observation_layer');

/** @see services/emotional_quality_check_service.js */
const GENERIC_TEMPLATE_STRIP = [
  'ここまでの流れを一本で見ています',
  '急がず、今日はこの一歩で十分です',
  '雑談も、ちゃんと受け止めます',
  '健康の話に引き戻さなくて大丈夫です',
  '続きがあれば、そのまま送ってください',
  'まずはここに送れただけで十分です'
];

const BANNED_SHORT_PHRASES = [
  '記録しました',
  '確認しました',
  '保存しました',
  'いい流れです',
  '無理なく続けましょう',
  '頑張りましょう',
  '次の一歩は小さくて十分です'
];

function parseOnlyArg() {
  const raw = process.argv.find((a) => a.startsWith('--only='));
  if (!raw) return new Set(['all']);
  return new Set(
    raw
      .slice('--only='.length)
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean)
  );
}

function onlyWants(only, name) {
  if (only.has('all')) return true;
  return only.has(name);
}

function pullText(result) {
  const msg = Array.isArray(result?.replyMessages) ? result.replyMessages.find((x) => x?.type === 'text') : null;
  return String(msg?.text || '').trim();
}

function sumBucketMealKcal(records) {
  return (records?.meals || []).reduce((acc, m) => acc + Number(m?.kcal || m?.estimatedNutrition?.kcal || 0), 0);
}

function forbiddenPhraseHits(text) {
  const t = String(text || '');
  const hits = [];
  for (const s of GENERIC_TEMPLATE_STRIP) {
    if (t.includes(s)) hits.push(s);
  }
  for (const s of BANNED_SHORT_PHRASES) {
    if (t.includes(s)) hits.push(s);
  }
  if (/「[^」]{1,48}」の重さ、ちゃんと受け取っています/.test(t)) hits.push('echo_weight_lead_template');
  return hits;
}

function interpret(text, userId = 'U_interp') {
  return conversationStateInterpreterService.interpretConversationState({
    userId,
    text,
    shortMemory: {},
    hasPendingConfirmation: false
  });
}

async function snapshot(userId) {
  const bucket = await contextMemoryService.getTodayRecords(userId);
  const dbSum = await dailyNutritionSummaryService.fetchTodayNutritionSummary(userId);
  const bucketKcal = sumBucketMealKcal(bucket);
  const dbKcal = Number(dbSum.kcal || 0);
  /** DB 集計は meal_logs の真値。getTodayRecords は DB 直後で空の瞬間があり得るため合算に寄せる */
  const effectiveKcal = Math.max(bucketKcal, dbKcal);
  return {
    bucketKcal,
    bucketMealCount: (bucket.meals || []).length,
    dbKcal,
    dbMealCount: Number(dbSum.meal_count || 0),
    effectiveKcal
  };
}

function selfTestForbiddenDetector() {
  const probe = '了解です。\n記録しました。';
  const h = forbiddenPhraseHits(probe);
  if (!h.includes('記録しました')) {
    throw new Error('[simulate:line] forbidden detector self-test failed');
  }
}

async function runTurn(userId, text, messageId) {
  const before = await snapshot(userId);
  const result = await orchestrateConversation({
    userId,
    lineUserId: userId,
    messageType: 'text',
    messageId: messageId || `m-${Date.now()}`,
    rawText: text
  });
  const after = await snapshot(userId);
  const reply = pullText(result);
  const persisted =
    after.dbMealCount > before.dbMealCount || after.bucketMealCount > before.bucketMealCount;
  const internal = result?.internal || {};
  return {
    result,
    reply,
    internal,
    before,
    after,
    persisted,
    intentType: String(internal.intentType || ''),
    responseMode: String(internal.responseMode || '')
  };
}

function printBlock(title, obj) {
  console.info(`[SCENARIO] ${title}`);
  console.info('expected:');
  console.info(JSON.stringify(obj.expected, null, 2));
  console.info('actual:');
  console.info(JSON.stringify(obj.actual, null, 2));
  console.info(obj.pass ? 'PASS' : 'FAIL');
  console.info('');
}

async function runScenario(def) {
  const userId = `U_simline_${def.id}_${Date.now()}_${Math.random().toString(16).slice(2, 8)}`;
  const errors = [];
  const steps = Array.isArray(def.steps) ? def.steps : [{ text: def.text, messageId: def.messageId, expect: def.expect }];

  const agg = {
    expected: {},
    actual: {},
    pass: true
  };

  for (let i = 0; i < steps.length; i += 1) {
    const st = steps[i];
    const interp = interpret(st.text, userId);
    const out = await runTurn(userId, st.text, st.messageId);

    const exp = st.expect || {};
    if (i === 0 && def.expectInterpret) {
      const ei = def.expectInterpret;
      if (ei.primary_conversation_mode && interp.primary_conversation_mode !== ei.primary_conversation_mode) {
        errors.push(`interpret.mode want ${ei.primary_conversation_mode} got ${interp.primary_conversation_mode}`);
      }
      if (ei.route && interp.route !== ei.route) {
        errors.push(`interpret.route want ${ei.route} got ${interp.route}`);
      }
      if (ei.reply_depth && interp.reply_depth !== ei.reply_depth) {
        errors.push(`interpret.reply_depth want ${ei.reply_depth} got ${interp.reply_depth}`);
      }
    }

    if (exp.intentType && out.intentType !== exp.intentType) {
      errors.push(`step${i} intentType want ${exp.intentType} got ${out.intentType}`);
    }
    if (exp.intentTypeNot && exp.intentTypeNot.includes(out.intentType)) {
      errors.push(`step${i} intentType must not be ${out.intentType}`);
    }
    if (exp.persisted != null && out.persisted !== exp.persisted) {
      errors.push(`step${i} persisted want ${exp.persisted} got ${out.persisted}`);
    }
    if (exp.dailyTotalBucketKcal != null && out.after.effectiveKcal !== exp.dailyTotalBucketKcal) {
      errors.push(
        `step${i} daily total kcal want ${exp.dailyTotalBucketKcal} got effective=${out.after.effectiveKcal} (bucket=${out.after.bucketKcal}, db=${out.after.dbKcal})`
      );
    }
    if (exp.minBucketMeals != null && out.after.bucketMealCount < exp.minBucketMeals) {
      errors.push(`step${i} bucketMealCount want >= ${exp.minBucketMeals} got ${out.after.bucketMealCount}`);
    }

    const hits = forbiddenPhraseHits(out.reply);
    const forbidden = hits.length > 0;
    if (exp.forbidden != null && forbidden !== exp.forbidden) {
      errors.push(`step${i} forbidden want ${exp.forbidden} got ${forbidden} hits=${JSON.stringify(hits)}`);
    } else if (exp.forbidden == null && forbidden) {
      errors.push(`step${i} forbidden phrase(s): ${hits.join(' | ')}`);
    }

    if (Array.isArray(exp.notIntentTypes) && exp.notIntentTypes.includes(out.intentType)) {
      errors.push(`step${i} misroute: intent ${out.intentType} is forbidden`);
    }
    if (exp.replyMustContain && !out.reply.includes(exp.replyMustContain)) {
      errors.push(`step${i} reply missing "${exp.replyMustContain}"`);
    }
    if (exp.replyMustNotContain && out.reply.includes(exp.replyMustNotContain)) {
      errors.push(`step${i} reply must not contain "${exp.replyMustNotContain}"`);
    }
    if (exp.nonEmptyReply && !out.reply) {
      errors.push(`step${i} empty reply`);
    }

    if (i === steps.length - 1) {
      agg.expected = {
        route: exp.reportRoute || exp.intentType || def.title,
        interpret_mode: def.expectInterpret?.primary_conversation_mode,
        persisted: exp.persisted,
        daily_total_kcal: exp.dailyTotalBucketKcal,
        forbidden_phrase: Boolean(exp.forbidden != null ? exp.forbidden : false)
      };
      agg.actual = {
        route: out.intentType,
        interpret_mode: interp.primary_conversation_mode,
        persisted: out.persisted,
        daily_total_kcal: out.after.effectiveKcal,
        daily_total_kcal_bucket: out.after.bucketKcal,
        daily_total_kcal_db: out.after.dbKcal,
        forbidden_phrase: forbidden,
        reply_preview: out.reply.slice(0, 120)
      };
    }
  }

  if (errors.length) {
    agg.pass = false;
    agg.errors = errors;
  }

  printBlock(def.title, agg);
  if (errors.length) {
    console.error(`[simulate:line] ${def.id} errors:`, errors);
    return false;
  }
  return true;
}

function allScenarios() {
  const dupMsgId = `m-dup-${Date.now()}`;
  return [
    {
      id: 'heart_heavy',
      group: 'conversation',
      title: '心が重いです',
      text: '心が重いです',
      expectInterpret: {
        primary_conversation_mode: 'emotional_support',
        route: 'life_companion',
        reply_depth: 'deep'
      },
      expect: {
        intentType: 'emotional_support',
        forbidden: false,
        notIntentTypes: ['lab_followup', 'meal_record_text', 'meal_note', 'correction_feedback'],
        nonEmptyReply: true
      }
    },
    {
      id: 'assistant_error',
      group: 'conversation',
      title: '間違えてますよ',
      text: '間違えてますよ',
      expectInterpret: {
        primary_conversation_mode: 'assistant_error_feedback',
        route: 'correction_feedback'
      },
      expect: {
        intentType: 'correction_feedback',
        forbidden: false,
        notIntentTypes: ['lab_followup', 'meal_record_text', 'emotional_support'],
        nonEmptyReply: true
      }
    },
    {
      id: 'meal_hot_water_egg',
      group: 'meal',
      title: '白湯300ml、味付き卵一個',
      text: '白湯300ml、味付き卵一個',
      messageId: `m-hot-${Date.now()}`,
      expectInterpret: {
        primary_conversation_mode: 'meal_text_record',
        route: 'meal_record'
      },
      expect: {
        intentType: 'meal_record_text',
        persisted: true,
        dailyTotalBucketKcal: 70,
        forbidden: false,
        notIntentTypes: ['lab_followup', 'emotional_support', 'correction_feedback', 'casual_chat'],
        nonEmptyReply: true,
        reportRoute: 'meal_record'
      }
    },
    {
      id: 'meal_dup_same_line_message',
      group: 'meal',
      title: '同じ白湯300ml、味付き卵一個を連投',
      steps: [
        {
          text: '白湯300ml、味付き卵一個',
          messageId: dupMsgId,
          expect: {
            intentType: 'meal_record_text',
            persisted: true,
            dailyTotalBucketKcal: 70,
            forbidden: false,
            notIntentTypes: ['lab_followup', 'casual_chat']
          }
        },
        {
          text: '白湯300ml、味付き卵一個',
          messageId: dupMsgId,
          expect: {
            intentType: 'meal_record_text',
            persisted: false,
            dailyTotalBucketKcal: 70,
            forbidden: false,
            notIntentTypes: ['lab_followup', 'casual_chat']
          }
        }
      ],
      expectInterpret: {
        primary_conversation_mode: 'meal_text_record',
        route: 'meal_record'
      }
    },
    {
      id: 'reward_ohagi',
      group: 'meal',
      title: 'おはぎ二個食べちゃいました',
      text: 'おはぎ二個食べちゃいました',
      messageId: `m-ohagi-${Date.now()}`,
      expectInterpret: {
        primary_conversation_mode: 'reward_food',
        route: 'meal_record'
      },
      expect: {
        intentType: 'meal_note',
        persisted: true,
        dailyTotalBucketKcal: 300,
        forbidden: false,
        notIntentTypes: ['lab_followup', 'emotional_support'],
        replyMustContain: 'おはぎ',
        nonEmptyReply: true,
        reportRoute: 'meal_record'
      }
    },
    {
      id: 'stretch_arm',
      group: 'conversation',
      title: 'ストレッチしたら腕が伸びた感じがしました',
      text: 'ストレッチしたら腕が伸びた感じがしました',
      expectInterpret: {
        primary_conversation_mode: 'exercise_feedback',
        route: 'exercise_or_body_feedback'
      },
      expect: {
        intentType: 'exercise_feedback',
        forbidden: false,
        notIntentTypes: ['lab_followup', 'meal_record_text', 'correction_feedback', 'emotional_support'],
        nonEmptyReply: true
      }
    },
    {
      id: 'lab_tg_question',
      group: 'conversation',
      title: 'TGは？',
      text: 'TGは？',
      expectInterpret: {
        primary_conversation_mode: 'lab_followup',
        route: 'lab_followup'
      },
      expect: {
        intentType: 'lab_followup',
        forbidden: false,
        notIntentTypes: ['meal_record_text', 'meal_note', 'emotional_support', 'correction_feedback'],
        nonEmptyReply: true
      }
    },
    {
      id: 'meal_half_rice',
      group: 'conversation',
      title: 'ご飯半分食べました',
      text: 'ご飯半分食べました',
      expectInterpret: {
        primary_conversation_mode: 'meal_correction',
        route: 'meal_correction'
      },
      expect: {
        intentType: 'meal_correction_target_not_found',
        forbidden: false,
        notIntentTypes: ['lab_followup', 'meal_record_text', 'emotional_support'],
        replyMustContain: '食事',
        nonEmptyReply: true
      }
    },
    {
      id: 'yes_without_pending',
      group: 'conversation',
      title: 'はい（保留なし）',
      text: 'はい',
      expectInterpret: {
        primary_conversation_mode: 'casual_chat',
        route: 'normal_chat'
      },
      expect: {
        intentType: 'casual_chat',
        forbidden: false,
        notIntentTypes: ['lab_followup', 'meal_record_text', 'emotional_support'],
        nonEmptyReply: true
      }
    }
  ];
}

async function main() {
  const only = parseOnlyArg();
  const runMeal = onlyWants(only, 'meal');
  const runConv = onlyWants(only, 'conversation');
  const runQuality = only.has('quality');

  selfTestForbiddenDetector();

  const scenarios = allScenarios().filter((sc) => {
    if (only.has('all')) return true;
    if (runMeal && sc.group === 'meal') return true;
    if (runConv && sc.group === 'conversation') return true;
    return false;
  });

  if (!only.has('all') && !runMeal && !runConv && runQuality) {
    try {
      runObservationLayerTests();
    } catch (e) {
      console.error(e?.message || e);
      process.exitCode = 1;
      return;
    }
    console.info('[simulate:line] quality-only (observation) complete');
    return;
  }

  let failed = 0;
  for (const sc of scenarios) {
    const ok = await runScenario(sc);
    if (!ok) failed += 1;
  }

  if (runQuality || only.has('all')) {
    try {
      runObservationLayerTests();
    } catch (e) {
      console.error(e?.message || e);
      failed += 1;
    }
  }

  if (failed) {
    console.error(`[simulate:line] DONE with ${failed} failure(s)`);
    process.exitCode = 1;
  } else {
    console.info('[simulate:line] ALL PASS');
  }
}

main().catch((e) => {
  console.error(e?.stack || e?.message || e);
  process.exit(1);
});
