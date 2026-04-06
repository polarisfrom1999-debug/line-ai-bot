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

const conversationRouter = require('./services/chatgpt_conversation_router');
const chatLogService = require('./services/chat_log_service');
const conversationSummaryService = require('./services/conversation_summary_service');
const webPortalAuthService = require('./services/web_portal_auth_service');
const webPortalDataService = require('./services/web_portal_data_service');
const webPortalRealtimeService = require('./services/web_portal_realtime_service');
const { supabase } = require('./services/supabase_service');
const { ensureUser } = require('./services/user_service');
const webLinkCommandService = require('./services/web_link_command_service');
const inputGatewayService = require('./services/input_gateway_service');
const webRouter = require('./routes/web');

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

function sanitizeMessageText(text) {
  const safe = String(text || '');
  return safe.length <= 4900 ? safe : `${safe.slice(0, 4890)}…`;
}

function normalizeReplyMessages(messages) {
  if (!Array.isArray(messages)) return [];
  return messages
    .filter(Boolean)
    .map((message) => {
      if (message.type === 'text') {
        return { ...message, text: sanitizeMessageText(message.text) };
      }
      return message;
    })
    .slice(0, 5);
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
    const gatewayResult = await inputGatewayService.handleLineTopLevel(input);
    const result = gatewayResult?.handled
      ? { ok: true, replyMessages: gatewayResult.replyMessages, internal: gatewayResult.internal || {} }
      : await conversationRouter.routeConversation({ ...input, entryLane: gatewayResult?.lane || '' });

    if (result?.ok && result?.internal?.suppressReply) {
      await chatLogService.logConversationOutcome({ input, result });
      await conversationSummaryService.recordTurn({ input, result });
      refreshWebPortalCachesForLineUser(input.lineUserId || input.userId, inferWebSyncContext(input, result));
      return;
    }

    if (result?.ok && Array.isArray(result.replyMessages) && result.replyMessages.length) {
      await replyLineMessages(input.replyToken, result.replyMessages);
      await chatLogService.logConversationOutcome({ input, result });
      await conversationSummaryService.recordTurn({ input, result });
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
  res.status(200).json({
    ok: true,
    service: 'kokokara-line-ai',
    version: 'phase12-root-rebuild',
    time: new Date().toISOString(),
    lineSdkLoaded: Boolean(line),
    hasAccessToken: Boolean(process.env.LINE_CHANNEL_ACCESS_TOKEN)
  });
});

app.use('/web', express.static(path.join(__dirname, 'public/web'), { index: 'index.html' }));
app.use('/api/web', webRouter);

app.post('/webhook', async (req, res) => {
  try {
    const events = Array.isArray(req.body?.events) ? req.body.events : [];
    res.status(200).send('ok');

    for (const event of events) {
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
});
