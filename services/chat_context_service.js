'use strict';

/**
 * services/chat_context_service.js
 *
 * 目的:
 * - 直前会話の流れを扱いやすい形に整える
 * - 曖昧な短文を直前文脈で補完しやすくする
 * - index.js 側で依存を増やしすぎない軽量な会話コンテキスト層
 *
 * 想定:
 * - DB / メモリ / users テーブル / 独自ログなどから取得した
 *   recentMessages をそのまま渡せるようにしている
 * - message の型は多少揺れても吸収する
 */

const DEFAULT_MAX_MESSAGES = 8;
const DEFAULT_MAX_CHARS = 1200;

function safeText(value, fallback = '') {
  return String(value || fallback).trim();
}

function clampNumber(value, min, max, fallback) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, n));
}

function normalizeRole(rawRole = '') {
  const v = safeText(rawRole).toLowerCase();
  if (['user', 'customer', 'client', 'member', 'human'].includes(v)) return 'user';
  if (['assistant', 'ai', 'bot', 'system'].includes(v)) return 'assistant';
  return 'unknown';
}

function normalizeMessage(raw = {}, index = 0) {
  const text = safeText(
    raw.text ||
    raw.message ||
    raw.body ||
    raw.content ||
    raw.transcript ||
    raw.user_message ||
    raw.assistant_message ||
    ''
  );

  const role = normalizeRole(
    raw.role ||
    raw.senderRole ||
    raw.sender_type ||
    raw.type ||
    (raw.isUser === true ? 'user' : raw.isAssistant === true ? 'assistant' : '')
  );

  return {
    id: safeText(raw.id || raw.message_id || `msg_${index + 1}`),
    role,
    text,
    timestamp: raw.timestamp || raw.created_at || raw.createdAt || null,
    raw,
  };
}

function normalizeMessages(messages = []) {
  if (!Array.isArray(messages)) return [];
  return messages
    .map((item, index) => normalizeMessage(item, index))
    .filter((item) => item.text);
}

function limitMessages(messages = [], maxMessages = DEFAULT_MAX_MESSAGES) {
  const safeMax = clampNumber(maxMessages, 1, 30, DEFAULT_MAX_MESSAGES);
  return messages.slice(-safeMax);
}

function summarizeMessages(messages = [], maxChars = DEFAULT_MAX_CHARS) {
  const safeMaxChars = clampNumber(maxChars, 200, 4000, DEFAULT_MAX_CHARS);
  const lines = [];

  for (const msg of messages) {
    const prefix = msg.role === 'assistant' ? 'AI' : msg.role === 'user' ? '利用者' : '会話';
    const line = `${prefix}: ${safeText(msg.text).replace(/\s+/g, ' ')}`;
    lines.push(line);
    const joined = lines.join('\n');
    if (joined.length >= safeMaxChars) {
      return joined.slice(0, safeMaxChars).trim();
    }
  }

  return lines.join('\n').trim();
}

function getLastUserMessage(messages = []) {
  const reversed = [...messages].reverse();
  return reversed.find((item) => item.role === 'user') || null;
}

function getLastAssistantMessage(messages = []) {
  const reversed = [...messages].reverse();
  return reversed.find((item) => item.role === 'assistant') || null;
}

function detectTopicHints(messages = []) {
  const joined = summarizeMessages(messages, 2000);

  const hints = {
    hasMealTopic: /(食べ|ご飯|朝食|昼食|夕食|間食|飲んだ|飲み物|カロリー|たんぱく質|脂質|糖質|おやつ)/.test(joined),
    hasExerciseTopic: /(歩い|走っ|ジョギング|筋トレ|ストレッチ|運動|痛み|膝|腰|疲れ|リハビリ)/.test(joined),
    hasWeightTopic: /(体重|体脂肪|kg|キロ)/i.test(joined),
    hasBloodTestTopic: /(血液検査|HbA1c|ヘモグロビンA1c|中性脂肪|コレステロール|血糖|AST|ALT|γ-GTP|尿酸)/i.test(joined),
    hasProcedureTopic: /(プラン|体験|無料|継続|支払い|決済|登録|変更|解約|会員|メニュー)/.test(joined),
    hasConsultTopic: /(どうしたら|どう思う|つらい|しんどい|悩み|不安|相談|わからない|迷う|大丈夫かな)/.test(joined),
  };

  return hints;
}

function isAmbiguousShortText(text = '') {
  const t = safeText(text).replace(/\s+/g, '');
  if (!t) return true;
  if (t.length <= 10) return true;
  if (/^(はい|うん|そう|違う|まだ|たぶん|少し|ちょっと|まあまあ|よくわからない|ちゃんとはわかってない)$/.test(t)) {
    return true;
  }
  return false;
}

function buildContextWindow({
  recentMessages = [],
  currentUserText = '',
  maxMessages = DEFAULT_MAX_MESSAGES,
  maxChars = DEFAULT_MAX_CHARS,
} = {}) {
  const normalizedMessages = limitMessages(normalizeMessages(recentMessages), maxMessages);
  const conversationSummary = summarizeMessages(normalizedMessages, maxChars);
  const lastUserMessage = getLastUserMessage(normalizedMessages);
  const lastAssistantMessage = getLastAssistantMessage(normalizedMessages);
  const topicHints = detectTopicHints(normalizedMessages);

  return {
    recentMessages: normalizedMessages,
    conversationSummary,
    lastUserMessage,
    lastAssistantMessage,
    currentUserText: safeText(currentUserText),
    currentTextLooksAmbiguous: isAmbiguousShortText(currentUserText),
    topicHints,
  };
}

function buildInterpretationInput({
  user,
  recentMessages = [],
  currentUserText = '',
  profileSummary = '',
  maxMessages = DEFAULT_MAX_MESSAGES,
} = {}) {
  const context = buildContextWindow({
    recentMessages,
    currentUserText,
    maxMessages,
  });

  return {
    user: user || null,
    currentUserText: safeText(currentUserText),
    profileSummary: safeText(profileSummary, ''),
    conversationSummary: context.conversationSummary,
    lastUserMessage: context.lastUserMessage,
    lastAssistantMessage: context.lastAssistantMessage,
    currentTextLooksAmbiguous: context.currentTextLooksAmbiguous,
    topicHints: context.topicHints,
    recentMessages: context.recentMessages,
  };
}

module.exports = {
  DEFAULT_MAX_MESSAGES,
  DEFAULT_MAX_CHARS,
  safeText,
  normalizeMessage,
  normalizeMessages,
  limitMessages,
  summarizeMessages,
  getLastUserMessage,
  getLastAssistantMessage,
  detectTopicHints,
  isAmbiguousShortText,
  buildContextWindow,
  buildInterpretationInput,
};
