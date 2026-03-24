'use strict';

/**
 * services/diagnosis_trial_flow_service.js
 *
 * 目的:
 * - 無料診断後の体験開始導線を統一する
 * - 体験開始直後 / 5日目 / 7日目 の案内をまとめる
 * - 何を送れば価値がわかるかを自然に伝える
 */

const {
  buildPlanSelectionGuide,
} = require('./diagnosis_plan_links');
const {
  buildTypeRecommendationBlock,
  getTypeProfile,
} = require('./type_recommendation_service');

function safeText(value, fallback = '') {
  return String(value || fallback).trim();
}

function safeNumber(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function getTodayJstDateString(baseDate = new Date()) {
  const d = new Date(baseDate);
  const parts = new Intl.DateTimeFormat('sv-SE', {
    timeZone: 'Asia/Tokyo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(d);

  const map = {};
  for (const p of parts) {
    map[p.type] = p.value;
  }
  return `${map.year}-${map.month}-${map.day}`;
}

function addDaysToDateString(dateString, days) {
  if (!dateString) return '';
  const [y, m, d] = String(dateString).split('-').map(Number);
  if (!y || !m || !d) return '';
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + safeNumber(days, 0));
  const yy = dt.getUTCFullYear();
  const mm = String(dt.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(dt.getUTCDate()).padStart(2, '0');
  return `${yy}-${mm}-${dd}`;
}

function diffDays(dateA, dateB) {
  if (!dateA || !dateB) return 0;
  const a = new Date(`${dateA}T00:00:00Z`);
  const b = new Date(`${dateB}T00:00:00Z`);
  const ms = b.getTime() - a.getTime();
  return Math.floor(ms / 86400000);
}

function buildTrialStartPayload(opts = {}) {
  const userName = safeText(opts.userName);
  const recommendedType = safeText(opts.recommendedType, 'そっと寄り添う');
  const diagnosisReason = safeText(opts.diagnosisReason);
  const startDate = safeText(opts.startDate, getTodayJstDateString());
  const endDate = safeText(opts.endDate, addDaysToDateString(startDate, 6));

  const namePrefix = userName ? `${userName}さん、` : '';
  const typeBlock = buildTypeRecommendationBlock(recommendedType, {
    reason: diagnosisReason,
  });

  const message = [
    `${namePrefix}無料診断ありがとうございます。`,
    '',
    typeBlock,
    '',
    'まずは7日間、ライト体験を無料で使ってみてください。',
    `体験期間: ${startDate} 〜 ${endDate}`,
    '',
    'この体験では、',
    '・食事の写真や内容',
    '・運動やストレッチ',
    '・体重や体脂肪率',
    '・不安や相談ごと',
    'を送っていただくことで、ここから。の価値がわかりやすくなります。',
    '',
    '最初は完璧でなくて大丈夫です。',
    'まずは今日の食事1回分か、今の気持ちをひとこと送るところから始めてみてくださいね。',
  ].join('\n').trim();

  return {
    start_date: startDate,
    end_date: endDate,
    recommended_type: getTypeProfile(recommendedType).label,
    message,
  };
}

function buildTrialQuickGuideMessage(opts = {}) {
  const userName = safeText(opts.userName);
  const namePrefix = userName ? `${userName}さんへ、` : '';

  return [
    `${namePrefix}体験中の使い方のコツです。`,
    '',
    '【まず送ると分かりやすいもの】',
    '・食事 → 写真だけでもOK',
    '・運動 → 「ウォーキング20分」など短文でOK',
    '・体重 → 数字だけでもOK',
    '・相談 → 気分、痛み、不安、そのままでOK',
    '',
    '【おすすめの送り方】',
    '1. 朝か夜に体重',
    '2. 食事は撮れた時だけ写真',
    '3. 運動した日は一言',
    '4. 迷ったら相談をそのまま送る',
    '',
    '最初の数日は、たくさん送るほど使い方がつかみやすくなります。',
  ].join('\n').trim();
}

function buildTrialValueGuideMessage() {
  return [
    '無料体験で特に価値がわかりやすいのはこの4つです。',
    '',
    '・食事の写真を送る',
    '→ 食べ方の傾向や整え方が見えやすくなります',
    '',
    '・運動やストレッチを送る',
    '→ 続けやすい流れを一緒に作りやすくなります',
    '',
    '・体重を送る',
    '→ 変化を見ながら声かけや調整がしやすくなります',
    '',
    '・悩みをそのまま送る',
    '→ 我慢や迷いを減らしやすくなります',
  ].join('\n').trim();
}

function buildTrialDay5Message(opts = {}) {
  const userName = safeText(opts.userName);
  const namePrefix = userName ? `${userName}さん、` : '';

  return [
    `${namePrefix}無料体験も5日目に入ってきました。`,
    '',
    'ここまでで、',
    '・食事を送るだけで整理される',
    '・相談を送ると気持ちが軽くなる',
    '・続ける流れが少し作れてきた',
    'と感じていただけていたら、とても良い流れです。',
    '',
    'この先は、1週間だけで終わるより、',
    '続けながら生活の流れを整えていく方が変化が出やすいです。',
    '',
    '気になる方は、先にプラン内容も見てみてください。',
    '',
    buildPlanSelectionGuide(),
  ].join('\n').trim();
}

function buildTrialDay7Message(opts = {}) {
  const userName = safeText(opts.userName);
  const namePrefix = userName ? `${userName}さん、` : '';

  return [
    `${namePrefix}7日間の無料体験おつかれさまでした。`,
    '',
    'ここから。は、',
    '単発で終わるよりも、続けながら少しずつ整えていくことで価値が出やすい仕組みです。',
    '',
    'もし',
    '・ひとりだと続きにくい',
    '・食事や体重の流れを整えたい',
    '・相談しながら前に進みたい',
    'と感じているなら、本プランへの移行がおすすめです。',
    '',
    'ご希望の方は、',
    '「ライト」「ベーシック」「プレミアム」「スペシャル」',
    'のいずれかを送ってください。',
  ].join('\n').trim();
}

function shouldSendTrialDay5Notice(user = {}, nowDateString = getTodayJstDateString()) {
  const startDate = safeText(user.trial_start_date || '');
  if (!startDate) return false;
  return diffDays(startDate, nowDateString) === 4;
}

function shouldSendTrialDay7Notice(user = {}, nowDateString = getTodayJstDateString()) {
  const startDate = safeText(user.trial_start_date || '');
  if (!startDate) return false;
  return diffDays(startDate, nowDateString) === 6;
}

function buildTrialStatusSummary(user = {}, nowDateString = getTodayJstDateString()) {
  const startDate = safeText(user.trial_start_date || '');
  const endDate = safeText(user.trial_end_date || '');
  const today = safeText(nowDateString || getTodayJstDateString());

  if (!startDate || !endDate) {
    return '無料体験はまだ開始されていません。';
  }

  const passed = diffDays(startDate, today) + 1;
  const remaining = diffDays(today, endDate);

  return [
    '現在の無料体験状況',
    `開始日: ${startDate}`,
    `終了日: ${endDate}`,
    `経過: ${Math.max(1, passed)}日目`,
    `残り: ${Math.max(0, remaining)}日`,
  ].join('\n');
}

module.exports = {
  getTodayJstDateString,
  addDaysToDateString,
  diffDays,
  buildTrialStartPayload,
  buildTrialQuickGuideMessage,
  buildTrialValueGuideMessage,
  buildTrialDay5Message,
  buildTrialDay7Message,
  shouldSendTrialDay5Notice,
  shouldSendTrialDay7Notice,
  buildTrialStatusSummary,
};
