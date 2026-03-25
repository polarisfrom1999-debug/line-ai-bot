'use strict';
const { parseProfile, calculateBMR, calculateTDEE } = require('../parsers/profile_parser');

function activityLevelLabel(level) {
  if (level === 'high') return '高い';
  if (level === 'moderate_high') return 'やや高い';
  if (level === 'moderate') return 'ふつう';
  if (level === 'low') return '低い';
  return '';
}

function buildProfileUpdatePayload(currentUser = {}, text = '') {
  const updates = parseProfile(text);
  if (!Object.keys(updates).length) return null;
  const merged = { ...currentUser, ...updates };
  const estimated_bmr = calculateBMR(merged);
  const estimated_tdee = calculateTDEE(merged);
  return { ...updates, estimated_bmr, estimated_tdee };
}

function buildPartialProfileReply(updates = {}, merged = {}) {
  const lines = [];
  if (updates.age != null) lines.push(`年齢を${updates.age}歳に更新しました。`);
  if (updates.height_cm != null) lines.push(`身長を${updates.height_cm}cmに更新しました。`);
  if (updates.weight_kg != null) lines.push(`体重を${updates.weight_kg}kgに更新しました。`);
  if (updates.target_weight_kg != null) lines.push(`目標体重を${updates.target_weight_kg}kgに更新しました。`);
  if (updates.activity_level) lines.push(`活動量を${activityLevelLabel(updates.activity_level)}に更新しました。`);
  if (updates.sex) lines.push(`性別を更新しました。`);
  if (merged.estimated_bmr != null) lines.push(`推定基礎代謝: ${merged.estimated_bmr} kcal/日`);
  if (merged.estimated_tdee != null) lines.push(`推定総消費目安: ${merged.estimated_tdee} kcal/日`);
  lines.push('他に変える項目があれば続けてどうぞ。終わりなら「完了」で大丈夫です。');
  return lines.join('\n');
}

module.exports = { buildProfileUpdatePayload, buildPartialProfileReply, activityLevelLabel };
