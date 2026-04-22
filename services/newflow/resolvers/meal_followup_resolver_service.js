'use strict';

const v2MealFollowupResolver = require('../../v2/followups/meal_followup_resolver_service');
const responseBuilderService = require('../response_builder_service');

function normalizeText(value) {
  return String(value || '').trim();
}

function round1(value) {
  return Math.round((Number(value || 0) + Number.EPSILON) * 10) / 10;
}

function resolveCanonicalMealFollowup(text, canonicalMeal = null) {
  const safeText = normalizeText(text || '');
  if (!safeText || !canonicalMeal) return null;
  if (/カロリー|kcal|何キロカロリー/.test(safeText)) {
    return {
      intentType: 'newflow_meal_followup',
      replyText: `直近の食事「${normalizeText(canonicalMeal.mealLabel || '食事')}」は約${round1(canonicalMeal?.adoptedNutrition?.kcal || 0)} kcalです。`
    };
  }
  if (/補正|修正|半分|食べてない|0kcal|ゼロ/.test(safeText) && canonicalMeal?.correction) {
    const mode = normalizeText(canonicalMeal?.correction?.mode || '補正');
    return {
      intentType: 'newflow_meal_followup',
      replyText: `直近の食事には「${mode}」補正が反映されています。必要なら同じ画像を再送して追加補正できます。`
    };
  }
  return null;
}

async function resolveMealFollowup({ input, text, activeContext }) {
  const safeText = normalizeText(text || input?.rawText || '');
  const mealReply = await v2MealFollowupResolver.resolveMealFollowupFromSession({
    input,
    text: safeText,
    activeContext,
  });
  if (mealReply?.replyText) return mealReply;
  return { intentType: 'newflow_meal_followup', replyText: responseBuilderService.buildMealGenericReply() };
}

module.exports = {
  resolveMealFollowup,
  resolveCanonicalMealFollowup,
};
