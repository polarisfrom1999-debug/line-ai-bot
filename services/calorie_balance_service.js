'use strict';

const metabolismService = require('./metabolism_service');

function round0(value) {
  return Math.round(Number(value || 0));
}

function sumMeals(meals = []) {
  return round0(meals.reduce((sum, item) => sum + Number(item?.kcal || item?.estimatedNutrition?.kcal || 0), 0));
}

function sumExercises(exercises = []) {
  return round0(exercises.reduce((sum, item) => sum + Number(item?.estimatedCalories || item?.kcal || 0), 0));
}

function buildMealRunningTotalReply(parsedMeal, todayRecords) {
  const mealKcal = round0(parsedMeal?.estimatedNutrition?.kcal || 0);
  const total = sumMeals(todayRecords?.meals || []);
  return `ざっくり ${mealKcal}kcal くらいで見てよさそうです。\n今日ここまでの摂取は ${total}kcal です。`;
}

function buildExerciseRunningTotalReply(exerciseRecord, todayRecords) {
  const activityKcal = round0(exerciseRecord?.estimatedCalories || 0);
  const total = sumExercises(todayRecords?.exercises || []);
  return `${exerciseRecord?.name || '活動'}は ざっくり ${activityKcal}kcal くらいです。\n今日ここまでの運動消費は ${total}kcal です。`;
}

function buildDailySummaryReply(longMemory, todayRecords) {
  const snapshot = metabolismService.estimateEnergyBalance({
    longMemory,
    todayRecords,
  });

  const intake = round0(snapshot.intakeKcal || 0);
  const activity = round0(snapshot.activityCalories || 0);
  const bmr = round0(snapshot.estimatedBmr || 0);
  const output = round0(snapshot.outputKcal || snapshot.totalOutputEstimate || 0);
  const balance = Number.isFinite(snapshot.balanceKcal) ? round0(snapshot.balanceKcal) : null;

  const lines = [
    `今日は摂取 ${intake}kcal、運動消費 ${activity}kcal です。`,
    bmr ? `基礎代謝の目安は ${bmr}kcal です。` : null,
    output ? `ざっくり消費全体は ${output}kcal 前後で見ています。` : null,
    balance != null ? `今日のざっくり収支は ${balance > 0 ? '+' : ''}${balance}kcal です。` : null,
    metabolismService.buildMetabolismNote(snapshot),
  ].filter(Boolean);

  return lines.join('\n');
}

function buildWeeklyProgressReply(recentDailyRows = []) {
  if (!recentDailyRows.length) {
    return '今週ぶんの記録がまだ少ないので、食事や運動が少し入ると流れが見えやすくなります。';
  }

  const totalIntake = round0(recentDailyRows.reduce((sum, row) => sum + sumMeals(row.records?.meals || []), 0));
  const totalActivity = round0(recentDailyRows.reduce((sum, row) => sum + sumExercises(row.records?.exercises || []), 0));
  const activeDays = recentDailyRows.filter((row) => sumExercises(row.records?.exercises || []) > 0).length;
  const mealDays = recentDailyRows.filter((row) => sumMeals(row.records?.meals || []) > 0).length;

  return [
    `今週はここまで、食事記録が入った日は ${mealDays}日、活動記録が入った日は ${activeDays}日です。`,
    `ざっくり累計では、摂取 ${totalIntake}kcal / 運動消費 ${totalActivity}kcal です。`,
    activeDays >= 3 ? '小さな活動もちゃんと積み上がっています。' : '活動は小さくても十分です。少しずつ積めれば大丈夫です。'
  ].join('\n');
}

module.exports = {
  sumMeals,
  sumExercises,
  buildMealRunningTotalReply,
  buildExerciseRunningTotalReply,
  buildDailySummaryReply,
  buildWeeklyProgressReply,
};
