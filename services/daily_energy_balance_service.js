'use strict';

const { supabase } = require('./supabase_service');
const { ensureUser } = require('./user_service');
const mealLogQueryService = require('./meal_log_query_service');
const contextMemoryService = require('./context_memory_service');
const activityLogRepository = require('../repositories/activity_log_repository');

function tokyoMealDayRangeIsoFromYmd(ymd) {
  const endExclusive = mealLogQueryService.addOneDayYmd(ymd);
  if (!endExclusive) return { startIso: '', endIso: '' };
  return {
    startIso: `${ymd}T00:00:00+09:00`,
    endIso: `${endExclusive}T00:00:00+09:00`,
  };
}

/**
 * 今日の食事摂取（meal_logs）と運動消費（activity_logs）および差分。
 */
async function fetchTodayEnergyBalance(lineUserId) {
  const uid = String(lineUserId || '').trim();
  const ymd = contextMemoryService.getTokyoTodayYmd();
  const { totals } = await mealLogQueryService.fetchAggregateMealLogsFromDb(
    uid,
    ymd,
    ymd,
    'daily_energy_balance'
  );
  const intakeKcal = Number(totals.kcal || 0);
  let exerciseBurnKcal = 0;
  if (uid && supabase) {
    try {
      const user = await ensureUser(supabase, uid, 'Asia/Tokyo');
      if (user?.id) {
        const { startIso, endIso } = tokyoMealDayRangeIsoFromYmd(ymd);
        if (startIso && endIso) {
          const bur = await activityLogRepository.getActivityBurnInRange(user.id, startIso, endIso);
          exerciseBurnKcal = Number(bur?.totalKcal || 0);
        }
      }
    } catch (_e) {
      exerciseBurnKcal = 0;
    }
  }
  const out = {
    ymd,
    intakeKcal,
    exerciseBurnKcal,
    netKcal: intakeKcal - exerciseBurnKcal,
    mealCount: Number(totals.count || 0),
    protein: Number(totals.protein || 0),
    fat: Number(totals.fat || 0),
    carbs: Number(totals.carbs || 0),
  };
  console.info('[daily_energy_balance_summary]', {
    user_id: uid,
    date: out.ymd,
    intake_calories: out.intakeKcal,
    exercise_calories: out.exerciseBurnKcal,
    net_calories: out.netKcal,
  });
  return out;
}

module.exports = {
  fetchTodayEnergyBalance,
  tokyoMealDayRangeIsoFromYmd,
};
