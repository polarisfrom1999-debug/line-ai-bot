'use strict';

/**
 * services/diagnosis_membership_flow_service.js
 *
 * 役割:
 * - 診断後の7日無料開始文面
 * - プラン一覧文面
 * - プラン個別案内文
 * - 7日目継続案内文
 * - スペシャル案内文
 */

function safeText(value, fallback = '') {
  return String(value || fallback).trim();
}

function buildQuickReplies(items = []) {
  return items
    .filter(Boolean)
    .map((item) => ({
      type: 'action',
      action: {
        type: 'message',
        label: safeText(item.label, '').slice(0, 20),
        text: safeText(item.text, '').slice(0, 300),
      },
    }));
}

function getTrialStartMessage() {
  return {
    text:
      'ありがとうございます。\n' +
      'これから7日間、ここから。を無料で体験していただけます。\n\n' +
      '完璧を目指さなくて大丈夫です。\n' +
      'まずは食事、体調、気分など、気軽に送ってくださいね。\n' +
      '無理なく、今のあなたに合うペースを一緒に見つけていきましょう。',
  };
}

function getPlanMenuMessage() {
  return {
    text:
      'ここから先の続け方を選べます。\n' +
      'ご自身のペースや、ほしい支え方に合わせて選んでくださいね。',
    quickReply: {
      items: buildQuickReplies([
        { label: 'ライト', text: 'プラン:ライト' },
        { label: 'ベーシック', text: 'プラン:ベーシック' },
        { label: 'プレミアム', text: 'プラン:プレミアム' },
        { label: 'スペシャル', text: 'プラン:スペシャル' },
      ]),
    },
  };
}

function getTrialCompletionMessage() {
  return {
    text:
      '7日間、おつかれさまでした。\n' +
      'ここまで続けてこられたこと自体が、とても大切な一歩です。\n\n' +
      'ここから先の続け方を選べます。',
    quickReply: {
      items: buildQuickReplies([
        { label: 'ライト', text: 'プラン:ライト' },
        { label: 'ベーシック', text: 'プラン:ベーシック' },
        { label: 'プレミアム', text: 'プラン:プレミアム' },
        { label: 'スペシャル', text: 'プラン:スペシャル' },
      ]),
    },
  };
}

function buildPlanGuideText(planKey, links = {}) {
  if (planKey === 'light') {
    return (
      'ライト｜2,980円\n' +
      'AI毎日返信のみ\n\n' +
      'まずは気軽に習慣化したい方に向いています。\n' +
      (links.light ? `\nお申込みはこちら\n${links.light}` : '\nこのプランでお申込みできます。')
    );
  }

  if (planKey === 'basic') {
    return (
      'ベーシック｜5,980円\n' +
      'AI毎日返信・週間報告\n\n' +
      '毎日のやり取りに加えて、1週間ごとの振り返りがほしい方に向いています。\n' +
      (links.basic ? `\nお申込みはこちら\n${links.basic}` : '\nこのプランでお申込みできます。')
    );
  }

  if (planKey === 'premium') {
    return (
      'プレミアム｜9,800円\n' +
      'AI毎日返信・牛込手書き週間報告・月間報告\n\n' +
      'より深く寄り添う伴走をご希望の方に向いています。\n' +
      (links.premium ? `\nお申込みはこちら\n${links.premium}` : '\nこのプランでお申込みできます。')
    );
  }

  return (
    '人数限定！絶対痩せたいスペシャル｜29,800円\n' +
    'AI毎日返信・牛込手書き毎日・週間報告・月間報告・整骨院優先予約枠あり\n\n' +
    '本気で変わりたい方のための特別伴走枠です。\n' +
    'ご希望の方へ個別にご案内します。'
  );
}

function getPlanGuideMessage(planKey, links = {}) {
  const text = buildPlanGuideText(planKey, links);

  if (planKey === 'special') {
    return {
      text,
      quickReply: {
        items: buildQuickReplies([
          { label: '内容を詳しく見る', text: 'スペシャル詳細' },
          { label: 'スペシャル希望', text: 'スペシャル希望' },
          { label: '通常プランを見る', text: 'プランを見る' },
        ]),
      },
    };
  }

  return {
    text,
    quickReply: {
      items: buildQuickReplies([
        { label: 'このプランで申し込む', text: `申込:${planKey}` },
        { label: '他のプランも見る', text: 'プランを見る' },
      ]),
    },
  };
}

function getAllPlansSummaryMessage() {
  return {
    text:
      'ありがとうございます。\n' +
      'ここから先は、あなたに合うペースで続けられるプランを選んでいただけます。\n\n' +
      'ライト｜2,980円\nAI毎日返信のみ\n\n' +
      'ベーシック｜5,980円\nAI毎日返信・週間報告\n\n' +
      'プレミアム｜9,800円\nAI毎日返信・牛込手書き週間報告・月間報告\n\n' +
      '人数限定！絶対痩せたいスペシャル｜29,800円\n' +
      'AI毎日返信・牛込手書き毎日・週間報告・月間報告・整骨院優先予約枠あり\n\n' +
      '気になるプランを選んでくださいね。',
    quickReply: {
      items: buildQuickReplies([
        { label: 'ライト', text: 'プラン:ライト' },
        { label: 'ベーシック', text: 'プラン:ベーシック' },
        { label: 'プレミアム', text: 'プラン:プレミアム' },
        { label: 'スペシャル', text: 'プラン:スペシャル' },
      ]),
    },
  };
}

function getSpecialIntroMessage() {
  return {
    text:
      'スペシャルは、人数限定の特別伴走枠です。\n' +
      '本気で生活を変えたい方、しっかり伴走を受けながら進みたい方向けです。\n\n' +
      '内容は、\n' +
      '・AI毎日返信\n' +
      '・牛込手書き毎日\n' +
      '・週間報告\n' +
      '・月間報告\n' +
      '・整骨院優先予約枠あり\n\n' +
      'です。',
    quickReply: {
      items: buildQuickReplies([
        { label: '内容を詳しく見る', text: 'スペシャル詳細' },
        { label: 'スペシャル希望', text: 'スペシャル希望' },
        { label: '通常プランを見る', text: 'プランを見る' },
      ]),
    },
  };
}

function getSpecialRequestMessage() {
  return {
    text:
      'ありがとうございます。\n' +
      'スペシャルは、本気で生活を変えたい方へ向けた人数限定の特別枠です。\n\n' +
      'ご希望内容や今の状況をふまえてご案内したいので、簡単に次のどちらかに近いお気持ちを教えてください。',
    quickReply: {
      items: buildQuickReplies([
        { label: '毎日しっかり伴走してほしい', text: 'スペシャル回答:毎日伴走希望' },
        { label: 'まずは詳しく内容を知りたい', text: 'スペシャル回答:詳細希望' },
      ]),
    },
  };
}

function parsePlanSelection(text) {
  const raw = safeText(text);

  if (raw === 'プラン:ライト' || raw === 'ライト') return 'light';
  if (raw === 'プラン:ベーシック' || raw === 'ベーシック') return 'basic';
  if (raw === 'プラン:プレミアム' || raw === 'プレミアム') return 'premium';
  if (raw === 'プラン:スペシャル' || raw === 'スペシャル') return 'special';

  return null;
}

module.exports = {
  getTrialStartMessage,
  getPlanMenuMessage,
  getTrialCompletionMessage,
  buildPlanGuideText,
  getPlanGuideMessage,
  getAllPlansSummaryMessage,
  getSpecialIntroMessage,
  getSpecialRequestMessage,
  parsePlanSelection,
};
