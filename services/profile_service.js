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

function buildProfileUpdatePayload(currentUser, text) {
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

function buildProfilePartialReply(patch = {}) {
  const lines = ['プロフィールを更新しました。'];
  if (patch.sex) lines.push(`性別: ${sexLabel(patch.sex)}`);
  if (patch.age) lines.push(`年齢: ${fmt(patch.age)}`);
  if (patch.height_cm) lines.push(`身長: ${fmt(patch.height_cm)} cm`);
  if (patch.weight_kg) lines.push(`体重: ${fmt(patch.weight_kg)} kg`);
  if (patch.target_weight_kg) lines.push(`目標体重: ${fmt(patch.target_weight_kg)} kg`);
  if (patch.activity_level) lines.push(`活動量: ${activityLevelLabel(patch.activity_level) || patch.activity_level}`);
  if (patch.estimated_bmr) lines.push(`推定基礎代謝: ${fmt(patch.estimated_bmr)} kcal/日`);
  if (patch.estimated_tdee) lines.push(`推定総消費目安: ${fmt(patch.estimated_tdee)} kcal/日`);
  lines.push('他に変える項目があれば、そのまま続けて送ってください。');
  return lines.join('\n');
}

module.exports = {
  profileGuideMessage,
  activityLevelLabel,
  sexLabel,
  buildProfileUpdatePayload,
  buildProfilePartialReply,
};
