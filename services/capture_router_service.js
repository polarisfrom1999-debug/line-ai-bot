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
  '痛い', '痛み', '大丈夫', 'どう思う', 'ダメかな', '不安', '相談', 'つらい', 'しんどい', '違和感',
  '平気', 'いいですか', 'していい', 'やっていい', '走っていい', '歩いていい', '痺れ', 'しびれ', 'むくみ',
  '肩', '腰', '膝', '足', '脚', '腕', '首', '頭痛', '痺れてる', '伏せ', 'スクワット',
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
  if (/^\d{2,3}(?:\.\d+)?$/.test(t)) {
    const n = Number(t);
    if (n >= 20 && n <= 300) return n;
  }
  return null;
}

function extractBodyFatPercent(text) {
  const t = safeText(text);
  let m = t.match(/体脂肪(?:率)?\s*[:：]?\s*(\d+(?:\.\d+)?)/);
  if (m) return Number(m[1]);
  m = t.match(/(\d+(?:\.\d+)?)\s*(%|％)/);
  if (m) return Number(m[1]);
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

function parseBodyMetrics(text = '') {
  const raw = safeText(text);
  if (!raw) return null;
  const normalized = normalizeLoose(raw);
  const hasWeightHint = /体重|kg|ｋｇ|キロ/i.test(raw) || /^\d{2,3}(?:\.\d+)?$/.test(raw);
  const hasBodyFatHint = /体脂肪|%|％/.test(raw);
  if (!hasWeightHint && !hasBodyFatHint) return null;

  const weightKg = hasWeightHint ? extractWeightKg(raw) : null;
  const bodyFatPct = hasBodyFatHint ? extractBodyFatPercent(raw) : null;

  if (!Number.isFinite(weightKg) && !Number.isFinite(bodyFatPct)) return null;

  if (Number.isFinite(bodyFatPct) && !Number.isFinite(weightKg) && !normalized.includes('体脂肪') && !/[％%]/.test(raw)) {
    return null;
  }

  return {
    weight_kg: Number.isFinite(weightKg) ? Math.round(weightKg * 10) / 10 : null,
    body_fat_pct: Number.isFinite(bodyFatPct) ? Math.round(bodyFatPct * 10) / 10 : null,
    source_text: raw,
  };
}

function analyzeNewCaptureCandidate(text = '') {
  const raw = safeText(text);
  const normalized = normalizeLoose(raw);

  if (!raw) return { route: 'empty' };
  if (isOnboardingStart(raw)) return { route: 'onboarding_start' };

  const metrics = parseBodyMetrics(raw);
  if (metrics) {
    return {
      route: 'body_metrics',
      type: 'body_metrics',
      payload: metrics,
    };
  }

  if (looksLikeConsultation(raw)) {
    return {
      route: 'consultation',
      replyText: '',
    };
  }

  if (includesAny(normalized, ['歩いた', '歩く', '散歩', 'ウォーキング', 'ジョギング', 'ランニング', '筋トレ', 'ストレッチ', '運動'])) {
    const duration = extractMinutes(raw);
    const distanceKm = extractDistanceKm(raw);
    const missingFields = [];
    if (duration == null && distanceKm == null) missingFields.push('duration_or_distance');

    return {
      route: 'record_candidate',
      captureType: 'exercise',
      payload: {
        activity: null,
        duration_min: duration,
        distance_km: distanceKm,
        source_text: raw,
      },
      missingFields,
      replyText: missingFields.length
        ? '運動の内容は受け取れています。時間か距離がわかれば、そのまま続けて教えてくださいね。'
        : '運動の内容は受け取れています。このまま今日の記録として残して大丈夫ですか？',
    };
  }

  if (includesAny(normalized, ['食べた', '食事', '朝ごはん', '昼ごはん', '夜ごはん', '朝食', '昼食', '夕食', '飲んだ', 'ラーメン', 'パン', 'おにぎり'])) {
    return {
      route: 'record_candidate',
      captureType: 'meal',
      payload: {
        raw_text: raw,
        source_text: raw,
      },
      missingFields: [],
      replyText: '食事の内容は受け取れています。今日の記録としてまとめてよければ保存しますか？違うところだけ、そのまま教えても大丈夫です。',
    };
  }

  return {
    route: 'conversation',
    replyText: '',
  };
}

module.exports = {
  safeText,
  normalizeLoose,
  extractMinutes,
  extractDistanceKm,
  extractWeightKg,
  extractBodyFatPercent,
  parseBodyMetrics,
  isOnboardingStart,
  looksLikeConsultation,
  analyzeNewCaptureCandidate,
};
