'use strict';

function buildTtlExpiredReply() {
  return '前の画像の保持期限が切れています。もう一度同じ画像を送ってください。';
}

function buildCanonicalInsufficientReply() {
  return '今確認できる範囲では判断材料が不足しているため、もう一度画像を送ってください。';
}

function buildLabGenericReply() {
  return '検査画像の続きとして確認します。項目名（例: TG, LDL, HbA1c）を指定して聞いてください。';
}

function buildMealGenericReply() {
  return '食事画像の続きとして扱います。「麺だけ0kcal」「半分食べた」「食べてない」のように指定してください。';
}

module.exports = {
  buildTtlExpiredReply,
  buildCanonicalInsufficientReply,
  buildLabGenericReply,
  buildMealGenericReply,
};
