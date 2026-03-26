'use strict';

/**
 * services/context_memory_service.js
 *
 * 役割:
 * - 短期記憶 / 長期記憶 / recent summary / user state を扱う
 * - 既存DBが未接続でも落ちないように in-memory fallback を持つ
 * - 会話に再利用しやすい形へ整えて返す
 */

const DEFAULT_SHORT_MEMORY = {
  lastTopic: null,
  lastImageType: null,
  pendingRecordCandidate: null,
  pendingClarification: null,
  lastEmotionTone: 'neutral',
  lastAdvice: null,
  recentSmallTalkTopic: null,
  followUpContext: null
};

const DEFAULT_LONG_MEMORY = {
  preferredName: null,
  goal: null,
  eatingPattern: [],
  stagnationTendency: null,
  bodySignals: [],
  exerciseBarrier: [],
  supportPreference: [],
  lifeContext: []
};

const DEFAULT_USER_STATE = {
  nagiScore: 5,
  gasolineScore: 5,
  trustScore: 3,
  lastEmotionTone: 'neutral',
  updatedAt: null
};

const memoryStore = {
  short: new Map(),
  long: new Map(),
  state: new Map(),
  messages: new Map()
};

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function nowIso() {
  return new Date().toISOString();
}

function mergeObjects(base, patch) {
  return Object.assign({}, base || {}, patch || {});
}

function uniqueArray(values) {
  return Array.from(new Set((values || []).filter(Boolean)));
}

function normalizeCandidateText(candidate) {
  return String(candidate || '').trim();
}

function getOrInitMapValue(map, key, defaultValue) {
  if (!map.has(key)) {
    map.set(key, clone(defaultValue));
  }
  return clone(map.get(key));
}

async function getShortMemory(userId) {
  return getOrInitMapValue(memoryStore.short, userId, DEFAULT_SHORT_MEMORY);
}

async function getLongMemory(userId) {
  return getOrInitMapValue(memoryStore.long, userId, DEFAULT_LONG_MEMORY);
}

async function getUserState(userId) {
  return getOrInitMapValue(memoryStore.state, userId, DEFAULT_USER_STATE);
}

async function saveShortMemory(userId, payload) {
  const current = await getShortMemory(userId);
  const next = mergeObjects(current, payload || {});
  memoryStore.short.set(userId, clone(next));
  return clone(next);
}

function classifyLongMemoryCandidate(candidate) {
  const text = normalizeCandidateText(candidate);
  if (!text) return null;

  if (/呼び方|うっし|名前/.test(text)) return { bucket: 'preferredName', value: text };
  if (/目標|痩せ|体重|無理なく/.test(text)) return { bucket: 'goal', value: text };
  if (/夜遅|食事|たんぱく|糖質|脂質|食べ/.test(text)) return { bucket: 'eatingPattern', value: text };
  if (/停滞|不安/.test(text)) return { bucket: 'stagnationTendency', value: text };
  if (/むくみ|便通|水分|だるい|疲れ|眠/.test(text)) return { bucket: 'bodySignals', value: text };
  if (/運動|痛み|首|骨折|膝|腰/.test(text)) return { bucket: 'exerciseBarrier', value: text };
  if (/優しく|整理|理屈|寄り添|声かけ/.test(text)) return { bucket: 'supportPreference', value: text };
  if (/家族|仕事|生活|リズム|夜勤|育児/.test(text)) return { bucket: 'lifeContext', value: text };
  return { bucket: 'lifeContext', value: text };
}

function shouldPersistLongMemoryCandidate(candidate, existingMemory) {
  const text = normalizeCandidateText(candidate);
  if (!text) return false;
  if (text.length <= 2) return false;

  const flatValues = [];
  Object.values(existingMemory || {}).forEach((value) => {
    if (Array.isArray(value)) {
      flatValues.push(...value);
    } else if (value) {
      flatValues.push(value);
    }
  });

  if (flatValues.includes(text)) return false;
  if (/今日は|さっき|たまたま|冗談|笑/.test(text)) return false;
  return true;
}

function mergeLongMemoryValue(existingMemory, candidate) {
  const classified = classifyLongMemoryCandidate(candidate);
  if (!classified) return existingMemory;

  const next = clone(existingMemory || DEFAULT_LONG_MEMORY);
  const { bucket, value } = classified;

  if (Array.isArray(next[bucket])) {
    next[bucket] = uniqueArray([...(next[bucket] || []), value]);
  } else if (!next[bucket]) {
    next[bucket] = value;
  }

  return next;
}

async function mergeLongMemory(userId, candidates) {
  const current = await getLongMemory(userId);
  let next = clone(current);

  for (const rawCandidate of candidates || []) {
    const candidate = normalizeCandidateText(rawCandidate);
    if (!shouldPersistLongMemoryCandidate(candidate, next)) continue;
    next = mergeLongMemoryValue(next, candidate);
  }

  memoryStore.long.set(userId, clone(next));
  return clone(next);
}

async function getRecentMessages(userId, limit = 20) {
  const rows = clone(memoryStore.messages.get(userId) || []);
  return rows.slice(-Math.max(1, limit));
}

async function appendRecentMessages(userId, messages) {
  const current = clone(memoryStore.messages.get(userId) || []);
  const next = current.concat((messages || []).filter((row) => row && row.role && row.content));
  memoryStore.messages.set(userId, next.slice(-100));
  return clone(next.slice(-100));
}

function countHits(text, patterns) {
  const safeText = String(text || '');
  return (patterns || []).reduce((count, pattern) => count + (safeText.includes(pattern) ? 1 : 0), 0);
}

function summarizeRecentMessages(messages) {
  const joinedUser = (messages || [])
    .filter((m) => m.role === 'user')
    .map((m) => String(m.content || ''))
    .join('\n');

  const fatigueHits = countHits(joinedUser, ['疲れ', '眠', '寝不足', 'だる', '余裕ない', 'バタバタ']);
  const anxietyHits = countHits(joinedUser, ['不安', '停滞', '焦', '最悪', 'やばい']);
  const painHits = countHits(joinedUser, ['痛', '骨折', '首', '腰', '膝']);
  const foodHits = countHits(joinedUser, ['食べ', 'ごはん', '夜遅', 'むくみ', '便通', '水分']);

  const lines = [];
  if (fatigueHits >= 2) lines.push('最近2〜3日、疲れや睡眠不足の表現が続いている。');
  if (anxietyHits >= 2) lines.push('停滞や先行きへの不安がやや出やすい。');
  if (painHits >= 1) lines.push('痛みや身体負担が会話の背景にある。');
  if (foodHits >= 2) lines.push('食事やむくみ、水分バランスへの意識が続いている。');
  if (!lines.length && joinedUser) lines.push('直近は大きく荒れすぎず、日常の流れの中でやり取りが続いている。');
  return lines.join(' ');
}

async function buildRecentSummary(userId, days = 3) {
  void days;
  const messages = await getRecentMessages(userId, 30);
  return summarizeRecentMessages(messages);
}

async function updateUserState(userId, nextState) {
  const safeState = Object.assign({}, DEFAULT_USER_STATE, nextState || {}, {
    updatedAt: (nextState && nextState.updatedAt) || nowIso()
  });
  memoryStore.state.set(userId, clone(safeState));
  return clone(safeState);
}

module.exports = {
  DEFAULT_SHORT_MEMORY,
  DEFAULT_LONG_MEMORY,
  DEFAULT_USER_STATE,
  getShortMemory,
  getLongMemory,
  saveShortMemory,
  mergeLongMemory,
  getRecentMessages,
  appendRecentMessages,
  buildRecentSummary,
  updateUserState,
  getUserState,
  shouldPersistLongMemoryCandidate,
  mergeLongMemoryValue
};
