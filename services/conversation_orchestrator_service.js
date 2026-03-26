'use strict';

/**
 * services/conversation_orchestrator_service.js
 *
 * 役割:
 * - 毎ターンの会話判断の中枢
 * - 文脈取得 → intent判定 → user state更新 → response mode決定 → 候補抽出 → hidden context生成 → AI返答 → 記憶更新
 *
 * 備考:
 * - 既存 service が未実装でも落ちないように safe fallback を多めに入れている
 * - 実DB保存は既存実装へつなぎやすいよう recordPayloads を返す
 */

const contextMemoryService = require('./context_memory_service');
const aiChatService = require('./ai_chat_service');
const dailySummaryService = require('./daily_summary_service');

let chatCaptureService;
let captureRouterService;
let recordCandidateService;
let recordConfirmationService;
let recordNormalizerService;

try { chatCaptureService = require('./chat_capture_service'); } catch (_) { chatCaptureService = {}; }
try { captureRouterService = require('./capture_router_service'); } catch (_) { captureRouterService = {}; }
try { recordCandidateService = require('./record_candidate_service'); } catch (_) { recordCandidateService = {}; }
try { recordConfirmationService = require('./record_confirmation_service'); } catch (_) { recordConfirmationService = {}; }
try { recordNormalizerService = require('./record_normalizer_service'); } catch (_) { recordNormalizerService = {}; }

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

const HEAVY_WORDS = ['心が苦しい', 'つらい', 'しんどい', '限界', '無理', '消えたい', '骨折', '痛い', '怖い', '不安', '最悪', 'もう嫌'];
const FATIGUE_WORDS = ['疲れた', '眠い', '寝不足', 'だるい', '余裕ない', 'バタバタ', 'しんどい', '動けない'];
const MEMORY_QUESTION_WORDS = ['何を覚えてる', '覚えてる', '私の名前', '呼び方', '記憶'];
const TIME_QUESTION_WORDS = ['今何時', '何時', '今日は何月何日', '今日何日', '日付'];
const DAILY_SUMMARY_WORDS = ['今日のまとめ', '今日の合計', '今日どうだった', 'まとめて', '今日の振り返り'];

function clampScore(value) {
  return Math.max(1, Math.min(10, Number(value) || 5));
}

function nowIso() {
  return new Date().toISOString();
}

function countIncludes(text, words) {
  const safeText = String(text || '');
  return (words || []).reduce((count, word) => count + (safeText.includes(word) ? 1 : 0), 0);
}

function detectEmotionTone(text) {
  const safeText = String(text || '');
  if (/骨折|痛い|痛み|首|腰|膝/.test(safeText)) return 'pained';
  if (/不安|焦|怖|落ち込|最悪/.test(safeText)) return 'anxious';
  if (/つら|苦しい|消えたい|限界/.test(safeText)) return 'sad';
  if (/疲|眠|寝不足|だる|余裕ない/.test(safeText)) return 'tired';
  if (/安心|落ち着|大丈夫|平気/.test(safeText)) return 'calm';
  if (/ありがとう|うれしい|助か/.test(safeText)) return 'warm';
  return 'neutral';
}

async function loadConversationContext(input) {
  const userId = input.userId;
  const [shortMemory, longMemory, userState, recentSummary, recentMessages] = await Promise.all([
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

function buildBaseContext(input, loaded) {
  return {
    input,
    shortMemory: loaded.shortMemory,
    longMemory: loaded.longMemory,
    userStateBefore: loaded.userState,
    recentSummary: loaded.recentSummary,
    recentMessages: loaded.recentMessages,
    intentType: null,
    responseMode: null,
    userState: null,
    captureAnalysis: null,
    hiddenContext: ''
  };
}

function inferIntent(context) {
  const text = String(context.input.rawText || '').trim();
  const shortMemory = context.shortMemory || {};
  const hints = context.input.routerHints || {};

  if (!text && context.input.messageType === 'image') {
    return shortMemory.lastImageType === 'lab' ? INTENT_TYPES.LAB_RECORD : INTENT_TYPES.FOLLOW_UP_IMAGE;
  }
  if (countIncludes(text, HEAVY_WORDS) >= 1) return INTENT_TYPES.EMOTIONAL_SHARE;
  if (hints.looksLikeMemoryQuestion || countIncludes(text, MEMORY_QUESTION_WORDS) >= 1) return INTENT_TYPES.QUESTION_ABOUT_MEMORY;
  if (hints.looksLikeTimeQuestion || countIncludes(text, TIME_QUESTION_WORDS) >= 1) return INTENT_TYPES.TIME_QUESTION;
  if (hints.looksLikeDailySummaryRequest || countIncludes(text, DAILY_SUMMARY_WORDS) >= 1) return INTENT_TYPES.DAILY_SUMMARY_REQUEST;
  if (hints.looksLikeShortFollowUp && shortMemory.lastImageType) return INTENT_TYPES.FOLLOW_UP_IMAGE;
  if (/LDL|HDL|中性脂肪|AST|ALT|血液検査/.test(text)) return INTENT_TYPES.LAB_RECORD;
  if (/kg|体重|体脂肪/.test(text)) return INTENT_TYPES.WEIGHT_RECORD;
  if (/歩い|ジョギング|走|筋トレ|kcal/.test(text)) return INTENT_TYPES.EXERCISE_RECORD;
  if (/朝|昼|夜|ごはん|食べた|食事|鍋|パン|卵|サラダ/.test(text)) return INTENT_TYPES.MEAL_RECORD;
  if (/どうしたら|できない|停滞|むくみ|便通|水分|つい|悩/.test(text)) return INTENT_TYPES.CONSULTATION;
  if (/天気|寒い|暑い|眠い|花粉|テレビ|週末/.test(text)) return INTENT_TYPES.SMALL_TALK;
  return INTENT_TYPES.MIXED;
}

function applyNagiDelta(base, text) {
  let next = Number(base) || 5;
  if (/心が苦しい|消えたい|限界|最悪/.test(text)) next -= 2;
  else if (/つらい|不安|焦る|落ち込/.test(text)) next -= 1;
  else if (/安心|落ち着|少し戻|大丈夫/.test(text)) next += 1;
  return clampScore(next);
}

function applyGasolineDelta(base, text) {
  let next = Number(base) || 5;
  if (/疲れた|寝不足|動けない|余裕ない|バタバタ/.test(text)) next -= 2;
  else if (/眠い|だるい|しんどい/.test(text)) next -= 1;
  else if (/休めた|眠れた|回復|少し楽/.test(text)) next += 1;
  return clampScore(next);
}

function applyTrustDelta(base, text, context) {
  let next = Number(base) || 3;
  if (/覚えてる|私の名前|呼び方|戻ってきた/.test(text)) next += 0.4;
  if (/本音|正直|しんどい|つらい/.test(text)) next += 0.2;
  if ((context.recentMessages || []).length >= 4) next += 0.1;
  return Math.max(1, Math.min(10, Number(next.toFixed(1))));
}

function inferNextUserState(context) {
  const prev = context.userStateBefore || {};
  const text = String(context.input.rawText || '');
  const tone = detectEmotionTone(text);

  return {
    nagiScore: applyNagiDelta(prev.nagiScore, text),
    gasolineScore: applyGasolineDelta(prev.gasolineScore, text),
    trustScore: applyTrustDelta(prev.trustScore, text, context),
    lastEmotionTone: tone,
    updatedAt: nowIso()
  };
}

function hasRecentAdvice(context) {
  return Boolean(context.shortMemory && context.shortMemory.lastAdvice);
}

function shouldUseEmpathyOnlyByMargin(context) {
  const text = String(context.input.rawText || '');
  let score = 0;
  if (hasRecentAdvice(context)) score += 1;
  if (text.length <= 20) score += 1;
  if (context.userState && context.userState.lastEmotionTone === 'tired') score += 1;
  if ((context.recentMessages || []).slice(-4).filter((m) => m.role === 'assistant').length >= 2) score += 1;
  if (Math.random() < 0.12) score += 1;
  return score >= 3;
}

function chooseResponseMode(context) {
  if (context.intentType === INTENT_TYPES.QUESTION_ABOUT_MEMORY || context.intentType === INTENT_TYPES.TIME_QUESTION) {
    return RESPONSE_MODES.MEMORY_ANSWER;
  }
  if (context.intentType === INTENT_TYPES.DAILY_SUMMARY_REQUEST) {
    return RESPONSE_MODES.SUMMARY_MODE;
  }
  if (context.intentType === INTENT_TYPES.EMOTIONAL_SHARE || context.userState.nagiScore <= 3) {
    return RESPONSE_MODES.DEEP_SUPPORT;
  }
  if (context.userState.gasolineScore <= 3 || shouldUseEmpathyOnlyByMargin(context)) {
    return RESPONSE_MODES.EMPATHY_ONLY;
  }
  if (context.intentType === INTENT_TYPES.SMALL_TALK) {
    return RESPONSE_MODES.CASUAL_TALK;
  }
  if ([INTENT_TYPES.MEAL_RECORD, INTENT_TYPES.WEIGHT_RECORD, INTENT_TYPES.EXERCISE_RECORD, INTENT_TYPES.LAB_RECORD].includes(context.intentType)) {
    return RESPONSE_MODES.RECORD_WITH_WARMTH;
  }
  return RESPONSE_MODES.EMPATHY_PLUS_ONE_HINT;
}

async function safeExtractFromConversation(context) {
  if (typeof chatCaptureService.extractFromConversation === 'function') {
    return chatCaptureService.extractFromConversation(context);
  }

  const text = String(context.input.rawText || '');
  const result = {
    recordCandidates: [],
    shortMemoryCandidates: [],
    longMemoryCandidates: [],
    emotionalSignals: [],
    consultationSignals: [],
    supportHints: []
  };

  if (/夜遅/.test(text)) result.longMemoryCandidates.push('夜遅い食事になりやすい');
  if (/むくみ/.test(text)) result.longMemoryCandidates.push('むくみを気にしやすい');
  if (/便通/.test(text)) result.longMemoryCandidates.push('便通で不安になりやすい');
  if (/疲|眠|しんど/.test(text)) result.shortMemoryCandidates.push('今日は疲れが強そう');
  if (/不安|つら|焦/.test(text)) result.emotionalSignals.push('negative_emotion');
  if (/痛|骨折/.test(text)) result.consultationSignals.push('pain_context');
  if (/優しく|きつく言わないで/.test(text)) result.longMemoryCandidates.push('優しく整理されると受け取りやすい');
  return result;
}

async function safeRouteCapture(context) {
  if (typeof captureRouterService.routeCapture === 'function') {
    return captureRouterService.routeCapture(context);
  }

  const text = String(context.input.rawText || '');
  if (/kg|体重/.test(text)) {
    return { captureType: 'weight_record', confidence: 0.9, needsConfirmation: false, candidatePayload: { recordType: 'weight', valueText: text } };
  }
  if (/歩い|ジョギング|筋トレ/.test(text)) {
    return { captureType: 'exercise_record', confidence: 0.8, needsConfirmation: false, candidatePayload: { recordType: 'exercise', valueText: text } };
  }
  if (/食べた|朝|昼|夜|ごはん/.test(text)) {
    return { captureType: 'meal_record', confidence: 0.75, needsConfirmation: /半分|少し|軽め/.test(text), candidatePayload: { recordType: 'meal', valueText: text } };
  }
  if (/LDL|HDL|中性脂肪|血液検査/.test(text)) {
    return { captureType: 'lab_record', confidence: 0.85, needsConfirmation: false, candidatePayload: { recordType: 'lab', valueText: text } };
  }
  return { captureType: 'none', confidence: 0, needsConfirmation: false, candidatePayload: null };
}

async function collectCaptureCandidates(context) {
  const chatCapture = await safeExtractFromConversation(context);
  const captureRoute = await safeRouteCapture(context);

  let unifiedRecordCandidates = [];
  if (typeof recordCandidateService.buildCandidates === 'function') {
    unifiedRecordCandidates = await recordCandidateService.buildCandidates({ context, chatCapture, captureRoute });
  } else if (captureRoute.candidatePayload) {
    unifiedRecordCandidates = [
      Object.assign({
        certainty: captureRoute.confidence >= 0.8 ? 'high' : 'medium',
        needsConfirmation: Boolean(captureRoute.needsConfirmation)
      }, captureRoute.candidatePayload)
    ];
  }

  return {
    chatCapture,
    captureRoute,
    unifiedRecordCandidates
  };
}

function buildHiddenContext(context) {
  const lines = [];
  const longMemory = context.longMemory || {};
  const supportPreference = Array.isArray(longMemory.supportPreference) ? longMemory.supportPreference.slice(0, 2) : [];
  const lifeContext = Array.isArray(longMemory.lifeContext) ? longMemory.lifeContext.slice(0, 2) : [];
  const eatingPattern = Array.isArray(longMemory.eatingPattern) ? longMemory.eatingPattern.slice(0, 2) : [];

  lines.push('[ユーザーの背景情報]');
  if (context.recentSummary) lines.push(`- ${context.recentSummary}`);
  if (eatingPattern.length) lines.push(`- 食事傾向: ${eatingPattern.join(' / ')}`);
  if (supportPreference.length) lines.push(`- 受け取りやすい支え方: ${supportPreference.join(' / ')}`);
  if (lifeContext.length) lines.push(`- 生活背景: ${lifeContext.join(' / ')}`);
  if (context.userState && context.userState.lastEmotionTone) lines.push(`- 直前の感情トーン: ${context.userState.lastEmotionTone}`);

  lines.push('');
  lines.push('[今回の会話方針]');
  lines.push(`- responseMode: ${context.responseMode}`);
  lines.push('- まず受け止めを優先する');
  lines.push('- 提案は多くても1つまで');
  lines.push('- 質問で負担を増やしすぎない');
  lines.push('- 管理者っぽい表現は避ける');

  return lines.join('\n');
}

function simpleNormalizeCandidate(candidate) {
  const base = Object.assign({}, candidate);
  if (!base.eventDate) base.eventDate = new Date().toISOString().slice(0, 10);
  return base;
}

async function maybePersistRecords(context) {
  const candidates = (context.captureAnalysis && context.captureAnalysis.unifiedRecordCandidates) || [];
  const recordPayloads = [];
  let needsClarification = false;
  let clarificationQuestion = null;

  for (const candidate of candidates) {
    let confirmation = { shouldPersist: true, needsClarification: Boolean(candidate.needsConfirmation), clarificationQuestion: null };
    if (typeof recordConfirmationService.confirmCandidate === 'function') {
      confirmation = await recordConfirmationService.confirmCandidate(candidate, context);
    }

    if (confirmation.needsClarification) {
      needsClarification = true;
      clarificationQuestion = confirmation.clarificationQuestion || clarificationQuestion;
      continue;
    }
    if (!confirmation.shouldPersist) continue;

    let normalized = simpleNormalizeCandidate(candidate);
    if (typeof recordNormalizerService.normalizeCandidate === 'function') {
      normalized = await recordNormalizerService.normalizeCandidate(candidate, context);
    }
    recordPayloads.push(normalized);
  }

  return {
    shouldSaveRecord: recordPayloads.length > 0,
    recordPayloads,
    needsClarification,
    clarificationQuestion
  };
}

async function finalizeMemories(context, params) {
  const replyText = String((params && params.replyText) || '');
  const persistResult = (params && params.persistResult) || {};
  const text = String(context.input.rawText || '');

  const shortMemoryUpdates = {
    lastTopic: context.intentType,
    lastImageType: context.input.messageType === 'image' ? (context.shortMemory.lastImageType || 'unknown') : context.shortMemory.lastImageType,
    pendingRecordCandidate: persistResult.needsClarification ? ((context.captureAnalysis && context.captureAnalysis.unifiedRecordCandidates || [])[0] || null) : null,
    pendingClarification: persistResult.needsClarification ? {
      type: 'record_confirmation',
      question: persistResult.clarificationQuestion || 'この内容は今日の実績として見てよさそうですか？'
    } : null,
    lastEmotionTone: context.userState.lastEmotionTone,
    lastAdvice: context.responseMode === RESPONSE_MODES.EMPATHY_PLUS_ONE_HINT ? replyText : null,
    recentSmallTalkTopic: context.intentType === INTENT_TYPES.SMALL_TALK ? text : null,
    followUpContext: context.input.messageType === 'image' ? {
      source: 'image',
      imageType: context.intentType === INTENT_TYPES.LAB_RECORD ? 'lab' : 'meal',
      extractedItems: [],
      unresolvedItems: []
    } : context.shortMemory.followUpContext
  };

  const longMemoryCandidates = ((context.captureAnalysis && context.captureAnalysis.chatCapture && context.captureAnalysis.chatCapture.longMemoryCandidates) || []).slice(0, 5);

  await contextMemoryService.saveShortMemory(context.input.userId, shortMemoryUpdates);
  await contextMemoryService.mergeLongMemory(context.input.userId, longMemoryCandidates);
  await contextMemoryService.updateUserState(context.input.userId, context.userState);
  await contextMemoryService.appendRecentMessages(context.input.userId, [
    { role: 'user', content: text },
    { role: 'assistant', content: replyText }
  ]);

  return {
    shortMemoryUpdates,
    longMemoryCandidates
  };
}

function answerSpecialQuestion(context) {
  const text = String(context.input.rawText || '');
  if (context.intentType === INTENT_TYPES.TIME_QUESTION) {
    const now = new Date();
    return `今は ${now.getHours()}時${String(now.getMinutes()).padStart(2, '0')}分 くらいです。`;
  }
  if (context.intentType === INTENT_TYPES.QUESTION_ABOUT_MEMORY) {
    const longMemory = context.longMemory || {};
    const pieces = [];
    if (longMemory.preferredName) pieces.push(`呼び方は「${longMemory.preferredName}」`);
    if (Array.isArray(longMemory.eatingPattern) && longMemory.eatingPattern.length) pieces.push(`食事傾向は ${longMemory.eatingPattern.slice(0, 2).join('、')}`);
    if (Array.isArray(longMemory.bodySignals) && longMemory.bodySignals.length) pieces.push(`体調面では ${longMemory.bodySignals.slice(0, 2).join('、')}`);
    if (!pieces.length) {
      return '今は、呼び方や最近の会話の流れ、食事や体調の傾向を少しずつつないで見ています。';
    }
    return `今覚えているのは、${pieces.join('、')}あたりです。`;
  }
  if (/AI|あなたは誰|牛込/.test(text)) {
    return '私は院長・AI牛込として、記録だけでなく日々の流れごと一緒に見ていく伴走役です。';
  }
  return null;
}

function buildSuccessResult({ context, replyText, persistResult, memoryResult }) {
  return {
    ok: true,
    replyMessages: [{ type: 'text', text: replyText }],
    internal: {
      intentType: context.intentType,
      responseMode: context.responseMode,
      userState: context.userState,
      shouldSaveRecord: Boolean(persistResult.shouldSaveRecord),
      recordPayloads: persistResult.recordPayloads || [],
      shortMemoryUpdates: memoryResult.shortMemoryUpdates || {},
      longMemoryCandidates: memoryResult.longMemoryCandidates || [],
      hiddenContext: context.hiddenContext || ''
    }
  };
}

async function orchestrateConversation(input) {
  const loaded = await loadConversationContext(input);
  const context = buildBaseContext(input, loaded);

  context.intentType = inferIntent(context);
  context.userState = inferNextUserState(context);
  context.responseMode = chooseResponseMode(context);
  context.captureAnalysis = await collectCaptureCandidates(context);

  if (context.intentType === INTENT_TYPES.DAILY_SUMMARY_REQUEST) {
    const summaryText = await dailySummaryService.buildDailySummary({
      userId: input.userId,
      userState: context.userState,
      longMemory: context.longMemory,
      recentMessages: context.recentMessages
    });
    const memoryResult = await finalizeMemories(context, { replyText: summaryText });
    return buildSuccessResult({
      context,
      replyText: summaryText,
      persistResult: { shouldSaveRecord: false, recordPayloads: [] },
      memoryResult
    });
  }

  if ([INTENT_TYPES.QUESTION_ABOUT_MEMORY, INTENT_TYPES.TIME_QUESTION, INTENT_TYPES.META_AI_QUESTION].includes(context.intentType)) {
    const specialReply = answerSpecialQuestion(context) || '……うん、そこは自然に返せるようにしてあります。';
    context.hiddenContext = buildHiddenContext(context);
    const memoryResult = await finalizeMemories(context, { replyText: specialReply });
    return buildSuccessResult({
      context,
      replyText: specialReply,
      persistResult: { shouldSaveRecord: false, recordPayloads: [] },
      memoryResult
    });
  }

  context.hiddenContext = buildHiddenContext(context);
  const replyText = await aiChatService.generateReply({
    userId: input.userId,
    userMessage: input.rawText,
    recentMessages: context.recentMessages,
    intentType: context.intentType,
    responseMode: context.responseMode,
    hiddenContext: context.hiddenContext
  });

  const persistResult = await maybePersistRecords(context);
  const memoryResult = await finalizeMemories(context, { replyText, persistResult });

  return buildSuccessResult({ context, replyText, persistResult, memoryResult });
}

module.exports = {
  orchestrateConversation,
  INTENT_TYPES,
  RESPONSE_MODES,
  loadConversationContext,
  inferIntent,
  inferNextUserState,
  chooseResponseMode,
  collectCaptureCandidates,
  buildHiddenContext,
  maybePersistRecords,
  finalizeMemories
};
