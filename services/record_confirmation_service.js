'use strict';

/**
 * services/record_confirmation_service.js
 *
 * 目的:
 * - 共通 record candidate から保存前確認文を作る
 * - index.js 側で record type ごとの条件分岐を減らす
 */

const {
  safeText,
  toNumberOrNull,
  normalizeRecordCandidate,
} = require('./record_normalizer_service');

function buildQuickReplies(items = []) {
  return (Array.isArray(items) ? items : [])
    .filter(Boolean)
    .map((item) => ({ type: 'action', action: { type: 'message', label: item, text: item } }));
}

function buildMealConfirmation(candidate) {
  const payload = candidate.parsed_payload || {};
  const lines = [];

  lines.push(`食事内容を整理しました。`);
  if (payload.meal_label) lines.push(`料理: ${safeText(payload.meal_label)}`);

  const kcal = toNumberOrNull(payload.estimated_kcal);
  if (kcal !== null) {
    const kcalMin = toNumberOrNull(payload.kcal_min);
    const kcalMax = toNumberOrNull(payload.kcal_max);
    if (kcalMin !== null && kcalMax !== null) {
      lines.push(`推定カロリー: ${kcal} kcal（${kcalMin}〜${kcalMax} kcal）`);
    } else {
      lines.push(`推定カロリー: ${kcal} kcal`);
    }
  }

  const protein = toNumberOrNull(payload.protein_g);
  const fat = toNumberOrNull(payload.fat_g);
  const carbs = toNumberOrNull(payload.carbs_g);

  if (protein !== null || fat !== null || carbs !== null) {
    lines.push(
      `栄養の目安: ` +
      [
        protein !== null ? `たんぱく質 ${protein}g` : null,
        fat !== null ? `脂質 ${fat}g` : null,
        carbs !== null ? `糖質 ${carbs}g` : null,
      ].filter(Boolean).join(' / ')
    );
  }

  lines.push(`合っていれば「保存」、違うところがあればそのまま訂正してくださいね。`);

  return {
    text: lines.join('\n'),
    quickReplies: buildQuickReplies(['保存', '訂正する']),
  };
}

function buildExerciseConfirmation(candidate) {
  const payload = candidate.parsed_payload || {};
  const lines = ['運動内容を整理しました。'];

  if (payload.exercise_name) lines.push(`内容: ${safeText(payload.exercise_name)}`);
  if (toNumberOrNull(payload.duration_minutes) !== null) {
    lines.push(`時間: ${toNumberOrNull(payload.duration_minutes)}分`);
  }
  if (toNumberOrNull(payload.estimated_kcal_burn) !== null) {
    lines.push(`消費カロリーの目安: ${toNumberOrNull(payload.estimated_kcal_burn)} kcal`);
  }

  lines.push(`合っていれば「保存」、違うところがあればそのまま訂正してください。`);

  return {
    text: lines.join('\n'),
    quickReplies: buildQuickReplies(['保存', '訂正する']),
  };
}

function buildWeightConfirmation(candidate) {
  const payload = candidate.parsed_payload || {};
  const weight = toNumberOrNull(payload.weight_kg);

  return {
    text: weight !== null
      ? `体重 ${weight}kg として受け取りました。合っていれば「保存」で大丈夫です。`
      : `体重の記録として受け取りました。合っていれば「保存」で進めます。`,
    quickReplies: buildQuickReplies(['保存', '訂正する']),
  };
}

function buildBodyFatConfirmation(candidate) {
  const payload = candidate.parsed_payload || {};
  const value = toNumberOrNull(payload.body_fat_percent);

  return {
    text: value !== null
      ? `体脂肪率 ${value}% として受け取りました。合っていれば「保存」で大丈夫です。`
      : `体脂肪率の記録として受け取りました。合っていれば「保存」で進めます。`,
    quickReplies: buildQuickReplies(['保存', '訂正する']),
  };
}

function buildBloodTestConfirmation(candidate) {
  const payload = candidate.parsed_payload || {};
  const examDate = safeText(payload.exam_date || '');

  return {
    text: examDate
      ? `血液検査 ${examDate} の内容として整理しました。合っていれば「保存」で進めます。`
      : `血液検査の内容として整理しました。合っていれば「保存」で進めます。`,
    quickReplies: buildQuickReplies(['保存', '訂正する']),
  };
}

function buildConfirmationMessage(rawCandidate = {}) {
  const candidate = normalizeRecordCandidate(rawCandidate);

  if (candidate.type === 'meal') return buildMealConfirmation(candidate);
  if (candidate.type === 'exercise') return buildExerciseConfirmation(candidate);
  if (candidate.type === 'weight') return buildWeightConfirmation(candidate);
  if (candidate.type === 'body_fat') return buildBodyFatConfirmation(candidate);
  if (candidate.type === 'blood_test') return buildBloodTestConfirmation(candidate);

  return {
    text: '内容を整理しました。合っていれば「保存」、違うところがあればそのまま訂正してくださいね。',
    quickReplies: buildQuickReplies(['保存', '訂正する']),
  };
}

module.exports = {
  buildQuickReplies,
  buildConfirmationMessage,
};
