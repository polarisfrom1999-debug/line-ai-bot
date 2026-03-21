'use strict';

/**
 * services/chat_recovery_service.js
 *
 * 目的:
 * - 判定が曖昧な時や例外時に、利用者へ機械的なエラーを見せずに自然回復させる
 * - 「保存失敗です」「処理できません」ではなく、会話の流れを保ったまま聞き直す
 */

function safeText(value, fallback = '') {
  return String(value || fallback).trim();
}

function normalizeLoose(text = '') {
  return safeText(text)
    .toLowerCase()
    .replace(/[！!？?\s　。、,\.\-ー]/g, '');
}

function looksLikeYes(text = '') {
  return /^(はい|うん|お願いします|ok|okay|了解|それで|それで大丈夫)$/.test(normalizeLoose(text));
}

function looksLikeNo(text = '') {
  return /^(いいえ|ちがう|違う|違います|だめ|やめる|キャンセル|不要)$/.test(normalizeLoose(text));
}

function buildSoftFollowup({
  route = 'unknown',
  userText = '',
  lastAssistantText = '',
  topicHints = {},
} = {}) {
  const text = safeText(userText);
  const lastAi = safeText(lastAssistantText);

  if (route === 'record_candidate') {
    if (topicHints.hasMealTopic) {
      return '食事のこととして受け取っています。内容や量が少しあいまいなので、食べたものをもう少しだけ教えてくださいね。';
    }
    if (topicHints.hasExerciseTopic) {
      return '運動のこととして見ています。時間や内容が少しだけ分かると、きれいに整理できます。';
    }
    if (topicHints.hasWeightTopic) {
      return '体重の記録として見ています。数値だけでも大丈夫なので、もう一度送ってくださいね。';
    }
    return '記録として受け取りたいのですが、内容が少しだけあいまいでした。もう一言だけ補足をお願いします。';
  }

  if (route === 'consultation') {
    return 'ありがとうございます。いまの気持ちや状況を大事に受け取りたいので、もう少しだけ詳しく教えてください。短くでも大丈夫です。';
  }

  if (route === 'procedure') {
    return '手続きのお話として受け取っています。やりたいことを一言でいいので、もう少しだけ教えてください。';
  }

  if (lastAi && looksLikeYes(text)) {
    return 'ありがとうございます。その流れで進めますね。';
  }

  if (lastAi && looksLikeNo(text)) {
    return 'わかりました。では無理に進めず、今の状況に合わせて別の形でお手伝いしますね。';
  }

  return 'うまく受け取れてはいるのですが、少しだけ意味が分かれそうでした。続けて一言だけ教えてくださいね。';
}

function buildNaturalErrorReply({
  stage = 'general',
  userText = '',
  topicHints = {},
} = {}) {
  if (stage === 'save') {
    return 'ありがとうございます。いま内容を整え直しているので、念のためもう一度だけ内容を送ってもらえますか。';
  }

  if (stage === 'parse') {
    if (topicHints.hasMealTopic) {
      return '食事の内容をていねいに拾いたいので、料理名や量を少しだけ言い換えてもらえると助かります。';
    }
    if (topicHints.hasExerciseTopic) {
      return '運動の内容をきれいに整理したいので、何をどれくらいしたかをもう一度だけ教えてください。';
    }
  }

  return 'ありがとうございます。こちらで意味を取り違えないようにしたいので、もう一度だけ短く送ってくださいね。';
}

function buildDisambiguationReply({
  candidates = [],
  topicHints = {},
} = {}) {
  const normalized = Array.isArray(candidates) ? candidates.filter(Boolean) : [];

  if (normalized.includes('consultation') && normalized.includes('record_candidate')) {
    if (topicHints.hasExerciseTopic) {
      return '相談としても受け取れますし、運動記録として整えることもできます。今は「相談したい」のか「記録したい」のか、どちらに近いですか。';
    }
    if (topicHints.hasMealTopic) {
      return 'お話として受け取ることも、食事記録として残すこともできます。今はどちらを希望ですか。';
    }
    return '今の内容は、会話として続けることも記録として整えることもできます。どちらに近いか教えてください。';
  }

  if (normalized.includes('procedure') && normalized.includes('smalltalk')) {
    return 'ご案内に進むこともできますし、まず普通にお話を続けることもできます。どちらにしましょうか。';
  }

  return '受け取り方が少しだけ分かれそうでした。もう一言だけ補足をお願いします。';
}

function buildRecoveryResult({
  ok = false,
  reason = '',
  replyText = '',
  needsClarification = true,
  route = 'unknown',
} = {}) {
  return {
    ok: Boolean(ok),
    reason: safeText(reason),
    route: safeText(route, 'unknown'),
    needsClarification: Boolean(needsClarification),
    replyText: safeText(replyText),
  };
}

module.exports = {
  normalizeLoose,
  looksLikeYes,
  looksLikeNo,
  buildSoftFollowup,
  buildNaturalErrorReply,
  buildDisambiguationReply,
  buildRecoveryResult,
};
