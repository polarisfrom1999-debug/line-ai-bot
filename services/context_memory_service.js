'use strict';

const shortMemoryStore = new Map();
const longMemoryStore = new Map();
const userStateStore = new Map();
const recentMessageStore = new Map();
const dailyRecordStore = new Map();

const DEFAULT_SHORT_MEMORY = {
  lastTopic: null,
  lastImageType: null,
  pendingRecordCandidate: null,
  pendingClarification: null,
  lastEmotionTone: 'neutral',
  lastAdvice: null,
  recentSmallTalkTopic: null,
  followUpContext: null,
  onboardingState: {
    isActive: false,
    mode: null,
    currentStep: null,
    completedSteps: [],
    answers: {}
  }
};

const DEFAULT_LONG_MEMORY = {
  preferredName: null,
  goal: null,
  eatingPattern: [],
  stagnationTendency: null,
  bodySignals: [],
  exerciseBarrier: [],
  supportPreference: [],
  lifeContext: [],
  age: null,
  weight: null,
  bodyFat: null,
  aiType: null,
  constitutionType: null,
  trialStartedAt: null,
  selectedPlan: null,
  onboardingCompleted: false
};

const DEFAULT_USER_STATE = {
  nagiScore: 5,
  gasolineScore: 5,
  trustScore: 3,
  lastEmotionTone: 'neutral',
  updatedAt: null
};

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function mergeDeep(base, patch) {
  if (!patch || typeof patch !== 'object' || Array.isArray(patch)) return patch;
  const result = Array.isArray(base) ? [...base] : { ...(base || {}) };

  for (const [key, value] of Object.entries(patch)) {
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      result[key] = mergeDeep(result[key], value);
    } else {
      result[key] = value;
    }
  }

  return result;
}

function getTodayKey() {
  return new Intl.DateTimeFormat('sv-SE', {
    timeZone: 'Asia/Tokyo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).format(new Date());
}

async function getShortMemory(userId) {
  const value = shortMemoryStore.get(userId);
  return clone(value || DEFAULT_SHORT_MEMORY);
}

async function getLongMemory(userId) {
  const value = longMemoryStore.get(userId);
  return clone(value || DEFAULT_LONG_MEMORY);
}

async function saveShortMemory(userId, payload) {
  const current = await getShortMemory(userId);
  const next = mergeDeep(current, payload || {});
  shortMemoryStore.set(userId, next);
  return clone(next);
}

async function mergeLongMemory(userId, patch) {
  const current = await getLongMemory(userId);
  let next = clone(current);

  if (Array.isArray(patch)) {
    for (const candidate of patch) {
      if (typeof candidate !== 'string' || !candidate.trim()) continue;
      if (!next.lifeContext.includes(candidate)) next.lifeContext.push(candidate);
    }
  } else {
    next = mergeDeep(current, patch || {});
  }

  longMemoryStore.set(userId, next);
  return clone(next);
}

async function getUserState(userId) {
  const value = userStateStore.get(userId);
  return clone(value || DEFAULT_USER_STATE);
}

async function updateUserState(userId, nextState) {
  const merged = mergeDeep(DEFAULT_USER_STATE, nextState || {});
  userStateStore.set(userId, merged);
  return clone(merged);
}

async function getRecentMessages(userId, limit = 20) {
  const arr = recentMessageStore.get(userId) || [];
  return clone(arr.slice(-limit));
}

async function appendRecentMessage(userId, role, content) {
  if (!userId || !role || !content) return;
  const arr = recentMessageStore.get(userId) || [];
  arr.push({
    role,
    content: String(content),
    createdAt: new Date().toISOString()
  });
  recentMessageStore.set(userId, arr.slice(-100));
}

async function buildRecentSummary(userId, _days = 3) {
  const messages = await getRecentMessages(userId, 30);
  const userText = messages.filter((m) => m.role === 'user').map((m) => m.content).join('\n');

  const parts = [];
  if (/疲れ|眠い|寝不足|だるい/.test(userText)) parts.push('最近は疲れや眠さの話が少し出ています。');
  if (/不安|つらい|しんどい|苦しい/.test(userText)) parts.push('不安やしんどさが時々あります。');
  if (/ラーメン|ごはん|朝ごはん|昼ごはん|夜ごはん|寿司/.test(userText)) parts.push('食事の記録は少しずつ続いています。');
  if (/歩いた|ジョギング|スクワット|運動|走りました|走った/.test(userText)) parts.push('運動の話題も入ってきています。');

  return parts.join(' ') || '';
}

async function addDailyRecord(userId, record) {
  const key = `${userId}:${getTodayKey()}`;
  const current = dailyRecordStore.get(key) || {
    meals: [],
    exercises: [],
    weights: [],
    labs: []
  };

  if (record?.type === 'meal') current.meals.push(record);
  if (record?.type === 'exercise') current.exercises.push(record);
  if (record?.type === 'weight') current.weights.push(record);
  if (record?.type === 'lab') current.labs.push(record);

  dailyRecordStore.set(key, current);
  return clone(current);
}

async function getTodayRecords(userId) {
  const key = `${userId}:${getTodayKey()}`;
  return clone(dailyRecordStore.get(key) || {
    meals: [],
    exercises: [],
    weights: [],
    labs: []
  });
}

module.exports = {
  getShortMemory,
  getLongMemory,
  saveShortMemory,
  mergeLongMemory,
  getRecentMessages,
  appendRecentMessage,
  buildRecentSummary,
  updateUserState,
  getUserState,
  addDailyRecord,
  getTodayRecords
};
