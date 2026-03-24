'use strict';

/**
 * services/chat_intent_service.js
 */

function safeText(value, fallback = '') {
  return String(value || fallback).trim();
}

function normalizeLoose(text = '') {
  return safeText(text)
    .toLowerCase()
    .replace(/[！!？?。.,，、]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function detectEmotionTone(text = '') {
  const t = normalizeLoose(text);
  if (!t) return 'neutral';
  if (/(不安|つらい|しんどい|落ち|怖い|気になる)/.test(t)) return 'anxious';
  if (/(うれしい|嬉しい|できた|順調|よかった)/.test(t)) return 'positive';
  if (/(疲れた|眠い|だるい|忙しい)/.test(t)) return 'tired';
  return 'neutral';
}

function detectSupportNeed(text = '') {
  const raw = safeText(text);
  const t = normalizeLoose(text);
  if (!t) return 'none';
  if (/[?？]/.test(raw)) return 'question';
  if (/(相談|どうしたら|どうすれば|いいですか|大丈夫かな|していい)/.test(t)) return 'consult';
  if (/(痛い|違和感|しびれ|不安)/.test(t)) return 'consult';
  return 'none';
}

function estimateChatPreference(text = '') {
  const raw = safeText(text);
  if (!raw) return 'balanced';
  if (raw.length <= 12) return 'record_focused';
  if (raw.length >= 60) return 'chat_friendly';
  return 'balanced';
}

function analyzeTextIntent(text = '', context = {}) {
  const tone = detectEmotionTone(text);
  const supportNeed = detectSupportNeed(text);
  const chatPreference = estimateChatPreference(text);

  return {
    tone,
    support_need: supportNeed,
    chat_preference: context.chat_preference || chatPreference,
    should_prefer_consultation: supportNeed === 'consult',
    should_keep_short: chatPreference !== 'chat_friendly',
  };
}

module.exports = {
  safeText,
  normalizeLoose,
  detectEmotionTone,
  detectSupportNeed,
  estimateChatPreference,
  analyzeTextIntent,
};
