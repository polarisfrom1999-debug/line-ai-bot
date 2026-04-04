"use strict";

function buildRunningVideoGuidance() {
  return [
    '走りの動画を見る時は、まず 10〜15秒くらいの短い動画で大丈夫です。',
    'おすすめは「横から 1本」と「正面か後方から 1本」です。',
    'できれば、アップではなく自然なペースで走っている場面を送ってください。',
    'そのうえで、接地・骨盤・腕振り・体幹のぶれ・左右差の見方を一緒に整理します。'
  ].join('\n');
}

function buildStillImageGuidance() {
  return [
    '静止画でも、立ち姿勢や接地の瞬間が分かる写真なら整理できます。',
    '横・正面・後方のどれか1枚でも大丈夫ですが、2方向あると見やすいです。',
    '画像だけで断定診断はしませんが、左右差やフォームの癖は一緒に見ていけます。'
  ].join('\n');
}

module.exports = {
  buildRunningVideoGuidance,
  buildStillImageGuidance,
};
