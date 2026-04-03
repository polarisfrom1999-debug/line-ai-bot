'use strict';

let line = null;
let axios = null;
try {
  line = require('@line/bot-sdk');
} catch (_) {
  line = null;
}
try {
  axios = require('axios');
} catch (_) {
  axios = null;
}

function buildLineBlobClient() {
  const token = getChannelAccessToken();
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


function getChannelAccessToken() {
  return String(process.env.LINE_CHANNEL_ACCESS_TOKEN || '').trim();
}

async function fetchMessageContentBufferViaHttp(messageId) {
  const token = getChannelAccessToken();
  if (!axios || !messageId || !token) return null;

  const urls = [
    `https://api-data.line.me/v2/bot/message/${messageId}/content`,
    `https://api.line.me/v2/bot/message/${messageId}/content`,
  ];

  for (const url of urls) {
    try {
      const response = await axios.get(url, {
        responseType: 'arraybuffer',
        headers: { Authorization: `Bearer ${token}` },
        timeout: Number(process.env.LINE_MEDIA_TIMEOUT_MS || 20000),
        validateStatus: (status) => status >= 200 && status < 300
      });
      const data = response && response.data ? Buffer.from(response.data) : null;
      if (data && data.length) return data;
    } catch (error) {
      console.error('[line_media_service] http fallback error:', error?.message || error);
    }
  }

  return null;
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

async function getMessageContentBuffer(messageId) {
  if (!messageId) return null;

  const client = buildLineBlobClient();
  if (!client || typeof client.getMessageContent !== 'function') return null;

  try {
    const response = await client.getMessageContent(messageId);
    if (!response) return null;
    if (Buffer.isBuffer(response)) return response;
    if (Buffer.isBuffer(response?.data)) return response.data;

    if (typeof response?.arrayBuffer === 'function') {
      return Buffer.from(await response.arrayBuffer());
    }
    if (response?.readable === true && typeof response?.on === 'function') {
      return streamToBuffer(response);
    }
    if (response?.data?.readable === true && typeof response.data?.on === 'function') {
      return streamToBuffer(response.data);
    }

    return null;
  } catch (error) {
    console.error('[line_media_service] getMessageContentBuffer error:', error?.message || error);
    return null;
  }
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
  if (!messageId) return null;

  let buffer = await getMessageContentBuffer(messageId);
  if (!buffer || !buffer.length) {
    buffer = await fetchMessageContentBufferViaHttp(messageId);
  }
  if (!buffer || !buffer.length) return null;

  let mimeType = detectMimeTypeFromBytes(buffer);
  if (messageType === 'image' && mimeType === 'application/octet-stream') {
    mimeType = 'image/jpeg';
  }

  return {
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
  if (!payload) return null;
  if (payload.kind !== 'image') return null;
  return payload;
}

module.exports = {
  getImagePayload,
  getMediaPayload,
  getMessageContentBuffer,
  detectMimeTypeFromBytes
};
