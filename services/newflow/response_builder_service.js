'use strict';

function buildTtlExpiredReply() {
  return '前の画像の保持期限が切れています。もう一度同じ画像を送ってください。';
}

function buildCanonicalInsufficientReply() {
  return '今確認できる範囲では判断材料が不足しているため、もう一度画像を送ってください。';
}

function buildLabGenericReply() {
  return '検査画像の続きとして確認します。項目名（例: TG, LDL, HbA1c）を指定して聞いてください。';
}

function buildMealGenericReply() {
  return '食事画像の続きとして扱います。「麺だけ0kcal」「半分食べた」「食べてない」のように指定してください。';
}

/**
 * 日次エネルギー b = getTokyoDayEnergyBalance 結果
 */
function buildTodayMealTotalReply(b) {
  if (!b) {
    return '日次合計をいま集計できませんでした。少し待ってからもう一度送ってください。';
  }
  if (!b.mealCount) {
    return '今日（東京日付）の食事はまだ記録がありません。合計 0 kcal です。';
  }
  return `今日の合計は、食事${b.mealCount}件、摂取（再計算反映後）で約${b.intakeKcal} kcal（P${b.protein}／F${b.fat}／C${b.carbs}）です。補正の適用は合計${b.totalCorrectionEventCount}件分です。`;
}

function buildTodayBalanceReply(b) {
  if (!b) {
    return '日次の収支をいま集計できませんでした。少し待ってからもう一度送ってください。';
  }
  const d = b.dateYmd || '';
  const n = Number(b.netKcal || 0);
  const tail =
    n > 0
      ? '摂取の方が大きい状態です。'
      : n < 0
        ? '活動消費の方が大きい状態です。'
        : 'ぴったり釣り合っています。';
  return `今日（${d}、東京日付）の収支は、食事（再計算後）の摂取が約${b.intakeKcal} kcal、活動消費が約${b.activityKcal} kcal（活動${b.activityCount}件）で、差分（摂取−活動）が約${b.netKcal} kcal です。${tail}合計補正イベント${b.totalCorrectionEventCount}件。`;
}

function buildTodayIntakeAskReply(b) {
  if (!b) {
    return '日次摂取をいま集計できませんでした。少し待ってからもう一度送ってください。';
  }
  if (!b.mealCount) {
    return '今日（東京日付）の食事はまだ記録がありません。0 kcal 相当です。';
  }
  return `今日、食事は${b.mealCount}件あって、摂取（再計算反映後）の合計は約${b.intakeKcal} kcal（P${b.protein}／F${b.fat}／C${b.carbs}）です。補正${b.totalCorrectionEventCount}件分を数えています。`;
}

function buildTodayActivityAskReply(b) {
  if (!b) {
    return '活動分をいま集計できませんでした。少し待ってからもう一度送ってください。';
  }
  if (!b.activityCount) {
    return '今日（東京日付）の活動消費はまだ記録がありません（0 kcal 相当）です。';
  }
  return `今日、活動記録は${b.activityCount}件分あって、消費（推定活動kcal）の合計は約${b.activityKcal} kcal です。`;
}

function buildWeekSoftTips(w) {
  const t = w?.totals;
  const days = Array.isArray(w?.days) ? w.days : [];
  if (!t || !days.length) {
    return { good: '記録の範囲で、週の雰囲気を掴めています。', watch: null };
  }
  if (t.weekIntakeKcal < 1 && t.weekActivityKcal < 1) {
    return {
      good: 'この7日は、食事・活動ともにまだ記録が少なめに見えます。続けて送ってもらえれば、次週は比較しやすくなります。',
      watch: null
    };
  }
  const zeroMeal = days.filter((d) => (d?.mealCount || 0) === 0).length;
  const good =
    zeroMeal <= 2
      ? '直近7日のうち、何日かは食事の記録が入っていて、流れを追いやすい雰囲気です。'
      : '食事ゼロの日が多めに見えますが、週の数字は参考程度に留めてよいかもしれません。';
  const watch =
    t.weekActivityKcal < 1 && t.weekIntakeKcal > 0
      ? '活動分の記録は控えめに見えるため、週合計は摂取寄りの見え方になる可能性があります。体調の感覚とあわせるのが良さそうです。'
      : days.filter((d) => (d?.activityCount || 0) === 0).length >= 5
        ? '活動の記録が日によって少なめの日が多いため、活動kcalの合計は低めに出やすいかもしれません。'
        : null;
  return { good, watch };
}

/**
 * w = getTokyoWeekEnergyBalance の戻り
 */
function buildWeekSummaryReply(w) {
  if (!w) {
    return '週の集計をいま取得できませんでした。少し待ってからもう一度送ってください。';
  }
  const a = w.averages;
  const t = w.totals;
  const { good, watch } = buildWeekSoftTips(w);
  const range = `（${w.fromYmd}〜${w.toYmd}、東京日付・7日分）`;
  const line1 = `週間のまとめ${range}です。摂取合計 約${t.weekIntakeKcal} kcal、活動 約${t.weekActivityKcal} kcal、差分（摂取−活動） 約${t.weekNetKcal} kcal。食事の件数合計 ${t.weekMealCount} 件、補正イベント合計 ${t.weekCorrectionEventCount} 件、活動記録の行数合計 ${t.weekActivityRowCount} 行です。`;
  const line2 = `1日あたりの目安（7日平均）は、摂取 約${a.avgIntakeKcal} kcal、活動 約${a.avgActivityKcal} kcal、差分 約${a.avgNetKcal} kcal です。`;
  const out = [line1, line2, good];
  if (watch) {
    out.push(watch);
  }
  return out.join('\n');
}

function buildWeekBalanceReply(w) {
  if (!w) {
    return '週の収支をいま集計できませんでした。少し待ってからもう一度送ってください。';
  }
  const t = w.totals;
  const { good, watch } = buildWeekSoftTips(w);
  const range = `（${w.fromYmd}〜${w.toYmd}、7日分）`;
  const main = `今週の収支${range}は、摂取（食事再計算後）の合計 約${t.weekIntakeKcal} kcal、活動消費（記録上）の合計 約${t.weekActivityKcal} kcal、差分（摂取−活動） 約${t.weekNetKcal} kcal です。補正イベント合計 ${t.weekCorrectionEventCount} 件。`;
  const extra = [good];
  if (watch) {
    extra.push(watch);
  }
  return [main, ...extra].join('\n');
}

function buildWeekIntakeAskReply(w) {
  if (!w) {
    return '週の食事分をいま集計できませんでした。少し待ってからもう一度送ってください。';
  }
  const t = w.totals;
  const a = w.averages;
  const { good, watch } = buildWeekSoftTips(w);
  const range = `（${w.fromYmd}〜${w.toYmd}、7日分）`;
  const main = `今週${range}、食事（再計算反映後）の合計摂取は 約${t.weekIntakeKcal} kcal です。食事の件数合計 ${t.weekMealCount} 件、補正イベント合計 ${t.weekCorrectionEventCount} 件。1日平均の摂取は 約${a.avgIntakeKcal} kcal です。`;
  const extra = [good];
  if (watch) {
    extra.push(watch);
  }
  return [main, ...extra].join('\n');
}

module.exports = {
  buildTtlExpiredReply,
  buildCanonicalInsufficientReply,
  buildLabGenericReply,
  buildMealGenericReply,
  buildTodayMealTotalReply,
  buildTodayBalanceReply,
  buildTodayIntakeAskReply,
  buildTodayActivityAskReply,
  buildWeekSummaryReply,
  buildWeekBalanceReply,
  buildWeekIntakeAskReply,
};
