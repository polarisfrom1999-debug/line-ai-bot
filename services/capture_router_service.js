'use strict';

function safeText(value, fallback = '') {
  return String(value || fallback).trim();
}

function normalizeLoose(text) {
  return safeText(text)
    .toLowerCase()
    .replace(/[！!？?。.,，、]/g, '')
    .replace(/\s+/g, '');
}

function extractMinutes(text) {
  const t = safeText(text);
  let m = t.match(/(\d+)\s*時間\s*(\d+)\s*分/);
  if (m) return Number(m[1]) * 60 + Number(m[2]);
  m = t.match(/(\d+(?:\.\d+)?)\s*分/);
  if (m) return Number(m[1]);
  m = t.match(/(\d+(?:\.\d+)?)\s*時間/);
  if (m) return Math.round(Number(m[1]) * 60);
  return null;
}

function extractDistanceKm(text) {
  const t = safeText(text);
  let m = t.match(/(\d+(?:\.\d+)?)\s*km/i);
  if (m) return Number(m[1]);
  m = t.match(/(\d+(?:\.\d+)?)\s*キロ/);
  if (m) return Number(m[1]);
  return null;
}

function extractWeightKg(text) {
  const t = safeText(text);
  const direct = t.match(/(\d+(?:\.\d+)?)\s*(kg|ｋｇ|キロ)/i);
  if (direct) return Number(direct[1]);
  if (/^(\d{2,3}(?:\.\d+)?)$/.test(t)) return Number(t);
  const bodyWeight = t.match(/体重\s*[:：]?\s*(\d+(?:\.\d+)?)/i);
  if (bodyWeight) return Number(bodyWeight[1]);
  return null;
}

function extractBodyFatPercent(text) {
  const t = safeText(text);
  const direct = t.match(/体脂肪(?:率)?\s*[:：]?\s*(\d+(?:\.\d+)?)\s*%?/i);
  if (direct) return Number(direct[1]);
  const percentOnly = t.match(/^(\d{1,2}(?:\.\d+)?)\s*[%％]$/);
  if (percentOnly) return Number(percentOnly[1]);
  return null;
}

function isOnboardingStart(text) {
  const normalized = normalizeLoose(text);
  return ['プロフィール登録', 'プロフィール入力', '初期設定', '無料診断', 'はじめる', '登録したい', '診断したい']
    .some((keyword) => normalized.includes(normalizeLoose(keyword)));
}

function analyzeNewCaptureCandidate(text = '') {
  const raw = safeText(text);
  const weightKg = extractWeightKg(raw);
  const bodyFatPercent = extractBodyFatPercent(raw);

  if (weightKg != null || bodyFatPercent != null) {
    return {
      route: 'body_metrics',
      payload: {
        weight_kg: weightKg,
        body_fat_pct: bodyFatPercent,
      },
    };
  }

  if (['歩いた', 'ジョギング', 'ランニング', 'ウォーキング', '散歩', '筋トレ', 'ストレッチ', 'スクワット', '腕立て'].some((w) => raw.includes(w))) {
    return {
      route: 'record_candidate',
      captureType: 'exercise',
      payload: {
        raw_text: raw,
        duration_min: extractMinutes(raw),
        distance_km: extractDistanceKm(raw),
      },
      missingFields: [],
      replyText: '',
    };
  }

  return { route: 'conversation' };
}

module.exports = {
  safeText,
  normalizeLoose,
  extractMinutes,
  extractDistanceKm,
  extractWeightKg,
  extractBodyFatPercent,
  isOnboardingStart,
  analyzeNewCaptureCandidate,
};
