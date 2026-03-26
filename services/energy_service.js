'use strict';

/**
 * services/energy_service.js
 *
 * 役割:
 * - 運動文から時間や距離をざっくり抽出
 * - follow-up の kcal 質問にもつなぎやすくする
 */

function parseExerciseText(text) {
  const safe = String(text || '').trim();
  const minutesMatch = safe.match(/(\d+)\s*分/);
  const kmMatch = safe.match(/(\d+(?:\.\d+)?)\s*(km|キロ)/i);

  let activityType = 'exercise';
  if (/歩い|散歩/.test(safe)) activityType = 'walk';
  else if (/ジョギング|走/.test(safe)) activityType = 'jogging';
  else if (/筋トレ/.test(safe)) activityType = 'strength';
  else if (/ストレッチ/.test(safe)) activityType = 'stretch';

  return {
    activityType,
    durationMinutes: minutesMatch ? Number(minutesMatch[1]) : null,
    distanceKm: kmMatch ? Number(kmMatch[1]) : null,
    rawText: safe
  };
}

function estimateCalories(parsed) {
  if (!parsed) return null;
  const minutes = parsed.durationMinutes || 0;
  switch (parsed.activityType) {
    case 'walk': return minutes ? Math.round(minutes * 3.5) : null;
    case 'jogging': return minutes ? Math.round(minutes * 7.5) : null;
    case 'strength': return minutes ? Math.round(minutes * 5.0) : null;
    case 'stretch': return minutes ? Math.round(minutes * 2.5) : null;
    default: return minutes ? Math.round(minutes * 4.0) : null;
  }
}

function detectExerciseCautionHint(text) {
  const safe = String(text || '');
  if (/痛い|痛み|首|腰|膝|骨折/.test(safe)) return 'pain_related_limit';
  if (/疲れた|しんどい|眠い/.test(safe)) return 'fatigue_related_limit';
  return null;
}

module.exports = {
  parseExerciseText,
  estimateCalories,
  detectExerciseCautionHint
};
