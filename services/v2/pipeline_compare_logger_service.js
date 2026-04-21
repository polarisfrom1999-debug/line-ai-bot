'use strict';

function summarizeLab(panel = {}) {
  return {
    isLabImageStrict: Boolean(panel?.isLabImage),
    isLabImageTentative: Boolean(panel?.labLike || panel?.isLabImage),
    examDate: panel?.latestExamDate || panel?.examDate || '',
    examDates: Array.isArray(panel?.examDates) ? panel.examDates.length : 0,
    itemCount: Array.isArray(panel?.items) ? panel.items.length : 0,
    patientName: panel?.patientName || '',
    facilityName: panel?.facilityName || '',
    printDate: panel?.printDate || '',
  };
}

function summarizeMeal(meal = {}) {
  return {
    isMealImage: Boolean(meal?.isMealImage),
    confidence: Number(meal?.confidence || 0),
    items: Array.isArray(meal?.items) ? meal.items.length : 0,
    kcal: Number(meal?.estimatedNutrition?.kcal || 0),
  };
}

function logImagePipelineResult({ userId, sourceImageId, routeKind = '', labPanel = null, meal = null, labPersistence = null, mealPersistence = null }) {
  console.info('[v2-image] ingress_result', {
    userId,
    sourceImageId: sourceImageId || '',
    routeKind: routeKind || '',
    lab: labPanel ? summarizeLab(labPanel) : null,
    meal: meal ? summarizeMeal(meal) : null,
    labPersistence: labPersistence || null,
    mealPersistence: mealPersistence || null,
  });
}

module.exports = {
  logImagePipelineResult,
};
