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

async function buildMonthlyReport({ records, points, monthlyAnswers }) {
  const mealRecords = (records || []).filter((r) => r.recordType === 'meal');
  const exerciseRecords = (records || []).filter((r) => r.recordType === 'exercise');
  const labRecords = (records || []).filter((r) => r.recordType === 'lab');
  const nutrition = sumNutrition(mealRecords);
  const answerCount = Array.isArray(monthlyAnswers) ? monthlyAnswers.length : 0;

  return a[
    `この1か月は食事 ${mealRecords.length}件、運動 ${exerciseRecords.length}件、血液検査 ${labRecords.length}件 でした。`,
    mealRecords.length ? `食事の累計は 約${round1(nutrition.kcal)}kcal / たんぱく質 ${round1(nutrition.protein)}g / 脂質 ${round1(nutrition.fat)}g / 糖質 ${round1(nutrition.carbs)}g です。` : 'この1か月は食事記録がまだ少なめです。',
    answerCount ? `月間アンケートの回答は ${answerCount}件 あります。` : '月間アンケートはまだこれからでも大丈夫です。',
    `現在のポイントは ${points?.total || 0}pt です。`,
    '数字だけでなく、話せる関係と戻りやすさが積み上がっているのが大きいです。'
  ].join('\n');
}

module.exports = { buildMonthlyReport };
