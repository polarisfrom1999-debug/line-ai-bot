services/chatgpt_conversation_router.js
'use strict';

/**
 * services/chatgpt_conversation_router.js
 */

const conversationOrchestratorService = require('./conversation_orchestrator_service');

const SHORT_FOLLOW_UP_PATTERNS = [
  '半分', '半分だけ', '朝のです', '昨日の', 'これ今日', '今日の',
  '朝の', '昼の', '夜の', 'ldlは', 'hdlは', '何kcal', '何キロ', 'グラフ',
  'これです', 'これ昨日', '昨日です'
];

const MEMORY_QUESTION_PATTERNS = [
  '何を覚えてる', '覚えてる', '私の名前', '呼び方', '記憶してる', '何を記憶'
];

const TIME_QUESTION_PATTERNS = [
  '今何時', '何時', '今日は何月何日', '今日何日', '日付', '時間'
];

const DAILY_SUMMARY_PATTERNS = [
  '今日のまとめ', '今日の合計', '今日どうだった', '今日の振り返り', 'まとめて'
];

function normalizeText(value) {
  return String(value || '').trim();
}

function includesAny(text, patterns) {
  const safeText = normalizeText(text).toLowerCase();
  return (patterns || []).some((pattern) => safeText.includes(String(pattern || '').toLowerCase()));
}

function looksLikeShortFollowUp(text) {
  const safeText = normalizeText(text);
  if (!safeText) return false;
  if (safeText.length <= 12 && includesAny(safeText, SHORT_FOLLOW_UP_PATTERNS)) return true;
  if (/^(半分|少し|昨日|今日|朝|昼|夜|LDL|HDL|kcal|グラフ)/i.test(safeText)) return true;
  return false;
}

function detectMessageType(input) {
  if (input && input.messageType) return input.messageType;
  const event = input && input.originalEvent;
  const messageType = event && event.message && event.message.type;
  return messageType || 'text';
}

function extractRawText(input) {
  if (typeof input?.rawText === 'string') return input.rawText;
  const event = input && input.originalEvent;
  return event?.message?.text || '';
}

function extractImageMeta(input) {
  if (input && input.imageMeta) return input.imageMeta;
  const event = input && input.originalEvent;
  if (event?.message?.type !== 'image') return null;
  return {
    messageId: event.message.id || input?.messageId || null,
    contentProvider: event.message.contentProvider || null
  };
}

function normalizeConversationInput(input) {
  const messageType = detectMessageType(input);
  const rawText = normalizeText(extractRawText(input));

  return {
    userId: input?.userId || input?.source?.userId || null,
    replyToken: input?.replyToken || input?.originalEvent?.replyToken || null,
    messageType,
    rawText,
    imageMeta: extractImageMeta(input),
    messageId: input?.messageId || input?.originalEvent?.message?.id || null,
    timestamp: input?.timestamp || input?.originalEvent?.timestamp || Date.now(),
    sourceType: input?.sourceType || input?.originalEvent?.source?.type || 'unknown',
    originalEvent: input?.originalEvent || null
  };
}

function buildRouterHints(normalized) {
  const text = normalized.rawText || '';
  return {
    looksLikeShortFollowUp: looksLikeShortFollowUp(text),
    looksLikeMemoryQuestion: includesAny(text, MEMORY_QUESTION_PATTERNS),
    looksLikeTimeQuestion: includesAny(text, TIME_QUESTION_PATTERNS),
    looksLikeDailySummaryRequest: includesAny(text, DAILY_SUMMARY_PATTERNS)
  };
}

function buildUnsupportedResult(messageType) {
  const text = messageType === 'sticker'
    ? 'スタンプもちゃんと受け取っています。文字でも少し添えてくれたら、今の流れに合わせて返しやすいです。'
    : '今の入力はまだうまく会話につなぎ切れなかったので、文字でもう一度だけ送ってもらえたら大丈夫です。';

  return {
    ok: true,
    replyMessages: [{ type: 'text', text }],
    internal: { intentType: 'unsupported', responseMode: 'empathy_only' }
  };
}

async function routeConversation(input) {
  const normalized = normalizeConversationInput(input);

  if (!normalized.userId) {
    return {
      ok: true,
      replyMessages: [{ type: 'text', text: '今うまく相手を特定できなかったので、もう一度だけ送ってもらえたら大丈夫です。' }],
      internal: { intentType: 'invalid', responseMode: 'empathy_only' }
    };
  }

  if (!['text', 'image', 'sticker', 'other'].includes(normalized.messageType)) {
    return buildUnsupportedResult(normalized.messageType);
  }

  if (normalized.messageType === 'sticker') {
    return buildUnsupportedResult(normalized.messageType);
  }

  const routerHints = buildRouterHints(normalized);

  return conversationOrchestratorService.orchestrateConversation({
    userId: normalized.userId,
    messageType: normalized.messageType,
    rawText: normalized.rawText,
    imageMeta: normalized.imageMeta,
    messageId: normalized.messageId,
    timestamp: normalized.timestamp,
    routerHints,
    originalEvent: normalized.originalEvent
  });
}

module.exports = {
  routeConversation,
  normalizeConversationInput,
  buildRouterHints,
  looksLikeShortFollowUp
};
