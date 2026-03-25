'use strict';

function safeText(value, fallback = '') {
  return String(value || fallback).trim();
}

function normalizeLoose(text = '') {
  return String(text || '')
    .trim()
    .toLowerCase()
    .replace(/[！!？?。.,，、]/g, '')
    .replace(/[　\s]+/g, '');
}

function includesAny(text = '', patterns = []) {
  return patterns.some((pattern) => {
    if (!pattern) return false;
    if (pattern instanceof RegExp) return pattern.test(text);
    return text.includes(String(pattern));
  });
}

function extractWeightKg(text = '') {
  const raw = safeText(text);
  const explicit = raw.match(/体重\s*[:：]?\s*(\d+(?:\.\d+)?)\s*(?:kg|ｋｇ|キロ)?/i);
  if (explicit) return Number(explicit[1]);
  const only = raw.match(/^(\d+(?:\.\d+)?)\s*(?:kg|ｋｇ|キロ)$/i);
  if (only) return Number(only[1]);
  const plain = raw.match(/^(?:今朝は|今日は|本日)?\s*(\d{2,3}(?:\.\d+)?)$/);
  if (plain) return Number(plain[1]);
  return null;
}

function extractBodyFatPercent(text = '') {
  const raw = safeText(text);
  const explicit = raw.match(/体脂肪(?:率)?\s*[:：]?\s*(\d+(?:\.\d+)?)\s*(?:%|％)?/i);
  if (explicit) return Number(explicit[1]);
  const only = raw.match(/^(\d+(?:\.\d+)?)\s*(?:%|％)$/);
  if (only) return Number(only[1]);
  return null;
}

function extractMinutes(text = '') {
  const raw = safeText(text);
  const hm = raw.match(/(\d+(?:\.\d+)?)\s*時間(?:間)?\s*(\d+(?:\.\d+)?)\s*分/);
  if (hm) return Math.round((Number(hm[1]) * 60 + Number(hm[2])) * 10) / 10;
  const h = raw.match(/(\d+(?:\.\d+)?)\s*時間(?:間)?/);
  if (h) return Math.round(Number(h[1]) * 60 * 10) / 10;
  const m = raw.match(/(\d+(?:\.\d+)?)\s*分/);
  if (m) return Math.round(Number(m[1]) * 10) / 10;
  return null;
}

function extractDistanceKm(text = '') {
  const raw = safeText(text);
  const m = raw.match(/(\d+(?:\.\d+)?)\s*(?:km|ｋｍ|キロ)/i);
  if (m) return Number(m[1]);
  return null;
}

function isOnboardingStart(text = '') {
  const n = normalizeLoose(text);
  return includesAny(n, ['はじめて', '初めて', '使い方', 'ヘルプ', 'メニュー']);
}

function isGraphIntent(text = '') {
  const n = normalizeLoose(text);
  return includesAny(n, ['グラフ', '体重グラフ', '食事活動グラフ', 'hba1cグラフ', 'ldlグラフ']);
}

function isPredictionIntent(text = '') {
  const n = normalizeLoose(text);
  return includesAny(n, ['予測', '体重予測', '見通し', 'このまま続けたら', 'このままだとどうなる']);
}

function looksLikeProfileEditStart(text = '') {
  const n = normalizeLoose(text);
  return includesAny(n, ['プロフィール変更', 'プロフィール編集', 'プロフィール更新']);
}

function looksLikeConsultation(text = '') {
  const raw = safeText(text);
  const n = normalizeLoose(raw);
  if (!n) return false;
  if (/[?？]/.test(raw)) return true;
  return includesAny(n, [
    '痛い', 'しびれ', '違和感', '不安', '相談', '大丈夫', '良いかな', 'いいかな', 'どうしよう',
    '何食べ', 'なに食べ', 'お腹すいた', '空いた', '痩せない', 'つらい', 'しんどい'
  ]);
}

function analyzeNewCaptureCandidate(text = '') {
  const raw = safeText(text);
  const n = normalizeLoose(raw);
  if (!raw) return { route: 'empty' };
  if (looksLikeProfileEditStart(raw)) return { route: 'profile_edit_start' };
  if (isGraphIntent(raw)) return { route: 'graph' };
  if (isPredictionIntent(raw)) return { route: 'prediction' };

  const weightKg = extractWeightKg(raw);
  const bodyFatPct = extractBodyFatPercent(raw);
  if (weightKg != null && bodyFatPct != null) {
    return { route: 'body_metrics', payload: { weight_kg: weightKg, body_fat_pct: bodyFatPct } };
  }
  if (weightKg != null && !includesAny(n, ['グラフ', '予測'])) {
    return { route: 'weight_record', payload: { weight_kg: weightKg } };
  }
  if (bodyFatPct != null) {
    return { route: 'body_fat_record', payload: { body_fat_pct: bodyFatPct } };
  }

  if (includesAny(n, ['ジョギング', 'ランニング', '走った', '歩いた', 'ウォーキング', '散歩', '筋トレ', 'ストレッチ', '運動'])) {
    return { route: 'exercise_candidate' };
  }

  if (includesAny(n, ['食べた', '朝ごはん', '昼ごはん', '夜ごはん', '朝食', '昼食', '夕食', '飲んだ'])) {
    return { route: 'meal_candidate' };
  }

  if (looksLikeConsultation(raw)) {
    return { route: 'consultation' };
  }

  return { route: 'conversation' };
}

module.exports = {
  safeText,
  normalizeLoose,
  includesAny,
  extractWeightKg,
  extractBodyFatPercent,
  extractMinutes,
  extractDistanceKm,
  isOnboardingStart,
  isGraphIntent,
  isPredictionIntent,
  looksLikeProfileEditStart,
  looksLikeConsultation,
  analyzeNewCaptureCandidate,
};
