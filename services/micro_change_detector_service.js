'use strict';

function detectMicroChange(params = {}) {
  const nutrition = params?.todayNutritionSummary || {};
  const energy = params?.todayEnergyBalance || {};
  const protein = Number(nutrition?.protein || 0);
  const fat = Number(nutrition?.fat || 0);
  const exercise = Number(energy?.exerciseBurnKcal || 0);
  const changes = [];

  if (protein >= 60) changes.push('たんぱく質が安定して取れている');
  if (exercise >= 250) changes.push('運動量がしっかり積み上がっている');
  if (fat >= 80) changes.push('脂質がやや続き気味');

  return {
    hasMicroChange: changes.length > 0,
    changes,
    positive: changes.filter((c) => !/続き気味/.test(c)),
    caution: changes.filter((c) => /続き気味/.test(c)),
  };
}

module.exports = {
  detectMicroChange,
};

