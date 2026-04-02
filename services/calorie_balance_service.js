'use strict';

const contextMemoryService = require('./context_memory_service');
const metabolismService = require('./metabolism_service');
const { getBusinessDayKey, getBusinessWeekKey } = require('./day_boundary_service');

function round0(v) {
  return Math.round(Number(v || 0));
}

function normalizeText(value) {
  return String(value || '').trim();
}

function sumMealKcal(meals = []) {
  return round0((Array.isArray(meals) ? meals : []).reduce((sum, meal) => sum + Number(meal?.kcal || meal?.estimatedNutrition?.kcal || 0), 0));
}

function sumExerciseKcal(exercises = []) {
  return round0((Array.isArray(exercises) ? exercises : []).reduce((sum, item) => sum + Number(item?.estimatedCalories || item?.kcal || 0), 0));
}

function buildPositiveComment(recordType, total, delta) {
  if (recordType === 'meal') {
    if (delta <= 180) return '小さくてもちゃんと記録できたのがいい流れです。';
    if (total <= 1400) return '今日の流れが見えやすくなってきました。';
    return '記録が積み上がって、今日の全体像がかなり見やすくなっています。';
  }
  if (recordType === 'exercise') {
    if (delta <= 40) return '小さな動きもちゃんと前進です。';
    if (total <= 180) return '日常の中で体を動かせていて、とてもいい流れです。';
    return '活動量がしっかり積み上がっています。かなり良いです。';
  }
  return '記録が積み上がってきました。';
}

async function buildMealRunningTotalReply({ userId, mealRecord, targetDateKey, now = new Date() }) {
  const dateKey = targetDateKey || getBusinessDayKey(now);
  const todayRecords = await contextMemoryService.getDailyRecordsByKey(userId, dateKey);
  const total = sumMealKcal(todayRecords.meals);
  const delta = round0(mealRecord?.kcal || mealRecord?.estimatedNutrition?.kcal || 0);

  return [
    `今回は 約${delta}kcal として記録しました。`,
    `${dateKey} のここまでの摂取は 約${total}kcal です。`,
    buildPositiveComment('meal', total, delta),
  ].join('\n');
}

async function buildExerciseRunningTotalReply({ userId, exerciseRecord, targetDateKey, now = new Date() }) {
  const dateKey = targetDateKey || getBusinessDayKey(now);
  const todayRecords = await contextMemoryService.getDailyRecordsByKey(userId, dateKey);
  const total = sumExerciseKcal(todayRecords.exercises);
  const delta = round0(exerciseRecord?.estimatedCalories || exerciseRecord?.kcal || 0);

  return [
    `今回は 約${delta}kcal 消費として見ています。`,
    `${dateKey} のここまでの運動消費は 約${total}kcal です。`,
    buildPositiveComment('exercise', total, delta),
  ].join('\n');
}

async function buildDailyBalanceReply({ userId, targetDateKey, now = new Date() }) {
  const dateKey = targetDateKey || getBusinessDayKey(now);
  const longMemory = await contextMemoryService.getLongMemory(userId);
  const dayRecords = await contextMemoryService.getDailyRecordsByKey(userId, dateKey);
  const snapshot = metabolismService.estimateEnergyBalance({ longMemory, todayRecords: dayRecords });

  const lines = [
    `${dateKey} のまとめです。`,
    `摂取: ${round0(snapshot.intakeKcal)}kcal`,
    `基礎代謝目安: ${round0(snapshot.estimatedBmr)}kcal`,
    `運動消費: ${round0(snapshot.activityCalories)}kcal`,
  ];

  if (snapshot.outputKcal != null) {
    const sign = snapshot.balanceKcal > 0 ? '+' : '';
    lines.push(`ざっくり収支: ${sign}${round0(snapshot.balanceKcal)}kcal`);
  }

  lines.push(metabolismService.buildMetabolismNote(snapshot));
  return lines.join('\n');
}

async function buildWeeklyBalanceReply({ userId, now = new Date() }) {
  const weekKey = getBusinessWeekKey(now);
  const days = await contextMemoryService.getRecentDailyRecords(userId, 10);
  const weeklyDays = days.filter((d) => String(d.weekKey || '') === weekKey || String(d.date || '') >= weekKey);
  const records = weeklyDays.reduce((acc, day) => {
    acc.meals.push(...(day.records?.meals || []));
    acc.exercises.push(...(day.records?.exercises || []));
    return acc;
  }, { meals: [], exercises: [] });

  const intake = sumMealKcal(records.meals);
  const exercise = sumExerciseKcal(records.exercises);
  const lines = [
    `今週（${weekKey}開始）の途中経過です。`,
    `摂取は 約${intake}kcal、運動消費は 約${exercise}kcal です。`,
  ];

  if (!records.meals.length && !records.exercises.length) {
    lines.push('まだ途中経過は少なめですが、ここから十分立て直せます。');
  } else if (records.meals.length && records.exercises.length) {
    lines.push('食事も活動も両方見えていて、自己管理しやすい流れです。');
  } else if (records.meals.length) {
    lines.push('食事の流れは見えてきています。今週は小さな活動も足せるとさらに見やすくなります。');
  } else {
    lines.push('活動の流れは見えています。食事の記録が少し増えると、今週のバランスがもっと分かりやすくなります。');
  }

  return lines.join('\n');
}

module.exports = {
  sumMealKcal,
  sumExerciseKcal,
  buildMealRunningTotalReply,
  buildExerciseRunningTotalReply,
  buildDailyBalanceReply,
  buildWeeklyBalanceReply,
};
