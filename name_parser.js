const { MEAL_WORD_HINTS } = require('../config/constants');

function normalizeMealText(text) {
  return String(text || '')
    .replace(/\s+/g, ' ')
    .trim();
}

function seemsMealTextCandidate(text) {
  const t = normalizeMealText(text);
  if (!t) return false;

  if (t.startsWith('名前') || t.startsWith('プロフィール')) return false;
  if (t.includes('運動') || t.includes('歩数') || t.includes('睡眠') || t.includes('水分')) return false;

  if (/(食べた|食べました|飲んだ|飲みました|朝食|昼食|夕食|間食)/.test(t)) return true;

  return MEAL_WORD_HINTS.some((w) => t.includes(w));
}

function buildMealTextGuide() {
  return [
    '食事の例:',
    '・朝食 食パン1枚 チーズ1枚 コーヒー',
    '・昼食 パスタ サラダ',
    '・大福1個食べた',
    '・スタバでラテを飲んだ',
  ].join('\n');
}

module.exports = {
  normalizeMealText,
  seemsMealTextCandidate,
  buildMealTextGuide,
};