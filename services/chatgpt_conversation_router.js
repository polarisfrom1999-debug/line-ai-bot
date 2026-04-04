'use strict';

const conversationOrchestratorService = require('./conversation_orchestrator_service');
const webLinkCommandService = require('./web_link_command_service');

const SUPPORTED_MESSAGE_TYPES = new Set(['text', 'image', 'sticker', 'audio', 'video', 'file', 'location', 'other']);

function normalizeText(value) {
  return String(value || '').trim();
}

function buildTraceId(event, input) {
  const userId = normalizeText(input?.userId || event?.source?.userId || 'unknown');
  const messageId = normalizeText(input?.messageId || event?.message?.id || 'no-message');
  const timestamp = Number(input?.timestamp || event?.timestamp || Date.now());
  return `${userId}:${timestamp}:${messageId}`;
}

function detectMessageType(input) {
  if (input?.messageType) return input.messageType;
  const event = input?.originalEvent || null;
  return event?.message?.type || 'other';
}

function extractRawText(input, messageType) {
  if (typeof input?.rawText === 'string') return normalizeText(input.rawText);
  const event = input?.originalEvent || null;

  if (messageType === 'text') return normalizeText(event?.message?.text || '');
  if (messageType === 'location') {
    const title = normalizeText(event?.message?.title || '');
    const address = normalizeText(event?.message?.address || '');
    return [title, address].filter(Boolean).join(' / ');
  }

  return '';
}

function extractImageMeta(input, messageType) {
  if (input?.imageMeta) return input.imageMeta;
  const event = input?.originalEvent || null;
  if (messageType !== 'image') return null;

  return {
    messageId: event?.message?.id || input?.messageId || null,
    contentProvider: event?.message?.contentProvider || null,
    previewUrl: event?.message?.previewImageUrl || null
  }; 
}

function extractMediaMeta(input, messageType) {
  const event = input?.originalEvent || null;
  const message = event?.message || {};

  return {
    fileName: normalizeText(message.fileName || ''),
    fileSize: Number(message.fileSize || 0),
    duration: Number(message.duration || 0),
    title: normalizeText(message.title || ''),
    address: normalizeText(message.address || ''),
    latitude: message.latitude || null,
    longitude: message.longitude || null,
    messageId: message.id || input?.messageId || null,
    messageType
  };
}

function normalizeConversationInput(input) {
  const event = input?.originalEvent || null;
  const messageType = detectMessageType(input);
  const rawText = extractRawText(input, messageType);

  return {
    userId: input?.userId || event?.source?.userId || null,
    replyToken: input?.replyToken || event?.replyToken || null,
    messageType,
    rawText,
    imageMeta: extractImageMeta(input, messageType),
    mediaMeta: extractMediaMeta(input, messageType),
    messageId: input?.messageId || event?.message?.id || null,
    timestamp: input?.timestamp || event?.timestamp || Date.now(),
    sourceType: input?.sourceType || event?.source?.type || 'unknown',
    sourceChannel: input?.sourceChannel || 'line',
    traceId: buildTraceId(event, input),
    originalEvent: event
  };
}

function buildRouterHints(normalized) {
  const text = normalizeText(normalized?.rawText || '');
  const messageType = normalized?.messageType || 'other';

  return {
    isImageMessage: messageType === 'image',
    isTextMessage: messageType === 'text',
    isLocationMessage: messageType === 'location',
    isMediaMessage: ['image', 'audio', 'video', 'file'].includes(messageType),
    looksLikeTimeQuestion: /今何時|何時|何月何日|今日何日|何時何分|今日の日付/.test(text),
    looksLikeMemoryQuestion: /私の名前|私の体重|私の体脂肪率|何を覚えてる|覚えてる|覚えていますか|私の目標/.test(text),
    looksLikeWeeklyReport: /週間報告|週刊報告|今週のまとめ|1週間まとめ/.test(text),
    looksLikeMonthlyReport: /月間報告|今月のまとめ|1か月まとめ|1ヶ月まとめ/.test(text),
    looksLikeTodayRecords: /今日の食事記録|今日の記録|食事記録教えて|今日の合計|今日どうだった/.test(text),
    looksLikeHelp: /使い方教えて|使い方|何ができる/.test(text),
    looksLikeOnboarding: /無料体験開始|無料体験スタート|体験開始|プロフィール変更|プロフィール入力|プロフィール修正/.test(text),
    looksLikeWebLinkCode: webLinkCommandService.isWebLinkCommand(text),
    looksLikeMealText: /朝ごはん|昼ごはん|夜ごはん|朝食|昼食|夕食|食べた|飲んだ|ラーメン|カレー|寿司|卵|味噌汁|サラダ|ごはん|パン|ヨーグルト|バナナ|プロテイン|おにぎり/.test(text),
    looksLikeExerciseText: /歩いた|ジョギング|ランニング|走った|走りました|スクワット|筋トレ|運動|散歩|ウォーキング|歩数/.test(text),
    looksLikeWeightText: /体重|体脂肪率|kg|キロ|％|パーセント/.test(text),
    looksLikeLabFollowup: /LDL|HDL|中性脂肪|HbA1c|AST|ALT|γ-GTP|LDH|血糖|尿酸/.test(text),
    looksLikeMealFollowup: /半分|少し|全部|完食|残した|汁は飲んでない|ご飯は残した/.test(text),
    looksLikeCheckin: /アンケート|チェックイン|振り返り/.test(text),
    looksLikePainOrDistress: /痛い|激痛|つらい|しんどい|苦しい|不安|落ち込/.test(text),
    looksLikeReconnect: /久しぶり|また来た|戻ってきた/.test(text)
  };
}

function buildUnsupportedResult(messageType) {
  if (messageType === 'sticker') {
    return {
      ok: true,
      replyMessages: [{ type: 'text', text: 'スタンプも受け取っています。ひとこと添えてもらえたら、今の流れに合わせて返しやすいです。' }],
      internal: { intentType: 'unsupported', responseMode: 'empathy_only' }
    };
  }

  if (messageType === 'location') {
    return {
      ok: true,
      replyMessages: [{ type: 'text', text: '位置情報も受け取りました。今は文字や画像の流れが得意なので、必要ならひとこと状況を添えてください。' }],
      internal: { intentType: 'unsupported', responseMode: 'empathy_only' }
    };
  }

  return {
    ok: true,
    replyMessages: [{ type: 'text', text: '今の入力はまだうまく会話につなぎ切れなかったので、文字でもう一度だけ送ってもらえたら大丈夫です。' }],
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

  if (!SUPPORTED_MESSAGE_TYPES.has(normalized.messageType)) {
    return buildUnsupportedResult(normalized.messageType);
  }

  if (normalized.messageType === 'sticker') {
    return buildUnsupportedResult(normalized.messageType);
  }

  const routerHints = buildRouterHints(normalized);
  return conversationOrchestratorService.orchestrateConversation({ ...normalized, routerHints });
}

module.exports = {
  SUPPORTED_MESSAGE_TYPES,
  routeConversation,
  normalizeConversationInput,
  buildRouterHints
};
