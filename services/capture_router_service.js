'use strict';

/**
 * services/capture_router_service.js
 * 相談優先 / プロフィール変更入口 / 画像文脈入口 / 記録候補の一次ルーター
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

const PROFILE_EDIT_KEYWORDS = [
  'プロフィール変更',
  'プロフィール修正',
  'プロフィール更新',
  'プロフィールを変えたい',
  'プロフィール直したい',
  '身長を変えたい',
  '年齢を変えたい',
  '体重を変えたい',
  '目標体重を変えたい',
  '活動量を変えたい',
];

const MEMORY_HINTS = [
  '私の名前覚えてる',
  '名前覚えてる',
  '覚えてる',
  '前に何て言ったっけ',
  '前に何て言った',
  '前に話した',
  '前の話',
];

const FOOD_QUESTION_HINTS = ['お腹すいた', '空腹', '何食べ', 'なに食べ', '食べていい', '夜食', '間食', 'ラーメン'];
const CONSULTATION_HINTS = [
  '痛い', '痛み', '頭痛', '腰痛', '膝痛', '不安', '相談', 'つらい', 'しんどい', '違和感',
  '大丈夫', '平気', 'いいですか', 'していい', 'やっていい', '走っていい', '歩いていい',
  '食べていい', 'どう思う', 'かな', '悩み', '気になる'
];
const EXERCISE_HINTS = ['歩いた', '歩く', '散歩', 'ウォーキング', 'ジョギング', 'ランニング', '筋トレ', 'ストレッチ', '運動'];
const MEAL_HINTS = ['食べた', '食事', '朝ごはん', '昼ごはん', '夜ごはん', '朝食', '昼食', '夕食', '飲んだ', 'パン', 'おにぎり', 'ご飯'];

function safeText(value, fallback = '') {
  return String(value || fallback).trim();
}

function normalizeLoose(text = '') {
  return safeText(text)
    .toLowerCase()
    .replace(/[！!？?。.,，、]/g, '')
    .replace(/\s+/g, '');
}

function includesAny(text = '', words = []) {
  return words.some((w) => text.includes(normalizeLoose(w)));
}

function extractMinutes(text = '') {
  const t = safeText(text);
  let m = t.match(/(\d+)\s*時間\s*(\d+)\s*分/);
  if (m) return Number(m[1]) * 60 + Number(m[2]);
  m = t.match(/(\d+(?:\.\d+)?)\s*分/);
  if (m) return Number(m[1]);
  m = t.match(/(\d+(?:\.\d+)?)\s*時間/);
  if (m) return Math.round(Number(m[1]) * 60);
  return null;
}

function extractDistanceKm(text = '') {
  const t = safeText(text);
  let m = t.match(/(\d+(?:\.\d+)?)\s*km/i);
  if (m) return Number(m[1]);
  m = t.match(/(\d+(?:\.\d+)?)\s*キロ/);
  if (m) return Number(m[1]);
  return null;
}

function extractWeightKg(text = '') {
  const t = safeText(text);
  const m = t.match(/(\d+(?:\.\d+)?)\s*(kg|ｋｇ|キロ)/i);
  if (!m) return null;
  return Number(m[1]);
}

function extractBodyFatPercent(text = '') {
  const t = safeText(text);
  const m = t.match(/(\d+(?:\.\d+)?)\s*(%|％)/);
  if (!m) return null;
  return Number(m[1]);
}

function isOnboardingStart(text = '') {
  const normalized = normalizeLoose(text);
  return ONBOARDING_KEYWORDS.some((keyword) => normalized.includes(normalizeLoose(keyword)));
}

function isProfileEditStart(text = '') {
  const normalized = normalizeLoose(text);
  return PROFILE_EDIT_KEYWORDS.some((keyword) => normalized.includes(normalizeLoose(keyword)));
}

function isMemoryIntent(text = '') {
  const normalized = normalizeLoose(text);
  return MEMORY_HINTS.some((keyword) => normalized.includes(normalizeLoose(keyword)));
}

function looksLikeConsultation(text = '') {
  const raw = safeText(text);
  const normalized = normalizeLoose(raw);
  if (!normalized) return false;
  if (includesAny(normalized, FOOD_QUESTION_HINTS)) return true;
  if (/[?？]/.test(raw)) return true;
  return includesAny(normalized, CONSULTATION_HINTS);
}

function looksLikeSimpleWeightRecord(text = '') {
  const raw = safeText(text);
  const normalized = normalizeLoose(raw);
  if (!raw) return false;
  if (looksLikeConsultation(raw)) return false;
  return /^(体重)?\s*\d{2,3}(?:\.\d+)?\s*(kg|ｋｇ|キロ)?$/.test(raw) ||
    (/体重/.test(raw) && !!extractWeightKg(raw)) ||
    (!!extractWeightKg(raw) && !includesAny(normalized, ['身長', '年齢', '目標']));
}

function looksLikeSimpleBodyFatRecord(text = '') {
  const raw = safeText(text);
  if (!raw) return false;
  if (looksLikeConsultation(raw)) return false;
  return /^(体脂肪(率)?)?\s*\d{1,2}(?:\.\d+)?\s*(%|％)$/.test(raw) ||
    (/体脂肪/.test(raw) && !!extractBodyFatPercent(raw));
}

function detectImageContextIntent(text = '') {
  const normalized = normalizeLoose(text);
  if (!normalized) return null;
  if (includesAny(normalized, ['食事の写真', 'ごはんの写真', 'ご飯の写真', '食事です', 'ごはんです', '料理です'])) return 'meal_image';
  if (includesAny(normalized, ['血液検査', '検査結果', '採血結果', '健診結果', '健康診断'])) return 'blood_test_image';
  if (includesAny(normalized, ['相談したい', 'これどう', 'みてほしい', '見てほしい', '痛いところ', '腫れてる', '傷'])) return 'consult_image';
  return null;
}

function analyzeNewCaptureCandidate(text = '') {
  const raw = safeText(text);
  const normalized = normalizeLoose(raw);

  if (!raw) return { route: 'empty' };
  if (isOnboardingStart(raw)) return { route: 'onboarding_start' };
  if (isProfileEditStart(raw)) return { route: 'profile_edit_start' };
  if (isMemoryIntent(raw)) return { route: 'memory_question' };

  const imageIntent = detectImageContextIntent(raw);
  if (imageIntent) {
    return {
      route: 'image_context',
      imageIntent,
      replyText:
        imageIntent === 'meal_image'
          ? 'ありがとうございます。食事の写真として受け取りました。補足があれば一言だけ続けて送ってくださいね。'
          : imageIntent === 'blood_test_image'
          ? 'ありがとうございます。血液検査の画像として見ていきます。日付や気になる項目があれば続けて送ってくださいね。'
          : 'ありがとうございます。相談の画像として受け取りました。どこが気になるか一言だけ続けてくださいね。',
    };
  }

  if (looksLikeConsultation(raw)) {
    return { route: 'consultation', replyText: '' };
  }

  const weightKg = extractWeightKg(raw);
  const bodyFatPercent = extractBodyFatPercent(raw);
  if (looksLikeSimpleWeightRecord(raw) && weightKg != null && bodyFatPercent != null) {
    return {
      route: 'body_metrics',
      type: 'body_metrics',
      payload: { weight_kg: weightKg, body_fat_pct: bodyFatPercent, source_text: raw },
    };
  }

  if (looksLikeSimpleWeightRecord(raw) && weightKg != null) {
    return { route: 'weight_record', type: 'weight', payload: { weight_kg: weightKg, source_text: raw } };
  }

  if (looksLikeSimpleBodyFatRecord(raw) && bodyFatPercent != null) {
    return { route: 'body_fat_record', type: 'body_fat', payload: { body_fat_pct: bodyFatPercent, source_text: raw } };
  }

  if (includesAny(normalized, EXERCISE_HINTS)) {
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

  if (includesAny(normalized, MEAL_HINTS)) {
    return {
      route: 'record_candidate',
      captureType: 'meal',
      payload: { raw_text: raw, source_text: raw },
      missingFields: [],
      replyText: '食事の内容は受け取れています。今日の記録としてまとめてよければ保存しますか？違うところだけ、そのまま教えても大丈夫です。',
    };
  }

  return { route: 'conversation', replyText: '' };
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
  isProfileEditStart,
  isMemoryIntent,
  looksLikeConsultation,
  looksLikeSimpleWeightRecord,
  looksLikeSimpleBodyFatRecord,
  detectImageContextIntent,
  analyzeNewCaptureCandidate,
};
