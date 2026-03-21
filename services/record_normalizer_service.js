'use strict';

/**
 * services/record_normalizer_service.js
 *
 * 目的:
 * - 食事 / 運動 / 体重 / 体脂肪 / 血液検査 を共通形式へ寄せる
 * - 後段の保存確認UIや週報作成で扱いやすくする
 */

function safeText(value, fallback = '') {
  return String(value || fallback).trim();
}

function toNumberOrNull(value) {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(String(value).replace(/[^\d.\-]/g, ''));
  return Number.isFinite(n) ? n : null;
}

function normalizeRecordType(type = '') {
  const v = safeText(type).toLowerCase();

  if (['meal', 'food', 'dish'].includes(v)) return 'meal';
  if (['exercise', 'workout', 'activity', 'stretch'].includes(v)) return 'exercise';
  if (['weight', 'body_weight'].includes(v)) return 'weight';
  if (['body_fat', 'bodyfat', 'fat'].includes(v)) return 'body_fat';
  if (['blood_test', 'lab', 'blood'].includes(v)) return 'blood_test';

  return 'unknown';
}

function buildUserFacingSummary(payload = {}) {
  const type = normalizeRecordType(payload.type);

  if (type === 'meal') {
    const label = safeText(payload.meal_label || payload.label || '食事');
    const kcal = toNumberOrNull(payload.estimated_kcal);
    return kcal !== null ? `${label} / ${kcal} kcal` : label;
  }

  if (type === 'exercise') {
    const name = safeText(payload.exercise_name || payload.label || '運動');
    const minutes = toNumberOrNull(payload.duration_minutes);
    return minutes !== null ? `${name} / ${minutes}分` : name;
  }

  if (type === 'weight') {
    const weight = toNumberOrNull(payload.weight_kg);
    return weight !== null ? `体重 ${weight}kg` : '体重';
  }

  if (type === 'body_fat') {
    const bodyFat = toNumberOrNull(payload.body_fat_percent);
    return bodyFat !== null ? `体脂肪率 ${bodyFat}%` : '体脂肪率';
  }

  if (type === 'blood_test') {
    const date = safeText(payload.exam_date || payload.measured_on || '');
    return date ? `血液検査 ${date}` : '血液検査';
  }

  return safeText(payload.label || payload.summary || '記録');
}

function normalizeRecordCandidate(raw = {}) {
  const type = normalizeRecordType(raw.type || raw.record_type || raw.kind);
  const confidence = Number.isFinite(Number(raw.confidence)) ? Number(raw.confidence) : 0.5;
  const needsConfirmation = raw.needs_confirmation !== false;
  const source = safeText(raw.source || 'text');
  const parsedPayload = raw.parsed_payload || raw.payload || {};
  const userFacingSummary = safeText(
    raw.user_facing_summary || buildUserFacingSummary({ ...parsedPayload, type }),
    ''
  );

  return {
    type,
    confidence,
    needs_confirmation: needsConfirmation,
    source,
    parsed_payload: {
      ...parsedPayload,
      type,
    },
    user_facing_summary: userFacingSummary,
    save_action: safeText(raw.save_action || `save_${type}`),
    meta: raw.meta || {},
  };
}

function normalizeRecordCandidates(list = []) {
  if (!Array.isArray(list)) return [];
  return list
    .map((item) => normalizeRecordCandidate(item))
    .filter((item) => item.type !== 'unknown');
}

module.exports = {
  safeText,
  toNumberOrNull,
  normalizeRecordType,
  buildUserFacingSummary,
  normalizeRecordCandidate,
  normalizeRecordCandidates,
};
