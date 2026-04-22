'use strict';

const { decideImageDomain } = require('./image_domain_router_service');
const activeContextStoreService = require('./active_context_store_service');
const imageIngestService = require('../image_ingest_service');
const mealAnalysisService = require('../meal_analysis_service');
const labDocumentIngestService = require('../lab_document_ingest_service');
const labSessionRepository = require('../../repositories/lab_session_repository');
const contextMemoryService = require('../context_memory_service');

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

function buildImageMealRecordPayload(parsedMeal, input = {}) {
  const items = Array.isArray(parsedMeal?.items) ? parsedMeal.items.filter(Boolean) : [];
  const itemLabel = items.length ? items.join('、') : '食事写真';
  return {
    type: 'meal',
    date: new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Tokyo', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date()),
    name: itemLabel,
    summary: itemLabel,
    items,
    food_items: items,
    estimatedNutrition: parsedMeal?.estimatedNutrition || { kcal: 0, protein: 0, fat: 0, carbs: 0 },
    kcal: Number(parsedMeal?.estimatedNutrition?.kcal || 0),
    protein: Number(parsedMeal?.estimatedNutrition?.protein || 0),
    fat: Number(parsedMeal?.estimatedNutrition?.fat || 0),
    carbs: Number(parsedMeal?.estimatedNutrition?.carbs || 0),
    amountRatio: Number(parsedMeal?.amountRatio || 1),
    amountNote: parsedMeal?.amountNote || '',
    confidence: parsedMeal?.confidence != null ? Number(parsedMeal.confidence) : null,
    comment: parsedMeal?.comment || '',
    sourceLineMessageId: normalizeText(input?.messageId || ''),
    dedupeKey: normalizeText(input?.messageId ? `msg:${input.messageId}` : ''),
    sourceImageHash: normalizeText(input?.messageId || ''),
    raw_model_json: {
      correction: null,
      adoptedNutrition: parsedMeal?.estimatedNutrition || {},
      sourceLineMessageId: normalizeText(input?.messageId || ''),
      dedupeKey: normalizeText(input?.messageId ? `msg:${input.messageId}` : ''),
    }
  };
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
    await contextMemoryService.addDailyRecord(input.userId, buildImageMealRecordPayload(meal, input)).catch(() => null);
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
  await labSessionRepository.createLabSession({
    userId: input.userId,
    sourceImageId: normalizeText(imagePayload?.id || ''),
    sourceMessageId: normalizeText(input?.messageId || ''),
    status: Array.isArray(lab?.items) && lab.items.length > 0 ? 'active' : 'tentative',
    patientName: lab?.patientName || '',
    facilityName: lab?.facilityName || '',
    printDate: lab?.printDate || '',
    examDates: Array.isArray(lab?.examDates) ? lab.examDates : [],
    parsedItems: Array.isArray(lab?.itemsStructured) ? lab.itemsStructured : (Array.isArray(lab?.items) ? lab.items : []),
    rawText: lab?.rawText || '',
    confidence: Number(lab?.analysisConfidence?.v2_confidence || 0) || 0,
    isLabImageStrict: Boolean(lab?.isLabImage),
    isLabImageTentative: true,
    geminiRaw: lab?.geminiRaw || null,
    structuredJson: lab?.structuredJson ?? lab?.rawPayload ?? null,
    expiresAt: new Date(Date.now() + (2 * 60 * 60 * 1000)).toISOString(),
  }).catch(() => null);
  return { handled: true, intentType: 'newflow_lab_image', replyText: buildLabReply(lab) };
}

module.exports = {
  handleImageIngest,
};
