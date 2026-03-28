services/monthly_report_service.js
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

function collectMessageSignals(recentMessages) {
  const text = (Array.isArray(recentMessages) ? recentMessages : [])
    .filter((m) => m?.role === 'user')
    .map((m) => normalizeText(m.content))
    .join('\n');

  return {
    fatigue: (text.match(/疲れた|眠い|寝不足|だるい/g) || []).length,
    pain: (text.match(/痛い|腰が痛い|首が痛い|しんどい/g) || []).length,
    anxiety: (text.match(/不安|つらい|苦しい/g) || []).length,
    recovery: (text.match(/落ち着いた|安心|大丈夫|休めた/g) || []).length
  };
}

function flattenRecentRecords(recentDailyRecords) {
  const days = Array.isArray(recentDailyRecords) ? recentDailyRecords : [];
  const merged = {
    meals: [],
    exercises: [],
    weights: [],
    labs: []
  };

  for (const day of days) {
    const records = day?.records || {};
    merged.meals.push(...(Array.isArray(records.meals) ? records.meals : []));
    merged.exercises.push(...(Array.isArray(records.exercises) ? records.exercises : []));
    merged.weights.push(...(Array.isArray(records.weights) ? records.weights : []));
    merged.labs.push(...(Array.isArray(records.labs) ? records.labs : []));
  }

  return merged;
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

  const names = exercises
    .slice(-8)
    .map((item) => item?.name || item?.summary || '運動')
    .filter(Boolean);

  return `運動: ${exercises.length}件 / ${names.join('、')}`;
}

function buildWeightLine(allRecords, longMemory) {
  const weights = Array.isArray(allRecords?.weights) ? allRecords.weights : [];
  if (weights.length) {
    const latest = weights[weights.length - 1];
    return `体重: ${latest?.summary || '今月の記録あり'}`;
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

  if (meals.length) {
    return '今月はまず食事の流れを崩しすぎなかったことが土台になっています。';
  }

  if (exercises.length) {
    return '今月は運動量そのものより、動ける日を少しでも作れたことが大きいです。';
  }

  if (longMemory?.supportPreference?.length) {
    return '今月は大きな記録量より、あなたに合う支え方を少しずつ見つけている段階として見て大丈夫です。';
  }

  return '今月は派手な変化より、戻ってこられる流れを切らさなかったことに意味があります。';
}

function inferMonthlyNextStep(allRecords, signals, longMemory) {
  const meals = Array.isArray(allRecords?.meals) ? allRecords.meals : [];
  const exercises = Array.isArray(allRecords?.exercises) ? allRecords.exercises : [];

  if (signals.pain > 0) {
    return '来月は無理に運動量を増やすより、痛みを悪化させない形で続けられる土台作りを優先で大丈夫です。';
  }

  if (signals.fatigue > 0) {
    return '来月は一つだけ、疲れを溜め込みすぎない生活の余白を作れれば十分です。';
  }

  if (meals.length && !exercises.length) {
    return '来月は一つだけ、軽く体を動かす場面を足せれば流れがさらに安定しやすいです。';
  }

  if (!meals.length && exercises.length) {
    return '来月は一つだけ、食事のリズムを整えやすい時間帯を作れれば十分です。';
  }

  if (longMemory?.constitutionType) {
    return `来月は「${longMemory.constitutionType}」の傾向を踏まえて、一つだけ整えやすい所から進めれば十分です。`;
  }

  return '来月は頑張り直すより、続けやすい一手を一つだけ固定できれば十分です。';
}

async function buildMonthlyReport(params) {
  const recentDailyRecords = Array.isArray(params?.recentDailyRecords) ? params.recentDailyRecords : [];
  const allRecords = flattenRecentRecords(recentDailyRecords);
  const recentMessages = Array.isArray(params?.recentMessages) ? params.recentMessages : [];
  const longMemory = params?.longMemory || {};
  const signals = collectMessageSignals(recentMessages);

  const lines = [
    '月間報告です。',
    buildMealsLine(allRecords),
    buildExerciseLine(allRecords)
  ];

  const weightLine = buildWeightLine(allRecords, longMemory);
  if (weightLine) lines.push(weightLine);

  const labLine = buildLabLine(allRecords);
  if (labLine) lines.push(labLine);

  lines.push(inferMonthlyMeaning(allRecords, signals, longMemory));
  lines.push(inferMonthlyNextStep(allRecords, signals, longMemory));

  return lines.filter(Boolean).join('\n');
}

module.exports = {
  buildMonthlyReport
};
