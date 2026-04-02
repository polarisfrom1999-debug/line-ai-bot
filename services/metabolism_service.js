'use strict';

function normalizeText(value) {
  return String(value || '').trim();
}

function toHalfWidth(text) {
  return normalizeText(text).replace(/[０-９．％．]/g, (s) => String.fromCharCode(s.charCodeAt(0) - 0xFEE0));
}

function round1(value) {
  return Math.round((Number(value || 0) + Number.EPSILON) * 10) / 10;
}

function round0(value) {
  return Math.round(Number(value || 0));
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, Number(value || 0)));
}

function extractNumber(value) {
  const safe = toHalfWidth(value).replace(/,/g, '');
  const match = safe.match(/-?[0-9]+(?:\.[0-9]+)?/);
  return match ? Number(match[0]) : null;
}

function normalizeWeightKg(value) {
  const num = extractNumber(value);
  if (num == null || num <= 0) return null;
  if (num > 250) return null;
  return round1(num);
}

function normalizeHeightCm(value) {
  const num = extractNumber(value);
  if (num == null || num <= 0) return null;
  if (num < 3) return round1(num * 100);
  if (num > 250) return null;
  return round1(num);
}

function normalizeAge(value) {
  const num = extractNumber(value);
  if (num == null || num <= 0) return null;
  if (num > 120) return null;
  return Math.round(num);
}

function normalizeBodyFatPercent(value) {
  const num = extractNumber(value);
  if (num == null || num < 0) return null;
  if (num > 80) return null;
  return round1(num);
}

function normalizeSex(value) {
  const safe = normalizeText(value).toLowerCase();
  if (!safe) return null;
  if (/^(male|man|m)$/i.test(safe) || /男性|男/.test(safe)) return 'male';
  if (/^(female|woman|f)$/i.test(safe) || /女性|女/.test(safe)) return 'female';
  return null;
}

function normalizeActivityLevel(value) {
  const safe = normalizeText(value).toLowerCase();
  if (!safe) return 'light';
  if (/sedentary|座り|ほぼ動かない|かなり少ない/.test(safe)) return 'sedentary';
  if (/active|高い|しっかり動く|運動多め/.test(safe)) return 'active';
  if (/very|athlete|かなり高い|非常に高い/.test(safe)) return 'very_active';
  return 'light';
}

function getActivityMultiplier(level) {
  if (level === 'sedentary') return 1.2;
  if (level === 'active') return 1.55;
  if (level === 'very_active') return 1.75;
  return 1.35;
}

function resolveProfile(profile = {}, longMemory = {}) {
  return {
    sex: normalizeSex(profile.sex || longMemory.sex || longMemory.gender),
    age: normalizeAge(profile.age || longMemory.age),
    weightKg: normalizeWeightKg(profile.weightKg || profile.weight || longMemory.weightKg || longMemory.weight),
    heightCm: normalizeHeightCm(profile.heightCm || profile.height || longMemory.heightCm || longMemory.height),
    bodyFatPercent: normalizeBodyFatPercent(profile.bodyFatPercent || profile.bodyFat || longMemory.bodyFatPercent || longMemory.bodyFat),
    activityLevel: normalizeActivityLevel(profile.activityLevel || longMemory.activityLevel),
    constitutionType: normalizeText(profile.constitutionType || longMemory.constitutionType),
    preferredName: normalizeText(profile.preferredName || longMemory.preferredName)
  };
}

function estimateLeanBodyMassKg(weightKg, bodyFatPercent) {
  if (weightKg == null || bodyFatPercent == null) return null;
  const ratio = clamp(bodyFatPercent / 100, 0.03, 0.7);
  return round1(weightKg * (1 - ratio));
}

function estimateBmrFromKatchMcArdle(weightKg, bodyFatPercent) {
  const lbm = estimateLeanBodyMassKg(weightKg, bodyFatPercent);
  if (lbm == null) return null;
  return round0(370 + (21.6 * lbm));
}

function estimateBmrFromMifflin({ sex, age, weightKg, heightCm }) {
  if (age == null || weightKg == null || heightCm == null) return null;
  const sexOffset = sex === 'male' ? 5 : sex === 'female' ? -161 : -78;
  return round0((10 * weightKg) + (6.25 * heightCm) - (5 * age) + sexOffset);
}

function estimateBasalMetabolism(input = {}) {
  const profile = resolveProfile(input.profile, input.longMemory);
  const fromKatch = estimateBmrFromKatchMcArdle(profile.weightKg, profile.bodyFatPercent);
  const fromMifflin = estimateBmrFromMifflin(profile);
  const estimatedBmr = fromKatch || fromMifflin || (profile.weightKg != null ? round0(profile.weightKg * 22) : null);

  return {
    ...profile,
    estimatedBmr,
    formula: fromKatch ? 'katch_mcardle' : fromMifflin ? 'mifflin_st_jeor' : estimatedBmr ? 'weight_x_22' : 'insufficient_data',
    leanBodyMassKg: estimateLeanBodyMassKg(profile.weightKg, profile.bodyFatPercent)
  };
}

function sumMealKcal(meals) {
  return (Array.isArray(meals) ? meals : []).reduce((sum, meal) => {
    return sum + Number(meal?.kcal || meal?.estimatedNutrition?.kcal || 0);
  }, 0);
}

function sumExerciseKcal(exercises) {
  return (Array.isArray(exercises) ? exercises : []).reduce((sum, item) => {
    return sum + Number(item?.estimatedCalories || item?.kcal || 0);
  }, 0);
}

function estimateStepBonusKcal(steps, weightKg) {
  const stepCount = Number(steps || 0);
  if (!stepCount || stepCount < 500) return 0;
  const kg = Number(weightKg || 60);
  return round0((stepCount / 1000) * (kg * 0.45));
}

function estimateDailyExpenditure(input = {}) {
  const metabolic = estimateBasalMetabolism(input);
  const bmr = Number(metabolic.estimatedBmr || 0);
  if (!bmr) {
    return {
      ...metabolic,
      estimatedTdee: null,
      activityMultiplier: null,
      activityCalories: 0,
      stepBonusCalories: 0,
      totalOutputEstimate: null
    };
  }

  const todayRecords = input.todayRecords || {};
  const directExerciseCalories = Number(input.activityCalories || sumExerciseKcal(todayRecords.exercises));
  const stepBonusCalories = estimateStepBonusKcal(input.steps || todayRecords.steps, metabolic.weightKg);
  const activityMultiplier = getActivityMultiplier(metabolic.activityLevel);
  const estimatedTdee = round0(bmr * activityMultiplier);
  const totalOutputEstimate = round0(estimatedTdee + directExerciseCalories + stepBonusCalories);

  return {
    ...metabolic,
    estimatedTdee,
    activityMultiplier,
    activityCalories: directExerciseCalories,
    stepBonusCalories,
    totalOutputEstimate
  };
}

function estimateEnergyBalance(input = {}) {
  const expenditure = estimateDailyExpenditure(input);
  const todayRecords = input.todayRecords || {};
  const intakeKcal = Number(input.intakeKcal || sumMealKcal(todayRecords.meals));
  const outputKcal = Number(expenditure.totalOutputEstimate || expenditure.estimatedTdee || 0);
  const balanceKcal = outputKcal ? round0(intakeKcal - outputKcal) : null;

  let tone = 'balanced';
  if (balanceKcal != null && balanceKcal > 350) tone = 'intake_high';
  else if (balanceKcal != null && balanceKcal < -450) tone = 'deficit_large';
  else if (balanceKcal != null && balanceKcal < -200) tone = 'deficit_moderate';

  return {
    ...expenditure,
    intakeKcal: round0(intakeKcal),
    outputKcal: outputKcal ? round0(outputKcal) : null,
    balanceKcal,
    tone
  };
}

function buildMetabolismNote(snapshot = {}) {
  if (!snapshot?.estimatedBmr) {
    return '基礎代謝の精度を上げるには、年齢・体重・体脂肪率、できれば身長があると見やすいです。';
  }

  if (snapshot.tone === 'intake_high') {
    return '今日は詰めて戻すより、次の食事を少し軽く整えるくらいで十分です。';
  }

  if (snapshot.tone === 'deficit_large') {
    return '削れ方が大きめなので、頑張りすぎで反動が出ないかも一緒に見たいです。';
  }

  if (snapshot.tone === 'deficit_moderate') {
    return '少し抑えられている流れですが、無理なく続くかも大事に見たいです。';
  }

  return '今日は大きく外しすぎず、流れを確認しやすい位置です。';
}


function buildBmrStatusMessage(currentSnapshot = {}, previousSnapshot = null) {
  if (!currentSnapshot?.estimatedBmr) {
    return '基礎代謝の目安を出すには、年齢・身長・体重・体脂肪率がそろうとかなり見やすいです。';
  }

  const lines = [`今の基礎代謝の目安は ${currentSnapshot.estimatedBmr}kcal 前後です。`];
  if (previousSnapshot?.estimatedBmr) {
    const diff = Number(currentSnapshot.estimatedBmr || 0) - Number(previousSnapshot.estimatedBmr || 0);
    if (diff >= 20) lines.push('前回より代謝の土台が少し上向きかもしれません。いい流れです。');
    else if (diff <= -20) lines.push('数値は日内変動もあるので、焦らず流れで見ていきましょう。');
  }
  if (currentSnapshot?.leanBodyMassKg && previousSnapshot?.leanBodyMassKg) {
    const leanDiff = Number(currentSnapshot.leanBodyMassKg || 0) - Number(previousSnapshot.leanBodyMassKg || 0);
    if (leanDiff >= 0.3) lines.push('除脂肪量の目安は少し上向きで、体の使い方が整ってきている可能性があります。');
  }
  return lines.join('\n');
}

function buildMetabolismSummaryText(input = {}) {
  const snapshot = estimateEnergyBalance(input);
  const lines = [];

  if (snapshot.estimatedBmr) lines.push(`基礎代謝目安: ${snapshot.estimatedBmr}kcal`);
  if (snapshot.estimatedTdee) lines.push(`生活込み消費目安: ${snapshot.estimatedTdee}kcal`);
  if (snapshot.activityCalories) lines.push(`運動消費: ${snapshot.activityCalories}kcal`);
  if (snapshot.stepBonusCalories) lines.push(`歩行上乗せ目安: ${snapshot.stepBonusCalories}kcal`);
  lines.push(`摂取: ${snapshot.intakeKcal || 0}kcal`);

  if (snapshot.outputKcal) {
    const sign = snapshot.balanceKcal > 0 ? '+' : '';
    lines.push(`ざっくり収支: ${sign}${snapshot.balanceKcal}kcal`);
  }

  lines.push(buildMetabolismNote(snapshot));
  return lines.filter(Boolean).join('\n');
}

module.exports = {
  resolveProfile,
  normalizeWeightKg,
  normalizeHeightCm,
  normalizeAge,
  normalizeBodyFatPercent,
  normalizeSex,
  normalizeActivityLevel,
  estimateLeanBodyMassKg,
  estimateBasalMetabolism,
  estimateDailyExpenditure,
  estimateEnergyBalance,
  buildMetabolismNote,
  buildMetabolismSummaryText,
  buildBmrStatusMessage
};
