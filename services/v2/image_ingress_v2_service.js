'use strict';

const imageIngestService = require('../image_ingest_service');
const contextMemoryService = require('../context_memory_service');
const labPipeline = require('./pipelines/lab_image_pipeline_v2_service');
const mealPipeline = require('./pipelines/meal_image_pipeline_v2_service');
const imageKindClassifier = require('./image_kind_classifier_service');
const compareLogger = require('./pipeline_compare_logger_service');
const phaseeReachabilityService = require('../phasee_reachability_service');

function normalizeText(value) {
  return String(value || '').trim();
}

function isPersistenceConfirmed(persistence = null) {
  if (!persistence || typeof persistence !== 'object') return true;
  if (Object.prototype.hasOwnProperty.call(persistence, 'labSessionSaved')) {
    return Boolean(persistence.labSessionSaved);
  }
  if (Object.prototype.hasOwnProperty.call(persistence, 'captureSessionSaved')) {
    return Boolean(persistence.captureSessionSaved) && Boolean(persistence.analyzedEventSaved);
  }
  return true;
}

function buildRetrySuffix(retryCount, intentType) {
  if (retryCount <= 0) return '';
  if (retryCount === 1) return '\n\n（保存確認が未完了のため、同じ画像をもう1回送ると復旧しやすいです）';
  if (retryCount === 2) return '\n\n（保存確認が連続で未完了です。画像を1枚ずつ送って、続けて「保存できた？」と送ってください）';
  return `\n\n（保存確認が ${retryCount} 回連続で未完了です。運用確認用: intent=${intentType || 'image'}）`;
}

async function applyPersistenceRetryState(userId, intentType, replyText, persistence) {
  const confirmed = isPersistenceConfirmed(persistence);
  const current = await contextMemoryService.getShortMemory(userId).catch(() => ({}));
  const prev = current?.imagePersistenceRetry && typeof current.imagePersistenceRetry === 'object'
    ? current.imagePersistenceRetry
    : { count: 0, lastIntent: '', updatedAt: '' };
  if (confirmed) {
    if (prev?.count > 0) {
      await contextMemoryService.saveShortMemory(userId, {
        imagePersistenceRetry: { count: 0, lastIntent: '', updatedAt: new Date().toISOString() }
      }).catch(() => null);
    }
    return {
      replyText,
      retry: { count: 0, confirmed: true }
    };
  }
  const nextCount = Number(prev.count || 0) + 1;
  const nextRetry = {
    count: nextCount,
    lastIntent: normalizeText(intentType || ''),
    updatedAt: new Date().toISOString()
  };
  await contextMemoryService.saveShortMemory(userId, { imagePersistenceRetry: nextRetry }).catch(() => null);
  return {
    replyText: `${replyText || ''}${buildRetrySuffix(nextCount, intentType)}`.trim(),
    retry: { count: nextCount, confirmed: false }
  };
}

async function handleImageIngressV2({ input, textHint = '' } = {}) {
  if (input?.messageType !== 'image') return { handled: false, reason: 'not_image' };
  console.info('[phasee-old] old_image_ingress_reached', { userId: input?.userId || '', messageType: input?.messageType || '' });
  phaseeReachabilityService.recordReachability('old_image_ingress_reached', ['services/v2/image_ingress_v2_service.js'], { userId: input?.userId || '' }).catch(() => null);

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
    console.info('[phasee-old] old_reject_first_path', { userId: input?.userId || '', reason: 'image_ingest_failed' });
    phaseeReachabilityService.recordReachability('old_reject_first_path', ['services/v2/image_ingress_v2_service.js'], { reason: 'image_ingest_failed' }).catch(() => null);
    return {
      handled: true,
      intentType: 'image_ingest_ng',
      replyText: '画像の取得に失敗しました。もう一度送ってください。'
    };
  }

  const imagePayload = ingested.payload;
  const hintKind = imageKindClassifier.classifyImageKind({
    textHint,
    labPanel: null,
    meal: null,
  });
  let labResult = null;
  let mealResult = null;
  if (hintKind === 'lab') {
    labResult = await labPipeline.handleLabImageV2({ input, imagePayload });
  } else if (hintKind === 'meal') {
    mealResult = await mealPipeline.handleMealImageV2({ input, imagePayload });
  } else {
    labResult = await labPipeline.handleLabImageV2({ input, imagePayload });
    if (!labResult?.handled) {
      mealResult = await mealPipeline.handleMealImageV2({ input, imagePayload });
    }
  }

  const kind = imageKindClassifier.classifyImageKind({
    textHint,
    labPanel: labResult?.analysis || null,
    meal: mealResult?.analysis || null,
  });
  console.info('[v2-image] route_selected', { userId: input.userId, routeKind: kind, domain: kind === 'unknown' ? 'unknown' : kind });
  compareLogger.logImagePipelineResult({
    userId: input.userId,
    sourceImageId: normalizeText(imagePayload?.id || input?.messageId || ''),
    routeKind: kind,
    labPanel: labResult?.analysis || null,
    meal: mealResult?.analysis || null,
    labPersistence: labResult?.persistence || null,
    mealPersistence: mealResult?.persistence || null,
  });

  if (kind === 'lab' && labResult?.handled) {
    const adjusted = await applyPersistenceRetryState(
      input.userId,
      labResult.intentType || 'lab_image',
      labResult.replyText,
      labResult?.persistence || null
    );
    return {
      handled: true,
      intentType: labResult.intentType || 'lab_image',
      replyText: adjusted.replyText,
      persistence: labResult?.persistence || null,
      persistenceRetry: adjusted.retry
    };
  }
  if (kind === 'meal' && mealResult?.handled) {
    const adjusted = await applyPersistenceRetryState(
      input.userId,
      mealResult.intentType || 'meal_image',
      mealResult.replyText,
      mealResult?.persistence || null
    );
    return {
      handled: true,
      intentType: mealResult.intentType || 'meal_image',
      replyText: adjusted.replyText,
      persistence: mealResult?.persistence || null,
      persistenceRetry: adjusted.retry
    };
  }
  if (labResult?.handled) {
    const adjusted = await applyPersistenceRetryState(
      input.userId,
      labResult.intentType || 'lab_image',
      labResult.replyText,
      labResult?.persistence || null
    );
    return {
      handled: true,
      intentType: labResult.intentType || 'lab_image',
      replyText: adjusted.replyText,
      persistence: labResult?.persistence || null,
      persistenceRetry: adjusted.retry
    };
  }
  if (mealResult?.handled) {
    const adjusted = await applyPersistenceRetryState(
      input.userId,
      mealResult.intentType || 'meal_image',
      mealResult.replyText,
      mealResult?.persistence || null
    );
    return {
      handled: true,
      intentType: mealResult.intentType || 'meal_image',
      replyText: adjusted.replyText,
      persistence: mealResult?.persistence || null,
      persistenceRetry: adjusted.retry
    };
  }

  console.info('[phasee-old] old_reject_first_path', { userId: input?.userId || '', reason: 'image_unclassified' });
  phaseeReachabilityService.recordReachability('old_reject_first_path', ['services/v2/image_ingress_v2_service.js'], { reason: 'image_unclassified' }).catch(() => null);
  return {
    // 旧 reject-first 系の終端（分類不能時）
    // 新本流切替後にここがゼロ到達なら削除候補化
    // （運用可視化のためログを残す）
    handled: true,
    intentType: 'image_unclassified',
    replyText: '画像を受け取りました。食事画像か血液検査画像かを一言添えて再送していただけると判定しやすくなります。'
  };
}

module.exports = {
  handleImageIngressV2,
};
