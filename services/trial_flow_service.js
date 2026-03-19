'use strict';

/**
 * services/trial_flow_service.js
 *
 * 役割:
 * - trial日数計算
 * - 5日目 / 7日目 判定
 * - 5日目Geminiミニレポート用プロンプト生成
 * - 5日目メッセージ整形
 */

function safeText(value, fallback = '') {
  return String(value || fallback).trim();
}

function toDate(value) {
  if (!value) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

function getTrialDayNumber(trialStartedAt, now = new Date()) {
  const start = toDate(trialStartedAt);
  if (!start) return 0;

  const current = now instanceof Date ? now : new Date(now);
  if (Number.isNaN(current.getTime())) return 0;

  const diff = current.getTime() - start.getTime();
  if (diff < 0) return 0;

  return Math.floor(diff / (24 * 60 * 60 * 1000)) + 1;
}

function shouldSendTrialMidReport(user = {}, now = new Date()) {
  if (safeText(user.trial_status) !== 'active') return false;
  if (user.trial_mid_report_sent_at) return false;
  return getTrialDayNumber(user.trial_started_at, now) === 5;
}

function shouldSendTrialCompletion(user = {}, now = new Date()) {
  if (safeText(user.trial_status) !== 'active') return false;
  if (user.trial_completion_sent_at) return false;
  return getTrialDayNumber(user.trial_started_at, now) >= 7;
}

function summarizeMealsForPrompt(meals = []) {
  if (!Array.isArray(meals) || meals.length === 0) {
    return '食事記録はまだ十分ではありません。記録が少ない前提で、やさしく前向きにまとめてください。';
  }

  return meals
    .map((meal, idx) => {
      const date = safeText(meal.date || meal.meal_date || '');
      const time = safeText(meal.time || meal.meal_time || '');
      const label = safeText(meal.label || meal.meal_label || '');
      const kcal = meal.kcal ?? meal.estimated_kcal ?? '';
      const protein = meal.protein_g ?? meal.protein ?? '';
      const fat = meal.fat_g ?? meal.fat ?? '';
      const carbs = meal.carbs_g ?? meal.carbs ?? meal.sugar ?? '';

      return [
        `記録${idx + 1}:`,
        date ? `日付=${date}` : null,
        time ? `時間=${time}` : null,
        label ? `内容=${label}` : null,
        kcal !== '' ? `カロリー=${kcal}` : null,
        protein !== '' ? `たんぱく質=${protein}` : null,
        fat !== '' ? `脂質=${fat}` : null,
        carbs !== '' ? `糖質=${carbs}` : null,
      ]
        .filter(Boolean)
        .join(' / ');
    })
    .join('\n');
}

function buildTrialMidReportPrompt(input = {}) {
  const mealSummary = summarizeMealsForPrompt(input.meals || []);
  const weightSummary = safeText(input.weightSummary || '');
  const userName = safeText(input.userName || '利用者');

  return (
    `${userName}さんの直近5日分の食事記録をもとに、` +
    'LINEで送る短い中間レポートを日本語で作成してください。\n\n' +
    '目的:\n' +
    '・継続意欲が少し上がること\n' +
    '・責めずに食事傾向をやさしく振り返ること\n' +
    '・良かった点と改善点を短く伝えること\n\n' +
    '条件:\n' +
    '・100〜250文字程度\n' +
    '・医療断定をしない\n' +
    '・「良かった点」と「これからのポイント」を自然に含める\n' +
    '・最後は前向きに締める\n' +
    '・日本語表記は「たんぱく質・脂質・糖質」を優先\n\n' +
    '食事記録:\n' +
    `${mealSummary}\n\n` +
    (weightSummary ? `体重補足:\n${weightSummary}\n\n` : '') +
    '出力は、そのままLINEで送れる文章のみ。'
  );
}

function buildTrialMidReportMessage(geminiText) {
  const cleaned = safeText(geminiText);

  if (!cleaned) {
    return {
      text:
        'ここまで5日間、とても大切な積み重ねができています。\n' +
        '記録を続けられていること自体が大きな前進です。\n\n' +
        'あと2日、完璧を目指さず一緒に続けていきましょう。',
    };
  }

  return {
    text: cleaned,
  };
}

module.exports = {
  getTrialDayNumber,
  shouldSendTrialMidReport,
  shouldSendTrialCompletion,
  buildTrialMidReportPrompt,
  buildTrialMidReportMessage,
};
