'use strict';

/**
 * services/trial_message_examples_service.js
 *
 * 目的:
 * - 体験中に「何を送ればいいかわからない」を減らす
 * - 価値が伝わりやすい送信例を出す
 */

function buildTrialMessageExamples() {
  return [
    '【体験中のおすすめ送信例】',
    '',
    '食事:',
    '・朝ごはんです',
    '・この写真です',
    '・昼はラーメンでした',
    '',
    '運動:',
    '・ウォーキング20分',
    '・今日はストレッチだけ',
    '',
    '体重:',
    '・今朝62.8kg',
    '・61.9kg 31.0%',
    '',
    '相談:',
    '・夜にお腹が空きやすいです',
    '・膝が少し痛いけど歩いて大丈夫？',
    '・最近やる気が出ません',
  ].join('\n').trim();
}

module.exports = {
  buildTrialMessageExamples,
};
