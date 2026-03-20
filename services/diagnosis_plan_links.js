'use strict';

/**
 * services/diagnosis_plan_links.js
 *
 * 目的:
 * - プラン別の決済リンクや案内文を一元管理する
 * - まずは Stripe Payment Link 前提で最短運用できる形にする
 * - 後から webhook / checkout session 方式へ移行しやすくする
 *
 * 環境変数例:
 * STRIPE_PAYMENT_LINK_LIGHT
 * STRIPE_PAYMENT_LINK_BASIC
 * STRIPE_PAYMENT_LINK_PREMIUM
 * STRIPE_PAYMENT_LINK_SPECIAL
 */

function safeText(value, fallback = '') {
  return String(value || fallback).trim();
}

const PLAN_DEFINITIONS = {
  light: {
    key: 'light',
    label: 'ライト',
    display_price: '2,980円',
    short_description: 'AI毎日返信のみ',
    features: [
      'AIによる毎日の返信',
      '食事・運動・体重・相談の記録サポート',
      '気軽に始めやすい基本プラン',
    ],
    env_key: 'STRIPE_PAYMENT_LINK_LIGHT',
  },
  basic: {
    key: 'basic',
    label: 'ベーシック',
    display_price: '5,980円',
    short_description: 'AI毎日・週間報告',
    features: [
      'AIによる毎日の返信',
      '週間ふり返り',
      '日々の流れが見えやすくなるプラン',
    ],
    env_key: 'STRIPE_PAYMENT_LINK_BASIC',
  },
  premium: {
    key: 'premium',
    label: 'プレミアム',
    display_price: '9,800円',
    short_description: 'AI毎日・牛込手書き週間報告・月間報告',
    features: [
      'AIによる毎日の返信',
      '牛込手書き週間報告',
      '月間報告',
      'より丁寧に伴走してほしい方向け',
    ],
    env_key: 'STRIPE_PAYMENT_LINK_PREMIUM',
  },
  special: {
    key: 'special',
    label: '人数限定！絶対痩せたいスペシャル',
    display_price: '29,800円',
    short_description: 'AI毎日・牛込手書き毎日・週間報告・月間報告',
    features: [
      'AIによる毎日の返信',
      '牛込手書き毎日コメント',
      '週間報告',
      '月間報告',
      '本気で変わりたい方向けの最上位伴走',
    ],
    env_key: 'STRIPE_PAYMENT_LINK_SPECIAL',
  },
};

function getAllPlanDefinitions() {
  return { ...PLAN_DEFINITIONS };
}

function getPlanDefinition(planKey) {
  const key = safeText(planKey).toLowerCase();
  return PLAN_DEFINITIONS[key] || null;
}

function getPlanPaymentLink(planKey) {
  const def = getPlanDefinition(planKey);
  if (!def) return '';
  return safeText(process.env[def.env_key] || '');
}

function hasPlanPaymentLink(planKey) {
  return !!getPlanPaymentLink(planKey);
}

function buildPlanSummary(planKey) {
  const def = getPlanDefinition(planKey);
  if (!def) return '';

  return [
    `【${def.label}】`,
    `${def.display_price}`,
    `${def.short_description}`,
    '',
    ...def.features.map((item) => `・${item}`),
  ].join('\n').trim();
}

function buildPlanSelectionGuide() {
  return [
    '今のおすすめプランはこちらです。',
    '',
    buildPlanSummary('light'),
    '',
    buildPlanSummary('basic'),
    '',
    buildPlanSummary('premium'),
    '',
    buildPlanSummary('special'),
    '',
    '迷った時は、',
    '・まず気軽に始めたい → ライト',
    '・週ごとの振り返りも欲しい → ベーシック',
    '・しっかり伴走してほしい → プレミアム',
    '・本気で変わりたい → スペシャル',
  ].join('\n').trim();
}

function buildCheckoutMessage(planKey, opts = {}) {
  const def = getPlanDefinition(planKey);
  if (!def) return 'プラン情報が見つかりませんでした。';

  const link = getPlanPaymentLink(planKey);
  const trialEnding = !!opts.trialEnding;
  const userName = safeText(opts.userName, '');

  const intro = userName
    ? `${userName}さんにご案内するプランはこちらです。`
    : 'ご案内するプランはこちらです。';

  const lines = [
    intro,
    '',
    `【${def.label}】`,
    `料金: ${def.display_price}`,
    `内容: ${def.short_description}`,
    '',
    ...def.features.map((item) => `・${item}`),
  ];

  if (trialEnding) {
    lines.push(
      '',
      '無料体験で使ってみて、',
      '「このまま続けたい」と感じていただけたらこちらからご登録ください。'
    );
  }

  if (link) {
    lines.push('', `お申し込みはこちら\n${link}`);
  } else {
    lines.push('', '※ 決済リンクはまだ設定中です。');
  }

  return lines.join('\n').trim();
}

function buildAllCheckoutMessages(opts = {}) {
  return Object.keys(PLAN_DEFINITIONS)
    .map((planKey) => buildCheckoutMessage(planKey, opts))
    .join('\n\n');
}

function detectPlanKeyFromText(text) {
  const normalized = safeText(text).replace(/\s+/g, '').toLowerCase();

  if (!normalized) return '';

  if (
    normalized.includes('ライト') ||
    normalized.includes('light') ||
    normalized.includes('2980')
  ) {
    return 'light';
  }

  if (
    normalized.includes('ベーシック') ||
    normalized.includes('basic') ||
    normalized.includes('5980')
  ) {
    return 'basic';
  }

  if (
    normalized.includes('プレミアム') ||
    normalized.includes('premium') ||
    normalized.includes('9800')
  ) {
    return 'premium';
  }

  if (
    normalized.includes('スペシャル') ||
    normalized.includes('special') ||
    normalized.includes('29800') ||
    normalized.includes('絶対痩せたい')
  ) {
    return 'special';
  }

  return '';
}

function buildPlanTransitionPrompt() {
  return [
    '気になるプラン名をそのまま送ってください。',
    '例: ライト / ベーシック / プレミアム / スペシャル',
  ].join('\n');
}

module.exports = {
  PLAN_DEFINITIONS,
  getAllPlanDefinitions,
  getPlanDefinition,
  getPlanPaymentLink,
  hasPlanPaymentLink,
  buildPlanSummary,
  buildPlanSelectionGuide,
  buildCheckoutMessage,
  buildAllCheckoutMessages,
  detectPlanKeyFromText,
  buildPlanTransitionPrompt,
};
