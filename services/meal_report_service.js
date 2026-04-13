'use strict';

const { supabase } = require('./supabase_service');

/**
 * 本日の合計（積算）をSupabaseから計算する内部関数
 */
async function getDailyTotalInternal(userId) {
  if (!userId) return null;
  const now = new Date();
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString();
  const todayEnd = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59).toISOString();

  const { data, error } = await supabase
    .from('meals')
    .select('estimated_kcal, protein_g, fat_g, carbs_g')
    .eq('user_id', userId)
    .gte('created_at', todayStart)
    .lte('created_at', todayEnd);

  if (error || !data || data.length === 0) return null;

  return data.reduce((acc, cur) => ({
    kcal: acc.kcal + (Number(cur.estimated_kcal) || 0),
    protein: acc.protein + (Number(cur.protein_g) || 0),
    fat: acc.fat + (Number(cur.fat_g) || 0),
    carbs: acc.carbs + (Number(cur.carbs_g) || 0)
  }), { kcal: 0, protein: 0, fat: 0, carbs: 0 });
}

/**
 * AIの解析結果を、LINE用の賑やかでやさしい文章に整えます
 */
async function buildFullMealReport({ result, userId }) {
  const lines = [];

  if (result.isMealImage) {
    lines.push('📸 お食事の解析が終わりました！✨');
    lines.push('━━━━━━━━━━━━━');
    lines.push(`【メニュー 🥗】: ${(result.items || []).join('、')}`);
    
    const nut = result.estimated_nutrition || {};
    lines.push(`エネルギー 🔥: ${Math.round(nut.kcal || 0)} kcal`);
    lines.push(`タンパク質 💪: ${Math.round(nut.protein || 0)} g`);
    lines.push(`脂質 🍳: ${Math.round(nut.fat || 0)} g`);
    lines.push(`糖質 🍞: ${Math.round(nut.carbs || 0)} g`);
    lines.push('━━━━━━━━━━━━━');
    lines.push(`💬 牛込先生のアドバイス:\n「${result.comment || '今日も一歩、健康に近づきましたね。'}」`);
    lines.push('');

    // 今日の合計を表示
    const dailyTotal = await getDailyTotalInternal(userId);
    if (dailyTotal) {
      lines.push('📈 本日の合計（積算）');
      lines.push('┈┈┈┈┈┈┈┈┈┈┈┈┈');
      lines.push(`  エネルギー 🔥: ${Math.round(dailyTotal.kcal)} kcal`);
      lines.push(`  タンパク質 💪: ${Math.round(dailyTotal.protein)} g`);
      lines.push(`  脂質 🍳: ${Math.round(dailyTotal.fat)} g`);
      lines.push(`  糖質 🍞: ${Math.round(dailyTotal.carbs)} g`);
      lines.push('━━━━━━━━━━━━━');
    }

  } else {
    lines.push('食事の画像ではないようです。食べ物の写真を送ってくださいね！😊');
  }

  return lines.join('\n');
}

module.exports = { buildFullMealReport };
