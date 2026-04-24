'use strict';

require('dotenv').config();

const path = require('path');
const express = require('express');
const bodyParser = require('body-parser');

let line = null;
try {
  line = require('@line/bot-sdk');
} catch (_) {
  line = null;
}

const app = express();
app.use(bodyParser.json({ limit: '10mb' }));
app.use(bodyParser.urlencoded({ extended: true, limit: '10mb' }));

const conversationRouter = require('./services/chatgpt_conversation_router');
const chatLogService = require('./services/chat_log_service');
const conversationSummaryService = require('./services/conversation_summary_service');
const webPortalAuthService = require('./services/web_portal_auth_service');
const webPortalDataService = require('./services/web_portal_data_service');
const webPortalRealtimeService = require('./services/web_portal_realtime_service');
const chatCaptureService = require('./services/chat_capture_service');
const contextMemoryService = require('./context_memory_service');
const { supabase } = require('./services/supabase_service');
const { ensureUser } = require('./services/user_service');
const webLinkCommandService = require('./services/web_link_command_service');
const inputGatewayService = require('./services/input_gateway_service');
const webRouter = require('./routes/web');
const featureFlags = require('./config/feature_flags');
const assistantRepeatGuard = require('./services/assistant_repeat_guard');
const sessionStateRepository = require('./repositories/session_state_repository');
const responseGuardService = require('./services/newflow/response_guard_service');

function buildNewFlowRuntimeStatus() {
  const arch = runtimeFlag('ENABLE_NEW_FLOW_ARCH', featureFlags.ENABLE_NEW_FLOW_ARCH);
  const imageIngest = runtimeFlag('ENABLE_NEW_FLOW_IMAGE_INGEST', featureFlags.ENABLE_NEW_FLOW_IMAGE_INGEST) || arch;
  const imageFollowup = runtimeFlag('ENABLE_NEW_FLOW_IMAGE_FOLLOWUP', featureFlags.ENABLE_NEW_FLOW_IMAGE_FOLLOWUP) || arch;
  const generalFollowup = runtimeFlag('ENABLE_NEW_FLOW_GENERAL_FOLLOWUP', featureFlags.ENABLE_NEW_FLOW_GENERAL_FOLLOWUP);
  const responseGuard = runtimeFlag('ENABLE_NEW_FLOW_RESPONSE_GUARD', featureFlags.ENABLE_NEW_FLOW_RESPONSE_GUARD);
  return {
    arch,
    imageIngest,
    imageFollowup,
    generalFollowup,
    responseGuard,
    renderService: String(process.env.RENDER_SERVICE_NAME || ''),
    renderInstance: String(process.env.RENDER_INSTANCE_ID || ''),
    renderGitCommit: String(process.env.RENDER_GIT_COMMIT || process.env.RENDER_GIT_SHA || ''),
    nodeEnv: String(process.env.NODE_ENV || ''),
    bootAt: new Date().toISOString(),
  };
}

function buildLineClient() {
  const token = process.env.LINE_CHANNEL_ACCESS_TOKEN;
  if (!line || !token) return null;

  try {
    return new line.messagingApi.MessagingApiClient({ channelAccessToken: token });
  } catch (error) {
    console.error('[index] buildLineClient error:', error?.message || error);
    return null;
  }
}

async function syncLineDisplayName(lineClient, lineUserId) {
  const uid = String(lineUserId || '').trim();
  if (!uid || !lineClient) return;
  try {
    const getProfileFn = typeof lineClient.getProfile === 'function'
      ? lineClient.getProfile.bind(lineClient)
      : null;
    if (!getProfileFn) return;
    const profile = await getProfileFn(uid);
    const displayName = String(profile?.displayName || '').trim();
    if (!displayName) return;
    const webAdminRepository = require('./repositories/web_admin_repository');
    await webAdminRepository.syncLineDisplayName(uid, displayName);
  } catch (_e) {
    // LINE profile取得失敗時は会話処理を止めない
  }
}

function sanitizeMessageText(text) {
  const safe = String(text || '');
  return safe.length <= 4900 ? safe : `${safe.slice(0, 4890)}…`;
}

function runtimeFlag(name, fallbackValue) {
  const raw = process.env[name];
  if (raw == null || raw === '') return Boolean(fallbackValue);
  return ['1', 'true', 'yes', 'on'].includes(String(raw).trim().toLowerCase());
}

function normalizeReplyMessages(messages) {
  if (!Array.isArray(messages)) return [];
  return messages
    .filter(Boolean)
    .map((message) => {
      if (message.type === 'text') {
        const safeText = runtimeFlag('ENABLE_NEW_FLOW_RESPONSE_GUARD', featureFlags.ENABLE_NEW_FLOW_RESPONSE_GUARD)
          ? responseGuardService.guardReplyText(sanitizeMessageText(message.text || '')).text
          : sanitizeMessageText(message.text);
        return { ...message, text: safeText };
      }
      return message;
    })
    .slice(0, 5);
}

function getTokyoHour() {
  const parts = new Intl.DateTimeFormat('ja-JP', {
    timeZone: 'Asia/Tokyo',
    hour: 'numeric',
    hour12: false
  }).formatToParts(new Date());
  const hourPart = parts.find((part) => part.type === 'hour');
  return Number(hourPart?.value || 12);
}

function inferTimeBand(hour) {
  if (hour >= 5 && hour <= 10) return 'morning';
  if (hour >= 18 || hour <= 2) return 'night';
  return 'day';
}

function isMealVisualReply(text) {
  return /📸 お食事の解析が終わりました/.test(String(text || ''));
}

function inferEnergyLevel(inputText, shortMemory) {
  const safeText = String(inputText || '').trim();
  const tone = String(shortMemory?.lastEmotionTone || '').trim();
  if (/眠い|寝不足|疲れ|しんどい|だるい|限界|もう無理|やる気が出ない|頑張れない/.test(safeText)) return 'low';
  if (tone === 'tired' || tone === 'heavy_negative' || tone === 'anxious') return 'low';
  if (/元気|いけそう|調子いい/.test(safeText)) return 'high';
  return 'middle';
}

function trimForLowEnergy(text) {
  const lines = String(text || '').split('\n').map((line) => line.trim()).filter(Boolean);
  if (lines.length <= 4) return String(text || '');
  return `${lines.slice(0, 3).join('\n')}\n今日はここだけ見れば十分です。`;
}

function applyIntensityPolicy(text, ctx) {
  const level = String(featureFlags.PERSONA_ADJUSTMENT_LEVEL || 'medium');
  if (level === 'low') return String(text || '');

  if (level === 'high') {
    if (ctx.energyLevel === 'low') return trimForLowEnergy(trimForLowEnergy(text));
    return String(text || '');
  }

  if (ctx.energyLevel === 'low') return trimForLowEnergy(text);
  return String(text || '');
}

function applyPersonaToneToText(text, ctx) {
  const original = String(text || '');
  if (!original.trim()) return original;
  if (isMealVisualReply(original)) return original;

  const recentBodies = ctx.recentAssistantBodies || [];
  if (ctx.skipPersonaExtras) {
    let slim = applyIntensityPolicy(original, ctx);
    slim = assistantRepeatGuard.scrubReplyAgainstRecent(slim, recentBodies);
    return assistantRepeatGuard.stripBannedLines(slim);
  }

  const lines = [];
  const timeBandOpenersOn = process.env.KOKOKARA_TIME_BAND_OPENERS === '1';
  const morningLine = 'おはようございます。今日のペースで大丈夫です。';
  const nightLine = '夜は無理に詰め込まず、整える視点でいきましょう。';
  if (
    timeBandOpenersOn &&
    ctx.timeBand === 'morning' &&
    /empathy|guided/.test(ctx.responseMode) &&
    !assistantRepeatGuard.phraseRecentlyUsed(morningLine, recentBodies, 12)
  ) {
    lines.push(morningLine);
  } else if (
    timeBandOpenersOn &&
    ctx.timeBand === 'night' &&
    /empathy|answer|guided/.test(ctx.responseMode) &&
    !assistantRepeatGuard.phraseRecentlyUsed(nightLine, recentBodies, 12)
  ) {
    lines.push(nightLine);
  }

  const level = String(featureFlags.PERSONA_ADJUSTMENT_LEVEL || 'medium');
  let body = applyIntensityPolicy(original, ctx);
  body = assistantRepeatGuard.scrubReplyAgainstRecent(body, recentBodies);
  if (
    ctx.aiType === '明るく後押し' &&
    !/！/.test(body) &&
    ctx.energyLevel !== 'low' &&
    !assistantRepeatGuard.phraseRecentlyUsed('一緒に、できる一歩から進めていきましょう。', recentBodies, 3)
  ) {
    body = `${body}\n一緒に、できる一歩から進めていきましょう。`;
  }
  if (
    ctx.aiType === '頼もしく導く' &&
    !/優先|まず/.test(body) &&
    !assistantRepeatGuard.phraseRecentlyUsed('まずは1つに絞って進めれば大丈夫です。', recentBodies, 3)
  ) {
    body = `${body}\nまずは1つに絞って進めれば大丈夫です。`;
  }
  if (
    ctx.voiceStyle === 'いつも明るく' &&
    ctx.energyLevel !== 'low' &&
    !/いきましょう。$/.test(body) &&
    !assistantRepeatGuard.phraseRecentlyUsed('焦らず、前向きにいきましょう。', recentBodies, 3)
  ) {
    body = `${body}\n焦らず、前向きにいきましょう。`;
  }
  if (ctx.voiceStyle === '普段優しく、ときどき厳しく' && ctx.overworkAlert && !/休む|減速/.test(body)) {
    body = `${body}\n今日は攻めるより、減速して整える判断で大丈夫です。`;
  }
  if (ctx.voiceStyle === 'いつも優しく') {
    body = body.replace(/！/g, '。');
  }
  lines.push(body);

  if (
    ctx.overworkAlert &&
    level !== 'low' &&
    !assistantRepeatGuard.phraseRecentlyUsed('頑張りが続いていそうなので', recentBodies, 3)
  ) {
    lines.push('頑張りが続いていそうなので、今日は1つできたら十分です。');
  }
  if (
    ctx.painContext &&
    level !== 'low' &&
    !/無理しない|痛みが強い|受診|安全|休/.test(body) &&
    !assistantRepeatGuard.phraseRecentlyUsed('痛みがある日は安全優先', recentBodies, 3)
  ) {
    lines.push('痛みがある日は安全優先で、悪化しそうなら無理せず休みましょう。');
  }
  return assistantRepeatGuard.stripBannedLines(lines.filter(Boolean).join('\n'));
}

async function applyGlobalPersonaAdjustments(input, result) {
  if (!result?.ok || !Array.isArray(result.replyMessages) || !result.replyMessages.length) return result;
  const userId = input?.userId || input?.lineUserId;
  let shortMemory = null;
  let longMemory = null;
  let recentAssistantBodies = [];
  try {
    shortMemory = userId ? await contextMemoryService.getShortMemory(userId) : null;
    longMemory = userId ? await contextMemoryService.getLongMemory(userId) : null;
    const recent = userId ? await contextMemoryService.getRecentMessages(userId, 12) : [];
    recentAssistantBodies = assistantRepeatGuard.recentAssistantBodies(recent, 5);
  } catch (_) {
    shortMemory = null;
    longMemory = null;
  }

  const inputText = String(input?.rawText || '').trim();
  const responseMode = String(result?.internal?.responseMode || 'answer');
  const intentType = String(result?.internal?.intentType || '');
  const hour = getTokyoHour();
  const skipPersonaExtras = [
    'time_question',
    'weight_lookup',
    'memory_question',
    'profile_summary',
    'lab_followup',
    'lab_save',
    'lab_date_select',
    'lab_image',
    'lab_image_pending',
    'lab_image_retry',
    'meal_image',
    'meal_image_retry',
    'meal_text',
    'meal_followup',
    'meal_log_correction',
    'meal_draft_followup',
    'meal_announcement',
    'meal_input_help',
    'image_route_clarify',
    'image_route_selected',
    'image_route_rerun',
    'image_route_lost',
    'lab_image_route_hint',
    'meal_image_route_hint',
    'motion_image_fallback',
    'shoe_motion_image',
    'motion_video',
    'motion_video_fallback',
    'conversation_repair',
    'video_ingest_ng',
    'image_ingest_ng',
    'pain_thread',
    'care_priority',
    'exercise_record',
    'point_summary',
    'today_records',
    'today_meal_totals',
    'meal_scope_query',
    'admin_check',
  ].includes(intentType);

  const ctx = {
    timeBand: inferTimeBand(hour),
    responseMode,
    energyLevel: inferEnergyLevel(inputText, shortMemory),
    overworkAlert: /頑張りすぎ|無理しがち|詰め込み|休めてない|消耗/.test(inputText),
    painContext: /痛い|しびれ|違和感|骨折|腰|膝|首|むくみ|便通ない/.test(inputText),
    aiType: String(longMemory?.aiType || '').trim(),
    voiceStyle: String(longMemory?.voiceStyle || '').trim(),
    supportPreference: Array.isArray(longMemory?.supportPreference) ? longMemory.supportPreference : [],
    recentAssistantBodies,
    skipPersonaExtras,
  };

  if (ctx.energyLevel !== 'low' && ctx.supportPreference.includes('短く返す')) {
    ctx.energyLevel = 'low';
  }

  const replyMessages = result.replyMessages.map((message) => {
    if (!message || message.type !== 'text') return message;
    return { ...message, text: applyPersonaToneToText(message.text, ctx) };
  });

  return { ...result, replyMessages };
}

async function replyLineMessages(replyToken, messages) {
  const client = buildLineClient();
  const normalizedMessages = normalizeReplyMessages(messages);

  if (!client || !replyToken || !normalizedMessages.length) {
    console.log('[reply fallback]', { replyToken, messages: normalizedMessages });
    return;
  }

  try {
    await client.replyMessage({ replyToken, messages: normalizedMessages });
  } catch (error) {
    console.error('[index] replyLineMessages error:', error?.message || error);
    console.log('[reply fallback]', { replyToken, messages: normalizedMessages });
  }
}

function normalizeEventInput(event) {
  const messageType = event?.message?.type || 'other';
  const rawText = messageType === 'text' ? String(event?.message?.text || '') : '';
  return {
    userId: event?.source?.userId || null,
    lineUserId: event?.source?.userId || null,
    replyToken: event?.replyToken || null,
    messageType,
    rawText,
    messageId: event?.message?.id || null,
    relatedEventId: event?.message?.id || null,
    traceId: chatLogService.buildTraceId(),
    timestamp: event?.timestamp || Date.now(),
    sourceType: event?.source?.type || 'unknown',
    sourceChannel: 'line',
    originalEvent: event
  };
}


function inferWebSyncContext(input = {}, result = {}) {
  const intent = String(result?.internal?.intentType || '').trim();
  const text = String(input?.rawText || '').trim();
  const type = String(input?.messageType || '').trim();

  if (intent === 'web_link_code') return { reason: 'line_link', scopes: { chat: false, records: false, home: false } };
  if (intent === 'meal_image' || intent === 'meal_followup' || intent === 'meal_text') return { reason: 'line_meal', scopes: { chat: true, records: true, home: true } };
  if (intent === 'lab_image' || intent === 'lab_followup') return { reason: 'line_lab', scopes: { chat: true, records: true, home: true } };
  if (intent === 'weight_lookup' || /(体重|kg|キロ|体脂肪|%)/.test(text)) return { reason: 'line_weight', scopes: { chat: true, records: true, home: true } };
  if (/(運動|散歩|歩数|ウォーキング|筋トレ|activity)/i.test(text)) return { reason: 'line_activity', scopes: { chat: true, records: true, home: true } };
  if (type === 'image') return { reason: 'line_image', scopes: { chat: true, records: true, home: true } };
  return { reason: 'line_chat', scopes: { chat: true, records: false, home: true } };
}

function refreshWebPortalCachesForLineUser(lineUserId, options = {}) {
  const safeLineUserId = String(lineUserId || '').trim();
  if (!safeLineUserId) return;
  Promise.resolve()
    .then(async () => {
      const user = await ensureUser(supabase, safeLineUserId, 'Asia/Tokyo');
      if (user?.id) {
        const reason = String(options.reason || 'line_update').trim() || 'line_update';
        const scopes = options.scopes && typeof options.scopes === 'object' ? options.scopes : { chat: true, records: true, home: true };
        webPortalDataService.invalidateUserCache(user.id, { reason, scopes });
        const sync = await webPortalDataService.getSyncStatus(user);
        webPortalRealtimeService.notifyUser(user.id, { userId: user.id, sync, reason, scopes });
      }
    })
    .catch((error) => console.error('[index] refreshWebPortalCachesForLineUser error:', error?.message || error));
}

async function persistConversationCapture(input, result) {
  try {
    const userId = input?.userId || input?.lineUserId;
    if (!userId) return;
    const captured = await chatCaptureService.extractFromConversation({ input, result });
    if (!captured) return;

    const shortPatch = {};
    const longPatch = {};

    if (Array.isArray(captured.shortMemoryCandidates) && captured.shortMemoryCandidates.length) {
      shortPatch.recentSmallTalkTopic = captured.shortMemoryCandidates[captured.shortMemoryCandidates.length - 1];
    }
    if (Array.isArray(captured.emotionalSignals) && captured.emotionalSignals.length) {
      shortPatch.lastEmotionTone = captured.emotionalSignals.includes('heavy_negative')
        ? 'heavy_negative'
        : captured.emotionalSignals.includes('anxious')
          ? 'anxious'
          : captured.emotionalSignals.includes('fatigued')
            ? 'tired'
            : 'neutral';
    }
    if (Array.isArray(captured.consultationSignals) && captured.consultationSignals.includes('pain_context')) {
      shortPatch.activeHealthTheme = '痛み対応';
      longPatch.bodySignals = ['痛みがある'];
    }
    if (Array.isArray(captured.consultationSignals) && captured.consultationSignals.includes('overwork_risk')) {
      longPatch.lifeContext = [...(longPatch.lifeContext || []), '頑張りすぎやすい'];
    }
    if (Array.isArray(captured.supportHints) && captured.supportHints.length) {
      longPatch.supportPreference = captured.supportHints;
    }
    if (Array.isArray(captured.longMemoryCandidates) && captured.longMemoryCandidates.length) {
      longPatch.lifeContext = [...(longPatch.lifeContext || []), ...captured.longMemoryCandidates];
    }

    if (Object.keys(shortPatch).length) {
      await contextMemoryService.saveShortMemory(userId, shortPatch);
    }
    if (Object.keys(longPatch).length) {
      await contextMemoryService.mergeLongMemory(userId, longPatch);
    }
  } catch (error) {
    console.error('[index] persistConversationCapture error:', error?.message || error);
  }
}

async function handleWebCodeCommand(input) {
  try {
    const issued = await webLinkCommandService.buildWebLinkReplyByLineUser(input.lineUserId || input.userId);
    return {
      ok: true,
      replyMessages: [{ type: 'text', text: issued.replyText }],
      internal: issued.internal
    };
  } catch (error) {
    console.error('[index] handleWebCodeCommand error:', error?.message || error);
    const webUrl = typeof webLinkCommandService.getWebPortalUrl === 'function'
      ? webLinkCommandService.getWebPortalUrl()
      : '/web';
    return {
      ok: true,
      replyMessages: [{
        type: 'text',
        text: [
          'WEB接続コードの発行で準備エラーが起きました。',
          'まず /web の画面は開けています。',
          `WEB: ${webUrl}`,
          'このまま運営側で接続コード発行ルートを確認します。少し時間をあけて、もう一度「WEB接続コード」と送ってください。'
        ].join('\n')
      }],
      internal: {
        intentType: 'web_link_code_error',
        responseMode: 'support',
        errorMessage: String(error?.message || error || '')
      }
    };
  }
}

async function handleEvent(event) {
  const fallbackText = '今ちょっとうまく受け取れなかったので、もう一度だけ送ってもらえたら大丈夫です。';

  try {
    if (!event || event.type !== 'message') return;

    const input = normalizeEventInput(event);
    const flow = buildNewFlowRuntimeStatus();
    console.log('[NEW_FLOW_ACTIVE] webhook_event', {
      traceId: input.traceId,
      userId: input.userId || '',
      messageType: input.messageType,
      ...flow
    });
    const gatewayResult = await inputGatewayService.handleLineTopLevel(input);
    const rawResult = gatewayResult?.handled
      ? { ok: true, replyMessages: gatewayResult.replyMessages, internal: gatewayResult.internal || {} }
      : await conversationRouter.routeConversation({ ...input, entryLane: gatewayResult?.lane || '' });
    const result = await applyGlobalPersonaAdjustments(input, rawResult);

    if (result?.ok && result?.internal?.suppressReply) {
      await chatLogService.logConversationOutcome({ input, result });
      await conversationSummaryService.recordTurn({ input, result });
      await persistConversationCapture(input, result);
      refreshWebPortalCachesForLineUser(input.lineUserId || input.userId, inferWebSyncContext(input, result));
      return;
    }

    if (result?.ok && Array.isArray(result.replyMessages) && result.replyMessages.length) {
      await replyLineMessages(input.replyToken, result.replyMessages);
      await chatLogService.logConversationOutcome({ input, result });
      await conversationSummaryService.recordTurn({ input, result });
      await persistConversationCapture(input, result);
      refreshWebPortalCachesForLineUser(input.lineUserId || input.userId, inferWebSyncContext(input, result));
      return;
    }

    const fallbackResult = {
      ok: true,
      replyMessages: [{ type: 'text', text: '受け取りました。少し言い換えて送ってもらえたら、今の流れに合わせて返せます。' }],
      internal: { intentType: 'fallback', responseMode: 'empathy_only' }
    };
    await replyLineMessages(input.replyToken, fallbackResult.replyMessages);
    await chatLogService.logConversationOutcome({ input, result: fallbackResult });
    await conversationSummaryService.recordTurn({ input, result: fallbackResult });
    await persistConversationCapture(input, fallbackResult);
    refreshWebPortalCachesForLineUser(input.lineUserId || input.userId, inferWebSyncContext(input, fallbackResult));
  } catch (error) {
    console.error('[index] handleEvent error:', error?.message || error);
    const input = normalizeEventInput(event || {});
    await replyLineMessages(event?.replyToken, [{ type: 'text', text: fallbackText }]);
    await chatLogService.logFailedTurn({ input, error, fallbackReplyText: fallbackText });
  }
}

app.get('/', (_req, res) => {
  res.status(200).send('ok');
});

app.get('/health', (_req, res) => {
  const flow = buildNewFlowRuntimeStatus();
  res.status(200).json({
    ok: true,
    service: 'kokokara-line-ai',
    version: 'phase12-root-rebuild',
    time: new Date().toISOString(),
    lineSdkLoaded: Boolean(line),
    hasAccessToken: Boolean(process.env.LINE_CHANNEL_ACCESS_TOKEN),
    newFlow: flow
  });
});

app.get('/web/admin', (_req, res) => {
  res.sendFile(path.join(__dirname, 'public/web/admin.html'));
});

app.get('/web/admin.html', (_req, res) => {
  res.sendFile(path.join(__dirname, 'public/web/admin.html'));
});

app.use('/web', express.static(path.join(__dirname, 'public/web'), { index: 'index.html' }));
app.use('/api/web', webRouter);

app.post('/webhook', async (req, res) => {
  try {
    const events = Array.isArray(req.body?.events) ? req.body.events : [];
    res.status(200).send('ok');

    const lineClient = buildLineClient();
    for (const event of events) {
      await syncLineDisplayName(lineClient, event?.source?.userId || '');
      await handleEvent(event);
    }
  } catch (error) {
    console.error('[index] webhook error:', error?.message || error);
    if (!res.headersSent) res.status(200).send('ok');
  }
});

const port = Number(process.env.PORT || 10000);
app.listen(port, () => {
  console.log(`server listening on ${port}`);
  console.log('[NEW_FLOW_ACTIVE] startup', buildNewFlowRuntimeStatus());
  sessionStateRepository.verifySessionStateSchema()
    .then((result) => {
      if (result?.ok) {
        console.log('[v2-context] session_state_schema_verify ok');
      } else {
        console.error(`[v2-error] reason=session_state_schema_verify_failed fallback=startup_warn_only detail=${String(result?.reason || 'unknown')}`);
      }
    })
    .catch((error) => {
      console.error(`[v2-error] reason=session_state_schema_verify_exception fallback=startup_warn_only detail=${String(error?.message || error || 'unknown')}`);
    });
});
