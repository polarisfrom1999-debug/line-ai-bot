'use strict';

const { supabase } = require('./supabase_service');

/**
 * meal_report_service.js
 *
 * 目的:
 * 1. Supabaseから当日の合計摂取栄養素を取得する
 * 2. LINE向けの見やすい食事レポート文を作る
 */

function normalizeText(value, fallback = '') {
  const safe = String(value || '').trim();
  return safe || fallback;
}

function normalizeNumber(value, fallback = 0) {
  const num = Number(value);
  return Number.isFinite(num) ? num : fallback;
}

/**
 * 今日の合計摂取量を計算して取得する
 */
async function getDailyTotal(userId) {
  if (!userId) return null;

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const tomorrow = new Date(today);
  tomorrow.setDate(tomorrow.getDate() + 1);

  const { data, error } = await supabase
    .from('meals')
    .select('estimated_kcal, protein_g, fat_g, carbs_g')
    .eq('user_id', userId)
    .gte('created_at', today.toISOString())
    .lt('created_at', tomorrow.toISOString());

  if (error || !data) {
    console.error('[meal_report_service] Error fetching daily totals:', error?.message || error);
    return null;
  }

  return data.reduce((acc, cur) => ({
    kcal: acc.kcal + (Number(cur.estimated_kcal) || 0),
    protein: acc.protein + (Number(cur.protein_g) || 0),
    fat: acc.fat + (Number(cur.fat_g) || 0),
    carbs: acc.carbs + (Number(cur.carbs_g) || 0),
  }), { kcal: 0, protein: 0, fat: 0, carbs: 0 });
}

/**
 * レポート用メッセージを構築する
 */
async function buildFullMealReport({ result, userId }) {
  const nut = result?.estimated_nutrition || result?.estimatedNutrition || {};

  const mealData = {
    items: Array.isArray(result?.items) && result.items.length
      ? result.items
      : ['内容を確認中'],
    kcal: Math.round(normalizeNumber(
      result?.estimated_kcal ?? nut.kcal,
      0
    )),
    protein: Math.round(normalizeNumber(
      result?.protein_g ?? nut.protein,
      0
    )),
    fat: Math.round(normalizeNumber(
      result?.fat_g ?? nut.fat,
      0
    )),
    carbs: Math.round(normalizeNumber(
      result?.carbs_g ?? nut.carbs,
      0
    )),
    comment: normalizeText(
      result?.comment || result?.ai_comment,
      '今日もひとつ記録できましたね。'
    ),
  };

  const lines = [
    '📸 お食事の解析が終わりました！✨',
    '━━━━━━━━━━━━━',
    `【メニュー 🥗】: ${mealData.items.join('、')}`,
    `エネルギー 🔥: ${mealData.kcal} kcal`,
    `タンパク質 💪: ${mealData.protein} g`,
    `脂質 🍳: ${mealData.fat} g`,
    `糖質 🍞: ${mealData.carbs} g`,
    '━━━━━━━━━━━━━',
    `💬 アドバイス: ${mealData.comment}`,
  ];

  const dailyTotal = await getDailyTotal(userId);
  if (dailyTotal) {
    lines.push('');
    lines.push('📈 本日の合計（積算）');
    lines.push('┈┈┈┈┈┈┈┈┈┈┈┈┈');
    lines.push(`エネルギー 🔥: ${Math.round(dailyTotal.kcal)} kcal`);
    lines.push(`タンパク質 💪: ${Math.round(dailyTotal.protein)} g`);
    lines.push(`脂質 🍳: ${Math.round(dailyTotal.fat)} g`);
    lines.push(`糖質 🍞: ${Math.round(dailyTotal.carbs)} g`);
    lines.push('━━━━━━━━━━━━━');

    if (dailyTotal.kcal >= 1800) {
      lines.push('✨ 今日はしっかり栄養が摂れていますね。');
    }
  }

  return lines.join('\n');
}

module.exports = {
  buildFullMealReport,
  getDailyTotal,
};
