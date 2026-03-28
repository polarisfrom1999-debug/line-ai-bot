'use strict';

require('dotenv').config();

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
    replyToken: event?.replyToken || null,
    messageType,
    rawText,
    messageId: event?.message?.id || null,
    timestamp: event?.timestamp || Date.now(),
    sourceType: event?.source?.type || 'unknown',
    originalEvent: event
  };
}

async function handleEvent(event) {
  try {
    if (!event || event.type !== 'message') return;

    const input = normalizeEventInput(event);
    const result = await conversationRouter.routeConversation(input);

    if (result?.ok && Array.isArray(result.replyMessages) && result.replyMessages.length) {
      await replyLineMessages(input.replyToken, result.replyMessages);
      return;
    }

    await replyLineMessages(input.replyToken, [{ type: 'text', text: '受け取りました。少し言い換えて送ってもらえたら、今の流れに合わせて返せます。' }]);
  } catch (error) {
    console.error('[index] handleEvent error:', error?.message || error);
    await replyLineMessages(event?.replyToken, [{ type: 'text', text: '今ちょっとうまく受け取れなかったので、もう一度だけ送ってもらえたら大丈夫です。' }]);
  }
}

app.get('/', (_req, res) => {
  res.status(200).send('ok');
});

app.get('/health', (_req, res) => {
  res.status(200).json({
    ok: true,
    service: 'kokokara-line-ai',
    time: new Date().toISOString(),
    lineSdkLoaded: Boolean(line),
    hasAccessToken: Boolean(process.env.LINE_CHANNEL_ACCESS_TOKEN)
  });
});

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
