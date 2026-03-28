services/weekly_report_service.js
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

function buildMealsLine(todayRecords) {
  const meals = Array.isArray(todayRecords?.meals) ? todayRecords.meals : [];
  if (!meals.length) {
    return '食事: 記録はまだ少なめですが、送ろうとしてくれた流れ自体はできています。';
  }

  const totals = sumNutrition(meals);
  return `食事: ${meals.length}件 / 約${round1(totals.kcal)}kcal / たんぱく質 ${round1(totals.protein)}g / 脂質 ${round1(totals.fat)}g / 糖質 ${round1(totals.carbs)}g`;
}

function buildExerciseLine(todayRecords) {
  const exercises = Array.isArray(todayRecords?.exercises) ? todayRecords.exercises : [];
  if (!exercises.length) {
    return '運動: 今週は運動量よりも、戻りやすさを保てたかを大事にしてよさそうです。';
  }

  const labels = exercises
    .slice(-5)
    .map((item) => item?.name || item?.summary || '運動')
    .filter(Boolean);

  return `運動: ${exercises.length}件 / ${labels.join('、')}`;
}

function buildWeightLine(todayRecords, longMemory) {
  const weights = Array.isArray(todayRecords?.weights) ? todayRecords.weights : [];
  if (weights.length) {
    const latest = weights[weights.length - 1];
    return `体重: ${latest?.summary || '今週の記録あり'}`;
  }

  if (longMemory?.weight) {
    return `体重: いま基準として見ているのは ${longMemory.weight} です。`;
  }

  return null;
}

function inferWeeklyMeaning(todayRecords, signals) {
  const meals = Array.isArray(todayRecords?.meals) ? todayRecords.meals : [];
  const exercises = Array.isArray(todayRecords?.exercises) ? todayRecords.exercises : [];

  if (meals.length && exercises.length) {
    return '今週は食事も動きも、完璧ではなくても流れを切らさずに続けられています。';
  }

  if (signals.pain > 0 || signals.fatigue > 0) {
    return '今週は攻める週というより、痛みや疲れを悪化させずに持ちこたえる週として見て大丈夫です。';
  }

  if (meals.length) {
    return '今週はまず食事の流れを大きく崩しすぎなかったことに意味があります。';
  }

  if (exercises.length) {
    return '今週は運動量そのものより、動ける日を少しでも作れたことが大事です。';
  }

  return '今週は記録量が多くなくても、戻ろうとしている流れ自体がちゃんと残っています。';
}

function inferWeeklyNextStep(todayRecords, signals, longMemory) {
  const meals = Array.isArray(todayRecords?.meals) ? todayRecords.meals : [];
  const exercises = Array.isArray(todayRecords?.exercises) ? todayRecords.exercises : [];

  if (signals.pain > 0) {
    return '来週は無理に運動量を増やすより、痛みを悪化させない形で整えるのを優先で大丈夫です。';
  }

  if (signals.fatigue > 0) {
    return '来週は一つだけ、休みやすい時間帯を確保できれば十分です。';
  }

  if (meals.length && !exercises.length) {
    return '来週は一つだけ、軽く体を動かす場面を足せれば十分です。';
  }

  if (!meals.length && exercises.length) {
    return '来週は一つだけ、食事の流れを崩しすぎない所を意識できれば十分です。';
  }

  if (longMemory?.constitutionType) {
    return `来週は「${longMemory.constitutionType}」の傾向を意識しながら、一つだけ整えやすい所からで大丈夫です。`;
  }

  return '来週は頑張り直すより、戻りやすい一手を一つだけ作れれば十分です。';
}

async function buildWeeklyReport(params) {
  const todayRecords = params?.todayRecords || {
    meals: [],
    exercises: [],
    weights: [],
    labs: []
  };
  const recentMessages = Array.isArray(params?.recentMessages) ? params.recentMessages : [];
  const longMemory = params?.longMemory || {};
  const signals = collectMessageSignals(recentMessages);

  const lines = [
    '週間報告です。',
    buildMealsLine(todayRecords),
    buildExerciseLine(todayRecords)
  ];

  const weightLine = buildWeightLine(todayRecords, longMemory);
  if (weightLine) lines.push(weightLine);

  if (Array.isArray(todayRecords?.labs) && todayRecords.labs.length) {
    lines.push(`血液検査: 今週は ${todayRecords.labs.length}件の検査関連記録があります。`);
  }

  lines.push(inferWeeklyMeaning(todayRecords, signals));
  lines.push(inferWeeklyNextStep(todayRecords, signals, longMemory));

  return lines.filter(Boolean).join('\n');
}

module.exports = {
  buildWeeklyReport
};
