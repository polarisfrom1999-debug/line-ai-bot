'use strict';

const pointsService = require('./points_service');
const mealLogQueryService = require('./meal_log_query_service');
const contextMemoryService = require('./context_memory_service');

function normalizeText(value) {
  return String(value || '').trim();
}

function round1(value) {
  return Math.round((Number(value || 0) + Number.EPSILON) * 10) / 10;
}

function sumNutrition(meals) {
  const totals = mealLogQueryService.aggregateLegacyMealRecords(meals);
  return {
    kcal: Number(totals.kcal || 0),
    protein: Number(totals.protein || 0),
    fat: Number(totals.fat || 0),
    carbs: Number(totals.carbs || 0),
  };
}

function flattenRecentRecords(recentDailyRecords) {
  const days = Array.isArray(recentDailyRecords) ? recentDailyRecords : [];
  const merged = { meals: [], exercises: [], weights: [], labs: [], activeDays: 0 };

  for (const day of days) {
    const records = day?.records || {};
    const hasAny = ['meals', 'exercises', 'weights', 'labs'].some((key) => Array.isArray(records[key]) && records[key].length);
    if (hasAny) merged.activeDays += 1;
    merged.meals.push(...(Array.isArray(records.meals) ? records.meals.map((item) => ({ ...item, date: day.date })) : []));
    merged.exercises.push(...(Array.isArray(records.exercises) ? records.exercises.map((item) => ({ ...item, date: day.date })) : []));
    merged.weights.push(...(Array.isArray(records.weights) ? records.weights.map((item) => ({ ...item, date: day.date })) : []));
    merged.labs.push(...(Array.isArray(records.labs) ? records.labs.map((item) => ({ ...item, date: day.date })) : []));
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
  const mealTypeMap = { breakfast: 0, lunch: 0, dinner: 0, snack: 0 };
  meals.forEach((meal) => {
    const mealType = normalizeText(meal?.mealType || '');
    if (mealTypeMap[mealType] != null) mealTypeMap[mealType] += 1;
  });

  const slotText = [
    mealTypeMap.breakfast ? `朝 ${mealTypeMap.breakfast}` : '',
    mealTypeMap.lunch ? `昼 ${mealTypeMap.lunch}` : '',
    mealTypeMap.dinner ? `夜 ${mealTypeMap.dinner}` : '',
    mealTypeMap.snack ? `間食 ${mealTypeMap.snack}` : ''
  ].filter(Boolean).join(' / ');

  return `食事: ${meals.length}件${slotText ? ` (${slotText})` : ''} / 約${round1(totals.kcal)}kcal / たんぱく質 ${round1(totals.protein)}g / 脂質 ${round1(totals.fat)}g / 糖質 ${round1(totals.carbs)}g`;
}

function buildExerciseLine(allRecords) {
  const exercises = Array.isArray(allRecords?.exercises) ? allRecords.exercises : [];
  if (!exercises.length) {
    return '運動: 今週は量が少なくても大丈夫です。無理なく戻れる形を優先で見ていきましょう。';
  }

  const minutes = exercises.reduce((sum, item) => sum + Number(item?.minutes || 0), 0);
  const kcal = exercises.reduce((sum, item) => sum + Number(item?.estimatedCalories || item?.kcal || item?.estimatedKcal || 0), 0);
  return `運動: ${exercises.length}件 / 合計 ${round1(minutes)}分 / 推定消費 ${round1(kcal)}kcal`;
}

function buildWeightLine(allRecords, longMemory) {
  const weights = Array.isArray(allRecords?.weights) ? allRecords.weights : [];
  if (weights.length) {
    const first = weights[0];
    const latest = weights[weights.length - 1];
    const diff = first?.weight != null && latest?.weight != null ? round1(Number(latest.weight) - Number(first.weight)) : null;
    const parts = [];
    if (latest?.weight != null) parts.push(`最新 ${latest.weight}kg`);
    if (latest?.bodyFat != null) parts.push(`体脂肪率 ${latest.bodyFat}%`);
    if (diff != null) parts.push(`週内変化 ${diff > 0 ? '+' : ''}${diff}kg`);
    return `体重: ${parts.join(' / ')}`;
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

function buildFlowLines(allRecords, signals) {
  const good = [];
  const rough = [];
  const active = Number(allRecords.activeDays || 0);
  const meals = Array.isArray(allRecords?.meals) ? allRecords.meals : [];
  const exercises = Array.isArray(allRecords?.exercises) ? allRecords.exercises : [];

  if (active >= 3) good.push('何かしら手が動いた日が続いています');
  if (meals.length >= 3) good.push('食事の記録が途切れにくい日がありました');
  if (exercises.length >= 2) good.push('身体を動かせた記録がありました');
  if (signals.recovery > 0) good.push('落ち着きや回復の言葉が見えました');

  if (signals.fatigue > 1) rough.push('疲れの声が続いた日がありました');
  if (signals.pain > 0) rough.push('痛みの影響が気になる場面がありました');
  if (signals.anxiety > 0) rough.push('不安が強い日がありました');

  const out = [];
  if (good.length) out.push(`良かった流れ: ${good[0]}。`);
  if (rough.length) out.push(`崩れやすかった流れ: ${rough[0]}。`);
  return out;
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
  if (signals.pain > 0) return '次の一手は、痛みを増やさない整え方だけに絞るのが安全です。';
  if (signals.fatigue > 0) return '次の一手は、睡眠と水分をひとつだけ整える、で十分です。';
  if (signals.hydration > 0) return '次の一手は、水分をこまめに足す意識だけで十分です。';
  if (signals.bowels > 0) return '次の一手は、便通や張りを見ながら、体の反応を先に優先しましょう。';
  if (/理屈|整理/.test(normalizeText(longMemory?.aiType))) return '次の一手は、食事か運動のどちらか一方だけを軸にすると判断がぶれにくいです。';
  return '次の一手は、送りやすい記録から一つだけ続ける、で十分です。';
}

async function buildWeeklyReport(params) {
  const longMemory = params?.longMemory || {};
  const recentMessages = Array.isArray(params?.recentMessages) ? params.recentMessages : [];
  const recentDailyRecords = Array.isArray(params?.recentDailyRecords) ? params.recentDailyRecords : [];
  const todayRecords = params?.todayRecords || {};
  const totalPoints = Number(params?.totalPoints || 0);
  const lineUserId = normalizeText(params?.lineUserId || '');

  let allRecords = recentDailyRecords.length
    ? flattenRecentRecords(recentDailyRecords)
    : {
        meals: Array.isArray(todayRecords?.meals) ? todayRecords.meals : [],
        exercises: Array.isArray(todayRecords?.exercises) ? todayRecords.exercises : [],
        weights: Array.isArray(todayRecords?.weights) ? todayRecords.weights : [],
        labs: Array.isArray(todayRecords?.labs) ? todayRecords.labs : [],
        activeDays: ['meals', 'exercises', 'weights', 'labs'].some((key) => Array.isArray(todayRecords?.[key]) && todayRecords[key].length) ? 1 : 0
      };

  /** 週次の食事件数・kcal は DB meal_logs の同一集合（dedupe後）に揃え、日次系と定義を合わせる */
  if (lineUserId) {
    const todayYmd = contextMemoryService.getTokyoTodayYmd();
    const fromYmd = contextMemoryService.addCalendarDaysToTokyoYmd(todayYmd, -6);
    const { deduped } = await mealLogQueryService.fetchAggregateMealLogsFromDb(
      lineUserId,
      fromYmd,
      todayYmd,
      'weekly_report_meals'
    );
    const legacyMeals = deduped.map((log) => ({
      mealType: 'unknown',
      kcal: log.kcal,
      protein: log.protein,
      fat: log.fat,
      carbs: log.carbs,
      estimatedNutrition: {
        kcal: log.kcal,
        protein: log.protein,
        fat: log.fat,
        carbs: log.carbs
      }
    }));
    allRecords = { ...allRecords, meals: legacyMeals };
  }

  const signals = collectMessageSignals(recentMessages);
  const lines = [
    '📊 今週の記録を、伴走の視点で眺めました。',
    `継続の感触: ${allRecords.activeDays || 0}日、何かしらの記録や会話がありました。`,
    buildMealsLine(allRecords),
    buildExerciseLine(allRecords)
  ];
  lines.push(...buildFlowLines(allRecords, signals));

  const weightLine = buildWeightLine(allRecords, longMemory);
  if (weightLine) lines.push(weightLine);

  const labLine = buildLabLine(allRecords);
  if (labLine) lines.push(labLine);

  if (totalPoints > 0) lines.push(pointsService.buildPointSummary(totalPoints));
  lines.push(inferWeeklyMeaning(allRecords, signals, longMemory));
  lines.push(buildNextStep(signals, longMemory));

  return lines.filter(Boolean).join('\n');
}

module.exports = {
  buildWeeklyReport
};
