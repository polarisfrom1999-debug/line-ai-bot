services/line_media_service.js
'use strict';

/**
 * services/line_media_service.js
 */

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

async function getMessageContentBuffer(messageId) {
  if (!messageId) return null;

  const client = buildLineBlobClient();
  if (!client || typeof client.getMessageContent !== 'function') {
    return null;
  }

  try {
    const response = await client.getMessageContent(messageId);
    if (!response) return null;

    if (Buffer.isBuffer(response)) return response;

    if (response?.data && Buffer.isBuffer(response.data)) {
      return response.data;
    }

    if (typeof response?.arrayBuffer === 'function') {
      const arrayBuffer = await response.arrayBuffer();
      return Buffer.from(arrayBuffer);
    }

    if (response?.readable === true && typeof response?.on === 'function') {
      return await streamToBuffer(response);
    }

    if (response?.data?.readable === true && typeof response.data?.on === 'function') {
      return await streamToBuffer(response.data);
    }

    return null;
  } catch (error) {
    console.error('[line_media_service] getMessageContentBuffer error:', error?.message || error);
    return null;
  }
}

function guessMimeType() {
  return 'image/jpeg';
}

async function getImagePayload(input) {
  const messageId =
    input?.imageMeta?.messageId ||
    input?.messageId ||
    input?.originalEvent?.message?.id ||
    null;

  if (!messageId) return null;

  const buffer = await getMessageContentBuffer(messageId);
  if (!buffer || !buffer.length) return null;

  return {
    messageId,
    buffer,
    mimeType: guessMimeType(),
    size: buffer.length
  };
}

module.exports = {
  getImagePayload,
  getMessageContentBuffer
};
