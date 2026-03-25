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

function normalizeLoose(text = '') {
  return String(text || '')
    .trim()
    .toLowerCase()
    .replace(/[　\s]+/g, '')
    .replace(/[!！?？。、,.]/g, '');
}

function isProfileEditIntent(text = '') {
  const n = normalizeLoose(text);
  if (!n) return false;
  return [
    'プロフィール変更',
    'プロフィール修正',
    'プロフィール更新',
    'プロフィール',
    '設定変更',
    '設定更新',
  ].some((word) => n.includes(normalizeLoose(word)));
}

function isProfileEditDoneIntent(text = '') {
  const n = normalizeLoose(text);
  if (!n) return false;
  return ['完了', 'おわり', '終わり', '以上', 'これでok', 'これで大丈夫'].some((word) => n.includes(normalizeLoose(word)));
}

function buildProfileUpdatePayload(currentUser, text) {
  const updates = parseProfile(text);
  if (!Object.keys(updates).length) return null;

  const previewUser = { ...currentUser, ...updates };
  const estimated_bmr = calculateBMR(previewUser);
  const estimated_tdee = calculateTDEE(previewUser);

  return {
    updates,
    userPatch: {
      ...updates,
      estimated_bmr,
      estimated_tdee,
    },
    previewUser: {
      ...previewUser,
      estimated_bmr,
      estimated_tdee,
    },
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

function buildProfileEditStartMessage() {
  return [
    'プロフィール変更ですね。',
    '変えたい項目だけ、そのまま送って大丈夫です。',
    '例: 体重 62 / 身長 160 / 年齢 55 / 目標体重 58 / 活動量 ふつう',
    '1つずつでも大丈夫です。終わったら「完了」で閉じます。',
  ].join('\n');
}

function buildChangedFieldLines(updates = {}, previewUser = {}) {
  const lines = [];

  if (Object.prototype.hasOwnProperty.call(updates, 'sex')) {
    lines.push(`性別を${sexLabel(previewUser.sex) || previewUser.sex}に更新しました。`);
  }
  if (Object.prototype.hasOwnProperty.call(updates, 'age')) {
    lines.push(`年齢を${fmt(previewUser.age)}に更新しました。`);
  }
  if (Object.prototype.hasOwnProperty.call(updates, 'height_cm')) {
    lines.push(`身長を${fmt(previewUser.height_cm)}cmに更新しました。`);
  }
  if (Object.prototype.hasOwnProperty.call(updates, 'weight_kg')) {
    lines.push(`体重を${fmt(previewUser.weight_kg)}kgに更新しました。`);
  }
  if (Object.prototype.hasOwnProperty.call(updates, 'target_weight_kg')) {
    lines.push(`目標体重を${fmt(previewUser.target_weight_kg)}kgに更新しました。`);
  }
  if (Object.prototype.hasOwnProperty.call(updates, 'activity_level')) {
    lines.push(`活動量を${activityLevelLabel(previewUser.activity_level) || previewUser.activity_level}に更新しました。`);
  }

  return lines;
}

function shouldShowMetabolismLines(updates = {}) {
  return (
    Object.prototype.hasOwnProperty.call(updates, 'sex') ||
    Object.prototype.hasOwnProperty.call(updates, 'age') ||
    Object.prototype.hasOwnProperty.call(updates, 'height_cm') ||
    Object.prototype.hasOwnProperty.call(updates, 'weight_kg') ||
    Object.prototype.hasOwnProperty.call(updates, 'activity_level')
  );
}

function buildProfilePartialReply(payload = {}) {
  const updates = payload?.updates || {};
  const previewUser = payload?.previewUser || {};
  const changedLines = buildChangedFieldLines(updates, previewUser);

  if (!changedLines.length) {
    return '変えたい項目だけ送ってください。例: 体重 62 / 身長 160 / 年齢 55。終わりなら「完了」で大丈夫です。';
  }

  const lines = [...changedLines];

  if (shouldShowMetabolismLines(updates) && previewUser.estimated_bmr) {
    lines.push(`推定基礎代謝: ${fmt(previewUser.estimated_bmr)} kcal/日`);
  }
  if (shouldShowMetabolismLines(updates) && previewUser.estimated_tdee) {
    lines.push(`推定総消費目安: ${fmt(previewUser.estimated_tdee)} kcal/日`);
  }

  lines.push('他に変える項目があれば、そのまま続けて送ってください。終わりなら「完了」で大丈夫です。');
  return lines.join('\n');
}

module.exports = {
  profileGuideMessage,
  activityLevelLabel,
  sexLabel,
  isProfileEditIntent,
  isProfileEditDoneIntent,
  buildProfileEditStartMessage,
  buildProfileUpdatePayload,
  buildProfileReply,
  buildProfilePartialReply,
};
