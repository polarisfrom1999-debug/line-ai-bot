'use strict';

const conversationOrchestratorService = require('./conversation_orchestrator_service');
const webLinkCommandService = require('./web_link_command_service');
const aiChatService = require('./ai_chat_service');
const contextMemoryService = require('./context_memory_service');

const SUPPORTED_MESSAGE_TYPES = new Set(['text', 'image', 'sticker', 'audio', 'video', 'file', 'location', 'other']);
/**
 * ルータ第2段の generateNaturalResponse をかけない intent。
 * - meal_/lab_ 接頭辞は下でまとめて判定
 * - オーケストレータで withSurfaceReply / polishReplyMessage / polishQuickReplyBundle
 *   済みのものは二重の言い換え・API二重呼び出しを避ける（設計: 自然文は最終一段）
 * - normal は buildNormalReply（generateReply）で既に会話生成済み
 */
const BYPASS_NATURALIZE_INTENTS = new Set([
  // 食事・運動・検査など、構造化された数値/項目表示はそのまま返す
  'meal_image',
  'meal_text',
  'meal_followup',
  'meal_draft_followup',
  'exercise_record',
  'exercise_calorie',
  'weight_record',
  'lab_image',
  'lab_image_pending',
  'lab_followup',
  'lab_date_select',
  'lab_save',
  'today_records',
  'today_meal_totals',
  'today_meal_balance',
  'biweekly_meal_balance',
  'weekly_report',
  'monthly_report',
  'point_summary',
  'admin_check',
  'image_route_clarify',
  // オーケストレータ表面レイヤー済み（meal_/lab_ 以外）
  'onboarding',
  'constitution_survey',
  'constitution_periodic_start',
  'constitution_initial_start',
  'constitution_answer_retry',
  'constitution_question_progress',
  'constitution_result',
  'style_feedback',
  'image_route_selected',
  'image_route_rerun',
  'image_route_lost',
  'pain_thread',
  'care_priority',
  'annyui_support',
  'image_ingest_ng',
  'shoe_motion_image',
  'motion_image',
  'motion_image_fallback',
  'motion_video',
  'motion_video_fallback',
  'video_ingest_ng',
  'time_question',
  'weight_lookup',
  'memory_question',
  'profile_summary',
  'help',
  'profile_update',
  'ai_type_change_prompt',
  'voice_style_change_prompt',
  'ai_type_update',
  'voice_style_update',
  'plan_select',
  'symptom_core',
  'homecare_core',
  'fallback',
  'invalid',
  'unsupported',
  'trial',
  'type',
  'plan',
  'meal_input_help',
  'faq',
  'food',
  'exercise',
  'weight',
  'consult',
  'lab',
  'general_usage_help',
  'weight_input_help',
  'summary_view_help',
  'persona_change_help',
  'symptom_entry_help',
  'homecare_entry_help',
  'sports_entry_help',
  'competition_entry_help'
]);

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
    originalEvent: event,
    webImagePayload: input?.webImagePayload || null
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

async function naturalizeResult(normalized, result) {
  const base = result && typeof result === 'object' ? result : { ok: true, replyMessages: [] };
  const messages = Array.isArray(base.replyMessages) ? base.replyMessages : [];
  const intentType = normalizeText(base?.internal?.intentType || '');
  const responseMode = normalizeText(base?.internal?.responseMode || '');
  const messageType = normalizeText(normalized?.messageType || '');
  const isStructuredHealthIntent =
    intentType.startsWith('meal_') ||
    intentType.startsWith('lab_') ||
    BYPASS_NATURALIZE_INTENTS.has(intentType);
  const isOrchestratorConversationComplete =
    intentType === 'normal' ||
    intentType.startsWith('sports_');
  const isImageRecordLike = messageType === 'image' && (responseMode === 'record' || isStructuredHealthIntent);
  if (isStructuredHealthIntent || isImageRecordLike || isOrchestratorConversationComplete) return base;
  const naturalized = [];

  const longMemory = await contextMemoryService.getLongMemory(normalized?.userId || '');
  const userState = await contextMemoryService.getUserState(normalized?.userId || '');
  const recentMessages = await contextMemoryService.getRecentMessages(normalized?.userId || '', 10);

  for (const message of messages) {
    if (!message || message.type !== 'text' || !normalizeText(message.text)) {
      naturalized.push(message);
      continue;
    }

    const rewritten = await aiChatService.generateNaturalResponse(
      normalized?.rawText || '',
      {
        intentType: base?.internal?.intentType || '',
        responseMode: base?.internal?.responseMode || '',
        messageType: normalized?.messageType || '',
        energyLevel: normalizeText(userState?.lastEmotionTone || '') === 'tired' ? 'low' : 'middle',
        recentMessages,
        longMemory: {
          ...(longMemory || {}),
          relationshipStage: userState?.relationshipStage || 'coach',
          recallStyle: userState?.recallStyle || 'direct'
        }
      },
      {
        draftReply: message.text,
        hasStructuredData: true
      }
    );

    naturalized.push({
      ...message,
      text: normalizeText(rewritten || message.text) || message.text
    });
  }

  return {
    ...base,
    replyMessages: naturalized
  };
}

async function routeConversation(input) {
  const normalized = normalizeConversationInput(input);

  if (!normalized.userId) {
    return naturalizeResult(normalized, {
      ok: true,
      replyMessages: [{ type: 'text', text: '今うまく相手を特定できなかったので、もう一度だけ送ってもらえたら大丈夫です。' }],
      internal: { intentType: 'invalid', responseMode: 'empathy_only' }
    });
  }

  if (!SUPPORTED_MESSAGE_TYPES.has(normalized.messageType)) {
    return naturalizeResult(normalized, buildUnsupportedResult(normalized.messageType));
  }

  if (normalized.messageType === 'sticker') {
    return naturalizeResult(normalized, buildUnsupportedResult(normalized.messageType));
  }

  const routerHints = buildRouterHints(normalized);
  const rawResult = await conversationOrchestratorService.orchestrateConversation({ ...normalized, routerHints });
  return naturalizeResult(normalized, rawResult);
}

module.exports = {
  SUPPORTED_MESSAGE_TYPES,
  routeConversation,
  normalizeConversationInput,
  buildRouterHints
};
