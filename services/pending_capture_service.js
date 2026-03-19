'use strict';

/**
 * services/pending_capture_service.js
 *
 * 役割:
 * - pending capture の開始
 * - pending capture への回答結合
 * - 保存可能か判定
 * - pending解除
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
    user.pending_capture_status === 'awaiting_clarification' &&
    !!user.pending_capture_payload
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
    if (
      normalized.includes('ジョギング') ||
      normalized.includes('ランニング') ||
      normalized.includes('走った') ||
      normalized.includes('走る')
    ) {
      merged.activity = 'jogging';
    } else if (
      normalized.includes('ウォーキング') ||
      normalized.includes('歩いた') ||
      normalized.includes('歩く') ||
      normalized.includes('散歩')
    ) {
      merged.activity = 'walking';
    } else if (
      normalized.includes('筋トレ') ||
      normalized.includes('トレーニング') ||
      normalized.includes('スクワット')
    ) {
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
  const weightKg = extractWeightKg(replyText);
  if (weightKg != null) merged.weight_kg = weightKg;
  return merged;
}

function mergeBodyFatReply(payload = {}, replyText = '') {
  const merged = { ...payload };
  const bodyFat = extractBodyFatPercent(replyText);
  if (bodyFat != null) merged.body_fat_percent = bodyFat;
  return merged;
}

function getMissingFields(captureType, payload = {}) {
  if (captureType === 'exercise') {
    const missing = [];
    if (!payload.activity) missing.push('activity');
    if (!payload.duration_min) missing.push('duration_min');
    return missing;
  }

  if (captureType === 'meal') {
    const missing = [];
    const raw = safeText(payload.raw_text);
    if (!raw) missing.push('food_items');
    return missing;
  }

  if (captureType === 'weight') {
    return payload.weight_kg == null ? ['weight_kg'] : [];
  }

  if (captureType === 'body_fat') {
    return payload.body_fat_percent == null ? ['body_fat_percent'] : [];
  }

  return [];
}

function mergePendingCaptureReply(user = {}, replyText = '') {
  const captureType = user.pending_capture_type;
  const currentPayload = user.pending_capture_payload || {};
  let mergedPayload = { ...currentPayload };

  if (captureType === 'exercise') {
    mergedPayload = mergeExerciseReply(currentPayload, replyText);
  } else if (captureType === 'meal') {
    mergedPayload = mergeMealReply(currentPayload, replyText);
  } else if (captureType === 'weight') {
    mergedPayload = mergeWeightReply(currentPayload, replyText);
  } else if (captureType === 'body_fat') {
    mergedPayload = mergeBodyFatReply(currentPayload, replyText);
  }

  const missingFields = getMissingFields(captureType, mergedPayload);
  const isReadyToSave = missingFields.length === 0;

  return {
    captureType,
    payload: mergedPayload,
    missingFields,
    isReadyToSave,
  };
}

function buildRetryPrompt(captureType, payload = {}, missingFields = []) {
  if (captureType === 'exercise') {
    if (missingFields.includes('activity')) {
      return 'どんな運動だったか教えてください。ジョギング、ウォーキング、筋トレなど、ざっくりで大丈夫です。';
    }
    if (missingFields.includes('duration_min')) {
      return '何分くらいだったか教えてください。ざっくりで大丈夫です。';
    }
  }

  if (captureType === 'meal') {
    return '何を食べたか1〜2品だけ教えてください。ざっくりで大丈夫です。';
  }

  if (captureType === 'weight') {
    return '何kgだったか教えてください。';
  }

  if (captureType === 'body_fat') {
    return '何％だったか教えてください。';
  }

  return 'もう少しだけ教えてください。';
}

function updateUserWithPendingResult(user = {}, pendingResult = {}, replyText = '') {
  if (!pendingResult || !pendingResult.captureType) {
    return clearPendingCapture(user);
  }

  if (pendingResult.isReadyToSave) {
    return {
      ...user,
      pending_capture_type: pendingResult.captureType,
      pending_capture_status: 'ready_to_save',
      pending_capture_payload: pendingResult.payload,
      pending_capture_missing_fields: [],
      pending_capture_prompt: null,
      pending_capture_started_at: user.pending_capture_started_at || nowIso(),
      pending_capture_source_text: user.pending_capture_source_text || safeText(replyText),
      pending_capture_attempts: Number(user.pending_capture_attempts || 0),
    };
  }

  return {
    ...user,
    pending_capture_type: pendingResult.captureType,
    pending_capture_status: 'awaiting_clarification',
    pending_capture_payload: pendingResult.payload,
    pending_capture_missing_fields: pendingResult.missingFields,
    pending_capture_prompt: buildRetryPrompt(
      pendingResult.captureType,
      pendingResult.payload,
      pendingResult.missingFields
    ),
    pending_capture_started_at: user.pending_capture_started_at || nowIso(),
    pending_capture_source_text: user.pending_capture_source_text || safeText(replyText),
    pending_capture_attempts: Number(user.pending_capture_attempts || 0) + 1,
  };
}

module.exports = {
  createPendingCapture,
  clearPendingCapture,
  hasPendingCapture,
  mergePendingCaptureReply,
  updateUserWithPendingResult,
  buildRetryPrompt,
};
