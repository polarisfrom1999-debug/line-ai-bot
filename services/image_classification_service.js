'use strict';

function normalizeText(value) {
  return String(value || '').trim();
}

function normalizeScore(value, fallback = 0) {
  const num = Number(value);
  if (!Number.isFinite(num)) return fallback;
  return Math.max(0, Math.min(1, num));
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

function scoreImageRoutes({ lab, meal, shoeWear, movement, hintText = '', followUpType = '' }) {
  const scores = {
    meal: 0,
    lab: 0,
    motion: 0,
    shoe_wear: 0
  };

  if (meal?.isMealImage) scores.meal += Math.max(0.6, normalizeScore(meal?.confidence, 0.8));
  if (lab?.isLabImage || lab?.labLike) scores.lab += Math.max(0.6, normalizeScore(lab?.confidence, 0.8));
  if (shoeWear?.isShoeWearImage) scores.shoe_wear += Math.max(0.6, normalizeScore(shoeWear?.confidence, 0.8));
  if (movement?.isMovementImage) scores.motion += Math.max(0.6, normalizeScore(movement?.confidence, 0.8));

  const hint = normalizeText(hintText);
  const hintRoute = classifyImageByHint(hint);
  if (hintRoute === 'meal') scores.meal += 0.22;
  if (hintRoute === 'lab') scores.lab += 0.22;
  if (hintRoute === 'shoe_wear') scores.shoe_wear += 0.22;
  if (hintRoute === 'movement') scores.motion += 0.22;

  const follow = normalizeText(followUpType);
  if (follow === 'meal') scores.meal += 0.18;
  if (follow === 'lab' || follow === 'lab_pending' || follow === 'blood_test' || follow === 'lab_image') scores.lab += 0.18;
  if (follow === 'motion') scores.motion += 0.18;
  if (follow === 'shoe_wear') scores.shoe_wear += 0.18;

  return scores;
}

function resolveImageRouteByScore(scores = {}, threshold = 0.66) {
  const tieBreak = { lab: 4, meal: 3, shoe_wear: 2, motion: 1 };
  const entries = Object.entries(scores)
    .map(([route, score]) => ({ route, score: Number(score || 0) }))
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      return (tieBreak[b.route] || 0) - (tieBreak[a.route] || 0);
    });
  const top = entries[0] || { route: 'unknown', score: 0 };
  const second = entries[1] || { route: 'unknown', score: 0 };
  const confidence = Math.max(0, Math.min(1, top.score - Math.max(0, second.score * 0.35)));
  const isReliable = top.score >= threshold && (top.score - second.score) >= 0.08;
  return {
    route: isReliable ? top.route : 'unknown',
    topRoute: top.route,
    topScore: top.score,
    secondRoute: second.route,
    secondScore: second.score,
    confidence: Number(confidence.toFixed(3)),
    isReliable
  };
}

module.exports = {
  classifyImageByAnalysis,
  classifyImageByHint,
  scoreImageRoutes,
  resolveImageRouteByScore
};
