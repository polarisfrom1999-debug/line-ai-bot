'use strict';

const mealLogQueryService = require('./meal_log_query_service');
const contextMemoryService = require('./context_memory_service');

/**
 * 今日（東京日付）の食事集計（meal_logs 由来、dedupe 済み）
 */
async function fetchTodayNutritionSummary(lineUserId) {
  const todayYmd = contextMemoryService.getTokyoTodayYmd();
  const { totals } = await mealLogQueryService.fetchAggregateMealLogsFromDb(
    lineUserId,
    todayYmd,
    todayYmd,
    'daily_nutrition_summary'
  );
  return {
    ymd: todayYmd,
    kcal: Number(totals.kcal || 0),
    protein: Number(totals.protein || 0),
    fat: Number(totals.fat || 0),
    carbs: Number(totals.carbs || 0),
    meal_count: Number(totals.count || 0),
  };
}

module.exports = {
  fetchTodayNutritionSummary,
};
