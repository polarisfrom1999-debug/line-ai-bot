services/chatgpt_conversation_router.js
'use strict';

const conversationOrchestratorService = require('./conversation_orchestrator_service');

function normalizeText(value) {
  return String(value || '').trim();
}

function detectMessageType(input) {
  if (input?.messageType) return input.messageType;

  const event = input?.originalEvent || null;
  return event?.message?.type || 'text';
}

function extractRawText(input, messageType) {
  if (typeof input?.rawText === 'string') {
    return normalizeText(input.rawText);
  }

  const event = input?.originalEvent || null;
  if (messageType === 'text') {
    return normalizeText(event?.message?.text || '');
  }

  return '';
}

function extractImageMeta(input, messageType) {
  if (input?.imageMeta) return input.imageMeta;

  const event = input?.originalEvent || null;
  if (messageType !== 'image') return null;

  return {
    messageId: event?.message?.id || input?.messageId || null,
    contentProvider: event?.message?.contentProvider || null
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
    messageId: input?.messageId || event?.message?.id || null,
    timestamp: input?.timestamp || event?.timestamp || Date.now(),
    sourceType: input?.sourceType || event?.source?.type || 'unknown',
    originalEvent: event
  };
}

function buildRouterHints(normalized) {
  const text = normalizeText(normalized?.rawText || '');

  return {
    isImageMessage: normalized?.messageType === 'image',
    isTextMessage: normalized?.messageType === 'text',
    looksLikeTimeQuestion: /今何時|何時|何月何日|今日何日|何時何分/.test(text),
    looksLikeMemoryQuestion: /私の名前|私の体重|私の体脂肪率|何を覚えてる|覚えてる|覚えていますか/.test(text),
    looksLikeWeeklyReport: /週間報告|週刊報告|今週のまとめ/.test(text),
    looksLikeTodayRecords: /今日の食事記録|今日の記録|食事記録教えて/.test(text),
    looksLikeHelp: /使い方教えて|使い方/.test(text),
    looksLikeOnboarding: /無料体験開始|無料体験スタート|体験開始|プロフィール変更|プロフィール入力|プロフィール修正/.test(text),
    looksLikeMealText: /朝ごはん|昼ごはん|夜ごはん|朝食|昼食|夕食|食べた|飲んだ|ラーメン|カレー|寿司|卵|味噌汁|サラダ|ごはん|パン|ヨーグルト|バナナ/.test(text),
    looksLikeExerciseText: /歩いた|ジョギング|ランニング|走った|走りました|スクワット|筋トレ|運動/.test(text),
    looksLikeWeightText: /体重|体脂肪率|kg|キロ/.test(text),
    looksLikeLabFollowup: /LDL|HDL|中性脂肪|HbA1c|AST|ALT|γ-GTP|LDH/.test(text),
    looksLikeMealFollowup: /半分|少し|全部|完食/.test(text)
  };
}

function buildUnsupportedResult(messageType) {
  if (messageType === 'sticker') {
    return {
      ok: true,
      replyMessages: [
        {
          type: 'text',
          text: 'スタンプもちゃんと受け取っています。文字でも少し添えてくれたら、今の流れに合わせて返しやすいです。'
        }
      ],
      internal: {
        intentType: 'unsupported',
        responseMode: 'empathy_only'
      }
    };
  }

  return {
    ok: true,
    replyMessages: [
      {
        type: 'text',
        text: '今の入力はまだうまく会話につなぎ切れなかったので、文字でもう一度だけ送ってもらえたら大丈夫です。'
      }
    ],
    internal: {
      intentType: 'unsupported',
      responseMode: 'empathy_only'
    }
  };
}

async function routeConversation(input) {
  const normalized = normalizeConversationInput(input);

  if (!normalized.userId) {
    return {
      ok: true,
      replyMessages: [
        {
          type: 'text',
          text: '今うまく相手を特定できなかったので、もう一度だけ送ってもらえたら大丈夫です。'
        }
      ],
      internal: {
        intentType: 'invalid',
        responseMode: 'empathy_only'
      }
    };
  }

  if (!['text', 'image', 'sticker', 'audio', 'video', 'file', 'location', 'other'].includes(normalized.messageType)) {
    return buildUnsupportedResult(normalized.messageType);
  }

  if (normalized.messageType === 'sticker') {
    return buildUnsupportedResult(normalized.messageType);
  }

  const routerHints = buildRouterHints(normalized);

  return conversationOrchestratorService.orchestrateConversation({
    ...normalized,
    routerHints
  });
}

module.exports = {
  routeConversation,
  normalizeConversationInput,
  buildRouterHints
};
