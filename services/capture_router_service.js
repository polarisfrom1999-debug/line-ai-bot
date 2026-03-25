'use strict';

const ONBOARDING_KEYWORDS = [
  'プロフィール登録',
  'プロフィール入力',
  '初期設定',
  '無料診断',
  'はじめる',
  '登録したい',
  '診断したい',
  'プロフィール変更',
];

const FOOD_QUESTION_HINTS = ['お腹すいた', '空腹', '何食べ', 'なに食べ', '食べていい', 'ラーメン', '夜食', '間食'];

const CONSULTATION_HINTS = [
  '痛い', '痛み', '大丈夫', 'どう思う', 'ダメかな', '不安', '相談', 'つらい', 'しんどい', '違和感', '平気',
  'いいですか', 'していい', 'やっていい', '走っていい', '歩いていい', 'しびれ', '痺れ', '痺れてる', '腫れ',
  '肩が痛い', '腰が痛い', '膝が痛い', '足が痛い', '肩', '腰', '膝', '足', '腕立て', 'スクワット'
];

function safeText(value, fallback = '') {
  return String(value || fallback).trim();
}

function normalizeLoose(text) {
  return safeText(text)
    .toLowerCase()
    .replace(/[！!？?。.,，、]/g, '')
    .replace(/\s+/g, '');
}

function includesAny(text, words = []) {
  return words.some((w) => text.includes(w));
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
  let m = t.match(/体重\s*[:：]?\s*(\d+(?:\.\d+)?)/i);
  if (m) return Number(m[1]);
  m = t.match(/(\d+(?:\.\d+)?)\s*(kg|ｋｇ|キロ)/i);
  if (m) return Number(m[1]);
  return null;
}

function extractBodyFatPercent(text) {
  const t = safeText(text);
  let m = t.match(/体脂肪(?:率)?\s*[:：]?\s*(\d+(?:\.\d+)?)/i);
  if (m) return Number(m[1]);
  m = t.match(/(\d+(?:\.\d+)?)\s*(%|％)/);
  if (m && /体脂肪/.test(t)) return Number(m[1]);
  return null;
}

function isOnboardingStart(text) {
  const normalized = normalizeLoose(text);
  return ONBOARDING_KEYWORDS.some((keyword) => normalized.includes(normalizeLoose(keyword)));
}

function looksLikeConsultation(text) {
  const raw = safeText(text);
  const normalized = normalizeLoose(raw);
  if (!normalized) return false;
  if (includesAny(normalized, FOOD_QUESTION_HINTS.map(normalizeLoose))) return true;
  if (/[?？]/.test(raw)) return true;
  return includesAny(normalized, CONSULTATION_HINTS.map(normalizeLoose));
}

function analyzeNewCaptureCandidate(text = '') {
  const raw = safeText(text);
  const normalized = normalizeLoose(raw);

  if (!raw) return { route: 'empty' };
  if (isOnboardingStart(raw)) return { route: 'onboarding_start' };
  if (looksLikeConsultation(raw)) {
    return { route: 'consultation', replyText: '' };
  }

  const weightKg = extractWeightKg(raw);
  const bodyFatPercent = extractBodyFatPercent(raw);
  if (weightKg != null || bodyFatPercent != null) {
    return {
      route: 'body_metrics',
      type: 'body_metrics',
      payload: {
        weight_kg: weightKg != null ? weightKg : null,
        body_fat_pct: bodyFatPercent != null ? bodyFatPercent : null,
      },
    };
  }

  if (includesAny(normalized, ['歩いた', '歩く', '散歩', 'ウォーキング', 'ジョギング', 'ランニング', '筋トレ', 'ストレッチ', '運動'])) {
    const duration = extractMinutes(raw);
    const distanceKm = extractDistanceKm(raw);
    return {
      route: 'record_candidate',
      captureType: 'exercise',
      payload: {
        raw_text: raw,
        duration_min: duration,
        distance_km: distanceKm,
      },
      missingFields: duration == null && distanceKm == null ? ['duration_or_distance'] : [],
      replyText: duration == null && distanceKm == null
        ? '運動の内容は受け取れています。時間か距離がわかれば、そのまま続けて教えてくださいね。'
        : '運動の内容は受け取れています。',
    };
  }

  return { route: 'conversation' };
}

module.exports = {
  safeText,
  normalizeLoose,
  includesAny,
  extractMinutes,
  extractDistanceKm,
  extractWeightKg,
  extractBodyFatPercent,
  isOnboardingStart,
  looksLikeConsultation,
  analyzeNewCaptureCandidate,
};
