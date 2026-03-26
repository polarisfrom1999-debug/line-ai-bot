'use strict';

/**
 * services/weight_service.js
 *
 * 役割:
 * - 体重/体脂肪率の自然文を扱いやすくする
 */

function parseWeightText(text) {
  const safe = String(text || '').trim();
  const weightMatch = safe.match(/(\d{2,3}(?:\.\d+)?)\s*kg/i);
  const bodyFatMatch = safe.match(/体脂肪(?:率)?\s*[:：]?\s*(\d{1,2}(?:\.\d+)?)\s*%?/);
  return {
    weightKg: weightMatch ? Number(weightMatch[1]) : null,
    bodyFatPercent: bodyFatMatch ? Number(bodyFatMatch[1]) : null,
    isMorning: /今朝/.test(safe),
    isToday: /今日|今朝/.test(safe),
    rawText: safe
  };
}

function detectWeightTrendHint(weightKg, recentWeights) {
  const rows = Array.isArray(recentWeights) ? recentWeights : [];
  if (!rows.length || weightKg == null) return null;
  const last = rows[rows.length - 1];
  if (typeof last?.weightKg !== 'number') return null;
  const diff = weightKg - last.weightKg;
  if (Math.abs(diff) < 0.3) return 'plateau_possible';
  if (diff > 0.5) return 'temporary_increase';
  if (diff < -0.5) return 'moving_down';
  return null;
}

function detectEmotionalRiskHint(text) {
  const safe = String(text || '');
  if (/減らない|増えた|停滞|最悪|やばい/.test(safe)) return 'may_feel_discouraged';
  return null;
}

module.exports = {
  parseWeightText,
  detectWeightTrendHint,
  detectEmotionalRiskHint
};
