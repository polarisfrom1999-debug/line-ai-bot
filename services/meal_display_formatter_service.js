'use strict';

function normalizeText(value) {
  return String(value || '').trim();
}

function round1(value) {
  return Math.round((Number(value || 0) + Number.EPSILON) * 10) / 10;
}

function formatMaybeKcal(n) {
  const x = Number(n);
  if (!Number.isFinite(x) || x <= 0) return '不明';
  return `約${round1(x).toLocaleString('ja-JP')} kcal`;
}

function formatMaybeG(n) {
  const x = Number(n);
  if (!Number.isFinite(x) || x < 0) return '不明';
  if (x === 0) return '0 g';
  return `約${round1(x)} g`;
}

function buildContentBulletLine(parsedMeal) {
  const items = Array.isArray(parsedMeal?.items) ? parsedMeal.items.filter(Boolean) : [];
  const rawJoin = items.map((it) => normalizeText(it)).filter(Boolean).join('・');
  if (rawJoin) return `・${rawJoin}`;
  const label = normalizeText(parsedMeal?.mealLabel || parsedMeal?.name || '');
  if (label) return `・${label}`;
  return '・内容は取得できた範囲で表示しています';
}

function pickMotivationComment(nut, todayTotals) {
  const kcal = Number(nut?.kcal || 0);
  const carbs = Number(nut?.carbs || 0);
  const protein = Number(nut?.protein || 0);
  const tK = Number(todayTotals?.kcal || 0);
  const tC = Number(todayTotals?.carbs || 0);

  if (carbs >= 90 && carbs > protein * 2.2) {
    return '糖質が多めなので、次は野菜やタンパク質を足すと良さそうです。';
  }
  if (protein >= 25) {
    return 'タンパク質がしっかり取れています。いい流れです。';
  }
  if (tK > 0 && tC > 0 && tC / Math.max(tK, 1) < 0.35) {
    return '今日のバランスはかなり良いです。';
  }
  if (kcal > 0 && kcal < 200) {
    return '軽めのタイミングも、記録できていていいですね。';
  }
  const seeds = [
    'いい流れです。',
    '無理なく続けられています。',
    '記録できていることがまず大きいです。',
  ];
  return seeds[Math.floor(Date.now() / 45000) % seeds.length];
}

/**
 * 1回分の食事見立て + 日次サマリ（摂取・運動・差分）を LINE 向けに整形
 */
function formatMealLineReply(parsedMeal, options = {}) {
  const todayTotals = options.todayTotals || null;
  const mealCount = options.mealCount != null ? Number(options.mealCount) : null;
  const exerciseBurnKcal = Number(options.exerciseBurnKcal || 0);
  const conf = Number(parsedMeal?.confidence || 0);
  const hedgeLowConf = conf > 0 && conf < 0.7;

  const nut = parsedMeal?.estimatedNutrition || parsedMeal?.estimated_nutrition || {};
  const kcal = round1(nut.kcal || 0);
  const protein = round1(nut.protein || 0);
  const fat = round1(nut.fat || 0);
  const carbs = round1(nut.carbs || 0);

  const baseComment = normalizeText(parsedMeal?.comment || '');
  const comment = baseComment || pickMotivationComment(nut, todayTotals);

  const receivedHead = '🍽️ 食事として受け取りました';

  const lines = [
    receivedHead,
    '【内容】',
    buildContentBulletLine(parsedMeal),
    hedgeLowConf ? '（自信度がまだ高くないので、見立ては「だいたい」くらいで見てください）' : '',
    `🔥 エネルギー：${kcal > 0 ? formatMaybeKcal(kcal) : '不明'}`,
    `💪 タンパク質：${protein > 0 ? formatMaybeG(protein) : '不明'}`,
    `🫒 脂質：${fat > 0 ? formatMaybeG(fat) : '不明'}`,
    `🍞 糖質：${carbs > 0 ? formatMaybeG(carbs) : '不明'}`,
  ].filter((x) => normalizeText(x));

  const hasDay =
    todayTotals &&
    (Number(todayTotals.kcal || 0) +
      Number(todayTotals.protein || 0) +
      Number(todayTotals.fat || 0) +
      Number(todayTotals.carbs || 0) > 0);

  if (hasDay) {
    lines.push('', '📈 本日の合計');
    if (mealCount != null && Number.isFinite(mealCount)) {
      lines.push(`🍽️ 食事件数：${mealCount}件`);
    }
    lines.push(
      `🔥 摂取：${formatMaybeKcal(todayTotals.kcal)}`,
      `💪 タンパク質：${formatMaybeG(todayTotals.protein)}`,
      `🫒 脂質：${formatMaybeG(todayTotals.fat)}`,
      `🍞 糖質：${formatMaybeG(todayTotals.carbs)}`,
    );
    lines.push(`🏃‍♂️ 運動消費：${formatMaybeKcal(exerciseBurnKcal)}`);
    const net = Number(todayTotals.kcal || 0) - exerciseBurnKcal;
    lines.push(`🔥 摂取 − 消費：${formatMaybeKcal(net)}`);
  }

  lines.push('', `ひとこと：${comment}`);

  return lines.join('\n');
}

module.exports = {
  formatMealLineReply,
  pickMotivationComment,
  round1,
};
