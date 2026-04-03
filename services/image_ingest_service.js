'use strict';

const lineMediaService = require('./line_media_service');

function normalizeText(value) {
  return String(value || '').trim();
}

function buildTraceId(input) {
  if (input?.traceId) return input.traceId;
  const user = normalizeText(input?.userId || 'unknown');
  const ts = Number(input?.timestamp || Date.now());
  const msg = normalizeText(input?.messageId || 'no-message');
  return `${user}:${ts}:${msg}`;
}

async function ingestLineImage(input) {
  const traceId = buildTraceId(input);
  const payload = await lineMediaService.getImagePayload(input);

  if (!payload?.ok) {
    return {
      ok: false,
      traceId,
      stage: 'image_ingest',
      errorCode: payload?.errorCode || 'unknown_image_ingest_error',
      errorMessage: payload?.errorMessage || '画像の取得に失敗しました。',
      payload: null
    };
  }

  return {
    ok: true,
    traceId,
    stage: 'image_ingest',
    payload
  };
}

module.exports = {
  ingestLineImage,
  buildTraceId
};
