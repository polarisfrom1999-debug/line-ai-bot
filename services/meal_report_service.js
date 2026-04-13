'use strict';

// 道具を取り寄せる際の名前が間違っていたのを修正しました
const { getDailyTotal } = require('./meal_report_daily_total_service');

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

    // 今日の合計を計算して表示
    if (getDailyTotal) {
      const dailyTotal = await getDailyTotal(userId);
      if (dailyTotal) {
        lines.push('📈 本日の合計（積算）');
        lines.push('┈┈┈┈┈┈┈┈┈┈┈┈┈');
        lines.push(`  エネルギー 🔥: ${Math.round(dailyTotal.kcal)} kcal`);
        lines.push(`  タンパク質 💪: ${Math.round(dailyTotal.protein)} g`);
        lines.push(`  脂質 🍳: ${Math.round(dailyTotal.fat)} g`);
        lines.push(`  糖質 🍞: ${Math.round(dailyTotal.carbs)} g`);
        lines.push('━━━━━━━━━━━━━');
      }
    }

  } else {
    lines.push('食事の画像ではないようです。食べ物の写真を送ってくださいね！😊');
  }

  return lines.join('\n');
}

module.exports = { buildFullMealReport };
