'use strict';

/**
 * services/type_recommendation_service.js
 *
 * 目的:
 * - 4タイプのおすすめ文面を統一管理
 * - 診断結果の最後に自然につなげやすくする
 * - lab_intake_service.js / index.js から共通利用しやすくする
 */

function safeText(value, fallback = '') {
  return String(value || fallback).trim();
}

const TYPE_MASTER = {
  gentle: {
    key: 'gentle',
    label: 'そっと寄り添う',
    summary: 'やさしく安心感を持って続けたい方向けです。',
    suitable_for: [
      '厳しく言われるとしんどくなりやすい方',
      '気持ちの波がある中でも続けたい方',
      '安心しながら少しずつ整えたい方',
    ],
    first_steps: [
      'まずは食事の写真を1枚送る',
      '体重を測れた日だけ送る',
      '不安や迷いもそのまま相談する',
    ],
    tone_hint: '安心感・やわらかさ・見守り',
  },
  bright: {
    key: 'bright',
    label: '明るく後押し',
    summary: '前向きに楽しく進めたい方向けです。',
    suitable_for: [
      '少し背中を押されると動きやすい方',
      '明るい雰囲気の方が続きやすい方',
      '頑張りを前向きに拾ってほしい方',
    ],
    first_steps: [
      '食事や運動を気軽にどんどん送る',
      'できたことを小さくても報告する',
      '迷った時は「今日どうしたらいい？」と聞く',
    ],
    tone_hint: '明るさ・前向き・気軽さ',
  },
  lead: {
    key: 'lead',
    label: '頼もしく導く',
    summary: '流れを整理しながら着実に進めたい方向けです。',
    suitable_for: [
      '自分に合う進め方を明確にしたい方',
      '今の課題を整理しながら改善したい方',
      '伴走しつつ、道筋もほしい方',
    ],
    first_steps: [
      '今の悩みを1つはっきり送る',
      '食事・運動・体重のうち送りやすいものから始める',
      '「今週の目標を一緒に決めたい」と送る',
    ],
    tone_hint: '整理・方針・安定感',
  },
  strong: {
    key: 'strong',
    label: '力強く支える',
    summary: '本気で変わりたい気持ちを強く支えてほしい方向けです。',
    suitable_for: [
      '結果をしっかり出したい方',
      '甘えすぎず伴走してほしい方',
      '継続の後押しを強めに感じたい方',
    ],
    first_steps: [
      '毎日の食事をできるだけ送る',
      '体重や運動もあわせて記録する',
      '「本気で変わりたい」と最初に宣言する',
    ],
    tone_hint: '力強さ・前進・本気の伴走',
  },
};

function normalizeTypeKey(typeValue) {
  const raw = safeText(typeValue).replace(/\s+/g, '').toLowerCase();

  if (!raw) return 'gentle';

  if (
    raw.includes('そっと寄り添う') ||
    raw.includes('gentle') ||
    raw.includes('soft')
  ) {
    return 'gentle';
  }

  if (
    raw.includes('明るく後押し') ||
    raw.includes('bright')
  ) {
    return 'bright';
  }

  if (
    raw.includes('頼もしく導く') ||
    raw.includes('lead') ||
    raw.includes('guide')
  ) {
    return 'lead';
  }

  if (
    raw.includes('力強く支える') ||
    raw.includes('strong')
  ) {
    return 'strong';
  }

  return 'gentle';
}

function getTypeProfile(typeValue) {
  const key = normalizeTypeKey(typeValue);
  return TYPE_MASTER[key] || TYPE_MASTER.gentle;
}

function buildTypeRecommendationBlock(typeValue, opts = {}) {
  const profile = getTypeProfile(typeValue);
  const reason = safeText(
    opts.reason,
    `${profile.label}タイプは、${profile.summary}`
  );

  return [
    `おすすめタイプ: ${profile.label}`,
    `理由: ${reason}`,
    `向いている人: ${profile.suitable_for.join(' / ')}`,
    `まずどう使うか: ${profile.first_steps.join(' / ')}`,
  ].join('\n');
}

function buildTypeSelectionGuide() {
  return [
    'AIの雰囲気は4タイプから選べます。',
    '',
    `・${TYPE_MASTER.gentle.label}：${TYPE_MASTER.gentle.summary}`,
    `・${TYPE_MASTER.bright.label}：${TYPE_MASTER.bright.summary}`,
    `・${TYPE_MASTER.lead.label}：${TYPE_MASTER.lead.summary}`,
    `・${TYPE_MASTER.strong.label}：${TYPE_MASTER.strong.summary}`,
    '',
    '変更したい時は、タイプ名をそのまま送ってください。',
  ].join('\n').trim();
}

module.exports = {
  TYPE_MASTER,
  normalizeTypeKey,
  getTypeProfile,
  buildTypeRecommendationBlock,
  buildTypeSelectionGuide,
};
