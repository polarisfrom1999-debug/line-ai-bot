'use strict';

const {
  parseProfile,
  calculateBMR,
  calculateTDEE,
  profileGuideMessage,
} = require('../parsers/profile_parser');
const { fmt } = require('../utils/formatters');

function activityLevelLabel(activityLevel) {
  if (activityLevel === 'high') return '高い';
  if (activityLevel === 'moderate_high') return 'やや高い';
  if (activityLevel === 'moderate') return 'ふつう';
  if (activityLevel === 'low') return '低い';
  return null;
}

function sexLabel(sex) {
  if (sex === 'male') return '男性';
  if (sex === 'female') return '女性';
  return null;
}

function buildProfileUpdatePayload(currentUser = {}, text = '') {
  const updates = parseProfile(text);
  if (!Object.keys(updates).length) return null;

  const previewUser = { ...currentUser, ...updates };
  const estimated_bmr = calculateBMR(previewUser);
  const estimated_tdee = calculateTDEE(previewUser);

  return {
    ...updates,
    estimated_bmr,
    estimated_tdee,
  };
}

function buildPartialProfileReply(updates = {}) {
  const lines = [];
  if (updates.sex) lines.push(`性別を${sexLabel(updates.sex)}に更新しました。`);
  if (updates.age != null) lines.push(`年齢を${fmt(updates.age)}歳に更新しました。`);
  if (updates.height_cm != null) lines.push(`身長を${fmt(updates.height_cm)}cmに更新しました。`);
  if (updates.weight_kg != null) lines.push(`体重を${fmt(updates.weight_kg)}kgに更新しました。`);
  if (updates.target_weight_kg != null) lines.push(`目標体重を${fmt(updates.target_weight_kg)}kgに更新しました。`);
  if (updates.activity_level) lines.push(`活動量を${activityLevelLabel(updates.activity_level) || updates.activity_level}に更新しました。`);
  if (updates.estimated_bmr != null) lines.push(`推定基礎代謝: ${fmt(updates.estimated_bmr)} kcal/日`);
  if (updates.estimated_tdee != null) lines.push(`推定総消費目安: ${fmt(updates.estimated_tdee)} kcal/日`);
  if (!lines.length) return '変えたい項目だけ、そのまま送ってください。';
  lines.push('他に変える項目があれば続けてどうぞ。終わりなら「完了」で大丈夫です。');
  return lines.join('\n');
}

module.exports = {
  profileGuideMessage,
  activityLevelLabel,
  sexLabel,
  buildProfileUpdatePayload,
  buildPartialProfileReply,
};
