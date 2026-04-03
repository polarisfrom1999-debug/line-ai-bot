'use strict';

function normalizeText(value) {
  return String(value || '').trim();
}

function classifyImageByAnalysis({ lab, meal }) {
  if (lab?.isLabImage) return 'lab';
  if (meal?.isMealImage) return 'meal';
  return 'unknown';
}

function classifyImageByHint(text) {
  const safe = normalizeText(text);
  if (/血液検査|採血|LDL|HDL|HbA1c|中性脂肪|TG|AST|ALT/i.test(safe)) return 'lab';
  if (/食事|ごはん|朝食|昼食|夕食|食べた|飲んだ|カロリー/i.test(safe)) return 'meal';
  return 'unknown';
}

module.exports = {
  classifyImageByAnalysis,
  classifyImageByHint
};
