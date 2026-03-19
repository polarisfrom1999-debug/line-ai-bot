'use strict';

const {
  GENTLE_REMINDER_TEMPLATES,
  INPUT_HELP_TEMPLATES,
} = require('../config/engagement_config');

function safeText(value, fallback = '') {
  return String(value || fallback).trim();
}

function pickFirst(list = [], fallback = '') {
  if (!Array.isArray(list) || !list.length) return fallback;
  return safeText(list[0], fallback);
}

function buildGentleReminder(kind = 'fallback') {
  const bucket = GENTLE_REMINDER_TEMPLATES[kind] || GENTLE_REMINDER_TEMPLATES.fallback;
  return pickFirst(bucket, '短くて大丈夫です。思い出せる範囲で送ってくださいね。');
}

function buildInputHelpMessage() {
  const examples = Array.isArray(INPUT_HELP_TEMPLATES.short_examples)
    ? INPUT_HELP_TEMPLATES.short_examples
    : [];

  const reassurance = Array.isArray(INPUT_HELP_TEMPLATES.reassurance_lines)
    ? INPUT_HELP_TEMPLATES.reassurance_lines
    : [];

  return [
    ...reassurance,
    '',
    'たとえばこんな送り方で大丈夫です。',
    ...examples.map((x) => `・${x}`),
  ].join('\n');
}

function buildRetrySupportMessage() {
  return [
    '大丈夫です。やり直せます。',
    '短くて大丈夫なので、もう一度だけ送ってください。',
    '「体重 57.2」「朝 パン」「20分歩いた」のような短い形でも大丈夫です。',
  ].join('\n');
}

function buildPastDateHelpMessage() {
  return [
    '昨日の分や過去の日付でも大丈夫です。',
    'たとえば「昨日 夜 ラーメン」「3/19 20分歩いた」のように送れます。',
  ].join('\n');
}

module.exports = {
  buildGentleReminder,
  buildInputHelpMessage,
  buildRetrySupportMessage,
  buildPastDateHelpMessage,
};
