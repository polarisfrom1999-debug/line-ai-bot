'use strict';

function normalizeText(value) {
  return String(value || '').trim();
}

function classifyByTextHint(textHint) {
  const hint = normalizeText(textHint);
  if (!hint) return 'unknown';
  if (/食事|ごはん|朝食|昼食|夕食|食べた|カロリー|麺|meal/i.test(hint)) return 'meal';
  if (/血液|検査|採血|検査結果|LDL|HDL|HbA1c|TG|中性脂肪|lab/i.test(hint)) return 'lab';
  return 'unknown';
}

function mealGeminiSignal(meal = null) {
  if (!meal || typeof meal !== 'object') return { present: false, confidence: 0, on: false };
  const confidence = Number(meal?.confidence || 0) || 0;
  const fallbackMeal = Boolean(
    normalizeText(meal?.reason)
    || (Array.isArray(meal?.items) && meal.items.length === 1 && normalizeText(meal.items[0]) === '食事画像（仮推定）')
  );
  const on = meal?.isMealImage !== false && !fallbackMeal;
  return { present: true, confidence, on };
}

function labGeminiSignal(lab = null) {
  if (!lab || typeof lab !== 'object') return { present: false, confidence: 0, on: false };
  const confidence = Number(lab?.analysisConfidence?.v2_confidence || 0)
    || Number(lab?.analysisConfidence?.classifier_confidence || 0)
    || 0;
  const on = Boolean(
    lab?.isLabImage
    || lab?.labLike
    || (Array.isArray(lab?.items) && lab.items.length > 0)
    || Number(lab?.analysisConfidence?.rows || 0) > 0
  );
  return { present: true, confidence, on };
}

function decideImageDomain({ textHint = '', forcedDomain = '', meal = null, lab = null } = {}) {
  const forced = normalizeText(forcedDomain).toLowerCase();
  if (forced === 'meal' || forced === 'lab' || forced === 'unknown') {
    return { selectedDomain: forced, candidateDomain: forced, confidence: 1, geminiResultPresent: false, rejectReason: '' };
  }

  const mealSig = mealGeminiSignal(meal);
  const labSig = labGeminiSignal(lab);
  const geminiResultPresent = Boolean(mealSig.present || labSig.present);
  const candidateDomain = mealSig.confidence >= labSig.confidence ? 'meal' : 'lab';

  if (mealSig.on && !labSig.on) {
    return { selectedDomain: 'meal', candidateDomain: 'meal', confidence: mealSig.confidence, geminiResultPresent, rejectReason: '' };
  }
  if (labSig.on && !mealSig.on) {
    return { selectedDomain: 'lab', candidateDomain: 'lab', confidence: labSig.confidence, geminiResultPresent, rejectReason: '' };
  }
  if (mealSig.on && labSig.on) {
    if (mealSig.confidence >= labSig.confidence) {
      return { selectedDomain: 'meal', candidateDomain: 'meal', confidence: mealSig.confidence, geminiResultPresent, rejectReason: '' };
    }
    return { selectedDomain: 'lab', candidateDomain: 'lab', confidence: labSig.confidence, geminiResultPresent, rejectReason: '' };
  }

  const textDomain = classifyByTextHint(textHint);
  if (textDomain !== 'unknown') {
    return { selectedDomain: textDomain, candidateDomain, confidence: 0.35, geminiResultPresent, rejectReason: 'gemini_no_positive_signal_text_hint_used' };
  }
  return {
    selectedDomain: 'unknown',
    candidateDomain,
    confidence: Math.max(mealSig.confidence, labSig.confidence, 0),
    geminiResultPresent,
    rejectReason: geminiResultPresent ? 'gemini_signals_below_threshold' : 'gemini_result_missing'
  };
}

module.exports = {
  decideImageDomain,
};
