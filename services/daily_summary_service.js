'use strict';

const { supabase } = require('./supabase_service');
const { fmt } = require('../utils/formatters');
const { buildEnergySummaryText } = require('./energy_service');

const TZ = 'Asia/Tokyo';

function currentDateYmdInTZ() {
  const now = new Date();
  const jp = new Date(now.toLocaleString('en-US', { timeZone: TZ }));
  const y = jp.getFullYear();
  const m = String(jp.getMonth() + 1).padStart(2, '0');
  const d = String(jp.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

async function getTodayRows(userId) {
  const ymd = currentDateYmdInTZ();
  const start = `${ymd}T00:00:00+09:00`;
  const end = `${ymd}T23:59:59+09:00`;

  const [mealsRes, activitiesRes, weightsRes] = await Promise.all([
    supabase.from('meal_logs').select('meal_label, estimated_kcal, eaten_at, protein_g, fat_g, carbs_g').eq('user_id', userId).gte('eaten_at', start).lte('eaten_at', end).order('eaten_at', { ascending: true }),
    supabase.from('activity_logs').select('exercise_summary, estimated_activity_kcal, logged_at').eq('user_id', userId).gte('logged_at', start).lte('logged_at', end).order('logged_at', { ascending: true }),
    supabase.from('weight_logs').select('weight_kg, body_fat_pct, logged_at').eq('user_id', userId).gte('logged_at', start).lte('logged_at', end).order('logged_at', { ascending: false }).limit(1),
  ]);

  if (mealsRes.error) throw mealsRes.error;
  if (activitiesRes.error) throw activitiesRes.error;
  if (weightsRes.error) throw weightsRes.error;

  return {
    meals: mealsRes.data || [],
    activities: activitiesRes.data || [],
    latestWeight: (weightsRes.data || [])[0] || null,
  };
}

function sum(list, key) {
  return (list || []).reduce((acc, row) => acc + (Number(row?.[key]) || 0), 0);
}

function buildDailySummaryText({ user = {}, rows = {} }) {
  const meals = rows.meals || [];
  const activities = rows.activities || [];
  const latestWeight = rows.latestWeight || null;

  const intakeKcal = Math.round(sum(meals, 'estimated_kcal'));
  const activityKcal = Math.round(sum(activities, 'estimated_activity_kcal'));
  const protein = Math.round(sum(meals, 'protein_g'));
  const fat = Math.round(sum(meals, 'fat_g'));
  const carbs = Math.round(sum(meals, 'carbs_g'));

  const mealPreview = meals.slice(-3).map((row) => row.meal_label).filter(Boolean).join(' / ');
  const activityPreview = activities.slice(-3).map((row) => row.exercise_summary).filter(Boolean).join(' / ');

  const lines = [
    '今日のまとめです。',
    meals.length ? `食事: ${meals.length}回` : '食事: まだ記録なし',
    meals.length && mealPreview ? `内容: ${mealPreview}` : null,
    meals.length ? `摂取合計: ${fmt(intakeKcal)} kcal` : null,
    meals.length ? `栄養の目安: たんぱく質 ${fmt(protein)}g / 脂質 ${fmt(fat)}g / 糖質 ${fmt(carbs)}g` : null,
    activities.length ? `活動: ${activityPreview || `${activities.length}件`}` : '活動: まだ記録なし',
    activities.length ? `活動消費合計: ${fmt(activityKcal)} kcal` : null,
    latestWeight?.weight_kg != null ? `今日の体重: ${fmt(latestWeight.weight_kg)}kg` : null,
    '',
    buildEnergySummaryText({
      estimatedBmr: user.estimated_bmr || 0,
      estimatedTdee: user.estimated_tdee || 0,
      intakeKcal,
      activityKcal,
    }),
  ].filter(Boolean);

  if (!meals.length && !activities.length) {
    return '今日はまだ記録が少なめです。食事でも体重でも、ひとつ送ってもらえたら流れを一緒に見ていけます。';
  }

  return lines.join('\n');
}

module.exports = {
  getTodayRows,
  buildDailySummaryText,
  currentDateYmdInTZ,
};
