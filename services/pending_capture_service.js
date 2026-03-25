'use strict';

/**
 * services/pending_capture_service.js
 */

const profileService = require('./profile_service');

function safeText(value, fallback = '') {
  return String(value || fallback).trim();
}

function normalizeLoose(text = '') {
  return safeText(text)
    .toLowerCase()
    .replace(/[！!？?。.,，、]/g, '')
    .replace(/\s+/g, '');
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

function nowIso() {
  return new Date().toISOString();
}

function createPendingCapture(user = {}, options = {}) {
  const payload = options.payload || {};
  const missingFields = Array.isArray(options.missingFields) ? options.missingFields : [];

  return {
    ...user,
    pending_capture_type: options.captureType || null,
    pending_capture_status: 'awaiting_clarification',
    pending_capture_payload: payload,
    pending_capture_missing_fields: missingFields,
    pending_capture_prompt: safeText(options.replyText),
    pending_capture_started_at: nowIso(),
    pending_capture_source_text: safeText(options.sourceText || payload.source_text || ''),
    pending_capture_attempts: Number(user.pending_capture_attempts || 0) + 1,
  };
}

function clearPendingCapture(user = {}) {
  return {
    ...user,
    pending_capture_type: null,
    pending_capture_status: null,
    pending_capture_payload: null,
    pending_capture_missing_fields: null,
    pending_capture_prompt: null,
    pending_capture_started_at: null,
    pending_capture_source_text: null,
    pending_capture_attempts: 0,
  };
}

function hasPendingCapture(user = {}) {
  return !!user.pending_capture_type && user.pending_capture_status === 'awaiting_clarification';
}

function mergeExerciseReply(payload = {}, replyText = '') {
  const merged = { ...payload };
  const text = safeText(replyText);

  if (!merged.duration_min) {
    const minutes = extractMinutes(text);
    if (minutes != null) merged.duration_min = minutes;
  }
  if (!merged.distance_km) {
    const distanceKm = extractDistanceKm(text);
    if (distanceKm != null) merged.distance_km = distanceKm;
  }

  const normalized = normalizeLoose(text);
  if (!merged.activity) {
    if (normalized.includes('ジョギング') || normalized.includes('ランニング') || normalized.includes('走った') || normalized.includes('走る')) merged.activity = 'jogging';
    else if (normalized.includes('ウォーキング') || normalized.includes('歩いた') || normalized.includes('歩く') || normalized.includes('散歩')) merged.activity = 'walking';
    else if (normalized.includes('筋トレ') || normalized.includes('トレーニング') || normalized.includes('スクワット')) merged.activity = 'strength_training';
  }

  return merged;
}

function mergeMealReply(payload = {}, replyText = '') {
  const merged = { ...payload };
  const text = safeText(replyText);
  merged.raw_text = merged.raw_text ? `${safeText(merged.raw_text)} / ${text}`.trim() : text;
  return merged;
}

function mergeWeightReply(payload = {}, replyText = '') {
  const merged = { ...payload };
  const text = safeText(replyText);
  if (!merged.weight_kg) {
    const weightKg = extractWeightKg(text);
    if (weightKg != null) merged.weight_kg = weightKg;
  }
  if (!merged.body_fat_pct) {
    const bodyFatPercent = extractBodyFatPercent(text);
    if (bodyFatPercent != null) merged.body_fat_pct = bodyFatPercent;
  }
  return merged;
}

function mergeBloodTestReply(payload = {}, replyText = '') {
  const merged = { ...payload };
  const text = safeText(replyText);
  merged.raw_text = merged.raw_text ? `${safeText(merged.raw_text)} / ${text}`.trim() : text;
  return merged;
}

function mergeProfileEditReply(payload = {}, replyText = '', currentUser = {}) {
  const updates = profileService.buildProfileUpdatePayload(currentUser, replyText);
  return {
    ...payload,
    updates: updates || null,
    raw_text: safeText(replyText),
  };
}

function detectImageContextIntent(text = '') {
  const normalized = normalizeLoose(text);
  if (!normalized) return null;
  if (['食事の写真', 'ごはんの写真', 'ご飯の写真', '食事です', 'ごはんです', '料理です'].some((w) => normalized.includes(normalizeLoose(w)))) return 'meal_image';
  if (['血液検査', '検査結果', '採血結果', '健診結果', '健康診断'].some((w) => normalized.includes(normalizeLoose(w)))) return 'blood_test_image';
  if (['相談したい', 'これどう', '見てほしい', 'みてほしい', '痛いところ', '腫れてる'].some((w) => normalized.includes(normalizeLoose(w)))) return 'consult_image';
  return null;
}

function mergeImageContextReply(payload = {}, replyText = '') {
  const intent = detectImageContextIntent(replyText);
  return {
    ...payload,
    image_intent: intent,
    raw_text: safeText(replyText),
  };
}

function resolveMissingFields(captureType = '', payload = {}) {
  if (captureType === 'exercise') {
    const missing = [];
    if (!payload.duration_min && !payload.distance_km) missing.push('duration_or_distance');
    return missing;
  }
  if (captureType === 'weight' || captureType === 'body_metrics') {
    const missing = [];
    if (!payload.weight_kg) missing.push('weight_kg');
    return missing;
  }
  if (captureType === 'profile_edit') {
    return payload.updates ? [] : ['profile_value'];
  }
  if (captureType === 'image_context') {
    return payload.image_intent ? [] : ['image_context'];
  }
  return [];
}

function buildPendingReply(captureType = '', missingFields = []) {
  if (!missingFields.length) {
    if (captureType === 'exercise') return '運動の内容は受け取れています。このまま今日の記録として残して大丈夫ですか？';
    if (captureType === 'meal') return '食事の内容は受け取れています。今日の記録としてまとめてよければ保存しますか？違うところだけ、そのまま教えても大丈夫です。';
    if (captureType === 'weight' || captureType === 'body_metrics') return '体重の内容は受け取れています。このまま記録して大丈夫ですか？';
    if (captureType === 'profile_edit') return 'プロフィール変更を受け取れました。';
    if (captureType === 'image_context') return '画像の文脈を受け取れました。';
    return '内容は受け取れています。このまま進めて大丈夫ですか？';
  }

  if (captureType === 'exercise') return '運動の内容は受け取れています。時間か距離がわかれば、そのまま続けて教えてくださいね。';
  if (captureType === 'weight' || captureType === 'body_metrics') return '体重の数字がわかれば、そのまま送ってくださいね。';
  if (captureType === 'profile_edit') return '直したい項目をそのまま送ってください。例: 身長 160 / 年齢 55 / 目標体重 58';
  if (captureType === 'image_context') return '画像について、食事・血液検査・相談 のどれかをそのまま送ってくださいね。';
  return '不足しているところだけ、そのまま教えてくださいね。';
}

function mergePendingCaptureReply(user = {}, replyText = '') {
  if (!hasPendingCapture(user)) {
    return { readyToSave: false, userPatch: user, replyText: '', captureType: null, payload: null };
  }

  const captureType = safeText(user.pending_capture_type);
  const payload = user.pending_capture_payload || {};
  let mergedPayload = { ...payload };

  if (captureType === 'exercise') mergedPayload = mergeExerciseReply(payload, replyText);
  else if (captureType === 'meal') mergedPayload = mergeMealReply(payload, replyText);
  else if (captureType === 'weight' || captureType === 'body_metrics') mergedPayload = mergeWeightReply(payload, replyText);
  else if (captureType === 'blood_test') mergedPayload = mergeBloodTestReply(payload, replyText);
  else if (captureType === 'profile_edit') mergedPayload = mergeProfileEditReply(payload, replyText, user);
  else if (captureType === 'image_context') mergedPayload = mergeImageContextReply(payload, replyText);

  const missingFields = resolveMissingFields(captureType, mergedPayload);
  const readyToSave = missingFields.length === 0;

  const nextUser = readyToSave
    ? clearPendingCapture(user)
    : {
        ...user,
        pending_capture_payload: mergedPayload,
        pending_capture_missing_fields: missingFields,
        pending_capture_prompt: buildPendingReply(captureType, missingFields),
        pending_capture_attempts: Number(user.pending_capture_attempts || 0) + 1,
      };

  return {
    readyToSave,
    userPatch: nextUser,
    replyText: buildPendingReply(captureType, missingFields),
    captureType,
    payload: mergedPayload,
  };
}

function updateUserWithPendingResult(currentUser = {}, pendingResult = {}) {
  if (!pendingResult || typeof pendingResult !== 'object') return currentUser;
  return { ...currentUser, ...pendingResult.userPatch };
}

module.exports = {
  createPendingCapture,
  clearPendingCapture,
  hasPendingCapture,
  mergePendingCaptureReply,
  updateUserWithPendingResult,
};
