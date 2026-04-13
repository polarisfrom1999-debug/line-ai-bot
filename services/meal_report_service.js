'use strict';

const { supabase } = require('./supabase_service');

/**
 * 今日の合計摂取量をデータベースから取得する関数
 */
async function getDailyTotal(userId) {
  if (!userId) return null;

  // 日本時間の「今日 0:00」から「今日 23:59」の範囲を設定
  const now = new Date();
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString();
  const todayEnd = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59).toISOString();

  const { data, error } = await supabase
    .from('meals')
    .select('estimated_kcal, protein_g, fat_g, carbs_g')
    .eq('user_id', userId)
    .gte('created_at', todayStart)
    .lte('created_at', todayEnd);

  if (error || !data) {
    console.error('データ取得エラー:', error);
    return null;
  }

  // 取得したデータを全て足し合わせる
  return data.reduce((acc, cur) => ({
    kcal: acc.kcal + (Number(cur.estimated_kcal) || 0),
    protein: acc.protein + (Number(cur.protein_g) || 0),
    fat: acc.fat + (Number(cur.fat_g) || 0),
    carbs: acc.carbs + (Number(cur.carbs_g) || 0)
  }), { kcal: 0, protein: 0, fat: 0, carbs: 0 });
}

/**
 * LINEに送る「🥗 形式」のメッセージを組み立てる関数
 */
async function buildFullMealReport({ result, userId }) {
  // 今回の解析結果
  const current = {
    items: Array.isArray(result.items) ? result.items.join('、') : '解析中',
    kcal: Math.round(result.estimatedNutrition?.kcal || 0),
    protein: Math.round(result.estimatedNutrition?.protein || 0),
    fat: Math.round(result.estimatedNutrition?.fat || 0),
    carbs: Math.round(result.estimatedNutrition?.carbs || 0),
    comment: result.comment || '今日も一歩、健康に近づきましたね。'
  };

  // レポートの作成
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

  // 今日の合計（積算）を計算して追加
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
