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

module.exports = {
  buildTtlExpiredReply,
  buildCanonicalInsufficientReply,
  buildLabGenericReply,
  buildMealGenericReply,
  buildTodayMealTotalReply,
  buildTodayBalanceReply,
  buildTodayIntakeAskReply,
  buildTodayActivityAskReply,
};
