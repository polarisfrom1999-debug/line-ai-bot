'use strict';

/**
 * services/user_guide_service.js
 *
 * 目的:
 * - 「使い方」「送り方」系の案内を担当
 * - ただし「今の私のプランは？」のような現在値照会はガイド扱いしない
 */

const { buildTypeSelectionGuide } = require('./type_recommendation_service');

function safeText(value, fallback = '') {
  return String(value || fallback).trim();
}

function normalizeLoose(text) {
  return safeText(text)
    .toLowerCase()
    .replace(/[！!？?。.,，、]/g, '')
    .replace(/\s+/g, '');
}

function hasDigits(text) {
  return /\d/.test(String(text || ''));
}

function looksLikeHowToRequest(text = '') {
  const n = normalizeLoose(text);
  if (!n) return false;
  if (n === 'ヘルプ' || n === 'help' || n === 'メニュー' || n === '使い方') return true;
  if (n.includes('送り方') || n.includes('使い方') || n.includes('教えて') || n.includes('知りたい')) return true;
  return false;
}

function looksLikeCurrentStateQuestion(text = '') {
  const raw = safeText(text);
  if (!raw) return false;
  if (!/[？?]/.test(raw)) return false;
  return /(今|現在|私の).*(プラン|目標|体重|体脂肪率|プロフィール|プロフ)/.test(raw);
}

function buildFirstGuideMessage(opts = {}) {
  const userName = safeText(opts.userName);
  const namePrefix = userName ? `${userName}さん、` : '';

  return [
    `${namePrefix}ここから。の使い方を短くご案内します。`,
    '',
    '【送れるもの】',
    '・食事 → 写真だけでもOK',
    '・運動 → 「ウォーキング20分」など短文でOK',
    '・体重 → 数字だけでもOK',
    '・相談 → 不安や迷いをそのまま送ってOK',
    '・血液検査 → 画像を送ってOK',
    '',
    '最初は全部そろえなくて大丈夫です。',
    'まずは今日いちばん送りやすいものを1つ送ってください。',
  ].join('\n').trim();
}

function buildFoodGuideMessage() {
  return [
    '【食事の送り方】',
    '・写真だけ',
    '・文章だけ',
    '・写真＋ひとこと',
    'どれでも大丈夫です。',
    '',
    '例:',
    '・朝ごはん',
    '・お昼はラーメン',
    '・この写真です',
    '',
    '内容があいまいな時は、必要な時だけこちらから確認します。',
  ].join('\n').trim();
}

function buildExerciseGuideMessage() {
  return [
    '【運動の送り方】',
    '短くて大丈夫です。',
    '',
    '例:',
    '・ウォーキング20分',
    '・ストレッチ10分',
    '・スクワット15回',
    '・今日は何もできていない',
    '',
    '運動できなかった日も、そのまま送って大丈夫です。',
  ].join('\n').trim();
}

function buildWeightGuideMessage() {
  return [
    '【体重・体脂肪率の送り方】',
    '数字だけでも大丈夫です。',
    '',
    '例:',
    '・体重 62.4',
    '・62.4kg 31.2%',
    '・今朝は61.8',
    '',
    '測る時間はだいたい同じだと流れが見やすくなりますが、毎回きっちりでなくても大丈夫です。',
  ].join('\n').trim();
}

function buildConsultGuideMessage() {
  return [
    '【相談の送り方】',
    '悩みや迷いをそのまま文章で送ってください。',
    '',
    '例:',
    '・夜に食べたくなる',
    '・膝が少し痛いけど歩いていい？',
    '・今日は気分が落ちる',
    '・外食が続いて困ってる',
    '',
    'ここから。では、相談文はできるだけ相談として受け止める前提で扱います。',
  ].join('\n').trim();
}

function buildLabGuideMessage() {
  return [
    '【血液検査画像の送り方】',
    '・検査結果の写真をそのまま送ってOK',
    '・複数枚ある場合は順に送ってOK',
    '',
    '読み取り後、必要に応じて確認しながら整理します。',
    '見づらい時は、明るい場所で正面から撮ると読み取りやすくなります。',
  ].join('\n').trim();
}

function buildHelpMenuMessage() {
  return [
    'ヘルプです。知りたい項目をそのまま送ってください。',
    '',
    '・食事の送り方',
    '・運動の送り方',
    '・体重の送り方',
    '・相談の送り方',
    '・血液検査の送り方',
    '・AIタイプ',
    '・無料体験',
    '・プラン',
  ].join('\n').trim();
}

function buildFaqMessage() {
  return [
    '【よくある質問】',
    '',
    'Q. 写真だけで送っても大丈夫？',
    'A. 大丈夫です。',
    '',
    'Q. 毎日全部送らないとダメ？',
    'A. そんなことはありません。送れるものからで大丈夫です。',
    '',
    'Q. 相談だけ送ってもいい？',
    'A. 大丈夫です。不安や迷いも大事な情報です。',
    '',
    'Q. AIタイプは変えられる？',
    'A. 変えられます。タイプ名を送ってください。',
    '',
    'Q. 無料体験のあとどうなる？',
    'A. ご希望の方だけ本プランへ進める形です。',
  ].join('\n').trim();
}

function buildFullUserGuideMessage(opts = {}) {
  return [
    buildFirstGuideMessage(opts),
    '',
    buildFoodGuideMessage(),
    '',
    buildExerciseGuideMessage(),
    '',
    buildWeightGuideMessage(),
    '',
    buildConsultGuideMessage(),
    '',
    buildLabGuideMessage(),
    '',
    buildTypeSelectionGuide(),
  ].join('\n\n').trim();
}

function detectGuideIntent(text) {
  const raw = safeText(text);
  const n = normalizeLoose(raw);
  if (!n) return '';

  // 重要:
  // 「今の私のプランは？」「私の目標体重は？」などの現在値照会は
  // ガイド導線に吸い込まない
  if (looksLikeCurrentStateQuestion(raw)) return '';

  const howTo = looksLikeHowToRequest(raw);
  const exactShort = n.length <= 8;

  if (n === 'ヘルプ' || n === 'help' || n === 'メニュー' || n === '使い方') return 'help';
  if (n.includes('faq') || n.includes('よくある')) return 'faq';

  if (hasDigits(raw) && !howTo) return '';

  if (howTo || exactShort) {
    if (n.includes('食事の送り方') || n === '食事') return 'food';
    if (n.includes('運動の送り方') || n.includes('ストレッチの送り方') || n === '運動') return 'exercise';
    if (n.includes('体重の送り方') || n.includes('体脂肪率の送り方') || n === '体重') return 'weight';
    if (n.includes('相談の送り方')) return 'consult';
    if (n.includes('血液検査の送り方') || n === '血液検査') return 'lab';
    if (n.includes('タイプ')) return 'type';
    if (n.includes('無料体験')) return 'trial';
    if (n.includes('プラン')) return 'plan';
  }

  return '';
}

module.exports = {
  detectGuideIntent,
  buildFirstGuideMessage,
  buildFoodGuideMessage,
  buildExerciseGuideMessage,
  buildWeightGuideMessage,
  buildConsultGuideMessage,
  buildLabGuideMessage,
  buildHelpMenuMessage,
  buildFaqMessage,
  buildFullUserGuideMessage,
};
