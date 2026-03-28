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
    recovery: (text.match(/落ち着いた|安心|大丈夫|休めた/g) || []).length,
    hydration: (text.match(/水分|喉乾|むくみ/g) || []).length,
    bowels: (text.match(/便通|お通じ/g) || []).length
  };
}

function buildMealsLine(allRecords) {
  const meals = Array.isArray(allRecords?.meals) ? allRecords.meals : [];
  if (!meals.length) {
    return '食事: 記録量よりも、今週また戻ってこれた流れ自体に意味があります。';
  }

  const totals = sumNutrition(meals);
  return `食事: ${meals.length}件 / 約${round1(totals.kcal)}kcal / たんぱく質 ${round1(totals.protein)}g / 脂質 ${round1(totals.fat)}g / 糖質 ${round1(totals.carbs)}g`;
}

function buildExerciseLine(allRecords) {
  const exercises = Array.isArray(allRecords?.exercises) ? allRecords.exercises : [];
  if (!exercises.length) {
    return '運動: 今週は量が少なくても大丈夫です。無理なく戻れる形を優先で見ていきましょう。';
  }

  const kcal = exercises.reduce((sum, item) => sum + Number(item?.kcal || item?.estimatedKcal || 0), 0);
  return `運動: ${exercises.length}件 / 推定消費 ${round1(kcal)}kcal`;
}

function buildWeightLine(allRecords, longMemory) {
  const weights = Array.isArray(allRecords?.weights) ? allRecords.weights : [];
  if (weights.length) {
    const latest = weights[weights.length - 1];
    return `体重: ${latest?.summary || latest?.value || '今週の記録あり'}`;
  }

  if (longMemory?.weight) {
    return `体重: 現在の基準は ${longMemory.weight} です。`;
  }

  return null;
}

function buildLabLine(allRecords) {
  const labs = Array.isArray(allRecords?.labs) ? allRecords.labs : [];
  if (!labs.length) return null;
  return `血液検査: 今週は ${labs.length}件の検査関連記録があります。`;
}

function inferWeeklyMeaning(allRecords, signals, longMemory) {
  const meals = Array.isArray(allRecords?.meals) ? allRecords.meals : [];
  const exercises = Array.isArray(allRecords?.exercises) ? allRecords.exercises : [];

  if (signals.pain > 0 || signals.fatigue > 1) {
    return '今週は結果を急ぐ週というより、痛みや疲れを悪化させずに持ちこたえた週として見るのが自然です。';
  }

  if (meals.length && exercises.length) {
    return '今週は食事も動きも、完璧より流れを切らさない形で積み上げられています。';
  }

  if (signals.anxiety > 0) {
    return '今週は数字以上に、不安がある中でも会話を切らさなかったことが前進です。';
  }

  if (Array.isArray(longMemory?.supportPreference) && longMemory.supportPreference.length) {
    return '今週は無理に詰め込むより、自分に合う進め方を探せている週です。';
  }

  if (meals.length) return '今週はまず食事の流れを戻せたことが土台になっています。';
  if (exercises.length) return '今週は動ける日を少しでも作れたことに意味があります。';
  return '今週は整え切るより、戻りやすい関係を保てたことを大事にして大丈夫です。';
}

function buildNextStep(signals, longMemory) {
  if (signals.pain > 0) return '次の一手: 痛みがある間は、運動量を足すより負担を増やさない整え方を優先でいきましょう。';
  if (signals.fatigue > 0) return '次の一手: まずは睡眠や水分を少し整えるだけでも十分です。';
  if (signals.hydration > 0) return '次の一手: 今日は水分をこまめに入れる意識だけで十分です。';
  if (signals.bowels > 0) return '次の一手: 便通やお腹の張りも見ながら、数字より体の反応を優先でいきましょう。';
  if (/理屈|整理/.test(normalizeText(longMemory?.aiType))) return '次の一手: 次週は、食事か運動のどちらか1つだけ軸を決めると流れが安定しやすいです。';
  return '次の一手: 来週も完璧を狙いすぎず、送りやすいものから続ければ十分です。';
}

async function buildWeeklyReport(params) {
  const longMemory = params?.longMemory || {};
  const recentMessages = Array.isArray(params?.recentMessages) ? params.recentMessages : [];
  const recentDailyRecords = Array.isArray(params?.recentDailyRecords) ? params.recentDailyRecords : [];
  const todayRecords = params?.todayRecords || {};

  const allRecords = recentDailyRecords.length
    ? flattenRecentRecords(recentDailyRecords)
    : {
        meals: Array.isArray(todayRecords?.meals) ? todayRecords.meals : [],
        exercises: Array.isArray(todayRecords?.exercises) ? todayRecords.exercises : [],
        weights: Array.isArray(todayRecords?.weights) ? todayRecords.weights : [],
        labs: Array.isArray(todayRecords?.labs) ? todayRecords.labs : []
      };

  const signals = collectMessageSignals(recentMessages);
  const lines = [
    '今週のまとめです。',
    buildMealsLine(allRecords),
    buildExerciseLine(allRecords)
  ];

  const weightLine = buildWeightLine(allRecords, longMemory);
  if (weightLine) lines.push(weightLine);

  const labLine = buildLabLine(allRecords);
  if (labLine) lines.push(labLine);

  lines.push(inferWeeklyMeaning(allRecords, signals, longMemory));
  lines.push(buildNextStep(signals, longMemory));

  return lines.filter(Boolean).join('\n');
}

module.exports = {
  buildWeeklyReport
};
