'use strict';

/**
 * services/capture_router_service.js
 */

const ONBOARDING_KEYWORDS = [
  'プロフィール登録',
  'プロフィール入力',
  '初期設定',
  '無料診断',
  'はじめる',
  '登録したい',
  '診断したい',
];

const FOOD_QUESTION_HINTS = ['お腹すいた', '空腹', '何食べ', 'なに食べ', '食べていい', 'ラーメン', '夜食', '間食'];

const CONSULTATION_HINTS = [
  '痛い',
  '痛み',
  '大丈夫',
  'どう思う',
  'ダメかな',
  '不安',
  '相談',
  'つらい',
  'しんどい',
  '違和感',
  '平気',
  'いいですか',
  'していい',
  'やっていい',
  '走っていい',
  '歩いていい',
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
  const m = t.match(/(\d+(?:\.\d+)?)\s*kg/i);
  if (!m) return null;
  return Number(m[1]);
}

function extractBodyFatPercent(text) {
  const t = safeText(text);
  const m = t.match(/(\d+(?:\.\d+)?)\s*%/);
  if (!m) return null;
  return Number(m[1]);
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
    return {
      route: 'consultation',
      replyText: '',
    };
  }

  const weightKg = extractWeightKg(raw);
  const bodyFatPercent = extractBodyFatPercent(raw);
  if (weightKg != null && bodyFatPercent != null) {
    return {
      route: 'body_metrics',
      type: 'body_metrics',
      payload: {
        weight_kg: weightKg,
        body_fat_pct: bodyFatPercent,
      },
    };
  }

  if (weightKg != null) {
    return {
      route: 'weight_record',
      type: 'weight',
      payload: { weight_kg: weightKg },
    };
  }

  if (bodyFatPercent != null && normalized.includes('体脂肪')) {
    return {
      route: 'body_fat_record',
      type: 'body_fat',
      payload: { body_fat_percent: bodyFatPercent },
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
  isOnboardingStart,
  looksLikeConsultation,
  analyzeNewCaptureCandidate,
};
