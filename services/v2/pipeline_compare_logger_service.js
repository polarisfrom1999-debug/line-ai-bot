'use strict';

function summarizeLab(panel = {}) {
  return {
    isLabImage: Boolean(panel?.isLabImage || panel?.labLike),
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

function logImagePipelineResult({ userId, sourceImageId, labPanel = null, meal = null }) {
  console.info('[v2-image] ingress_result', {
    userId,
    sourceImageId: sourceImageId || '',
    lab: labPanel ? summarizeLab(labPanel) : null,
    meal: meal ? summarizeMeal(meal) : null,
  });
}

module.exports = {
  logImagePipelineResult,
};
