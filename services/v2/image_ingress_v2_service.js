'use strict';

const imageIngestService = require('../image_ingest_service');
const labPipeline = require('./pipelines/lab_image_pipeline_v2_service');
const mealPipeline = require('./pipelines/meal_image_pipeline_v2_service');
const imageKindClassifier = require('./image_kind_classifier_service');
const compareLogger = require('./pipeline_compare_logger_service');

function normalizeText(value) {
  return String(value || '').trim();
}

async function handleImageIngressV2({ input, textHint = '' } = {}) {
  if (input?.messageType !== 'image') return { handled: false, reason: 'not_image' };

  let ingested = null;
  if (input?.webImagePayload?.buffer) {
    ingested = {
      ok: true,
      payload: {
        ok: true,
        id: normalizeText(input?.messageId || ''),
        buffer: input.webImagePayload.buffer,
        mimeType: input.webImagePayload.mimeType || 'image/jpeg',
      },
    };
  } else {
    ingested = await imageIngestService.ingestLineImage(input);
  }
  if (!ingested?.ok) {
    return {
      handled: true,
      intentType: 'image_ingest_ng',
      replyText: '画像の取得に失敗しました。もう一度送ってください。'
    };
  }

  const imagePayload = ingested.payload;
  const [labResult, mealResult] = await Promise.all([
    labPipeline.handleLabImageV2({ input, imagePayload }),
    mealPipeline.handleMealImageV2({ input, imagePayload }),
  ]);

  compareLogger.logImagePipelineResult({
    userId: input.userId,
    sourceImageId: normalizeText(imagePayload?.id || input?.messageId || ''),
    labPanel: labResult?.analysis || null,
    meal: mealResult?.analysis || null,
  });

  const kind = imageKindClassifier.classifyImageKind({
    textHint,
    labPanel: labResult?.analysis || null,
    meal: mealResult?.analysis || null,
  });

  if (kind === 'lab' && labResult?.handled) {
    return {
      handled: true,
      intentType: labResult.intentType || 'lab_image',
      replyText: labResult.replyText,
      persistence: labResult?.persistence || null
    };
  }
  if (kind === 'meal' && mealResult?.handled) {
    return {
      handled: true,
      intentType: mealResult.intentType || 'meal_image',
      replyText: mealResult.replyText,
      persistence: mealResult?.persistence || null
    };
  }
  if (labResult?.handled) {
    return {
      handled: true,
      intentType: labResult.intentType || 'lab_image',
      replyText: labResult.replyText,
      persistence: labResult?.persistence || null
    };
  }
  if (mealResult?.handled) {
    return {
      handled: true,
      intentType: mealResult.intentType || 'meal_image',
      replyText: mealResult.replyText,
      persistence: mealResult?.persistence || null
    };
  }

  return {
    handled: true,
    intentType: 'image_unclassified',
    replyText: '画像を受け取りました。食事画像か血液検査画像かを一言添えて再送していただけると判定しやすくなります。'
  };
}

module.exports = {
  handleImageIngressV2,
};
