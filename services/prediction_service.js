function round1(value) {
  if (value == null || Number.isNaN(Number(value))) return null;
  return Math.round(Number(value) * 10) / 10;
}

function fmt(value) {
  if (value == null || Number.isNaN(Number(value))) return '-';
  const n = Number(value);
  return Number.isInteger(n) ? String(n) : n.toFixed(1);
}

function estimateWeeklyWeightChangeKg(dailyNetKcal) {
  if (dailyNetKcal == null || Number.isNaN(Number(dailyNetKcal))) return null;
  const weeklyKcal = Number(dailyNetKcal) * 7;
  return round1(weeklyKcal / 7200);
}

function classifyTrend(dailyNetKcal) {
  const n = Number(dailyNetKcal) || 0;
  if (n <= -300) return 'down_fast';
  if (n < -80) return 'down_slow';
  if (n <= 80) return 'flat';
  if (n < 300) return 'up_slow';
  return 'up_fast';
}

function buildTrendComment(trend) {
  if (trend === 'down_fast') {
    return 'このまま続くと体重は下がりやすい流れですが、無理が強すぎないかも見ていきたいです。';
  }
  if (trend === 'down_slow') {
    return 'このまま続くと、ゆるやかに下がる流れが期待しやすいです。';
  }
  if (trend === 'flat') {
    return 'このままだと大きくは変わらず、横ばいに近い流れになりそうです。';
  }
  if (trend === 'up_slow') {
    return 'このまま続くと、少しずつ増えやすい流れです。食事か活動のどちらかを少し整えると変えやすいです。';
  }
  return 'このまま続くと増えやすい流れです。無理なく整え直したいですね。';
}

function buildActionHint(trend) {
  if (trend === 'down_fast') {
    return '食事を減らしすぎていないか、疲れすぎていないかも一緒に見ましょう。';
  }
  if (trend === 'down_slow') {
    return '今の流れは悪くないので、小さく続けることが大事です。';
  }
  if (trend === 'flat') {
    return '1日の間食を少し見直すか、5〜10分の歩行を足すだけでも変化が出やすいです。';
  }
  if (trend === 'up_slow') {
    return '飲み物や間食の見直し、または軽い歩行追加がやりやすい一手です。';
  }
  return 'まずは食事量か活動量を1つだけ整えるところから始めましょう。';
}

function buildPredictionText({
  estimatedBmr = 0,
  estimatedTdee = 0,
  intakeKcal = 0,
  activityKcal = 0,
  currentWeightKg = null,
}) {
  const intake = Number(intakeKcal) || 0;
  const tdee = Number(estimatedTdee) || 0;
  const activity = Number(activityKcal) || 0;

  const dailyNetKcal = round1(intake - tdee - activity);
  const weeklyWeightChangeKg = estimateWeeklyWeightChangeKg(dailyNetKcal);
  const trend = classifyTrend(dailyNetKcal);

  const lines = [
    '今の記録から、ざっくりした見通しを出しますね。',
    `推定BMR: ${fmt(estimatedBmr)} kcal`,
    `推定TDEE: ${fmt(estimatedTdee)} kcal`,
    `摂取: ${fmt(intake)} kcal`,
    `活動消費: ${fmt(activity)} kcal`,
    `ざっくり収支: ${fmt(dailyNetKcal)} kcal/日`,
    weeklyWeightChangeKg != null
      ? `この流れが1週間続いた場合の目安: ${weeklyWeightChangeKg > 0 ? '+' : ''}${fmt(weeklyWeightChangeKg)} kg`
      : null,
    currentWeightKg != null && weeklyWeightChangeKg != null
      ? `今の体重 ${fmt(currentWeightKg)} kg からみると、1週間後の目安は ${fmt(Number(currentWeightKg) + Number(weeklyWeightChangeKg))} kg 前後です。`
      : null,
    buildTrendComment(trend),
    buildActionHint(trend),
  ].filter(Boolean);

  return {
    text: lines.join('\n'),
    quickReplies: ['体重推移を見たい', '血液検査の流れを見たい', '食事を記録', '少し歩いた'],
  };
}

function isPredictionIntent(text) {
  const t = String(text || '');
  return [
    '予測',
    'このまま続けたら',
    'このままだとどうなる',
    '体重予測',
    '見通し',
  ].some((w) => t.includes(w));
}

module.exports = {
  buildPredictionText,
  isPredictionIntent,
};