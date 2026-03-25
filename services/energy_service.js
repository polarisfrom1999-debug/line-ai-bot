'use strict';

const { round1, fmt } = require('../utils/formatters');

function normalizeNumber(value) {
  if (value == null || value === '') return 0;
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function calculateDailyEnergyBalance({
  estimatedBmr = 0,
  estimatedTdee = 0,
  intakeKcal = 0,
  activityKcal = 0,
}) {
  const bmr = normalizeNumber(estimatedBmr);
  const tdee = normalizeNumber(estimatedTdee);
  const intake = normalizeNumber(intakeKcal);
  const activity = normalizeNumber(activityKcal);

  const baseBurn = tdee > 0 ? tdee : bmr;
  const totalBurn = round1(baseBurn + activity);
  const balance = round1(intake - totalBurn);

  return {
    estimated_bmr: round1(bmr),
    estimated_tdee: round1(tdee),
    intake_kcal: round1(intake),
    activity_kcal: round1(activity),
    total_burn_kcal: round1(totalBurn),
    balance_kcal: round1(balance),
  };
}

function getBalanceComment(balanceKcal) {
  const balance = normalizeNumber(balanceKcal);
  if (balance <= -500) return 'かなりマイナス寄りです。食べなさすぎにならないかも見ながらいきましょう。';
  if (balance < -150) return 'ややマイナス寄りで、体重管理には良い流れです。';
  if (balance <= 150) return '収支は大きくは崩れていません。落ち着いた1日です。';
  if (balance <= 400) return '少しプラス寄りです。次の食事か活動でやさしく戻せます。';
  return 'しっかりプラス寄りです。責めずに、次を少し整えれば大丈夫です。';
}

function buildEnergySummaryText({
  estimatedBmr = 0,
  estimatedTdee = 0,
  intakeKcal = 0,
  activityKcal = 0,
}) {
  const result = calculateDailyEnergyBalance({
    estimatedBmr,
    estimatedTdee,
    intakeKcal,
    activityKcal,
  });

  return [
    result.estimated_bmr ? `推定基礎代謝: ${fmt(result.estimated_bmr)} kcal` : null,
    result.estimated_tdee ? `推定総消費目安: ${fmt(result.estimated_tdee)} kcal` : null,
    `食事摂取: ${fmt(result.intake_kcal)} kcal`,
    `活動消費: ${fmt(result.activity_kcal)} kcal`,
    `ざっくり収支: ${fmt(result.balance_kcal)} kcal`,
    getBalanceComment(result.balance_kcal),
  ].filter(Boolean).join('\n');
}

module.exports = {
  normalizeNumber,
  calculateDailyEnergyBalance,
  getBalanceComment,
  buildEnergySummaryText,
};
