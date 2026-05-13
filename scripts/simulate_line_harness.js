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
const { evaluateReplyQuality, forbiddenPhraseHits } = require('./lib/simulate_line_reply_quality');

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

function interpret(text, userId = 'U_interp', shortMemory = null) {
  return conversationStateInterpreterService.interpretConversationState({
    userId,
    text,
    shortMemory: shortMemory || {},
    hasPendingConfirmation: false
  });
}

async function interpretWithMemory(text, userId) {
  const shortMemory = await contextMemoryService.getShortMemory(userId).catch(() => ({}));
  return interpret(text, userId, shortMemory || {});
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

async function runLabNormalizerSelfTests() {
  const { resolveLabItemForPersistence } = require('../services/newflow/lab_item_normalizer_service');
  const emptyMaster = [];
  const k = await resolveLabItemForPersistence('K', {}, emptyMaster);
  if (k.normalized_key === 'cpk') {
    throw new Error('[simulate:line] lab normalizer: K must not map to cpk');
  }
  if (k.normalized_key !== 'potassium') {
    throw new Error(`[simulate:line] lab normalizer: K want potassium got ${k.normalized_key}`);
  }
  const cpk = await resolveLabItemForPersistence('CPK', {}, emptyMaster);
  if (cpk.normalized_key !== 'cpk') {
    throw new Error(`[simulate:line] lab normalizer: CPK want cpk got ${cpk.normalized_key}`);
  }
  const mch = await resolveLabItemForPersistence('MCH', {}, emptyMaster);
  if (mch.normalized_key !== 'mch') {
    throw new Error(`[simulate:line] lab normalizer: MCH want mch got ${mch.normalized_key}`);
  }
  const mchc = await resolveLabItemForPersistence('MCHC', {}, emptyMaster);
  if (mchc.normalized_key === 'mch') {
    throw new Error('[simulate:line] lab normalizer: MCHC must not map to mch');
  }
  if (mchc.normalized_key !== 'mchc') {
    throw new Error(`[simulate:line] lab normalizer: MCHC want mchc got ${mchc.normalized_key}`);
  }
  const bili = await resolveLabItemForPersistence('総ビリルビン', {}, emptyMaster);
  if (!/^total_bilirubin$/.test(bili.normalized_key)) {
    throw new Error(`[simulate:line] lab normalizer: 総ビリルビン want total_bilirubin got ${bili.normalized_key}`);
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
  if (typeof def.preSeed === 'function') {
    await def.preSeed(userId);
  }
  const steps = Array.isArray(def.steps) ? def.steps : [{ text: def.text, messageId: def.messageId, expect: def.expect }];

  const agg = {
    expected: {},
    actual: {},
    pass: true
  };

  for (let i = 0; i < steps.length; i += 1) {
    const st = steps[i];
    const interp = await interpretWithMemory(st.text, userId);
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

    const qViol = evaluateReplyQuality({
      userText: st.qualityUserText != null ? st.qualityUserText : st.text,
      reply: out.reply,
      intentType: out.intentType,
      interpretMode: interp.primary_conversation_mode,
      replyDepth: interp.reply_depth,
      allowStableRoutinePhrase: Boolean(exp.allowStableRoutinePhrase)
    });
    if (qViol.length) {
      errors.push(`step${i} reply_quality: ${qViol.join('; ')}`);
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
  const dupMsgIdA = `m-dup-a-${Date.now()}`;
  const dupMsgIdB = `m-dup-b-${Date.now()}`;
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
        allowStableRoutinePhrase: false,
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
          messageId: dupMsgIdA,
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
          messageId: dupMsgIdB,
          expect: {
            intentType: 'pending_confirmation',
            persisted: false,
            dailyTotalBucketKcal: 70,
            forbidden: false,
            notIntentTypes: ['lab_followup', 'casual_chat'],
            replyMustContain: '同じ内容が今日すでに入っています'
          }
        },
        {
          text: 'はい',
          qualityUserText: '白湯300ml、味付き卵一個',
          messageId: dupMsgId,
          expect: {
            intentType: 'meal_record_text',
            persisted: true,
            dailyTotalBucketKcal: 140,
            forbidden: false,
            allowStableRoutinePhrase: true,
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
        notIntentTypes: ['lab_followup', 'meal_record_text', 'correction_feedback', 'emotional_support', 'casual_chat', 'life_companion'],
        replyMustContain: '腕',
        nonEmptyReply: true
      }
    },
    {
      id: 'life_work_stress',
      group: 'conversation',
      title: '仕事で嫌なことがあって聞いてほしい',
      text: '仕事で嫌なことがあって、ちょっと聞いてほしい',
      expectInterpret: {
        primary_conversation_mode: 'life_companion',
        route: 'life_companion'
      },
      expect: {
        intentType: 'life_companion',
        forbidden: false,
        notIntentTypes: ['lab_followup', 'meal_record_text', 'meal_note', 'correction_feedback', 'casual_chat'],
        nonEmptyReply: true
      }
    },
    {
      id: 'lab_tg_question',
      group: 'conversation',
      title: 'TGは？',
      text: 'TGは？',
      preSeed: async (userId) => {
        await contextMemoryService.saveShortMemory(userId, {
          followUpContext: {
            labPanel: {
              latestExamDate: '2026-04-01',
              examDate: '2026-04-01',
              items: [{ itemName: '中性脂肪', value: '61', unit: 'mg/dL', flag: '' }],
              rawText: 'TG 61 mg/dL'
            }
          }
        });
      },
      expectInterpret: {
        primary_conversation_mode: 'lab_followup',
        route: 'lab_followup'
      },
      expect: {
        intentType: 'lab_followup',
        forbidden: false,
        notIntentTypes: ['meal_record_text', 'meal_note', 'emotional_support', 'correction_feedback', 'casual_chat'],
        replyMustContain: 'TG：61',
        nonEmptyReply: true
      }
    },
    {
      id: 'lab_other_exam_dates',
      group: 'conversation',
      title: '他の検査日は？（lab_image_session）',
      text: '他の検査日は？',
      preSeed: async (userId) => {
        await contextMemoryService.saveShortMemory(userId, {
          activeContext: { type: 'lab_image_session', domain: 'lab_image_session' },
          followUpContext: {
            imageType: 'lab_image_session',
            labPanel: {
              examDates: ['2016-01-21', '2016-02-25', '2016-05-10', '2025-03-22'],
              latestExamDate: '2025-03-22',
              items: [{ itemName: '中性脂肪', value: '61', unit: 'mg/dL' }]
            }
          }
        });
      },
      expectInterpret: {
        primary_conversation_mode: 'lab_date_inventory',
        route: 'lab_followup'
      },
      expect: {
        intentType: 'lab_date_inventory',
        forbidden: false,
        notIntentTypes: ['casual_chat', 'meal_record_text', 'emotional_support'],
        replyMustContain: '2016-01-21',
        nonEmptyReply: true
      }
    },
    {
      id: 'lab_compare_previous',
      group: 'conversation',
      title: '前回と比べて（lab_image_session）',
      text: '前回と比べて',
      preSeed: async (userId) => {
        await contextMemoryService.saveShortMemory(userId, {
          activeContext: { type: 'lab_image_session', domain: 'lab_image_session' },
          followUpContext: {
            imageType: 'lab_image_session',
            labPanel: {
              examDates: ['2025-01-10', '2025-03-22'],
              latestExamDate: '2025-03-22',
              items: [{
                itemName: '中性脂肪',
                value: '61',
                unit: 'mg/dL',
                history: [
                  { date: '2025-01-10', value: '72', unit: 'mg/dL' },
                  { date: '2025-03-22', value: '61', unit: 'mg/dL' }
                ]
              }]
            }
          }
        });
      },
      expectInterpret: {
        primary_conversation_mode: 'lab_comparison',
        route: 'lab_followup'
      },
      expect: {
        intentType: 'lab_comparison',
        forbidden: false,
        notIntentTypes: ['casual_chat', 'meal_record_text', 'emotional_support'],
        replyMustContain: '2025-01-10',
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
  await runLabNormalizerSelfTests();

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
