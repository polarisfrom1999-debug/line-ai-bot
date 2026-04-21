'use strict';

const mealAnalysisService = require('../../meal_analysis_service');
const contextMemoryService = require('../../context_memory_service');
const activeContextService = require('../../active_context_service');

const MEAL_IMAGE_CONFIDENCE_MIN = Number(process.env.KOKOKARA_MEAL_IMAGE_CONFIDENCE_MIN || 0.56) || 0.56;

function normalizeText(value) {
  return String(value || '').trim();
}

function round1(value) {
  return Math.round((Number(value || 0) + Number.EPSILON) * 10) / 10;
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
    sourceImageHash: normalizeText(input?.messageId || '')
  };
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
    meal?.comment || ''
  ].filter(Boolean).join('\n');
}

async function handleMealImageV2({ input, imagePayload }) {
  const caption = normalizeText(input?.rawText || '');
  const meal = await mealAnalysisService.analyzeMealImage(imagePayload, input.userId, caption);
  const conf = Number(meal?.confidence || 0);
  if (!meal?.isMealImage || !Number.isFinite(conf) || conf < MEAL_IMAGE_CONFIDENCE_MIN) {
    return { handled: false, reason: 'not_meal_like', analysis: meal || null };
  }

  await contextMemoryService.saveShortMemory(input.userId, {
    lastImageType: 'meal',
    followUpContext: {
      source: 'image',
      imageType: 'meal',
      extractedMeal: meal
    },
    pendingRecordCandidate: {
      recordType: 'meal_record',
      extracted: meal
    }
  });
  await activeContextService.setActiveContext(input.userId, {
    type: 'meal_image_session',
    payload: {
      sourceImageId: normalizeText(imagePayload?.id || ''),
      sourceMessageId: normalizeText(input?.messageId || ''),
      rawAnalysis: meal?.raw || null,
      mealCandidates: Array.isArray(meal?.items) ? meal.items : [],
      selectedLabel: Array.isArray(meal?.items) ? (meal.items[0] || '') : '',
      kcalEstimate: Number(meal?.estimatedNutrition?.kcal || 0),
      macros: meal?.estimatedNutrition || {},
      confidence: Number(meal?.confidence || 0),
      createdAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + (24 * 60 * 60 * 1000)).toISOString()
    }
  });

  if (meal?.recordReady) {
    await contextMemoryService.addDailyRecord(input.userId, buildImageMealRecordPayload(meal, input));
  }

  return { handled: true, analysis: meal, replyText: buildMealReply(meal), intentType: 'meal_image' };
}

module.exports = {
  handleMealImageV2,
};
