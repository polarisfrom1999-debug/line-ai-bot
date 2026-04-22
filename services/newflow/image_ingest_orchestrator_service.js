'use strict';

const { decideImageDomain } = require('./image_domain_router_service');
const activeContextStoreService = require('./active_context_store_service');
const imageIngestService = require('../image_ingest_service');
const mealAnalysisService = require('../meal_analysis_service');
const labDocumentIngestService = require('../lab_document_ingest_service');

function normalizeText(value) {
  return String(value || '').trim();
}

function round1(value) {
  return Math.round((Number(value || 0) + Number.EPSILON) * 10) / 10;
}

function buildMealReply(meal) {
  const items = Array.isArray(meal?.items) ? meal.items.filter(Boolean).join('、') : '';
  const kcal = round1(meal?.estimatedNutrition?.kcal || 0);
  const protein = round1(meal?.estimatedNutrition?.protein || 0);
  const fat = round1(meal?.estimatedNutrition?.fat || 0);
  const carbs = round1(meal?.estimatedNutrition?.carbs || 0);
  return [
    '食事画像として受け取りました。',
    `見立て: ${items || '品目未特定'}`,
    `目安: ${kcal} kcal / P ${protein}g / F ${fat}g / C ${carbs}g`,
    '必要なら「麺だけ0kcal」「半分食べた」のように続けて補正できます。'
  ].join('\n');
}

function buildLabReply(lab = {}) {
  const examDate = normalizeText(lab?.latestExamDate || lab?.examDate || '');
  return [
    '血液検査画像として受け取りました。',
    examDate ? `最新の検査日: ${examDate}` : '検査日は確認中です。',
    '「TGは？」「患者名は？」「異常がある項目は？」のように聞いてください。'
  ].join('\n');
}

async function resolveImagePayload(input) {
  if (input?.webImagePayload?.buffer) {
    return {
      id: normalizeText(input?.messageId || ''),
      buffer: input.webImagePayload.buffer,
      mimeType: input.webImagePayload.mimeType || 'image/jpeg'
    };
  }
  const ingested = await imageIngestService.ingestLineImage(input);
  if (!ingested?.ok || !ingested?.payload?.buffer) return null;
  return ingested.payload;
}

async function handleImageIngest({ input, textHint = '' } = {}) {
  if (input?.messageType !== 'image') return { handled: false, reason: 'not_image' };
  const imagePayload = await resolveImagePayload(input);
  if (!imagePayload) {
    return {
      handled: true,
      intentType: 'newflow_image_ingest_ng',
      replyText: '画像の取得に失敗しました。もう一度送ってください。'
    };
  }
  const domain = decideImageDomain({ textHint });
  if (domain === 'unknown') {
    return {
      handled: true,
      intentType: 'newflow_image_unknown',
      replyText: '画像を受け取りました。食事画像か血液検査画像かを一言添えて送ってください。'
    };
  }
  console.info('[v2-image] route_selected', { userId: input.userId, routeKind: domain, domain });

  if (domain === 'meal') {
    const meal = await mealAnalysisService.analyzeMealImage(imagePayload, input.userId, normalizeText(textHint));
    if (!meal || meal?.isMealImage === false) {
      return { handled: true, intentType: 'newflow_meal_image_ng', replyText: '食事画像として判定できませんでした。食事の写真なら「食事」と添えて再送してください。' };
    }
    await activeContextStoreService.setActiveContext(input.userId, {
      domain: 'meal_image_session',
      payload: {
        sourceImageId: normalizeText(imagePayload?.id || ''),
        sourceMessageId: normalizeText(input?.messageId || ''),
        meal
      }
    }).catch(() => null);
    return { handled: true, intentType: 'newflow_meal_image', replyText: buildMealReply(meal) };
  }

  const ingest = await labDocumentIngestService.ingestLabDocument({ userId: input.userId, imagePayload });
  const lab = ingest?.panel || null;
  if (!lab || typeof lab !== 'object') {
    return { handled: true, intentType: 'newflow_lab_image_ng', replyText: '血液検査画像として判定できませんでした。検査結果画像なら「血液検査」と添えて再送してください。' };
  }
  await activeContextStoreService.setActiveContext(input.userId, {
    domain: 'lab_image_session',
    payload: {
      sourceImageId: normalizeText(imagePayload?.id || ''),
      sourceMessageId: normalizeText(input?.messageId || ''),
      labPanel: lab
    }
  }).catch(() => null);
  return { handled: true, intentType: 'newflow_lab_image', replyText: buildLabReply(lab) };
}

module.exports = {
  handleImageIngest,
};
