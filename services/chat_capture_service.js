'use strict';

/**
 * services/chat_capture_service.js
 *
 * 目的:
 * - 直前会話から ChatGPT に渡すための「会話記憶メモ」を軽く作る
 * - 雑談 / 相談 / 記録 / 手続き の流れを次のターンへ渡しやすくする
 * - 高齢者相手でも機械っぽくならない会話継続の補助
 *
 * 注意:
 * - 既存の大きな chat_capture_service.js がある場合でも、
 *   補助関数群として使えるようにしている
 * - 最終的に index.js から必要関数だけ呼べる形
 */

const { safeText } = require('./chat_context_service');

function summarizeUserState(user = {}) {
  if (!user || typeof user !== 'object') return '';

  const parts = [];

  if (user.display_name) parts.push(`名前: ${safeText(user.display_name)}`);
  if (user.nickname) parts.push(`呼び名: ${safeText(user.nickname)}`);
  if (user.goal) parts.push(`目標: ${safeText(user.goal)}`);
  if (user.purpose) parts.push(`目的: ${safeText(user.purpose)}`);
  if (user.ai_tone_label) parts.push(`AIトーン: ${safeText(user.ai_tone_label)}`);
  if (user.trial_status) parts.push(`体験状況: ${safeText(user.trial_status)}`);
  if (user.current_plan) parts.push(`プラン: ${safeText(user.current_plan)}`);

  return parts.join(' / ');
}

function buildRecentConversationMemo(recentMessages = []) {
  const list = Array.isArray(recentMessages) ? recentMessages.slice(-6) : [];
  const lines = [];

  for (const item of list) {
    const role = safeText(item.role) === 'assistant' ? 'AI' : '利用者';
    const text = safeText(item.text || item.message || item.body || '');
    if (!text) continue;
    lines.push(`${role}: ${text}`);
  }

  return lines.join('\n').trim();
}

function buildCompanionMemorySnippet({
  user = {},
  recentMessages = [],
  latestRoute = '',
  latestSummary = '',
  latestRecordCandidate = null,
} = {}) {
  const parts = [];

  const userState = summarizeUserState(user);
  if (userState) parts.push(`利用者情報\n${userState}`);

  const convo = buildRecentConversationMemo(recentMessages);
  if (convo) parts.push(`直前会話\n${convo}`);

  if (latestRoute) parts.push(`直前の会話分類\n${safeText(latestRoute)}`);
  if (latestSummary) parts.push(`今回の要点\n${safeText(latestSummary)}`);

  if (latestRecordCandidate?.type) {
    parts.push(
      `記録候補\n` +
      `種類: ${safeText(latestRecordCandidate.type)}\n` +
      `要約: ${safeText(latestRecordCandidate.user_facing_summary)}`
    );
  }

  return parts.join('\n\n').trim();
}

function buildAssistantReplyGuard({
  latestRoute = '',
  isAmbiguous = false,
  shouldAvoidSales = false,
  shouldAvoidRecordPush = false,
} = {}) {
  return {
    latestRoute: safeText(latestRoute),
    isAmbiguous: Boolean(isAmbiguous),
    shouldAvoidSales: Boolean(shouldAvoidSales),
    shouldAvoidRecordPush: Boolean(shouldAvoidRecordPush),
    rules: [
      shouldAvoidSales ? '雑談や相談中はサービス説明へ飛ばしすぎない' : null,
      shouldAvoidRecordPush ? '記録が確定していない時は保存を急がせない' : null,
      isAmbiguous ? '意味が分かれそうな時は会話継続を優先する' : null,
    ].filter(Boolean),
  };
}

function buildNaturalFollowupSuggestion({
  latestRoute = '',
  topicHints = {},
} = {}) {
  if (latestRoute === 'consultation') {
    return '気持ちや状況をもう少しだけ聞きながら寄り添って返す';
  }

  if (latestRoute === 'smalltalk') {
    return '無理に記録や案内へ進めず、自然に会話を続ける';
  }

  if (latestRoute === 'record_candidate') {
    if (topicHints.hasMealTopic) return '食事記録として整理しつつ、合っているかやさしく確認する';
    if (topicHints.hasExerciseTopic) return '運動記録として整理しつつ、時間や内容をやさしく確認する';
    return '記録候補として整理しつつ、保存を急がせず確認する';
  }

  if (latestRoute === 'procedure') {
    return '希望する手続きだけを簡潔に案内する';
  }

  return '無理に分類せず、自然に一言聞き返して意味を確かめる';
}

module.exports = {
  summarizeUserState,
  buildRecentConversationMemo,
  buildCompanionMemorySnippet,
  buildAssistantReplyGuard,
  buildNaturalFollowupSuggestion,
};
