const crypto = require('crypto');
const axios = require('axios');

function verifyLineSignature(rawBody, signature, channelSecret) {
  if (!signature || !rawBody || !channelSecret) return false;

  const expected = crypto
    .createHmac('sha256', channelSecret)
    .update(rawBody)
    .digest('base64');

  try {
    return crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected));
  } catch {
    return false;
  }
}

function isValidHttpUrl(value) {
  return /^https:\/\//i.test(String(value || ''));
}

function normalizeLineMessages(messages) {
  const list = Array.isArray(messages) ? messages : [messages];

  return list
    .filter(Boolean)
    .slice(0, 5)
    .map((msg) => {
      if (typeof msg === 'string') {
        return { type: 'text', text: msg.slice(0, 5000) };
      }

      if (msg.type === 'text' && typeof msg.text === 'string') {
        return { ...msg, text: msg.text.slice(0, 5000) };
      }

      if (msg.type === 'image') {
        const originalContentUrl = String(msg.originalContentUrl || '');
        const previewImageUrl = String(msg.previewImageUrl || originalContentUrl);

        if (!isValidHttpUrl(originalContentUrl) || !isValidHttpUrl(previewImageUrl)) {
          console.warn('⚠️ Invalid LINE image message URL:', {
            originalContentUrl,
            previewImageUrl,
          });
          return null;
        }

        return {
          type: 'image',
          originalContentUrl,
          previewImageUrl,
        };
      }

      return msg;
    })
    .filter(Boolean);
}

function textMessageWithQuickReplies(text, labels) {
  const items = (labels || [])
    .filter(Boolean)
    .slice(0, 13)
    .map((label) => ({
      type: 'action',
      action: {
        type: 'message',
        label: String(label).slice(0, 20),
        text: String(label).slice(0, 300),
      },
    }));

  if (!items.length) {
    return {
      type: 'text',
      text: String(text).slice(0, 5000),
    };
  }

  return {
    type: 'text',
    text: String(text).slice(0, 5000),
    quickReply: { items },
  };
}

async function replyMessage(replyToken, messages, accessToken) {
  if (!replyToken) return;

  const normalizedMessages = normalizeLineMessages(messages);
  if (!normalizedMessages.length) {
    throw new Error('No valid LINE messages to send');
  }

  const payload = {
    replyToken,
    messages: normalizedMessages,
  };

  try {
    await axios.post('https://api.line.me/v2/bot/message/reply', payload, {
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${accessToken}`,
      },
      timeout: 30000,
    });
  } catch (error) {
    const detail = error?.response?.data || error?.message || error;
    console.error('❌ LINE replyMessage failed:', JSON.stringify(detail, null, 2));
    throw error;
  }
}

async function getLineImageContent(messageId, accessToken) {
  const response = await axios.get(
    `https://api-data.line.me/v2/bot/message/${messageId}/content`,
    {
      responseType: 'arraybuffer',
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
      timeout: 60000,
      maxContentLength: 20 * 1024 * 1024,
      maxBodyLength: 20 * 1024 * 1024,
    }
  );

  const mimeHeader = response.headers['content-type'] || 'image/jpeg';
  const mimeType = String(mimeHeader).includes('image/') ? String(mimeHeader) : 'image/jpeg';
  const buffer = Buffer.from(response.data);

  if (!buffer || !buffer.length) {
    throw new Error('LINE image content is empty');
  }

  return {
    buffer,
    mimeType,
  };
}

module.exports = {
  verifyLineSignature,
  normalizeLineMessages,
  textMessageWithQuickReplies,
  replyMessage,
  getLineImageContent,
};