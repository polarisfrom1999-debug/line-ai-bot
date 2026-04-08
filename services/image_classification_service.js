'use strict';

function normalizeText(value) {
  return String(value || '').trim();
}

function classifyImageByAnalysis({ lab, meal, shoeWear, movement }) {
  if (lab?.isLabImage) return 'lab';
  if (meal?.isMealImage) return 'meal';
  if (shoeWear?.isShoeWearImage) return 'shoe_wear';
  if (movement?.isMovementImage) return 'movement';
  if (lab?.ignoredReason === 'chat_screenshot') return 'chat_screenshot';
  return 'unknown';
}

function classifyImageByHint(text) {
  const safe = normalizeText(text);
  if (/血液検査|採血|LDL|HDL|HbA1c|中性脂肪|TG|AST|ALT/i.test(safe)) return 'lab';
  if (/食事|ごはん|朝食|昼食|夕食|食べた|飲んだ|カロリー/i.test(safe)) return 'meal';
  if (/靴|靴底|ソール|削れ|摩耗/i.test(safe)) return 'shoe_wear';
  if (/アキレス腱|フォーム|走り|動画|接地|足の運び/i.test(safe)) return 'movement';
  return 'unknown';
}

module.exports = {
  classifyImageByAnalysis,
  classifyImageByHint
};
