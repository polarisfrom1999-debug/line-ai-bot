'use strict';

/**
 * index.js
 *
 * 役割:
 * - LINE webhook の入口
 * - event を整形して router へ渡す
 * - 最終返信送信
 *
 * 備考:
 * - 既存の LINE client がある場合は差し替えやすいように薄くしている
 */

const express = require('express');
const bodyParser = require('body-parser');

let line;
try {
  line = require('@line/bot-sdk');
} catch (_) {
  line = null;
}

const conversationRouter = require('./services/chatgpt_conversation_router');

const config = {
  channelAccessToken: process.env.LINE_CHANNEL_ACCESS_TOKEN || '',
  channelSecret: process.env.LINE_CHANNEL_SECRET || ''
};

const app = express();

if (line && config.channelSecret) {
  app.post('/webhook', line.middleware(config), webhookHandler);
} else {
  app.use(bodyParser.json({ limit: '10mb' }));
  app.post('/webhook', webhookHandler);
}

async function webhookHandler(req, res) {
  try {
    const events = Array.isArray(req.body?.events) ? req.body.events : [];
    await Promise.all(events.map(handleEvent));
    res.status(200).send('ok');
  } catch (error) {
    console.error('[webhook] error', error);
    res.status(500).send('error');
  }
}

async function handleEvent(event) {
  try {
    if (!event || !event.source?.userId) return;

    if (event.type !== 'message') return;

    const messageType = event.message?.type || 'other';
    const rawText = messageType === 'text' ? (event.message?.text || '') : '';

    const result = await conversationRouter.routeConversation({
      userId: event.source.userId,
      replyToken: event.replyToken,
      messageType,
      rawText,
      messageId: event.message?.id || null,
      timestamp: event.timestamp || Date.now(),
      sourceType: event.source?.type || 'user',
      originalEvent: event
    });

    if (result?.ok && Array.isArray(result.replyMessages) && result.replyMessages.length) {
      await replyLineMessages(event.replyToken, result.replyMessages);
    }
  } catch (error) {
    console.error('[handleEvent] error', error);
    if (event?.replyToken) {
      await replyLineMessages(event.replyToken, [
        { type: 'text', text: '今うまく受け取れなかったので、もう一度だけ送ってもらえたら大丈夫です。' }
      ]).catch(() => {});
    }
  }
}

async function replyLineMessages(replyToken, messages) {
  if (!replyToken || !Array.isArray(messages) || !messages.length) return;

  if (line && config.channelAccessToken) {
    const client = new line.messagingApi.MessagingApiClient({
      channelAccessToken: config.channelAccessToken
    });
    await client.replyMessage({
      replyToken,
      messages
    });
    return;
  }

  console.log('[reply fallback]', { replyToken, messages });
}

app.get('/', (_req, res) => {
  res.status(200).send('kokokara line ai running');
});

const port = Number(process.env.PORT || 3000);

if (require.main === module) {
  app.listen(port, () => {
    console.log(`server listening on ${port}`);
  });
}

module.exports = {
  app,
  handleEvent,
  replyLineMessages
};
