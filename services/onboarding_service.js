'use strict';

/**
 * services/onboarding_service.js
 *
 * 目的:
 * - 初回利用時の導線を軽く整える
 * - 4タイプ表示を共通化し、後の profile / intake と合わせやすくする
 */

const PERSONA_OPTIONS = [
  'そっと寄り添う',
  '明るく後押し',
  '頼もしく導く',
  '力強く支える',
];

const ONBOARDING_STEPS = {
  WELCOME: 'welcome',
  PERSONA_SELECT: 'persona_select',
  GOAL_CAPTURE: 'goal_capture',
  DONE: 'done',
};

function safeText(value, fallback = '') {
  return String(value || fallback).trim();
}

function buildQuickReplies(items = []) {
  return (Array.isArray(items) ? items : [])
    .filter(Boolean)
    .map((item) => ({ type: 'action', action: { type: 'message', label: item, text: item } }));
}

function buildWelcomeReply() {
  return {
    text: [
      'はじめまして。ここから。へようこそ。',
      'まずは、話しかけやすい伴走の雰囲気を選んでみましょう。',
    ].join('\n'),
    quickReplies: buildQuickReplies(PERSONA_OPTIONS),
  };
}

function buildPersonaSelectReply() {
  return {
    text: 'どんな雰囲気で寄り添ってほしいですか。',
    quickReplies: buildQuickReplies(PERSONA_OPTIONS),
  };
}

function buildGoalCaptureReply(selectedPersona = '') {
  return {
    text: [
      `${safeText(selectedPersona)} を選びました。`,
      'これから、どんなふうになりたいかを一言で教えてくださいね。',
    ].join('\n'),
    quickReplies: [],
  };
}

module.exports = {
  PERSONA_OPTIONS,
  ONBOARDING_STEPS,
  buildQuickReplies,
  buildWelcomeReply,
  buildPersonaSelectReply,
  buildGoalCaptureReply,
};
