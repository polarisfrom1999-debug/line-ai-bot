'use strict';

/**
 * AIの解析結果を、LINE用の賑やかでやさしい文章に整えます
 */
async function buildFullMealReport({ result, userId }) {
  const lines = [];

  // 食事として判定された場合
  if (result.isMealImage) {
    lines.push('📸 お食事の解析が終わりました！✨');
    lines.push('');

    // メニューを表示
    if (result.items && result.items.length > 0) {
      lines.push('【メニュー 🥗】');
      lines.push(result.items.join('、'));
      lines.push('');
    }

    // 栄養素を表示（ご指定の絵文字をすべて配置）
    if (result.estimatedNutrition) {
      const nut = result.estimatedNutrition;
      lines.push('【推定栄養素 ✨】');
      lines.push(`エネルギー 🔥: ${nut.kcal || 0} kcal`);
      lines.push(`タンパク質 💪: ${nut.protein || 0} g`);
      lines.push(`脂質 🍳: ${nut.fat || 0} g`);
      lines.push(`糖質 🍞: ${nut.carbs || 0} g`);
      lines.push('');
    }

    // アドバイス
    if (result.comment) {
      lines.push(`💬 ${result.comment}`);
    } else {
      lines.push('💬 今日もバランスを意識して、素敵な一日を過ごしましょう！🌈');
    }

  } else {
    // 食事ではないと判断されたとき
    lines.push('すみません、この画像からはお食事の内容がうまく読み取れませんでした 💦');
    lines.push('お料理や食品ラベルの写真を送っていただければ、また全力で解析しますね！😊');
  }

  return lines.join('\n');
}

module.exports = { buildFullMealReport };
