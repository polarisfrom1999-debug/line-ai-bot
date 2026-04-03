'use strict';

const https = require('https');

let line = null;
try {
  line = require('@line/bot-sdk');
} catch (_) {
  line = null;
}

function buildLineBlobClient() {
  const token = process.env.LINE_CHANNEL_ACCESS_TOKEN;
  if (!line || !token) return null;

  try {
    return new line.messagingApi.MessagingApiBlobClient({
      channelAccessToken: token
    });
  } catch (error) {
    console.error('[line_media_service] buildLineBlobClient error:', error?.message || error);
    return null;
  }
}

function streamToBuffer(stream) {
  return new Promise((resolve, reject) => {
    const chunks = [];

    stream.on('data', (chunk) => {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    });
    stream.on('end', () => resolve(Buffer.concat(chunks)));
    stream.on('error', reject);
  });
}

function fetchContentViaHttps(messageId) {
  const token = process.env.LINE_CHANNEL_ACCESS_TOKEN;
  if (!messageId || !token) return Promise.resolve(null);

  return new Promise((resolve) => {
    const req = https.request({
      method: 'GET',
      hostname: 'api-data.line.me',
      path: `/v2/bot/message/${encodeURIComponent(messageId)}/content`,
      headers: {
        Authorization: `Bearer ${token}`
      },
      timeout: 20000
    }, (res) => {
      const chunks = [];
      res.on('data', (chunk) => chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)));
      res.on('end', () => {
        if (res.statusCode && res.statusCode >= 200 && res.statusCode < 300) {
          return resolve(Buffer.concat(chunks));
        }
        console.error('[line_media_service] https fallback status:', res.statusCode);
        return resolve(null);
      });
    });

    req.on('error', (error) => {
      console.error('[line_media_service] https fallback error:', error?.message || error);
      resolve(null);
    });
    req.on('timeout', () => {
      req.destroy(new Error('timeout'));
    });
    req.end();
  });
}

async function getMessageContentBuffer(messageId) {
  if (!messageId) return null;

  const client = buildLineBlobClient();
  if (client && typeof client.getMessageContent === 'function') {
    try {
      const response = await client.getMessageContent(messageId);
      if (response) {
        if (Buffer.isBuffer(response)) return response;
        if (Buffer.isBuffer(response?.data)) return response.data;
        if (typeof response?.arrayBuffer === 'function') {
          return Buffer.from(await response.arrayBuffer());
        }
        if (response?.readable === true && typeof response?.on === 'function') {
          return await streamToBuffer(response);
        }
        if (response?.data?.readable === true && typeof response.data?.on === 'function') {
          return await streamToBuffer(response.data);
        }
      }
    } catch (error) {
      console.error('[line_media_service] blob client error:', error?.message || error);
    }
  }

  return fetchContentViaHttps(messageId);
}

function detectMimeTypeFromBytes(buffer) {
  if (!buffer || buffer.length < 12) return 'application/octet-stream';

  const hex = buffer.subarray(0, 12).toString('hex').toLowerCase();
  if (hex.startsWith('89504e47')) return 'image/png';
  if (hex.startsWith('ffd8ff')) return 'image/jpeg';
  if (hex.startsWith('47494638')) return 'image/gif';
  if (hex.startsWith('52494646') && buffer.subarray(8, 12).toString('ascii') === 'WEBP') return 'image/webp';
  if (hex.startsWith('25504446')) return 'application/pdf';
  if (hex.startsWith('000000') && buffer.subarray(4, 8).toString('ascii') === 'ftyp') return 'video/mp4';
  return 'application/octet-stream';
}

function buildPayloadKind(mimeType, messageType) {
  if (/^image\//.test(mimeType) || messageType === 'image') return 'image';
  if (/^video\//.test(mimeType) || messageType === 'video') return 'video';
  if (mimeType === 'application/pdf' || messageType === 'file') return 'file';
  return messageType || 'binary';
}

async function getMediaPayload(input) {
  const event = input?.originalEvent || null;
  const messageId = input?.imageMeta?.messageId || input?.messageId || event?.message?.id || null;
  const messageType = input?.messageType || event?.message?.type || 'unknown';
  if (!messageId) {
    return {
      ok: false,
      errorCode: 'missing_message_id',
      errorMessage: 'messageId が見つかりません。'
    };
  }

  const buffer = await getMessageContentBuffer(messageId);
  if (!buffer || !buffer.length) {
    return {
      ok: false,
      messageId,
      errorCode: 'content_fetch_failed',
      errorMessage: 'LINE画像の取得に失敗しました。'
    };
  }

  const mimeType = detectMimeTypeFromBytes(buffer);
  return {
    ok: true,
    messageId,
    buffer,
    size: buffer.length,
    mimeType,
    kind: buildPayloadKind(mimeType, messageType),
    messageType
  };
}

async function getImagePayload(input) {
  const payload = await getMediaPayload(input);
  if (!payload?.ok) return payload;
  if (payload.kind !== 'image') {
    return {
      ok: false,
      messageId: payload.messageId,
      errorCode: 'not_image',
      errorMessage: '画像メッセージではありません。'
    };
  }
  return payload;
}

module.exports = {
  getImagePayload,
  getMediaPayload,
  getMessageContentBuffer,
  detectMimeTypeFromBytes
};
