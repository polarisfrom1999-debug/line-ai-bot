'use strict';

function truthy(value) {
  return Boolean(value);
}

function classifyImageByAnalysis(analysis = {}) {
  const lab = analysis.lab || {};
  const meal = analysis.meal || {};

  if (truthy(lab.isLabImage) || truthy(lab.labLike) || (Array.isArray(lab.items) && lab.items.length)) {
    return 'lab';
  }

  if (truthy(meal.isMealImage) || (Array.isArray(meal.items) && meal.items.length)) {
    return 'meal';
  }

  return 'unknown';
}

module.exports = {
  classifyImageByAnalysis
};
