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

  const baseTotalBurn = tdee > 0 ? tdee : bmr;
  const totalBurn = round1(baseTotalBurn + activity);
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

  if (balance <= -500) {
    return 'かなりマイナス寄りです。無理が続かないよう、体調も見ながら進めましょう。';
  }

  if (balance < -150) {
    return 'ややマイナス寄りです。体重管理には良い流れになりやすいです。';
  }

  if (balance <= 150) {
    return 'ほぼ収支はフラットに近いです。安定した1日として見られます。';
  }

  if (balance <= 400) {
    return 'ややプラス寄りです。今日の流れを見ながら次で調整していきましょう。';
  }

  return 'しっかりプラス寄りです。無理なく整えるなら、食事か活動量のどちらかを少し調整できると良さそうです。';
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

  const lines = [
    result.estimated_bmr ? `推定基礎代謝: ${fmt(result.estimated_bmr)} kcal` : null,
    result.estimated_tdee ? `推定総消費目安: ${fmt(result.estimated_tdee)} kcal` : null,
    `食事摂取: ${fmt(result.intake_kcal)} kcal`,
    `運動消費: ${fmt(result.activity_kcal)} kcal`,
    `総消費目安: ${fmt(result.total_burn_kcal)} kcal`,
    `ざっくり収支: ${fmt(result.balance_kcal)} kcal`,
    getBalanceComment(result.balance_kcal),
  ].filter(Boolean);

  return lines.join('\n');
}

module.exports = {
  normalizeNumber,
  calculateDailyEnergyBalance,
  getBalanceComment,
  buildEnergySummaryText,
};