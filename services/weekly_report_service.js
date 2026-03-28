'use strict';

function sumNutrition(records) {
  return records.reduce((acc, record) => {
    const n = record?.estimatedNutrition || {};
    acc.kcal += Number(n.kcal || 0);
    acc.protein += Number(n.protein || 0);
    acc.fat += Number(n.fat || 0);
    acc.carbs += Number(n.carbs || 0);
    return acc;
  }, { kcal: 0, protein: 0, fat: 0, carbs: 0 });
}

function round1(n) {
  return Math.round((Number(n) || 0) * 10) / 10;
}

async function buildWeeklyReport({ records, points, weeklyAnswers }) {
  const mealRecords = (records || []).filter((r) => r.recordType === 'meal');
  const exerciseRecords = (records || []).filter((r) => r.recordType === 'exercise');
  const weightRecords = (records || []).filter((r) => r.recordType === 'weight');
  const nutrition = sumNutrition(mealRecords);
  const answerCount = Array.isArray(weeklyAnswers) ? weeklyAnswers.length : 0;

  return [
    `今週は食事 ${mealRecords.length}件、運動 ${exerciseRecords.length}件、体重 ${weightRecords.length}件 でした。`,
    mealRecords.length ? `食事の累計は 約${round1(nutrition.kcal)}kcal / たんぱく質 ${round1(nutrition.protein)}g / 脂質 ${round1(nutrition.fat)}g / 糖質 ${round1(nutrition.carbs)}g です。` : '今週は食事記録がまだ少なめです。',
    answerCount ? `週間アンケートの回答は ${answerCount}件 あります。` : '週間アンケートはまだこれからでも大丈夫です。',
    `現在のポイントは ${points?.total || 0}pt です。`,
    '崩れを責めるより、戻ろうとしていた流れがちゃんとあります。'
  ].join('\n');
}

module.exports = { buildWeeklyReport };
