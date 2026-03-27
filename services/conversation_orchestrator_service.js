'use strict';

const contextMemoryService = require('./context_memory_service');
const aiChatService = require('./ai_chat_service');
const chatCaptureService = require('./chat_capture_service');
const captureRouterService = require('./capture_router_service');
const recordConfirmationService = require('./record_confirmation_service');
const recordNormalizerService = require('./record_normalizer_service');
const dailySummaryService = require('./daily_summary_service');

const lineMediaService = require('./line_media_service');
const mealAnalysisService = require('./meal_analysis_service');
const labImageAnalysisService = require('./lab_image_analysis_service');
const recordPersistenceService = require('./record_persistence_service');

const INTENT_TYPES = {
  SMALL_TALK: 'small_talk',
  CONSULTATION: 'consultation',
  EMOTIONAL_SHARE: 'emotional_share',
  MEAL_RECORD: 'meal_record',
  WEIGHT_RECORD: 'weight_record',
  EXERCISE_RECORD: 'exercise_record',
  LAB_RECORD: 'lab_record',
  PROFILE_UPDATE: 'profile_update',
  FOLLOW_UP_IMAGE: 'follow_up_image',
  FOLLOW_UP_RECORD: 'follow_up_record',
  QUESTION_ABOUT_MEMORY: 'question_about_memory',
  DAILY_SUMMARY_REQUEST: 'daily_summary_request',
  TIME_QUESTION: 'time_question',
  META_AI_QUESTION: 'meta_ai_question',
  MIXED: 'mixed'
};

const RESPONSE_MODES = {
  EMPATHY_ONLY: 'empathy_only',
  EMPATHY_PLUS_ONE_HINT: 'empathy_plus_one_hint',
  DEEP_SUPPORT: 'deep_support',
  CASUAL_TALK: 'casual_talk',
  RECORD_WITH_WARMTH: 'record_with_warmth',
  CLARIFY_MINIMUM: 'clarify_minimum',
  MEMORY_ANSWER: 'memory_answer',
  SUMMARY_MODE: 'summary_mode'
};

function normalizeText(value) {
  return String(value || '').trim();
}

function clampScore(value) {
  return Math.min(10, Math.max(1, Number(value || 5)));
}

function round1(n) {
  return Math.round((Number(n) || 0) * 10) / 10;
}

async function loadConversationContext(input) {
  const userId = input?.userId;
  const [
    shortMemory,
    longMemory,
    userState,
    recentSummary,
    recentMessages
  ] = await Promise.all([
    contextMemoryService.getShortMemory(userId),
    contextMemoryService.getLongMemory(userId),
    contextMemoryService.getUserState(userId),
    contextMemoryService.buildRecentSummary(userId, 3),
    contextMemoryService.getRecentMessages(userId, 20)
  ]);

  return {
    shortMemory,
    longMemory,
    userState,
    recentSummary,
    recentMessages
  };
}

function inferIntent(context) {
  const input = context.input || {};
  const text = normalizeText(input.rawText || '');

  if (context.routerHints?.looksLikeMemoryQuestion) return INTENT_TYPES.QUESTION_ABOUT_MEMORY;
  if (context.routerHints?.looksLikeTimeQuestion) return INTENT_TYPES.TIME_QUESTION;
  if (context.routerHints?.looksLikeDailySummaryRequest) return INTENT_TYPES.DAILY_SUMMARY_REQUEST;

  if (input.messageType === 'image') {
    return INTENT_TYPES.FOLLOW_UP_IMAGE;
  }

  if (/しんど|つらい|苦しい|限界|痛い|不安/.test(text)) return INTENT_TYPES.EMOTIONAL_SHARE;
  if (/体重|kg|キロ|体脂肪/.test(text)) return INTENT_TYPES.WEIGHT_RECORD;
  if (/歩いた|ジョギング|ランニング|筋トレ|運動|スクワット/.test(text)) return INTENT_TYPES.EXERCISE_RECORD;
  if (/血液検査|LDL|HDL|中性脂肪|HbA1c|AST|ALT/.test(text)) return INTENT_TYPES.LAB_RECORD;
  if (/朝ごはん|昼ごはん|夜ごはん|食べた|飲んだ|ラーメン|カレー|卵|味噌汁|寿司/.test(text)) return INTENT_TYPES.MEAL_RECORD;
  if (/どうしたら|相談|悩んでる|困ってる|不安/.test(text)) return INTENT_TYPES.CONSULTATION;
  if (!text) return INTENT_TYPES.MIXED;
  return INTENT_TYPES.SMALL_TALK;
}

function inferNextUserState(context) {
  const before = context.userStateBefore || {
    nagiScore: 5,
    gasolineScore: 5,
    trustScore: 3,
    lastEmotionTone: 'neutral'
  };
  const text = normalizeText(context?.input?.rawText || '');

  let nagi = Number(before.nagiScore || 5);
  let gasoline = Number(before.gasolineScore || 5);
  let trust = Number(before.trustScore || 3);
  let tone = 'neutral';

  if (/しんど|つらい|苦しい|限界|不安/.test(text)) {
    nagi -= 1.2;
    gasoline -= 0.8;
    tone = 'sad';
  } else if (/疲れた|眠い|寝不足|だるい/.test(text)) {
    gasoline -= 1.0;
    tone = 'tired';
  } else if (/安心|落ち着いた|大丈夫/.test(text)) {
    nagi += 0.6;
    tone = 'calm';
  }

  if (/覚えてる|相談|うっし|本音/.test(text)) {
    trust += 0.2;
  }

  return {
    nagiScore: clampScore(nagi),
    gasolineScore: clampScore(gasoline),
    trustScore: clampScore(trust),
    lastEmotionTone: tone,
    updatedAt: new Date().toISOString()
  };
}

function chooseResponseMode(context) {
  if (context.intentType === INTENT_TYPES.QUESTION_ABOUT_MEMORY) return RESPONSE_MODES.MEMORY_ANSWER;
  if (context.intentType === INTENT_TYPES.DAILY_SUMMARY_REQUEST) return RESPONSE_MODES.SUMMARY_MODE;
  if (context.userState?.nagiScore <= 3) return RESPONSE_MODES.DEEP_SUPPORT;
  if (context.userState?.gasolineScore <= 3) return RESPONSE_MODES.EMPATHY_ONLY;

  if (
    context.intentType === INTENT_TYPES.MEAL_RECORD ||
    context.intentType === INTENT_TYPES.WEIGHT_RECORD ||
    context.intentType === INTENT_TYPES.EXERCISE_RECORD ||
    context.intentType === INTENT_TYPES.LAB_RECORD ||
    context.intentType === INTENT_TYPES.FOLLOW_UP_IMAGE
  ) {
    return RESPONSE_MODES.RECORD_WITH_WARMTH;
  }

  if (context.intentType === INTENT_TYPES.SMALL_TALK) return RESPONSE_MODES.CASUAL_TALK;
  return RESPONSE_MODES.EMPATHY_PLUS_ONE_HINT;
}

async function safeExtractFromConversation(context) {
  try {
    if (chatCaptureService && typeof chatCaptureService.extractFromConversation === 'function') {
      return await chatCaptureService.extractFromConversation(context);
    }
  } catch (error) {
    console.error('[conversation_orchestrator] safeExtractFromConversation error:', error?.message || error);
  }

  return {
    recordCandidates: [],
    shortMemoryCandidates: [],
    longMemoryCandidates: [],
    emotionalSignals: [],
    consultationSignals: [],
    supportHints: []
  };
}

async function analyzeImageIfNeeded(context) {
  if (context?.input?.messageType !== 'image') {
    return { imagePayload: null, meal: null, lab: null };
  }

  const imagePayload = await lineMediaService.getImagePayload(context.input);
  if (!imagePayload) {
    return { imagePayload: null, meal: null, lab: null };
  }

  const [meal, lab] = await Promise.all([
    mealAnalysisService.analyzeMealImage(imagePayload),
    labImageAnalysisService.analyzeLabImage(imagePayload)
  ]);

  return {
    imagePayload,
    meal,
    lab
  };
}

function formatNutritionBlock(nutrition, ratioText) {
  if (!nutrition) return '';
  return [
    ratioText ? `量の反映: ${ratioText}` : null,
    `推定: 約${round1(nutrition.kcal)}kcal`,
    `たんぱく質 ${round1(nutrition.protein)}g / 脂質 ${round1(nutrition.fat)}g / 糖質 ${round1(nutrition.carbs)}g`
  ].filter(Boolean).join('\n');
}

function buildMealReply(parsedMeal) {
  const items = Array.isArray(parsedMeal?.items) && parsedMeal.items.length
    ? parsedMeal.items.join('、')
    : '食事';
  const amountText = parsedMeal?.amountNote || (parsedMeal?.amountRatio && parsedMeal.amountRatio !== 1 ? `量補正 ${parsedMeal.amountRatio}倍` : '');

  return [
    `受け取りました。今回は ${items} として見ています。`,
    formatNutritionBlock(parsedMeal?.estimatedNutrition, amountText),
    '必要なら、このまま今日の合計にもつなげていきます。'
  ].filter(Boolean).join('\n');
}

function buildLabReply(lab) {
  const items = Array.isArray(lab?.items) ? lab.items : [];
  const top = items.slice(0, 5).map((item) => `${item.itemName} ${item.value}${item.unit ? ` ${item.unit}` : ''}`);
  if (!top.length) {
    return '血液検査画像は受け取りました。読み取りは試みましたが、今回は項目を十分に確定できませんでした。';
  }

  return [
    '血液検査画像を受け取りました。',
    `読み取れた主な項目: ${top.join(' / ')}`,
    '気になる項目があれば、そのまま聞いてください。'
  ].join('\n');
}

function buildLdlReply(context) {
  const lab = context?.imageAnalysis?.lab || null;
  const items = Array.isArray(lab?.items) ? lab.items : [];
  const ldl = items.find((item) => /LDL/i.test(String(item?.itemName || '')));
  if (!ldl) return null;
  return `今回の画像では LDL は ${ldl.value}${ldl.unit ? ` ${ldl.unit}` : ''} と読めました。`;
}

function applyMealFollowUpToPending(text, pending) {
  const base = pending || {};
  const meal = base.extracted || base;
  if (!meal?.estimatedNutrition) return base;

  const safeText = normalizeText(text);
  let ratio = 1;
  if (safeText.includes('半分')) ratio = 0.5;
  else if (safeText.includes('少し')) ratio = 0.7;
  else if (safeText.includes('全部')) ratio = 1.0;

  return {
    ...base,
    extracted: {
      ...meal,
      amountNote: safeText,
      estimatedNutrition: {
        kcal: round1((meal.estimatedNutrition.kcal || 0) * ratio),
        protein: round1((meal.estimatedNutrition.protein || 0) * ratio),
        fat: round1((meal.estimatedNutrition.fat || 0) * ratio),
        carbs: round1((meal.estimatedNutrition.carbs || 0) * ratio)
      }
    }
  };
}

async function collectCaptureCandidates(context) {
  const chatCapture = await safeExtractFromConversation(context);
  const captureRoute = await captureRouterService.routeCapture(context);

  const unifiedRecordCandidates = [];
  if (captureRoute?.candidatePayload && captureRoute.captureType !== 'none') {
    unifiedRecordCandidates.push({
      recordType: captureRoute.captureType,
      certainty: captureRoute.confidence || 0.5,
      extracted: captureRoute.candidatePayload
    });
  }

  if (
    context.input?.messageType === 'text' &&
    /食べ|朝ごはん|昼ごはん|夜ごはん|ラーメン|カレー|卵|味噌汁|寿司/.test(normalizeText(context.input.rawText))
  ) {
    const mealParsed = mealAnalysisService.parseMealText(context.input.rawText);
    if (mealParsed.confidence >= 0.4) {
      unifiedRecordCandidates.push({
        recordType: 'meal_record',
        certainty: mealParsed.confidence,
        extracted: mealParsed
      });
    }
  }

  if (context.imageAnalysis?.meal?.isMealImage) {
    unifiedRecordCandidates.push({
      recordType: 'meal_record',
      certainty: context.imageAnalysis.meal.confidence || 0.8,
      extracted: context.imageAnalysis.meal
    });
  }

  if (context.imageAnalysis?.lab?.isLabImage) {
    unifiedRecordCandidates.push({
      recordType: 'lab_record',
      certainty: context.imageAnalysis.lab.confidence || 0.8,
      extracted: context.imageAnalysis.lab
    });
  }

  return {
    chatCapture,
    captureRoute,
    unifiedRecordCandidates
  };
}

function buildHiddenContext(context) {
  const longMemory = context.longMemory || {};
  const lines = [];

  lines.push('[ユーザーの背景情報]');
  if (context.recentSummary) lines.push(`- ${context.recentSummary}`);
  if (Array.isArray(longMemory.eatingPattern) && longMemory.eatingPattern.length) {
    lines.push(`- 食事傾向: ${longMemory.eatingPattern.slice(0, 2).join(' / ')}`);
  }
  if (longMemory.stagnationTendency) lines.push(`- 停滞傾向: ${longMemory.stagnationTendency}`);
  if (Array.isArray(longMemory.supportPreference) && longMemory.supportPreference.length) {
    lines.push(`- 受け取りやすさ: ${longMemory.supportPreference.slice(0, 2).join(' / ')}`);
  }

  lines.push('');
  lines.push('[今回の会話方針]');
  lines.push(`- responseMode: ${context.responseMode}`);
  lines.push('- まず受け止める');
  lines.push('- 提案は多くて1つ');
  lines.push('- 質問で負担を増やしすぎない');
  lines.push('- 管理者のような言い方は禁止');

  return lines.join('\n');
}

function simpleMemoryAnswer(context) {
  const longMemory = context.longMemory || {};
  const pieces = [];

  if (longMemory.preferredName) {
    pieces.push(`今は「${longMemory.preferredName}」って呼び方を覚えています。`);
  }
  if (longMemory.goal) {
    pieces.push(`目標としては「${longMemory.goal}」を覚えています。`);
  }
  if (Array.isArray(longMemory.eatingPattern) && longMemory.eatingPattern.length) {
    pieces.push(`食事では「${longMemory.eatingPattern.slice(0, 2).join('、')}」あたりを覚えています。`);
  }

  if (!pieces.length) {
    return '今はまだ強く残っていることは多くないので、これから少しずつ覚えていきますね。';
  }

  return `はい、いくつか覚えています。\n${pieces.join('\n')}`;
}

function simpleTimeAnswer() {
  const now = new Date();
  return `今は ${now.getHours()}時${String(now.getMinutes()).padStart(2, '0')}分くらいです。`;
}

async function maybePersistRecords(context) {
  const recordPayloads = [];
  const candidates = context.captureAnalysis?.unifiedRecordCandidates || [];

  for (const candidate of candidates) {
    try {
      let confirmed = { shouldPersist: true, needsClarification: false, clarificationQuestion: null };
      if (recordConfirmationService && typeof recordConfirmationService.confirmCandidate === 'function') {
        confirmed = await recordConfirmationService.confirmCandidate(candidate);
      }

      if (!confirmed?.shouldPersist) continue;

      let normalized = candidate.extracted;
      if (recordNormalizerService && typeof recordNormalizerService.normalizeCandidate === 'function') {
        normalized = await recordNormalizerService.normalizeCandidate(candidate);
      }

      recordPayloads.push(normalized);
    } catch (error) {
      console.error('[conversation_orchestrator] maybePersistRecords candidate error:', error?.message || error);
    }
  }

  const persistResult = await recordPersistenceService.persistRecords({
    userId: context.input.userId,
    recordPayloads
  });

  return {
    shouldSaveRecord: Boolean(recordPayloads.length),
    recordPayloads,
    persistResult
  };
}

function inferLastTopic(context) {
  if (context.imageAnalysis?.meal?.isMealImage) return 'meal_image';
  if (context.imageAnalysis?.lab?.isLabImage) return 'lab_image';
  return context.intentType || 'conversation';
}

async function finalizeMemories(context) {
  const shortMemoryUpdates = {
    lastTopic: inferLastTopic(context),
    lastImageType: context.imageAnalysis?.meal?.isMealImage ? 'meal' : context.imageAnalysis?.lab?.isLabImage ? 'lab' : null,
    lastEmotionTone: context.userState?.lastEmotionTone || 'neutral'
  };

  const currentMealCandidate = (context.captureAnalysis?.unifiedRecordCandidates || []).find((c) => c.recordType === 'meal_record');
  const currentLabCandidate = (context.captureAnalysis?.unifiedRecordCandidates || []).find((c) => c.recordType === 'lab_record');

  if (currentMealCandidate) {
    shortMemoryUpdates.pendingRecordCandidate = {
      recordType: 'meal_record',
      extracted: currentMealCandidate.extracted
    };
  } else if (currentLabCandidate) {
    shortMemoryUpdates.pendingRecordCandidate = {
      recordType: 'lab_record',
      extracted: currentLabCandidate.extracted
    };
  }

  if (context.imageAnalysis?.lab?.isLabImage) {
    shortMemoryUpdates.followUpContext = {
      source: 'image',
      imageType: 'lab',
      extractedItems: (context.imageAnalysis.lab.items || []).map((item) => item.itemName)
    };
  }

  await Promise.all([
    contextMemoryService.saveShortMemory(context.input.userId, shortMemoryUpdates),
    contextMemoryService.mergeLongMemory(
      context.input.userId,
      context.captureAnalysis?.chatCapture?.longMemoryCandidates || []
    ),
    contextMemoryService.updateUserState(context.input.userId, context.userState)
  ]);

  return {
    shortMemoryUpdates,
    longMemoryCandidates: context.captureAnalysis?.chatCapture?.longMemoryCandidates || []
  };
}

function buildSuccessResult({ context, replyText, persistResult, memoryResult }) {
  return {
    ok: true,
    replyMessages: [{ type: 'text', text: replyText }],
    internal: {
      intentType: context.intentType,
      responseMode: context.responseMode,
      userState: context.userState,
      shouldSaveRecord: Boolean(persistResult?.shouldSaveRecord),
      recordPayloads: persistResult?.recordPayloads || [],
      shortMemoryUpdates: memoryResult?.shortMemoryUpdates || {},
      longMemoryCandidates: memoryResult?.longMemoryCandidates || [],
      hiddenContext: context.hiddenContext || ''
    }
  };
}

function buildDirectReplyIfPossible(context) {
  const text = normalizeText(context?.input?.rawText || '');
  const pending = context?.shortMemory?.pendingRecordCandidate || null;

  if (context.imageAnalysis?.meal?.isMealImage) {
    return buildMealReply(context.imageAnalysis.meal);
  }

  if (context.imageAnalysis?.lab?.isLabImage) {
    return buildLabReply(context.imageAnalysis.lab);
  }

  if (/^ldlは[？?]?$/i.test(text) || /^LDL[？?]?$/i.test(text)) {
    const ldlReply = buildLdlReply(context);
    if (ldlReply) return ldlReply;
    if (pending?.recordType === 'lab_record') {
      const items = Array.isArray(pending?.extracted?.items) ? pending.extracted.items : [];
      const ldl = items.find((item) => /LDL/i.test(String(item?.itemName || '')));
      if (ldl) {
        return `直前の検査データでは LDL は ${ldl.value}${ldl.unit ? ` ${ldl.unit}` : ''} と見ています。`;
      }
    }
  }

  if (
    context.intentType === INTENT_TYPES.MEAL_RECORD &&
    /食べ|朝ごはん|昼ごはん|夜ごはん|ラーメン|カレー|卵|味噌汁|寿司/.test(text)
  ) {
    const parsed = mealAnalysisService.parseMealText(text);
    if (parsed.confidence >= 0.4) {
      return buildMealReply(parsed);
    }
  }

  if (
    context.routerHints?.looksLikeShortFollowUp &&
    pending?.recordType === 'meal_record' &&
    /半分|少し|全部/.test(text)
  ) {
    const updated = applyMealFollowUpToPending(text, pending);
    context.captureAnalysis = context.captureAnalysis || {};
    context.captureAnalysis.unifiedRecordCandidates = [
      { recordType: 'meal_record', certainty: 0.8, extracted: updated.extracted }
    ];
    return [
      '了解です。量を反映しました。',
      formatNutritionBlock(updated.extracted.estimatedNutrition, text),
      'この内容で今日の記録に続けられます。'
    ].join('\n');
  }

  return null;
}

async function orchestrateConversation(input) {
  try {
    const loaded = await loadConversationContext(input);
    const context = {
      input,
      routerHints: input?.routerHints || {},
      shortMemory: loaded.shortMemory || {},
      longMemory: loaded.longMemory || {},
      userStateBefore: loaded.userState || {},
      recentSummary: loaded.recentSummary || '',
      recentMessages: loaded.recentMessages || []
    };

    context.intentType = inferIntent(context);
    context.userState = inferNextUserState(context);
    context.responseMode = chooseResponseMode(context);

    if (context.intentType === INTENT_TYPES.QUESTION_ABOUT_MEMORY) {
      const replyText = simpleMemoryAnswer(context);
      const memoryResult = await finalizeMemories(context);
      return buildSuccessResult({
        context,
        replyText,
        persistResult: { shouldSaveRecord: false, recordPayloads: [] },
        memoryResult
      });
    }

    if (context.intentType === INTENT_TYPES.TIME_QUESTION) {
      const replyText = simpleTimeAnswer();
      const memoryResult = await finalizeMemories(context);
      return buildSuccessResult({
        context,
        replyText,
        persistResult: { shouldSaveRecord: false, recordPayloads: [] },
        memoryResult
      });
    }

    if (context.intentType === INTENT_TYPES.DAILY_SUMMARY_REQUEST) {
      const replyText = await dailySummaryService.buildDailySummary({
        userId: input.userId,
        userState: context.userState,
        longMemory: context.longMemory,
        recentMessages: context.recentMessages
      });
      const memoryResult = await finalizeMemories(context);
      return buildSuccessResult({
        context,
        replyText,
        persistResult: { shouldSaveRecord: false, recordPayloads: [] },
        memoryResult
      });
    }

    context.imageAnalysis = await analyzeImageIfNeeded(context);
    context.captureAnalysis = await collectCaptureCandidates(context);
    context.hiddenContext = buildHiddenContext(context);

    const directReply = buildDirectReplyIfPossible(context);

    const replyText = directReply || await aiChatService.generateReply({
      userId: input.userId,
      userMessage: input.rawText || (input.messageType === 'image' ? '画像を受け取りました。' : ''),
      recentMessages: context.recentMessages,
      intentType: context.intentType,
      responseMode: context.responseMode,
      hiddenContext: context.hiddenContext
    });

    const persistResult = await maybePersistRecords(context);
    const memoryResult = await finalizeMemories(context);

    return buildSuccessResult({
      context,
      replyText,
      persistResult,
      memoryResult
    });
  } catch (error) {
    console.error('[conversation_orchestrator] fatal error:', error?.message || error);
    return {
      ok: true,
      replyMessages: [
        { type: 'text', text: '今ちょっとうまく受け取れなかったので、もう一度だけ送ってもらえたら大丈夫です。' }
      ],
      internal: {
        intentType: 'fallback',
        responseMode: 'empathy_only'
      }
    };
  }
}

module.exports = {
  orchestrateConversation
};
