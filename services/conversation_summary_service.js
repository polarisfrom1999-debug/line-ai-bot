'use strict';

const { getBusinessDateInfo } = require('./day_boundary_service');
const contextMemoryService = require('./context_memory_service');

let supabase = null;
let ensureUser = null;
try {
  ({ supabase } = require('./supabase_service'));
  ({ ensureUser } = require('./user_service'));
} catch (_error) {
  supabase = null;
  ensureUser = null;
}

const rollingSummaryStore = new Map();
const dailySummaryStore = new Map();

function nowIso() {
  return new Date().toISOString();
}

function normalizeText(value) {
  return String(value || '').trim();
}

function compactArray(values, limit = 8) {
  return [...new Set((Array.isArray(values) ? values : []).map((v) => normalizeText(v)).filter(Boolean))].slice(-limit);
}

function looksLike(text, pattern) {
  return pattern.test(normalizeText(text || ''));
}

function extractTopics(userText, internal) {
  const text = normalizeText(userText);
  const topics = [];
  if (looksLike(text, /食べた|飲んだ|ラーメン|カレー|ごはん|朝食|昼食|夕食|おにぎり|パン|ヨーグルト/)) topics.push('食事');
  if (looksLike(text, /歩いた|走った|ジョギング|ランニング|筋トレ|ストレッチ|スクワット|散歩/)) topics.push('運動');
  if (looksLike(text, /LDL|HDL|中性脂肪|HbA1c|血液検査|採血|TG|AST|ALT/)) topics.push('血液検査');
  if (looksLike(text, /痛い|しびれ|腰|膝|首|肩|だるい|しんどい|眠い|疲れ/)) topics.push('心身の不調');
  if (looksLike(text, /大会|800m|1500m|フォーム|レース|タイム/)) topics.push('競技・大会');
  if (looksLike(text, /名前|プロフィール|体重|体脂肪率|目標/)) topics.push('プロフィール');
  if (internal?.intentType) topics.push(`intent:${internal.intentType}`);
  return compactArray(topics);
}

function buildSummaryText(state) {
  const recentTopics = compactArray(state.recentTopics || [], 6);
  const rollingFacts = compactArray(state.keyFacts || [], 6);
  const recentNotes = compactArray(state.recentNotes || [], 3);

  return [
    recentTopics.length ? `最近のテーマ: ${recentTopics.join(' / ')}` : null,
    rollingFacts.length ? `伴走に効く前提: ${rollingFacts.join(' / ')}` : null,
    recentNotes.length ? `直近メモ: ${recentNotes.join(' / ')}` : null,
    state.lastIntent ? `直近intent: ${state.lastIntent}` : null
  ].filter(Boolean).join('\n');
}

async function resolvePersistentUser(lineUserId) {
  if (!supabase || !ensureUser || !lineUserId) return null;
  try {
    return await ensureUser(supabase, lineUserId, 'Asia/Tokyo');
  } catch (_error) {
    return null;
  }
}

async function upsertSummaryRow(userId, lineUserId, scope, key, state, traceId) {
  if (!supabase) return;
  const persistentUser = await resolvePersistentUser(lineUserId || userId);
  if (!persistentUser) return;

  const payload = {
    user_id: persistentUser.id,
    line_user_id: lineUserId || userId,
    summary_scope: scope,
    summary_key: key,
    summary_text: buildSummaryText(state),
    structured_context: {
      recentTopics: compactArray(state.recentTopics || [], 10),
      keyFacts: compactArray(state.keyFacts || [], 10),
      recentNotes: compactArray(state.recentNotes || [], 5),
      lastIntent: state.lastIntent || null,
      lastUpdatedAt: state.updatedAt || nowIso()
    },
    latest_trace_id: traceId || '',
    updated_at: nowIso()
  };

  try {
    await supabase
      .from('conversation_summaries')
      .upsert(payload, { onConflict: 'user_id,summary_scope,summary_key' });
  } catch (error) {
    console.error('[conversation_summary_service] upsertSummaryRow error:', error?.message || error);
  }
}

function buildKeyFacts(memorySnapshot) {
  const facts = [];
  if (memorySnapshot?.preferredName) facts.push(`呼び方: ${memorySnapshot.preferredName}`);
  if (memorySnapshot?.goal) facts.push(`目標: ${memorySnapshot.goal}`);
  if (memorySnapshot?.weight) facts.push(`体重: ${memorySnapshot.weight}`);
  if (memorySnapshot?.bodyFat) facts.push(`体脂肪率: ${memorySnapshot.bodyFat}`);
  if (memorySnapshot?.aiType) facts.push(`AIタイプ: ${memorySnapshot.aiType}`);
  if (memorySnapshot?.constitutionType) facts.push(`体質: ${memorySnapshot.constitutionType}`);
  return facts;
}

async function recordTurn({ input, result }) {
  if (!input?.userId || !result) return;

  const memorySnapshot = await contextMemoryService.getMemorySnapshot(input.userId).catch(() => null);
  const userText = normalizeText(input.rawText || (input.messageType === 'image' ? '[image]' : ''));
  const replyText = normalizeText((Array.isArray(result.replyMessages) ? result.replyMessages : []).map((m) => normalizeText(m?.text || '')).filter(Boolean).join('\n'));
  const topics = extractTopics(userText, result.internal || {});
  const keyFacts = buildKeyFacts(memorySnapshot || {});

  const rollingCurrent = rollingSummaryStore.get(input.userId) || { recentTopics: [], keyFacts: [], recentNotes: [], lastIntent: null, updatedAt: null };
  const rollingNext = {
    recentTopics: compactArray([...(rollingCurrent.recentTopics || []), ...topics], 10),
    keyFacts: compactArray([...(rollingCurrent.keyFacts || []), ...keyFacts], 10),
    recentNotes: compactArray([...(rollingCurrent.recentNotes || []), userText && replyText ? `${userText.slice(0, 80)} => ${replyText.slice(0, 100)}` : userText || replyText], 5),
    lastIntent: result.internal?.intentType || rollingCurrent.lastIntent || '',
    updatedAt: nowIso()
  };
  rollingSummaryStore.set(input.userId, rollingNext);
  await upsertSummaryRow(input.userId, input.lineUserId || input.userId, 'rolling', 'current', rollingNext, input.traceId);

  const dayInfo = getBusinessDateInfo(new Date(input.timestamp || Date.now()));
  const dailyKey = `${input.userId}:${dayInfo.dayKey}`;
  const dailyCurrent = dailySummaryStore.get(dailyKey) || { recentTopics: [], keyFacts: [], recentNotes: [], lastIntent: null, updatedAt: null };
  const dailyNext = {
    recentTopics: compactArray([...(dailyCurrent.recentTopics || []), ...topics], 10),
    keyFacts: compactArray([...(dailyCurrent.keyFacts || []), ...keyFacts], 10),
    recentNotes: compactArray([...(dailyCurrent.recentNotes || []), userText || replyText], 6),
    lastIntent: result.internal?.intentType || dailyCurrent.lastIntent || '',
    updatedAt: nowIso()
  };
  dailySummaryStore.set(dailyKey, dailyNext);
  await upsertSummaryRow(input.userId, input.lineUserId || input.userId, 'daily', dayInfo.dayKey, dailyNext, input.traceId);
}

async function getPromptSummary(userId) {
  if (!userId) return '';
  const inMemory = rollingSummaryStore.get(userId);
  if (inMemory) return buildSummaryText(inMemory);

  if (!supabase) return '';
  const persistentUser = await resolvePersistentUser(userId);
  if (!persistentUser) return '';

  try {
    const { data } = await supabase
      .from('conversation_summaries')
      .select('summary_text, structured_context')
      .eq('user_id', persistentUser.id)
      .eq('summary_scope', 'rolling')
      .eq('summary_key', 'current')
      .maybeSingle();
    return normalizeText(data?.summary_text || '');
  } catch (error) {
    console.error('[conversation_summary_service] getPromptSummary error:', error?.message || error);
    return '';
  }
}

module.exports = {
  recordTurn,
  getPromptSummary
};
