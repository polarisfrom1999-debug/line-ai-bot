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

module.exports = {
  downloadMessageContentBuffer,
};
