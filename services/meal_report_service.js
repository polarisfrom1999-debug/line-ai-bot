'use strict';

const { supabase } = require('./supabase_service');

/**
 * 今日の合計摂取量を計算して取得する
 */
async function getDailyTotal(userId) {
  if (!userId) return null;

  // 今日の「開始時刻(00:00)」と「終了時刻(23:59)」を設定
  const now = new Date();
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString();
  const todayEnd = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59).toISOString();

  // Supabaseから今日の食事データを取得
  const { data, error } = await supabase
    .from('meals')
    .select('estimated_kcal, protein_g, fat_g, carbs_g')
    .eq('user_id', userId)
    .gte('created_at', todayStart)
    .lte('created_at', todayEnd);

  if (error || !data) {
    console.error('積算データの取得失敗:', error);
    return null;
  }

  // 合計を計算
  return data.reduce((acc, cur) => ({
    kcal: acc.kcal + (Number(cur.estimated_kcal) || 0),
    protein: acc.protein + (Number(cur.protein_g) || 0),
    fat: acc.fat + (Number(cur.fat_g) || 0),
    carbs: acc.carbs + (Number(cur.carbs_g) || 0)
  }), { kcal: 0, protein: 0, fat: 0, carbs: 0 });
}

/**
 * LINE送信用の「食事分析レポート」テキストを組み立てる
 */
async function buildFullMealReport({ result, userId }) {
  // 今回の解析結果（Geminiが返してきた値）
  const current = {
    items: Array.isArray(result.items) ? result.items.join('、') : '解析中',
    kcal: Math.round(result.estimatedNutrition?.kcal || 0),
    protein: Math.round(result.estimatedNutrition?.protein || 0),
    fat: Math.round(result.estimatedNutrition?.fat || 0),
    carbs: Math.round(result.estimatedNutrition?.carbs || 0),
    comment: result.comment || '今日も一歩、健康に近づきましたね。'
  };

  // 1. 今回の食事レポート部分
  const lines = [
    '【食事分析レポート】',
    '━━━━━━━━━━━━━',
    `🥗 メニュー: ${current.items}`,
    `🔥 エネルギー: ${current.kcal} kcal`,
    `💪 たんぱく質: ${current.protein}g`,
    `🍳 脂質: ${current.fat}g`,
    `🍞 糖質: ${current.carbs}g`,
    '━━━━━━━━━━━━━',
    '牛込先生のアドバイス:',
    `「${current.comment}」`,
    ''
  ];

  // 2. 積算データの取得と追加
  const dailyTotal = await getDailyTotal(userId);
  if (dailyTotal) {
    lines.push('📈 本日の合計（積算）');
    lines.push('┈┈┈┈┈┈┈┈┈┈┈┈┈');
    lines.push(`  エネルギー: ${Math.round(dailyTotal.kcal)} kcal`);
    lines.push(`  たんぱく質: ${Math.round(dailyTotal.protein)}g`);
    lines.push(`  脂質: ${Math.round(dailyTotal.fat)}g`);
    lines.push(`  糖質: ${Math.round(dailyTotal.carbs)}g`);
    lines.push('━━━━━━━━━━━━━');
  }

  return lines.join('\n');
}

module.exports = { buildFullMealReport, getDailyTotal };
