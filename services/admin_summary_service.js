'use strict';

const pointsService = require('./points_service');
const conversationFactResolverService = require('./conversation_fact_resolver_service');
const contextMemoryService = require('./context_memory_service');

function round1(value) {
  return Math.round((Number(value || 0) + Number.EPSILON) * 10) / 10;
}

function computeConsecutiveDays(days = []) {
  if (!Array.isArray(days) || !days.length) return 0;
  const activeDates = days
    .filter((day) => ['meals', 'exercises', 'weights', 'labs'].some((key) => Array.isArray(day?.records?.[key]) && day.records[key].length))
    .map((day) => day.date)
    .sort();
  if (!activeDates.length) return 0;

  let streak = 1;
  for (let i = activeDates.length - 1; i > 0; i -= 1) {
    const current = new Date(`${activeDates[i]}T00:00:00+09:00`);
    const previous = new Date(`${activeDates[i - 1]}T00:00:00+09:00`);
    const diff = Math.round((current - previous) / 86400000);
    if (diff === 1) streak += 1;
    else break;
  }
  return streak;
}

async function buildAdminSummary(lineUserId) {
  const [{ merged }, recentDailyRecords, totalPoints] = await Promise.all([
    conversationFactResolverService.buildMergedProfile(lineUserId),
    contextMemoryService.getRecentDailyRecords(lineUserId, 31),
    contextMemoryService.getPoints(lineUserId)
  ]);

  const week = recentDailyRecords.slice(-7);
  const month = recentDailyRecords;
  const activeWeekDays = week.filter((day) => ['meals', 'exercises', 'weights', 'labs'].some((key) => Array.isArray(day?.records?.[key]) && day.records[key].length)).length;
  const activeMonthDays = month.filter((day) => ['meals', 'exercises', 'weights', 'labs'].some((key) => Array.isArray(day?.records?.[key]) && day.records[key].length)).length;
  const latestDay = month[month.length - 1] || null;
  const latestWeight = latestDay?.records?.weights?.slice(-1)[0] || null;
  const latestMealCount = latestDay?.records?.meals?.length || 0;
  const latestExerciseCount = latestDay?.records?.exercises?.length || 0;
  const streak = computeConsecutiveDays(month);

  const lines = [
    '管理確認メモです。',
    `ユーザー: ${merged.preferredName || '未設定'}`,
    merged.weight || merged.bodyFat
      ? `最新体組成: ${[merged.weight ? `体重 ${merged.weight}` : '', merged.bodyFat ? `体脂肪率 ${merged.bodyFat}` : ''].filter(Boolean).join(' / ')}`
      : '最新体組成: まだ未登録',
    merged.goal ? `目標: ${merged.goal}` : '目標: まだ未登録',
    `直近7日: ${activeWeekDays}日アクティブ`,
    `直近31日: ${activeMonthDays}日アクティブ / 継続 ${streak}日`,
    latestDay
      ? `最新日の内訳: 食事 ${latestMealCount}件 / 運動 ${latestExerciseCount}件${latestWeight?.weight != null ? ` / 体重 ${round1(latestWeight.weight)}kg` : ''}`
      : '最新日の内訳: まだ記録なし',
    pointsService.buildPointSummary(totalPoints),
    '特典管理: ポイント残高と継続日数を基準に、整骨院特典の利用判断へつなげられる状態です。'
  ];

  return lines.filter(Boolean).join('\n');
}

module.exports = {
  buildAdminSummary
};
