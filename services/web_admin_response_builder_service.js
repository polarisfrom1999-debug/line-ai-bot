'use strict';

function buildWeeklyDraft(summary) {
  if (!summary) return '週間報告を生成できませんでした。';
  return `📊 今週のまとめです。摂取は約${summary.totals.weekIntakeKcal} kcal、活動は約${summary.totals.weekActivityKcal} kcal、差分は約${summary.totals.weekNetKcal} kcalでした。\n🍽️ 食事は${summary.totals.weekMealCount}件、補正イベントは${summary.totals.weekCorrectionEventCount}件です。\n✨ 良かった点は、記録が続いている日があることです。気をつけたい点は、活動記録が少ない日は収支が偏って見えやすいことです。`;
}

function buildMonthlyDraft(summary) {
  if (!summary) return '月間報告を生成できませんでした。';
  return `📊 今月のまとめです。摂取は約${summary.totals.monthIntakeKcal} kcal、活動は約${summary.totals.monthActivityKcal} kcal、差分は約${summary.totals.monthNetKcal} kcalでした。\n🍚 食事は${summary.totals.monthMealCount}件、補正イベントは${summary.totals.monthCorrectionEventCount}件です。\n🌿 全体として継続の流れがあります。次月は、活動記録の粒度をそろえると変化を見やすくできます。`;
}

module.exports = {
  buildWeeklyDraft,
  buildMonthlyDraft
};
