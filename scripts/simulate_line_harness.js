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
const {
  evaluateUshigomeScenarioQuality,
  evaluateGlobalUshigomeFails,
} = require('./lib/simulate_line_ushigome_quality');
const { evaluateMovementScenarioQuality } = require('./lib/simulate_line_movement_quality');
const { evaluateConversationCoreScenarioQuality } = require('./lib/simulate_line_conversation_core_quality');
const movementGoalCompanionService = require('../services/movement_goal_companion_service');
const ushigomeConversationStyleService = require('../services/ushigome_conversation_style_service');

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

async function runMovementCompanionSelfTest() {
  const movementConditionMap = require('../services/movement_condition_map_service');
  const movementClassifier = require('../services/movement_support_classifier_service');
  const movementLibrary = require('../services/movement_selfcare_library_service');

  if (!movementGoalCompanionService.isMovementGoalCompanionText('腰が固いのでストレッチを教えて')) {
    throw new Error('[simulate:line] movement companion detect failed');
  }
  const matched = movementConditionMap.matchConditions('脊柱管狭窄症');
  if (!matched.some((c) => c.id === 'spinal_stenosis')) {
    throw new Error('[simulate:line] condition map spinal_stenosis missing');
  }
  const shin = movementConditionMap.matchConditions('シンスプリント');
  if (!shin.some((c) => c.id === 'shin_splint')) {
    throw new Error('[simulate:line] condition map shin_splint missing');
  }
  const hints = movementGoalCompanionService.buildMovementGoalHints({
    userText: '足がしびれて歩けません',
    conversationMode: 'movement_goal_companion',
  });
  if (!hints.safe_self_care_candidates?.length || !hints.ushigomeStyle) {
    throw new Error('[simulate:line] movement hints incomplete');
  }
  if (!hints.block_self_care) {
    throw new Error('[simulate:line] movement red flag block_self_care expected');
  }
  const safeHints = movementGoalCompanionService.buildMovementGoalHints({
    userText: '腰が重いです',
    conversationMode: 'movement_goal_companion',
  });
  if (!safeHints.recommended_menu) {
    throw new Error('[simulate:line] movement menu missing for safe case');
  }
  const cls = movementClassifier.classifyMovementSupport({ userText: '胸が苦しいです' });
  if (cls.safety_level !== movementClassifier.SAFETY_LEVEL.RED_FLAG) {
    throw new Error('[simulate:line] chest pain should be red_flag');
  }
  const menus = movementLibrary.pickMenus({
    bodyRegion: 'lower_leg',
    conditionIds: ['shin_splint'],
    safetyLevel: 'safe_self_care_candidate',
    text: '走るとすねが痛い',
  });
  if (!menus.length) throw new Error('[simulate:line] shin splint menus missing');

  const movementLifeSceneSelfcare = require('../services/movement_life_scene_selfcare_service');
  const lp = movementLifeSceneSelfcare.pickLifeSceneExercise({
    userText: '朝起きると腰が固いです',
    blockSelfCare: false,
    safetyLevel: 'needs_caution',
  });
  if (!lp || lp.exerciseKey !== 'knee_sway_bed') {
    throw new Error('[simulate:line] life scene morning waist pick failed');
  }

  const { postProcessMovementReply } = require('../services/movement_life_scene_selfcare_service');
  const bikePp = postProcessMovementReply({
    userText: '布団の中で自転車こぎしていいですか',
    replyText: '仰向けで少し動かしてみましょう。終わったら教えてください。',
  });
  if (!/腰が反る感じがある時はやらない/.test(bikePp) || !/腰が痛い日は無理にしない/.test(bikePp)) {
    throw new Error('[simulate:line] postProcess bicycle waist clauses failed');
  }
  const bathPp = postProcessMovementReply({
    userText: 'お風呂で腰を伸ばしてもいいですか',
    replyText: '湯船で背中を丸めて10秒。終わったら教えてください。',
  });
  if (!/のぼせ/.test(bathPp) || !/ふらつ/.test(bathPp) || !/滑りそう/.test(bathPp)) {
    throw new Error('[simulate:line] postProcess bath caution failed');
  }
  const betterPp = postProcessMovementReply({
    userText: '楽になりました',
    replyText: 'いい感じですね。明日も頑張りましょう。',
  });
  if (!/増やさず/.test(betterPp) || !/同じ強さ/.test(betterPp) || !/再現/.test(betterPp)) {
    throw new Error('[simulate:line] postProcess better reaction failed');
  }
}

async function runUshigomeStyleSelfTest() {
  const hints = ushigomeConversationStyleService.buildUshigomeStyleHints({
    userText: 'おはぎ二個食べちゃいました',
    conversationMode: 'reward_food',
  });
  if (!Array.isArray(hints.stylePrinciples) || hints.stylePrinciples.length < 5) {
    throw new Error('[simulate:line] ushigome style: stylePrinciples missing');
  }
  if (!hints.user_emotional_state || !hints.body_risk_state) {
    throw new Error('[simulate:line] ushigome style: canonical judgment fields missing');
  }
  if (!Array.isArray(hints.avoid_response_patterns) || !hints.tone_hint) {
    throw new Error('[simulate:line] ushigome style: avoid_response_patterns or tone_hint missing');
  }
  if (!hints.userStateInterpretation?.primaryEmotion) {
    throw new Error('[simulate:line] ushigome style: userStateInterpretation missing');
  }
  const block = ushigomeConversationStyleService.formatHintsForPrompt(hints);
  if (!/AI牛込/.test(block) || /森田|松阪|髙橋/.test(block)) {
    throw new Error('[simulate:line] ushigome prompt block invalid');
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

    if (exp.intentType && !exp.intentTypeOneOf && out.intentType !== exp.intentType) {
      errors.push(`step${i} intentType want ${exp.intentType} got ${out.intentType}`);
    }
    if (Array.isArray(exp.intentTypeOneOf) && !exp.intentTypeOneOf.includes(out.intentType)) {
      errors.push(`step${i} intentType want one of ${exp.intentTypeOneOf.join('|')} got ${out.intentType}`);
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
      allowStableRoutinePhrase: Boolean(exp.allowStableRoutinePhrase),
      skipDirectEchoCheck: Boolean(exp.ushigomeScenario || exp.movementScenario),
    });
    if (qViol.length) {
      errors.push(`step${i} reply_quality: ${qViol.join('; ')}`);
    }

    if (exp.ushigomeScenario) {
      const qualityUserText = st.qualityUserText != null ? st.qualityUserText : st.text;
      const uViol = evaluateUshigomeScenarioQuality({
        userText: qualityUserText,
        reply: out.reply,
        scenarioId: exp.ushigomeScenario,
      });
      const gViol = evaluateGlobalUshigomeFails({
        userText: qualityUserText,
        reply: out.reply,
      });
      const merged = [...new Set([...uViol, ...gViol])];
      if (merged.length) {
        errors.push(`step${i} ushigome_quality: ${merged.join('; ')}`);
      }
    }

    if (exp.movementScenario) {
      const qualityUserText = st.qualityUserText != null ? st.qualityUserText : st.text;
      const mViol = evaluateMovementScenarioQuality({
        userText: qualityUserText,
        reply: out.reply,
        scenarioId: exp.movementScenario,
      });
      if (mViol.length) {
        errors.push(`step${i} movement_quality: ${mViol.join('; ')}`);
      }
    }

    if (exp.conversationCoreScenario) {
      const qualityUserText = st.qualityUserText != null ? st.qualityUserText : st.text;
      const cViol = evaluateConversationCoreScenarioQuality({
        userText: qualityUserText,
        reply: out.reply,
        scenarioId: exp.conversationCoreScenario,
      });
      if (cViol.length) {
        errors.push(`step${i} conversation_core_quality: ${cViol.join('; ')}`);
      }
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
    },
    ...conversationCoreScenarios(),
    ...ushigomeScenarios(),
    ...movementGoalScenarios(),
  ];
}

function movementGoalScenarios() {
  return [
    { id: 'movement_lumbar_heavy', group: 'movement', title: '腰が重いです', text: '腰が重いです', expectInterpret: { primary_conversation_mode: 'movement_goal_companion' }, expect: { intentType: 'movement_goal_companion', movementScenario: 'lumbar_heavy', forbidden: false, nonEmptyReply: true } },
    { id: 'movement_spinal_stenosis', group: 'movement', title: '脊柱管狭窄症しびれ', text: '脊柱管狭窄症と言われています。歩くと足がしびれます', expectInterpret: { primary_conversation_mode: 'movement_goal_companion' }, expect: { intentType: 'movement_goal_companion', movementScenario: 'spinal_stenosis_numbness', forbidden: false, nonEmptyReply: true } },
    { id: 'movement_gikkuri', group: 'movement', title: 'ぎっくり腰怖い', text: 'ぎっくり腰っぽくて動くのが怖いです', expectInterpret: { primary_conversation_mode: 'movement_goal_companion' }, expect: { intentType: 'movement_goal_companion', movementScenario: 'acute_low_back_fear', forbidden: false, nonEmptyReply: true } },
    { id: 'movement_shoulder', group: 'movement', title: '肩が上がりにくい', text: '肩が上がりにくいです', expectInterpret: { primary_conversation_mode: 'movement_goal_companion' }, expect: { intentType: 'movement_goal_companion', movementScenario: 'shoulder_frozen', forbidden: false, nonEmptyReply: true } },
    { id: 'movement_knee_training', group: 'movement', title: '膝痛家トレ', text: '膝が痛いけど家でできる筋トレありますか', expectInterpret: { primary_conversation_mode: 'movement_goal_companion' }, expect: { intentType: 'movement_goal_companion', movementScenario: 'knee_home_training', forbidden: false, nonEmptyReply: true } },
    { id: 'movement_neck', group: 'movement', title: 'ストレートネック', text: 'ストレートネックで首肩がつらいです', expectInterpret: { primary_conversation_mode: 'movement_goal_companion' }, expect: { intentType: 'movement_goal_companion', movementScenario: 'straight_neck', forbidden: false, nonEmptyReply: true } },
    { id: 'movement_weeding', group: 'movement', title: '草むしり腰張り', text: '草むしりして腰が張りました', expect: { intentTypeOneOf: ['movement_goal_companion', 'exercise_record', 'life_companion'], movementScenario: 'weeding_back', forbidden: false, nonEmptyReply: true } },
    { id: 'movement_squat_done', group: 'movement', title: '足痛スクワットした', text: '足が痛いけどスクワットしました', expect: { intentTypeOneOf: ['movement_goal_companion', 'exercise_record', 'exercise_feedback'], movementScenario: 'squat_done_with_pain', forbidden: false, nonEmptyReply: true } },
    { id: 'movement_chest', group: 'movement', title: '胸が苦しい', text: '胸が苦しいです', expectInterpret: { primary_conversation_mode: 'movement_goal_companion' }, expect: { intentType: 'movement_goal_companion', movementScenario: 'chest_red_flag', forbidden: false, nonEmptyReply: true } },
    { id: 'movement_wrist_fall', group: 'movement', title: '転倒手首腫れ', text: '転んで手首が腫れています', expectInterpret: { primary_conversation_mode: 'movement_goal_companion' }, expect: { intentType: 'movement_goal_companion', movementScenario: 'wrist_fall_swelling', forbidden: false, nonEmptyReply: true } },
    { id: 'movement_cauda', group: 'movement', title: '腰痛しびれ排尿', text: '腰痛と足のしびれ、排尿が変です', expectInterpret: { primary_conversation_mode: 'movement_goal_companion' }, expect: { intentType: 'movement_goal_companion', movementScenario: 'cauda_equina', forbidden: false, nonEmptyReply: true } },
    { id: 'movement_shin_run', group: 'movement', title: '走るとすね痛', text: '走るとすねの内側が痛いです', expectInterpret: { primary_conversation_mode: 'movement_goal_companion' }, expect: { intentType: 'movement_goal_companion', movementScenario: 'shin_run_pain', forbidden: false, nonEmptyReply: true } },
    { id: 'movement_shin_point', group: 'movement', title: 'すね一点ジャンプ痛', text: 'すねの一点がズキッと痛くて片脚ジャンプも痛いです', expectInterpret: { primary_conversation_mode: 'movement_goal_companion' }, expect: { intentType: 'movement_goal_companion', movementScenario: 'shin_point_jump', forbidden: false, nonEmptyReply: true } },
    { id: 'movement_shin_practice', group: 'movement', title: 'シンスプリント練習', text: 'シンスプリントでも練習していいですか？', expectInterpret: { primary_conversation_mode: 'movement_goal_companion' }, expect: { intentType: 'movement_goal_companion', movementScenario: 'shin_practice_ok', forbidden: false, nonEmptyReply: true } },
    { id: 'movement_slurred', group: 'movement', title: 'ろれつ障害', text: 'ろれつが回らないです', expectInterpret: { primary_conversation_mode: 'movement_goal_companion' }, expect: { intentType: 'movement_goal_companion', movementScenario: 'neuro_red_flag', forbidden: false, nonEmptyReply: true } },
    { id: 'movement_unilateral_paralysis', group: 'movement', title: '片側麻痺', text: '片側の麻痺があります', expectInterpret: { primary_conversation_mode: 'movement_goal_companion' }, expect: { intentType: 'movement_goal_companion', movementScenario: 'neuro_red_flag', forbidden: false, nonEmptyReply: true } },
    { id: 'movement_stretch_hip', group: 'movement', title: '腰ストレッチ', text: '腰が固いのでストレッチを教えてください', expectInterpret: { primary_conversation_mode: 'movement_goal_companion' }, expect: { intentType: 'movement_goal_companion', movementScenario: 'stretch_request', forbidden: false, nonEmptyReply: true } },
    { id: 'movement_red_flag', group: 'movement', title: '足しびれ歩けない', text: '足がしびれて歩けません', expectInterpret: { primary_conversation_mode: 'movement_goal_companion' }, expect: { intentType: 'movement_goal_companion', movementScenario: 'red_flag_numbness', forbidden: false, nonEmptyReply: true } },
    { id: 'life_morning_waist', group: 'movement', title: '朝腰固い', text: '朝起きると腰が固いです', expectInterpret: { primary_conversation_mode: 'movement_goal_companion' }, expect: { intentType: 'movement_goal_companion', movementScenario: 'life_morning_waist_stiff', forbidden: false, nonEmptyReply: true } },
    { id: 'life_morning_hip', group: 'movement', title: '朝股関節固い', text: '朝、股関節が固いです', expectInterpret: { primary_conversation_mode: 'movement_goal_companion' }, expect: { intentType: 'movement_goal_companion', movementScenario: 'life_morning_hip_stiff', forbidden: false, nonEmptyReply: true } },
    { id: 'life_cockroach', group: 'movement', title: 'ゴキブリ体操', text: '朝、体が重いのでゴキブリ体操していいですか', expectInterpret: { primary_conversation_mode: 'movement_goal_companion' }, expect: { intentType: 'movement_goal_companion', movementScenario: 'life_hand_foot_shake', forbidden: false, nonEmptyReply: true } },
    { id: 'life_bed_bike', group: 'movement', title: '布団自転車こぎ', text: '布団の中で自転車こぎしていいですか', expectInterpret: { primary_conversation_mode: 'movement_goal_companion' }, expect: { intentType: 'movement_goal_companion', movementScenario: 'life_small_bicycle', forbidden: false, nonEmptyReply: true } },
    { id: 'life_bath_stretch', group: 'movement', title: 'お風呂腰伸ばし', text: 'お風呂で腰を伸ばしてもいいですか', expectInterpret: { primary_conversation_mode: 'movement_goal_companion' }, expect: { intentType: 'movement_goal_companion', movementScenario: 'life_bath_waist', forbidden: false, nonEmptyReply: true } },
    { id: 'life_chair_lumbar', group: 'movement', title: '椅子腰体操', text: '椅子でできる腰の体操ありますか', expectInterpret: { primary_conversation_mode: 'movement_goal_companion' }, expect: { intentType: 'movement_goal_companion', movementScenario: 'life_chair_waist', forbidden: false, nonEmptyReply: true } },
    { id: 'life_rx_better', group: 'movement', title: '反応楽', text: '楽になりました', expectInterpret: { primary_conversation_mode: 'movement_goal_companion' }, expect: { intentType: 'movement_goal_companion', movementScenario: 'life_reaction_better', forbidden: false, nonEmptyReply: true } },
    { id: 'life_rx_pain', group: 'movement', title: '反応痛い', text: '痛くなりました', expectInterpret: { primary_conversation_mode: 'movement_goal_companion' }, expect: { intentType: 'movement_goal_companion', movementScenario: 'life_reaction_pain', forbidden: false, nonEmptyReply: true } },
    { id: 'life_rx_numb', group: 'movement', title: '反応しびれ', text: 'しびれました', expectInterpret: { primary_conversation_mode: 'movement_goal_companion' }, expect: { intentType: 'movement_goal_companion', movementScenario: 'life_reaction_numb', forbidden: false, nonEmptyReply: true } },
  ];
}

function conversationCoreScenarios() {
  return [
    { id: 'phase_i_tired', group: 'conversation', title: 'Phase I: 今日は疲れました', text: '今日は疲れました', expect: { intentTypeOneOf: ['life_companion', 'emotional_support'], conversationCoreScenario: 'phase_i_tired', forbidden: false, nonEmptyReply: true } },
    { id: 'phase_i_work_bad', group: 'conversation', title: 'Phase I: 仕事で嫌なことがありました', text: '仕事で嫌なことがありました', expect: { intentType: 'life_companion', conversationCoreScenario: 'phase_i_work_bad', forbidden: false, nonEmptyReply: true } },
    { id: 'phase_i_lonely', group: 'conversation', title: 'Phase I: なんか寂しいです', text: 'なんか寂しいです', expect: { intentTypeOneOf: ['emotional_support', 'life_companion'], conversationCoreScenario: 'phase_i_lonely', forbidden: false, nonEmptyReply: true } },
    { id: 'phase_i_nothing_done', group: 'conversation', title: 'Phase I: 今日は何もできませんでした', text: '今日は何もできませんでした', expect: { intentTypeOneOf: ['life_companion', 'exercise_record'], conversationCoreScenario: 'phase_i_nothing_done', forbidden: false, nonEmptyReply: true } },
    { id: 'phase_i_ai_test', group: 'conversation', title: 'Phase I: どうせAIでしょ？', text: 'どうせAIでしょ？', expect: { intentType: 'life_companion', conversationCoreScenario: 'phase_i_ai_test', forbidden: false, nonEmptyReply: true } },
    { id: 'phase_i_non_health_ok', group: 'conversation', title: 'Phase I: 健康と関係ない話でもいいですか？', text: '健康と関係ない話でもいいですか？', expect: { intentType: 'life_companion', conversationCoreScenario: 'phase_i_non_health_ok', forbidden: false, nonEmptyReply: true } },
    { id: 'phase_i_ramen', group: 'conversation', title: 'Phase I: ラーメン食べちゃいました', text: 'ラーメン食べちゃいました', messageId: `m-ramen-${Date.now()}`, expect: { intentTypeOneOf: ['meal_note', 'meal_record_text'], conversationCoreScenario: 'phase_i_ramen', forbidden: false, nonEmptyReply: true } },
    { id: 'phase_i_sesame', group: 'conversation', title: 'Phase I: きなこをすりごまに変えていいですか？', text: 'きなこをすりごまに変えていいですか？', expect: { intentType: 'life_companion', conversationCoreScenario: 'phase_i_sesame', forbidden: false, nonEmptyReply: true } },
    { id: 'phase_i_meal_prep', group: 'conversation', title: 'Phase I: 作り置きこれで大丈夫ですか？', text: '作り置きこれで大丈夫ですか？', expect: { intentType: 'life_companion', conversationCoreScenario: 'phase_i_meal_prep', forbidden: false, nonEmptyReply: true } },
    { id: 'phase_i_convenience', group: 'conversation', title: 'Phase I: コンビニで何を買えばいいですか？', text: 'コンビニで何を買えばいいですか？', expect: { intentType: 'life_companion', conversationCoreScenario: 'phase_i_convenience', forbidden: false, nonEmptyReply: true } },
    { id: 'phase_i_travel_walk', group: 'conversation', title: 'Phase I: 旅行でたくさん歩けるか不安です', text: '旅行でたくさん歩けるか不安です', expect: { intentType: 'life_companion', conversationCoreScenario: 'phase_i_travel_walk', forbidden: false, nonEmptyReply: true } },
    { id: 'phase_i_mother_knee', group: 'conversation', title: 'Phase I: 母が膝を痛がっています', text: '母が膝を痛がっています', expect: { intentTypeOneOf: ['life_companion', 'body_condition_note'], conversationCoreScenario: 'phase_i_mother_knee', forbidden: false, nonEmptyReply: true } },
    { id: 'phase_i_lab_worry', group: 'conversation', title: 'Phase I: 血液検査結果が心配です', text: '血液検査結果が心配です', expect: { intentTypeOneOf: ['lab_followup', 'life_companion'], conversationCoreScenario: 'phase_i_lab_worry', forbidden: false, nonEmptyReply: true } },
    { id: 'phase_i_cinal', group: 'conversation', title: 'Phase I: シナール続けるか迷います', text: 'シナール続けるか迷います', expect: { intentType: 'life_companion', conversationCoreScenario: 'phase_i_cinal', forbidden: false, nonEmptyReply: true } },
    { id: 'phase_i_stop_med', group: 'conversation', title: 'Phase I: 薬をやめてもいいですか？', text: '薬をやめてもいいですか？', expect: { intentType: 'life_companion', conversationCoreScenario: 'phase_i_stop_med', forbidden: false, nonEmptyReply: true } },
    { id: 'phase_i_100m_drop', group: 'conversation', title: 'Phase I: 100mのタイムが落ちました', text: '100mのタイムが落ちました', expect: { intentType: 'life_companion', conversationCoreScenario: 'phase_i_100m_drop', forbidden: false, nonEmptyReply: true } },
    { id: 'phase_i_200m_five', group: 'conversation', title: 'Phase I: 今日は200mを5本走りました', text: '今日は200mを5本走りました', expect: { intentTypeOneOf: ['exercise_record', 'life_companion'], conversationCoreScenario: 'phase_i_200m_five', forbidden: false, nonEmptyReply: true } },
    { id: 'phase_i_ham_tight', group: 'conversation', title: 'Phase I: ハムが張っています', text: 'ハムが張っています', expect: { intentTypeOneOf: ['movement_goal_companion', 'life_companion', 'body_condition_note'], conversationCoreScenario: 'phase_i_ham_tight', forbidden: false, nonEmptyReply: true } },
    { id: 'phase_i_goal_done', group: 'conversation', title: 'Phase I: 目標達成しました', text: '目標達成しました', expect: { intentType: 'life_companion', conversationCoreScenario: 'phase_i_goal_done', forbidden: false, nonEmptyReply: true } },
    { id: 'phase_i_crisis', group: 'conversation', title: 'Phase I: 死にたいくらいつらい', text: '死にたいくらいつらい', expect: { intentType: 'emotional_support', conversationCoreScenario: 'phase_i_crisis', forbidden: false, nonEmptyReply: true } },
  ];
}

function ushigomeScenarios() {
  return [
    { id: 'ushigome_ohagi', group: 'ushigome', title: 'おはぎ二個食べちゃいました', text: 'おはぎ二個食べちゃいました', expectInterpret: { primary_conversation_mode: 'reward_food' }, expect: { intentTypeOneOf: ['meal_note', 'reward_food', 'meal_record_text'], ushigomeScenario: 'reward_ohagi', forbidden: false, nonEmptyReply: true } },
    { id: 'ushigome_weight_gain', group: 'ushigome', title: '体重が増えてしまいました', text: '体重が増えてしまいました', expectInterpret: { primary_conversation_mode: 'body_condition_note' }, expect: { intentTypeOneOf: ['body_condition_note', 'life_companion'], ushigomeScenario: 'weight_gain', forbidden: false, nonEmptyReply: true } },
    { id: 'ushigome_low_appetite', group: 'ushigome', title: '食欲がなくてあまり食べられません', text: '今日は食欲がなくてあまり食べられません', expectInterpret: { primary_conversation_mode: 'body_condition_note' }, expect: { intentType: 'body_condition_note', ushigomeScenario: 'low_appetite', forbidden: false, nonEmptyReply: true } },
    { id: 'ushigome_half_portion', group: 'ushigome', title: '半分にしました', text: '半分にしました', expect: { intentTypeOneOf: ['meal_correction', 'meal_correction_target_not_found', 'meal_record_text'], ushigomeScenario: 'half_portion', forbidden: false, nonEmptyReply: true } },
    { id: 'ushigome_photo_forgot', group: 'ushigome', title: '写真撮り忘れました', text: '写真撮り忘れました', expectInterpret: { primary_conversation_mode: 'life_companion' }, expect: { intentTypeOneOf: ['life_companion', 'casual_chat'], ushigomeScenario: 'photo_forgot', forbidden: false, nonEmptyReply: true } },
    { id: 'ushigome_stretch_relief', group: 'ushigome', title: '腰が痛かったけどストレッチしたら楽になりました', text: '腰が痛かったけどストレッチしたら楽になりました', expectInterpret: { primary_conversation_mode: 'exercise_feedback' }, expect: { intentType: 'exercise_feedback', ushigomeScenario: 'stretch_pain_relief', forbidden: false, nonEmptyReply: true } },
    { id: 'ushigome_squat_pain', group: 'ushigome', title: '足が痛いけどスクワットしました', text: '足が痛いけどスクワットしました', expect: { intentTypeOneOf: ['exercise_record', 'exercise_feedback', 'body_condition_note'], ushigomeScenario: 'squat_with_pain', forbidden: false, nonEmptyReply: true } },
    { id: 'ushigome_squat_20', group: 'ushigome', title: 'スクワット20回しました', text: 'スクワット20回しました', expect: { intentType: 'exercise_record', ushigomeScenario: 'squat_20', forbidden: false, nonEmptyReply: true } },
    { id: 'ushigome_jump_rope', group: 'ushigome', title: 'エアー縄跳び1分しました', text: 'エアー縄跳び1分しました', expect: { intentType: 'exercise_record', ushigomeScenario: 'jump_rope', forbidden: false, nonEmptyReply: true } },
    { id: 'ushigome_no_exercise', group: 'ushigome', title: '今日は運動できませんでした', text: '今日は運動できませんでした', expectInterpret: { primary_conversation_mode: 'life_companion' }, expect: { intentTypeOneOf: ['life_companion', 'casual_chat', 'exercise_record'], ushigomeScenario: 'exercise_skipped', forbidden: false, nonEmptyReply: true } },
    { id: 'ushigome_child_carry', group: 'ushigome', title: '子どもを抱っこして歩きました', text: '子どもを抱っこして歩きました', expectInterpret: { primary_conversation_mode: 'life_companion' }, expect: { intentTypeOneOf: ['life_companion', 'casual_chat', 'exercise_record'], ushigomeScenario: 'child_carry', forbidden: false, nonEmptyReply: true } },
    { id: 'ushigome_theater', group: 'ushigome', title: '劇団で遅くなりました', text: '劇団で遅くなりました', expectInterpret: { primary_conversation_mode: 'life_companion' }, expect: { intentTypeOneOf: ['life_companion', 'casual_chat'], ushigomeScenario: 'theater_late', forbidden: false, nonEmptyReply: true } },
    { id: 'ushigome_weeding', group: 'ushigome', title: '草むしり1時間しました', text: '草むしり1時間しました', expect: { intentType: 'exercise_record', ushigomeScenario: 'weeding', forbidden: false, nonEmptyReply: true } },
    { id: 'ushigome_tea_party', group: 'ushigome', title: '今日はお茶会でした', text: '今日はお茶会でした', expectInterpret: { primary_conversation_mode: 'life_companion' }, expect: { intentTypeOneOf: ['life_companion', 'casual_chat', 'meal_note'], ushigomeScenario: 'tea_party', forbidden: false, nonEmptyReply: true } },
    { id: 'ushigome_headache', group: 'ushigome', title: '頭痛があって食欲がありません', text: '頭痛があって食欲がありません', expectInterpret: { primary_conversation_mode: 'body_condition_note' }, expect: { intentType: 'body_condition_note', ushigomeScenario: 'headache_no_appetite', forbidden: false, nonEmptyReply: true } },
    { id: 'ushigome_constipation', group: 'ushigome', title: '便が出ていません', text: '便が出ていません', expectInterpret: { primary_conversation_mode: 'body_condition_note' }, expect: { intentType: 'body_condition_note', ushigomeScenario: 'constipation', forbidden: false, nonEmptyReply: true } },
    { id: 'ushigome_sleep', group: 'ushigome', title: '寝不足です', text: '寝不足です', expectInterpret: { primary_conversation_mode: 'body_condition_note' }, expect: { intentType: 'body_condition_note', ushigomeScenario: 'sleep_deprived', forbidden: false, nonEmptyReply: true } },
  ];
}

async function main() {
  const only = parseOnlyArg();
  const runMeal = onlyWants(only, 'meal');
  const runConv = onlyWants(only, 'conversation');
  const runQuality = only.has('quality');

  const runUshigome = onlyWants(only, 'ushigome');

  selfTestForbiddenDetector();
  await runMovementCompanionSelfTest();
  await runUshigomeStyleSelfTest();
  await runLabNormalizerSelfTests();

  const scenarios = allScenarios().filter((sc) => {
    if (only.has('all')) return true;
    if (runMeal && sc.group === 'meal') return true;
    if (runConv && sc.group === 'conversation') return true;
    if (runUshigome && sc.group === 'ushigome') return true;
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
