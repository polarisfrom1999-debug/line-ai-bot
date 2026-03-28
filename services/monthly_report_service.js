'use strict';

function normalizeText(value) {
  return String(value || '').trim();
}

function round1(value) {
  return Math.round((Number(value || 0) + Number.EPSILON) * 10) / 10;
}

function sumNutrition(meals) {
  return (Array.isArray(meals) ? meals : []).reduce((acc, meal) => {
    acc.kcal += Number(meal?.kcal || meal?.estimatedNutrition?.kcal || 0);
    acc.protein += Number(meal?.protein || meal?.estimatedNutrition?.protein || 0);
    acc.fat += Number(meal?.fat || meal?.estimatedNutrition?.fat || 0);
    acc.carbs += Number(meal?.carbs || meal?.estimatedNutrition?.carbs || 0);
    return acc;
  }, { kcal: 0, protein: 0, fat: 0, carbs: 0 });
}

function flattenRecentRecords(recentDailyRecords) {
  const days = Array.isArray(recentDailyRecords) ? recentDailyRecords : [];
  const merged = { meals: [], exercises: [], weights: [], labs: [] };

  for (const day of days) {
    const records = day?.records || {};
    merged.meals.push(...(Array.isArray(records.meals) ? records.meals : []));
    merged.exercises.push(...(Array.isArray(records.exercises) ? records.exercises : []));
    merged.weights.push(...(Array.isArray(records.weights) ? records.weights : []));
    merged.labs.push(...(Array.isArray(records.labs) ? records.labs : []));
  }

  return merged;
}

function collectMessageSignals(recentMessages) {
  const text = (Array.isArray(recentMessages) ? recentMessages : [])
    .filter((m) => m?.role === 'user')
    .map((m) => normalizeText(m.content))
    .join('\n');

  return {
    fatigue: (text.match(/疲れた|眠い|寝不足|だるい/g) || []).length,
    pain: (text.match(/痛い|腰が痛い|首が痛い|しんどい/g) || []).length,
    anxiety: (text.match(/不安|つらい|苦しい|焦る/g) || []).length,
    recovery: (text.match(/落ち着いた|安心|大丈夫|休めた/g) || []).length
  };
}

function buildMealsLine(allRecords) {
  const meals = Array.isArray(allRecords?.meals) ? allRecords.meals : [];
  if (!meals.length) {
    return '食事: 今月は記録量より、戻ろうとしてくれた流れ自体に意味があります。';
  }

  const totals = sumNutrition(meals);
  return `食事: ${meals.length}件 / 約${round1(totals.kcal)}kcal / たんぱく質 ${round1(totals.protein)}g / 脂質 ${round1(totals.fat)}g / 糖質 ${round1(totals.carbs)}g`;
}

function buildExerciseLine(allRecords) {
  const exercises = Array.isArray(allRecords?.exercises) ? allRecords.exercises : [];
  if (!exercises.length) {
    return '運動: 今月は量よりも、無理なく戻れる形を作る視点で十分です。';
  }

  const kcal = exercises.reduce((sum, item) => sum + Number(item?.kcal || item?.estimatedKcal || 0), 0);
  return `運動: ${exercises.length}件 / 推定消費 ${round1(kcal)}kcal`;
}

function buildWeightLine(allRecords, longMemory) {
  const weights = Array.isArray(allRecords?.weights) ? allRecords.weights : [];
  if (weights.length) {
    const latest = weights[weights.length - 1];
    return `体重: ${latest?.summary || latest?.value || '今月の記録あり'}`;
  }

  if (longMemory?.weight) {
    return `体重: 現在の基準としては ${longMemory.weight} を見ています。`;
  }

  return null;
}

function buildLabLine(allRecords) {
  const labs = Array.isArray(allRecords?.labs) ? allRecords.labs : [];
  if (!labs.length) return null;
  return `血液検査: 今月は ${labs.length}件の検査関連記録があります。`;
}

function inferMonthlyMeaning(allRecords, signals, longMemory) {
  const meals = Array.isArray(allRecords?.meals) ? allRecords.meals : [];
  const exercises = Array.isArray(allRecords?.exercises) ? allRecords.exercises : [];

  if (meals.length && exercises.length) {
    return '今月は食事も動きも、完璧を狙いすぎず流れを切らさずに積み上げられています。';
  }

  if (signals.pain > 0 || signals.fatigue > 0) {
    return '今月は結果を急ぐ月というより、痛みや疲れを悪化させずに立て直しの土台を守れた月として見て大丈夫です。';
  }

  if (signals.anxiety > 0 && signals.recovery > 0) {
    return '今月は揺れがありつつも、戻り方を一緒に見つけられた月でした。';
  }

  if (meals.length) return '今月はまず食事の流れを崩しすぎなかったことが土台になっています。';
  if (exercises.length) return '今月は運動量そのものより、動ける日を少しでも作れたことが大きいです。';
  if (Array.isArray(longMemory?.supportPreference) && longMemory.supportPreference.length) {
    return '今月は自分に合う伴走の受け方を探せたこと自体が前進です。';
  }
  return '今月は整え切ることより、関係を切らさず戻ってこられたことを大事にして大丈夫です。';
}

function buildNextStep(signals, longMemory) {
  if (signals.pain > 0) return '次の一手: 来月は無理に運動量を追わず、痛みが少ない日を基準に整えましょう。';
  if (signals.fatigue > 0) return '次の一手: 来月は睡眠や休息の立て直しを軸にすると、食事も運動も安定しやすいです。';
  if (/理屈|整理/.test(normalizeText(longMemory?.aiType))) return '次の一手: 来月は、食事・運動・体重のうち1つだけ主軸を決めると判断がぶれにくいです。';
  return '次の一手: 来月も完璧を狙うより、送りやすい記録を少しずつ続ける形で十分です。';
}

async function buildMonthlyReport(params) {
  const longMemory = params?.longMemory || {};
  const recentMessages = Array.isArray(params?.recentMessages) ? params.recentMessages : [];
  const recentDailyRecords = Array.isArray(params?.recentDailyRecords) ? params.recentDailyRecords : [];

  const allRecords = flattenRecentRecords(recentDailyRecords);
  const signals = collectMessageSignals(recentMessages);

  const lines = [
    '今月のまとめです。',
    buildMealsLine(allRecords),
    buildExerciseLine(allRecords)
  ];

  const weightLine = buildWeightLine(allRecords, longMemory);
  if (weightLine) lines.push(weightLine);

  const labLine = buildLabLine(allRecords);
  if (labLine) lines.push(labLine);

  lines.push(inferMonthlyMeaning(allRecords, signals, longMemory));
  lines.push(buildNextStep(signals, longMemory));

  return lines.filter(Boolean).join('\n');
}

module.exports = {
  buildMonthlyReport
};
