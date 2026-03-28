services/daily_summary_service.js
'use strict';

function normalizeText(value) {
  return String(value || '').trim();
}

function round1(value) {
  return Math.round((Number(value || 0) + Number.EPSILON) * 10) / 10;
}

function sumNutrition(meals) {
  return (Array.isArray(meals) ? meals : []).reduce((acc, meal) => {
    const kcal = Number(meal?.kcal || meal?.estimatedNutrition?.kcal || 0);
    const protein = Number(meal?.protein || meal?.estimatedNutrition?.protein || 0);
    const fat = Number(meal?.fat || meal?.estimatedNutrition?.fat || 0);
    const carbs = Number(meal?.carbs || meal?.estimatedNutrition?.carbs || 0);

    acc.kcal += kcal;
    acc.protein += protein;
    acc.fat += fat;
    acc.carbs += carbs;
    return acc;
  }, { kcal: 0, protein: 0, fat: 0, carbs: 0 });
}

function collectDayData(params) {
  const messages = Array.isArray(params?.recentMessages) ? params.recentMessages : [];
  const todayRecords = params?.todayRecords || {
    meals: [],
    exercises: [],
    weights: [],
    labs: []
  };

  const joinedUserText = messages
    .filter((m) => m?.role === 'user')
    .map((m) => normalizeText(m.content))
    .join('\n');

  const mealTotals = sumNutrition(todayRecords.meals || []);

  return {
    meals: Array.isArray(todayRecords.meals) ? todayRecords.meals : [],
    exercises: Array.isArray(todayRecords.exercises) ? todayRecords.exercises : [],
    weights: Array.isArray(todayRecords.weights) ? todayRecords.weights : [],
    labs: Array.isArray(todayRecords.labs) ? todayRecords.labs : [],
    mealTotals,
    fatigueSignals: (joinedUserText.match(/疲れた|眠い|寝不足|だるい/g) || []).length,
    recoverySignals: (joinedUserText.match(/落ち着いた|安心|大丈夫|休めた/g) || []).length,
    emotionalSignals: (joinedUserText.match(/不安|つらい|しんどい|苦しい/g) || []).length
  };
}

function buildMealLine(dayData) {
  if (!dayData.meals.length) {
    return '食事: 今日はまだはっきりした記録が少なめです。';
  }

  const kcal = round1(dayData.mealTotals.kcal);
  const protein = round1(dayData.mealTotals.protein);
  const fat = round1(dayData.mealTotals.fat);
  const carbs = round1(dayData.mealTotals.carbs);

  return `食事: ${dayData.meals.length}件 / 約${kcal}kcal / たんぱく質 ${protein}g / 脂質 ${fat}g / 糖質 ${carbs}g`;
}

function buildExerciseLine(dayData) {
  if (!dayData.exercises.length) {
    return '運動: 今日は運動記録は少なめです。';
  }

  const labels = dayData.exercises
    .slice(-3)
    .map((item) => item?.name || item?.summary || '運動')
    .filter(Boolean);

  return `運動: ${dayData.exercises.length}件 / ${labels.join('、')}`;
}

function buildWeightLine(dayData) {
  if (!dayData.weights.length) {
    return null;
  }

  const latest = dayData.weights[dayData.weights.length - 1];
  return `体重: ${latest?.summary || '今日の記録あり'}`;
}

function inferMeaning(dayData, userState) {
  if (dayData.meals.length && dayData.exercises.length) {
    return '今日は食事も動きも少しずつ積み上げられていて、流れは作れています。';
  }

  if (dayData.fatigueSignals > 0 || Number(userState?.gasolineScore || 5) <= 4) {
    return '今日は頑張り切る日というより、崩しすぎず整える日にできています。';
  }

  if (dayData.meals.length) {
    return '今日は食事の流れを大きく崩さずに過ごせています。';
  }

  if (dayData.exercises.length) {
    return '今日は動けたこと自体にしっかり意味があります。';
  }

  return '今日は大きく崩したというより、今の生活の中で持ちこたえた日として見て大丈夫です。';
}

function buildTomorrowHint(dayData, userState, longMemory) {
  if (dayData.fatigueSignals > 0 || Number(userState?.gasolineScore || 5) <= 4) {
    return '明日は無理に詰め直すより、休める所を一つ作れれば十分です。';
  }

  if (dayData.meals.length && !dayData.exercises.length) {
    return '明日は一つだけ、軽く体を動かす所を足せれば十分です。';
  }

  if (!dayData.meals.length && dayData.exercises.length) {
    return '明日は一つだけ、食事の流れを崩しすぎない所を意識できれば十分です。';
  }

  if (dayData.meals.length) {
    return '明日も一つだけ、続けやすい食事の形を守れれば十分です。';
  }

  return '明日は戻しやすい所から一つだけで大丈夫です。';
}

async function buildDailySummary(params) {
  const dayData = collectDayData(params);
  const lines = [
    buildMealLine(dayData),
    buildExerciseLine(dayData)
  ];

  const weightLine = buildWeightLine(dayData);
  if (weightLine) lines.push(weightLine);

  lines.push(inferMeaning(dayData, params?.userState || {}));
  lines.push(buildTomorrowHint(dayData, params?.userState || {}, params?.longMemory || {}));

  return lines.filter(Boolean).join('\n');
}

module.exports = {
  buildDailySummary
};
