'use strict';

const labTentativeEscalation = require('./lab_tentative_escalation_service');

function normalizeText(value) {
  return String(value || '').trim();
}

function classifyImageKind({ textHint = '', labPanel = null, meal = null }) {
  if (
    labPanel?.isLabImage
    || labPanel?.labLike
    || labTentativeEscalation.shouldAcceptTentativeLabSession(labPanel)
  ) return 'lab';
  if (meal?.isMealImage) return 'meal';
  const safe = normalizeText(textHint);
  if (/血液|検査|採血|LDL|HDL|HbA1c|中性脂肪|TG|AST|ALT/i.test(safe)) return 'lab';
  if (/食事|ごはん|朝食|昼食|夕食|食べた|飲んだ|カロリー|ラーメン|丼|麺/i.test(safe)) return 'meal';
  return 'unknown';
}

module.exports = {
  classifyImageKind,
};
