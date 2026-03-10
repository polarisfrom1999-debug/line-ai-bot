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

function buildProfileReply(user) {
  const lines = [
    'プロフィールを更新しました。',
    user.sex ? `性別: ${sexLabel(user.sex)}` : null,
    user.age ? `年齢: ${fmt(user.age)}` : null,
    user.height_cm ? `身長: ${fmt(user.height_cm)} cm` : null,
    user.weight_kg ? `体重: ${fmt(user.weight_kg)} kg` : null,
    user.target_weight_kg ? `目標体重: ${fmt(user.target_weight_kg)} kg` : null,
    user.activity_level ? `活動量: ${activityLevelLabel(user.activity_level) || user.activity_level}` : null,
    user.estimated_bmr ? `推定基礎代謝: ${fmt(user.estimated_bmr)} kcal/日` : null,
    user.estimated_tdee ? `推定総消費目安: ${fmt(user.estimated_tdee)} kcal/日` : null,
  ].filter(Boolean);

  return lines.join('\n');
}

module.exports = {
  profileGuideMessage,
  activityLevelLabel,
  sexLabel,
  buildProfileUpdatePayload,
  buildProfileReply,
};