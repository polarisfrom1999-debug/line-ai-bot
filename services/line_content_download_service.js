'use strict';

const lineMediaService = require('./line_media_service');

/**
 * LINE Messaging API: messageId からコンテンツバイナリを取得（画像・動画共通）。
 */
async function downloadMessageContentBuffer(messageId) {
  const id = String(messageId || '').trim();
  if (!id) return null;
  return lineMediaService.getMessageContentBuffer(id);
}

async function downloadMessageContentBufferWithMeta(messageId) {
  const id = String(messageId || '').trim();
  if (!id) {
    return { ok: false, status: null, contentType: '', contentLength: null, buffer: null };
  }
  if (typeof lineMediaService.getMessageContentBufferDetailed === 'function') {
    return lineMediaService.getMessageContentBufferDetailed(id);
  }
  const buffer = await lineMediaService.getMessageContentBuffer(id);
  return {
    ok: Boolean(buffer && buffer.length),
    status: null,
    contentType: '',
    contentLength: null,
    buffer: buffer || null
  };
}

module.exports = {
  downloadMessageContentBuffer,
  downloadMessageContentBufferWithMeta,
};
