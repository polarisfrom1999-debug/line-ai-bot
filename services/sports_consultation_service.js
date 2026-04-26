'use strict';

function normalizeText(value) {
  return String(value || '').trim();
}

function detectSportsIntent(text) {
  const safe = normalizeText(text);
  if (!safe) return null;

  if (/大会|試合|レース|本番|補食|当日朝/.test(safe)) return 'competition';
  if (/フォーム|動画|走り方|投げ方|泳ぎ|スイング/.test(safe)) return 'form';
  if (/練習|トレーニング|メニュー|800m|400m|ラン|競技/.test(safe)) return 'training';
  return null;
}

function buildSportsReply(intent) {
  if (intent === 'competition') {
    return [
      '大会や試合の日の相談ですね。',
      '種目、開始時間、食べやすいものを1つ送ってもらえれば、当日の動きに合わせて整理します。'
    ].join('\n');
  }

  if (intent === 'form') {
    return [
      'フォームの相談ですね。',
      '競技名と、気になる動きが分かる一言や動画があると見立てやすいです。'
    ].join('\n');
  }

  return [
    '練習の相談ですね。',
    '競技名、今日やった内容、困っていることを短く送ってもらえれば、無理のない次の一手に整えます。'
  ].join('\n');
}

module.exports = {
  detectSportsIntent,
  buildSportsReply
};
