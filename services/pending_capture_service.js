'use strict';

/**
 * services/pending_capture_service.js
 */

const {
  safeText,
  extractMinutes,
  extractDistanceKm,
  extractWeightKg,
  extractBodyFatPercent,
  normalizeLoose,
} = require('./capture_router_service');

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
  return (
    !!user.pending_capture_type &&
    user.pending_capture_status === 'awaiting_clarification'
  );
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
    if (normalized.includes('ジョギング') || normalized.includes('ランニング') || normalized.includes('走った') || normalized.includes('走る')) {
      merged.activity = 'jogging';
    } else if (normalized.includes('ウォーキング') || normalized.includes('歩いた') || normalized.includes('歩く') || normalized.includes('散歩')) {
      merged.activity = 'walking';
    } else if (normalized.includes('筋トレ') || normalized.includes('トレーニング') || normalized.includes('スクワット')) {
      merged.activity = 'strength_training';
    }
  }

  return merged;
}

function mergeMealReply(payload = {}, replyText = '') {
  const merged = { ...payload };
  const text = safeText(replyText);

  if (!merged.raw_text) {
    merged.raw_text = text;
  } else {
    merged.raw_text = `${safeText(merged.raw_text)} / ${text}`.trim();
  }

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
  if (!merged.raw_text) {
    merged.raw_text = text;
  } else {
    merged.raw_text = `${safeText(merged.raw_text)} / ${text}`.trim();
  }
  return merged;
}

function resolveMissingFields(captureType = '', payload = {}) {
  if (captureType === 'exercise') {
    const missing = [];
    if (!payload.duration_min && !payload.distance_km) missing.push('duration_or_distance');
    return missing;
  }
  if (captureType === 'weight' || captureType === 'body_metrics') {
    const missing = [];
    if (!payload.weight_kg && !payload.body_fat_pct) missing.push('weight_or_body_fat');
    return missing;
  }
  return [];
}

function buildPendingReply(captureType = '', missingFields = []) {
  if (!missingFields.length) {
    if (captureType === 'exercise') {
      return '運動の内容は受け取れています。このまま今日の記録として残して大丈夫ですか？';
    }
    if (captureType === 'meal') {
      return '食事の内容は受け取れています。今日の記録としてまとめてよければ保存しますか？違うところだけ、そのまま教えても大丈夫です。';
    }
    if (captureType === 'weight' || captureType === 'body_metrics') {
      return '体重や体脂肪率の内容は受け取れています。このまま記録して大丈夫ですか？';
    }
    if (captureType === 'profile_edit') {
      return 'プロフィールの内容は受け取れています。';
    }
    return '内容は受け取れています。このまま進めて大丈夫ですか？';
  }

  if (captureType === 'exercise') {
    return '運動の内容は受け取れています。時間か距離がわかれば、そのまま続けて教えてくださいね。';
  }
  if (captureType === 'weight' || captureType === 'body_metrics') {
    return '体重か体脂肪率の数字がわかれば、そのまま送ってくださいね。';
  }
  if (captureType === 'profile_edit') {
    return '変えたい項目をそのまま送ってください。例: 身長160 / 55歳 / 体重62';
  }
  return '不足しているところだけ、そのまま教えてくださいね。';
}

function mergePendingCaptureReply(user = {}, replyText = '') {
  if (!hasPendingCapture(user)) {
    return {
      readyToSave: false,
      userPatch: user,
      replyText: '',
      captureType: null,
      payload: null,
    };
  }

  const captureType = safeText(user.pending_capture_type);
  const payload = user.pending_capture_payload || {};

  let mergedPayload = { ...payload };
  if (captureType === 'exercise') mergedPayload = mergeExerciseReply(payload, replyText);
  else if (captureType === 'meal') mergedPayload = mergeMealReply(payload, replyText);
  else if (captureType === 'weight' || captureType === 'body_metrics') mergedPayload = mergeWeightReply(payload, replyText);
  else if (captureType === 'blood_test') mergedPayload = mergeBloodTestReply(payload, replyText);

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
  return {
    ...currentUser,
    ...pendingResult.userPatch,
  };
}

module.exports = {
  createPendingCapture,
  clearPendingCapture,
  hasPendingCapture,
  mergePendingCaptureReply,
  updateUserWithPendingResult,
};
