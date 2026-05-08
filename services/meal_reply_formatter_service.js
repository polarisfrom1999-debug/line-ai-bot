'use strict';

function normalizeText(value) {
  return String(value || '').trim();
}

function round1(value) {
  return Math.round((Number(value || 0) + Number.EPSILON) * 10) / 10;
}

function formatKcal(n) {
  const x = Number(n);
  if (!Number.isFinite(x) || x <= 0) return null;
  return `約${Math.round(x).toLocaleString('ja-JP')} kcal`;
}

function formatG(n) {
  const x = Number(n);
  if (!Number.isFinite(x) || x < 0) return null;
  return `${round1(x)} g`;
}

function pickFoods(parsedMeal) {
  const src = Array.isArray(parsedMeal?.items) ? parsedMeal.items : [];
  const cleaned = src.map((v) => normalizeText(v)).filter(Boolean);
  if (!cleaned.length) {
    const label = normalizeText(parsedMeal?.mealLabel || parsedMeal?.name || '');
    return label ? [label] : [];
  }
  return cleaned.slice(0, 6);
}

function hashOpeningSeed(foods = []) {
  const s = Array.isArray(foods) ? foods.join('') : '';
  let h = 0;
  for (let i = 0; i < s.length; i += 1) h = ((h << 5) - h) + s.charCodeAt(i);
  return Math.abs(h || 0);
}

function pickWarmMealOpening(foods = []) {
  const i = hashOpeningSeed(foods) % 4;
  const lines = [
    '🍽️ 今日の食卓の形、ちゃんと見えています。',
    '🍽️ この組み合わせ、そばで追いかけています。',
    '🍽️ 写真、ありがとう。内容を一緒に見ていきます。',
    '🍽️ 何を選んだか、ちゃんと伝わってきました。',
  ];
  return lines[i];
}

function pickMotivationComment(nutrition, todayTotals) {
  const protein = Number(nutrition?.protein || 0);
  const fat = Number(nutrition?.fat || 0);
  const carbs = Number(nutrition?.carbs || 0);
  const totalKcal = Number(todayTotals?.kcal || 0);
  const seed = hashOpeningSeed([String(protein), String(fat), String(carbs)]);
  if (protein >= 28) {
    return seed % 2 === 0
      ? 'たんぱく質の軸がしっかり見えます。体を支える選び方です。'
      : 'たんぱく質がちゃんと入っていて、続けやすいバランスに寄せられています。';
  }
  if (fat >= 35 && carbs < protein * 2) {
    return '脂質が少し多めに見える日もあります。次は野菜や汁物を足すと、体が軽く感じやすくなります。';
  }
  if (carbs >= 70 && protein >= 18) {
    return '糖質もしっかり入っています。動いた日のエネルギー源として自然な形です。';
  }
  if (totalKcal > 0) {
    return '今日の合計を見ると、大きくは崩れていない流れです。';
  }
  return '短い一言でも、流れをつかむ手がかりになります。';
}

function buildMealSpecificHitokoto(foods = [], nutrition = {}) {
  const names = Array.isArray(foods) ? foods.join('、') : '';
  const hasRice = /ごはん|ご飯|丼|親子丼|おにぎり/.test(names);
  const hasProtein = /鶏|卵|肉|魚|豆腐|納豆|ヨーグルト/.test(names) || Number(nutrition?.protein || 0) >= 20;
  const hasVeg = /サラダ|野菜|汁|味噌汁|みそ汁/.test(names);
  const hasNoodle = /ラーメン|うどん|そば|パスタ|麺/.test(names);
  const hasBread = /パン|トースト|サンド/.test(names);
  if (hasRice && hasProtein && hasVeg) {
    return '主食・たんぱく質・野菜がそろいやすい組み合わせです。次に整えるなら、汁物か野菜を少し足すくらいで十分です。';
  }
  if (hasProtein && hasVeg) {
    return 'たんぱく質と野菜が入っていて、現実的な一本柱です。主食の量は、その日の体調に合わせて微調整できれば十分です。';
  }
  if (hasRice && hasProtein) {
    return '主食とたんぱく質の軸はできています。野菜か汁物を小さく足すと、満足感が長く続きやすいです。';
  }
  if (hasNoodle) {
    return '麺類は満足感が出やすいので、次は野菜やたんぱく質を足すとバランスが整いやすいです。';
  }
  if (hasBread) {
    return 'パン系は手軽にエネルギーが取れます。次に卵やヨーグルトを足すと、昼までの安定感が出やすいです。';
  }
  return '';
}

function isSourceNoteLike(text) {
  const safe = normalizeText(text);
  return /カロリーは写真からの推定です|パッケージや栄養表示|メニューや店内表示|商品名がはっきり|写真からの推定として記録|表示されている数値を優先して記録|写真からの概算なので/.test(safe);
}

function buildSourceNotes(calorieSource) {
  if (/nutrition_label/.test(calorieSource)) {
    return ['パッケージや栄養表示に書かれている数字を、いちばん信頼できる手がかりにしています。'];
  }
  if (/menu_declared/.test(calorieSource)) {
    return ['メニューや店内表示の数値を、まずそのまま見ています。'];
  }
  if (/confirmed_product/.test(calorieSource)) {
    return ['商品名がはっきりしていたので、その前提で数値を置いています。'];
  }
  if (/gemini_estimate/.test(calorieSource)) {
    return ['カロリーは写真からの推定です。', '違っていれば、あとで「半分くらい」「ごはん少なめ」みたいに直せます。'];
  }
  if (/fallback_estimate/.test(calorieSource)) {
    return ['今回は写真からの概算です。違っていたら、あとで一言で直せます。'];
  }
  return [];
}

function formatMealReplyText(parsedMeal, options = {}) {
  const todayTotals = options?.todayTotals || null;
  const mealCount = Number(options?.mealCount || 0);
  const exerciseKcal = Number(options?.exerciseBurnKcal || 0);
  const netKcal = Number(options?.netKcal != null ? options.netKcal : (Number(todayTotals?.kcal || 0) - exerciseKcal));
  const foods = pickFoods(parsedMeal);
  const nut = parsedMeal?.estimatedNutrition || parsedMeal?.estimated_nutrition || {};
  const rawComment = normalizeText(parsedMeal?.comment || '');
  const comment = (!rawComment || isSourceNoteLike(rawComment))
    ? (buildMealSpecificHitokoto(foods, nut) || pickMotivationComment(nut, todayTotals))
    : rawComment;
  const calorieSource = normalizeText(parsedMeal?.calorie_source || '');

  const lines = [pickWarmMealOpening(foods), '', '【食べ物】'];
  if (foods.length) {
    for (const food of foods) lines.push(`・${food}`);
  } else {
    lines.push('・食事内容');
  }
  lines.push('');

  const kcal = formatKcal(nut.kcal);
  const protein = formatG(nut.protein);
  const fat = formatG(nut.fat);
  const carbs = formatG(nut.carbs);

  if (kcal) lines.push(`🔥 エネルギー：${kcal}`);
  if (protein) lines.push(`💪 タンパク質：${protein}`);
  if (fat) lines.push(`🫒 脂質：${fat}`);
  if (carbs) lines.push(`🍞 糖質：${carbs}`);
  if (!kcal && !protein && !fat && !carbs) lines.push('栄養値は取得できた範囲で表示します。');

  lines.push('', '📈 本日の合計');
  lines.push(`🍽️ 食事件数：${Math.max(0, mealCount)}件`);
  lines.push(`🔥 摂取カロリー：${formatKcal(todayTotals?.kcal) || '不明'}`);
  if (formatG(todayTotals?.protein)) lines.push(`💪 タンパク質：${formatG(todayTotals?.protein)}`);
  if (formatG(todayTotals?.fat)) lines.push(`🫒 脂質：${formatG(todayTotals?.fat)}`);
  if (formatG(todayTotals?.carbs)) lines.push(`🍞 糖質：${formatG(todayTotals?.carbs)}`);
  lines.push('');
  lines.push(`🏃‍♂️ 運動消費：${Math.round(Math.max(0, exerciseKcal)).toLocaleString('ja-JP')} kcal`);
  lines.push(`🔥 摂取 − 消費：${Math.round(netKcal).toLocaleString('ja-JP')} kcal`);
  const sourceNotes = buildSourceNotes(calorieSource);
  for (const note of sourceNotes) lines.push(note);
  lines.push('', 'ひとこと：');
  lines.push(comment);
  console.info('[meal_reply_formatter_used]', {
    calorie_source: calorieSource || '',
    source_note_included: sourceNotes.length > 0,
    hitokoto_generated: Boolean(comment)
  });
  const rendered = lines.join('\n');
  const duplicateSourceCount = (rendered.match(/カロリーは写真からの推定です。/g) || []).length;
  console.info('[meal_reply_final_text_debug]', {
    has_duplicate_source_note: duplicateSourceCount > 1,
    has_hitokoto_specific_comment: !isSourceNoteLike(comment)
  });
  return rendered;
}

module.exports = {
  formatMealReplyText,
  pickMotivationComment,
};
