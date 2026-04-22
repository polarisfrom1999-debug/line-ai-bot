'use strict';

function normalizeText(value) {
  return String(value || '').trim();
}

function labGeminiActive(labPanel) {
  return Boolean(
    labPanel?.isLabImage
    || labPanel?.labLike
    || (Array.isArray(labPanel?.items) && labPanel.items.length > 0)
    || Number(labPanel?.analysisConfidence?.rows || 0) > 0
  );
}

/**
 * 画像ルートは lab / meal / unknown のいずれか一つ（同時 true 禁止）。
 * 優先: Gemini 由来の labPanel / meal 解析 → 最後にテキストヒント。
 */
function classifyImageKind({ textHint = '', labPanel = null, meal = null }) {
  const labOn = labGeminiActive(labPanel);
  const mealOn = Boolean(meal?.isMealImage);
  if (labOn && mealOn) {
    const hint = normalizeText(textHint);
    if (/食事|ごはん|朝食|昼食|夕食|食べた|飲んだ|カロリー|ラーメン|丼|麺|meal/i.test(hint)) return 'meal';
    if (/血液|検査|採血|検査結果|LDL|HDL|HbA1c|TG|中性脂肪|AST|ALT|lab/i.test(hint)) return 'lab';
    const labScore = Number(labPanel?.analysisConfidence?.v2_confidence || 0)
      + Number(labPanel?.analysisConfidence?.classifier_confidence || 0) * 0.35
      + (Number(labPanel?.analysisConfidence?.rows || 0) > 0 ? 0.25 : 0);
    const mealScore = Number(meal?.confidence || 0);
    return labScore >= mealScore ? 'lab' : 'meal';
  }
  if (labOn) return 'lab';
  if (mealOn) return 'meal';
  const safe = normalizeText(textHint);
  if (/血液|検査|採血|LDL|HDL|HbA1c|中性脂肪|TG|AST|ALT/i.test(safe)) return 'lab';
  if (/食事|ごはん|朝食|昼食|夕食|食べた|飲んだ|カロリー|ラーメン|丼|麺/i.test(safe)) return 'meal';
  return 'unknown';
}

module.exports = {
  classifyImageKind,
};
