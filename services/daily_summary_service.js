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

function sumExercise(exercises) {
  return (Array.isArray(exercises) ? exercises : []).reduce((acc, item) => {
    acc.count += 1;
    acc.kcal += Number(item?.estimatedCalories || 0);
    acc.minutes += Number(item?.minutes || 0);
    return acc;
  }, { count: 0, kcal: 0, minutes: 0 });
}

function collectSignals(messages) {
  const joinedUserText = (Array.isArray(messages) ? messages : [])
    .filter((m) => m?.role === 'user')
    .map((m) => normalizeText(m.content))
    .join('\n');

  return {
    fatigueSignals: (joinedUserText.match(/疲れた|眠い|寝不足|だるい/g) || []).length,
    recoverySignals: (joinedUserText.match(/落ち着いた|安心|大丈夫|休めた/g) || []).length,
    emotionalSignals: (joinedUserText.match(/不安|つらい|しんどい|苦しい/g) || []).length,
    painSignals: (joinedUserText.match(/痛い|腰痛|首|肩|激痛|骨折/g) || []).length,
    swellingSignals: (joinedUserText.match(/むくみ/g) || []).length,
    bowelSignals: (joinedUserText.match(/便通|便秘|お腹/g) || []).length,
    hydrationSignals: (joinedUserText.match(/水分|のど乾/g) || []).length
  };
}

function collectDayData(params) {
  const todayRecords = params?.todayRecords || {
    meals: [],
    exercises: [],
    weights: [],
    labs: []
  };

  return {
    meals: Array.isArray(todayRecords.meals) ? todayRecords.meals : [],
    exercises: Array.isArray(todayRecords.exercises) ? todayRecords.exercises : [],
    weights: Array.isArray(todayRecords.weights) ? todayRecords.weights : [],
    labs: Array.isArray(todayRecords.labs) ? todayRecords.labs : [],
    mealTotals: sumNutrition(todayRecords.meals || []),
    exerciseTotals: sumExercise(todayRecords.exercises || []),
    ...collectSignals(params?.recentMessages || [])
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

  const kcal = round1(dayData.exerciseTotals.kcal);
  const minuteText = dayData.exerciseTotals.minutes ? ` / 合計${round1(dayData.exerciseTotals.minutes)}分` : '';
  const kcalText = kcal ? ` / 推定消費 ${kcal}kcal` : '';

  return `運動: ${dayData.exercises.length}件${minuteText}${kcalText} / ${labels.join('、')}`;
}

function buildWeightLine(dayData) {
  if (!dayData.weights.length) return null;
  const latest = dayData.weights[dayData.weights.length - 1];
  return `体重: ${latest?.summary || '今日の記録あり'}`;
}

function buildBodySignalLine(dayData) {
  const parts = [];
  if (dayData.painSignals > 0) parts.push('痛み');
  if (dayData.fatigueSignals > 0) parts.push('疲れ');
  if (dayData.swellingSignals > 0) parts.push('むくみ');
  if (dayData.bowelSignals > 0) parts.push('便通');
  if (dayData.hydrationSignals > 0) parts.push('水分');

  if (!parts.length) return null;
  return `体調メモ: ${parts.join('・')}の話題がありました。`;
}

function inferMeaning(dayData, userState) {
  if (dayData.painSignals > 0) {
    return '今日は整えることより、まず負担を増やしすぎない方が大事な日として見てよさそうです。';
  }

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
  if (dayData.painSignals > 0) {
    return '明日は無理に上乗せせず、痛みを増やさない動き方を優先できれば十分です。';
  }

  if (dayData.fatigueSignals > 0 || Number(userState?.gasolineScore || 5) <= 4) {
    return '明日は無理に詰め直すより、休める所を一つ作れれば十分です。';
  }

  if (dayData.meals.length && !dayData.exercises.length) {
    return '明日は一つだけ、軽く体を動かす所を足せれば十分です。';
  }

  if (!dayData.meals.length && dayData.exercises.length) {
    return '明日は一つだけ、食事の流れを崩しすぎない所を意識できれば十分です。';
  }

  if (/理屈|整理/.test(String(longMemory?.aiType || ''))) {
    return '明日は一つだけ、続けやすい行動を先に決めておくと流れを作りやすいです。';
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

  const bodySignalLine = buildBodySignalLine(dayData);
  if (bodySignalLine) lines.push(bodySignalLine);

  lines.push(inferMeaning(dayData, params?.userState || {}));
  lines.push(buildTomorrowHint(dayData, params?.userState || {}, params?.longMemory || {}));

  return lines.filter(Boolean).join('\n');
}

module.exports = {
  buildDailySummary,
  collectDayData
};
