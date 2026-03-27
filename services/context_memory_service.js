'use strict';

const shortMemoryStore = new Map();
const longMemoryStore = new Map();
const userStateStore = new Map();
const recentMessageStore = new Map();
const recordStore = new Map();
const surveyStore = new Map();
const pointsStore = new Map();

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
    currentStep: null,
    completedSteps: [],
    answers: {}
  },
  surveySession: {
    isActive: false,
    surveyType: null,
    currentIndex: 0,
    answers: []
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

function nowTokyoDate() {
  const now = new Date();
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Tokyo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).format(now);
}

function dateKeyFromDaysAgo(daysAgo) {
  const now = new Date();
  const utc = new Date(now.getTime() - (daysAgo * 24 * 60 * 60 * 1000));
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Tokyo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).format(utc);
}

function recordKey(userId, dateKey) {
  return `${userId}:${dateKey}`;
}

async function getShortMemory(userId) {
  return clone(shortMemoryStore.get(userId) || DEFAULT_SHORT_MEMORY);
}

async function getLongMemory(userId) {
  return clone(longMemoryStore.get(userId) || DEFAULT_LONG_MEMORY);
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
  return clone(userStateStore.get(userId) || DEFAULT_USER_STATE);
}

async function updateUserState(userId, nextState) {
  const merged = mergeDeep(DEFAULT_USER_STATE, nextState || {});
  userStateStore.set(userId, merged);
  return clone(merged);
}

async function getRecentMessages(userId, limit = 20) {
  return clone((recentMessageStore.get(userId) || []).slice(-limit));
}

async function appendRecentMessage(userId, role, content) {
  if (!userId || !role || !content) return;
  const arr = recentMessageStore.get(userId) || [];
  arr.push({
    role,
    content: String(content),
    createdAt: new Date().toISOString()
  });
  recentMessageStore.set(userId, arr.slice(-200));
}

async function buildRecentSummary(userId) {
  const messages = await getRecentMessages(userId, 40);
  const userText = messages.filter((m) => m.role === 'user').map((m) => m.content).join('\n');
  const parts = [];
  if (/疲れ|眠い|寝不足|だるい/.test(userText)) parts.push('最近は疲れや眠さの話が少し出ています。');
  if (/不安|つらい|しんどい|苦しい/.test(userText)) parts.push('不安やしんどさが時々あります。');
  if (/ラーメン|ご飯|ごはん|朝ごはん|昼ごはん|夜ごはん|寿司|味噌汁|卵/.test(userText)) parts.push('食事の記録は少しずつ続いています。');
  if (/歩いた|ジョギング|スクワット|運動/.test(userText)) parts.push('運動の話題も入ってきています。');
  return parts.join(' ') || '';
}

async function addRecord(userId, record) {
  const key = recordKey(userId, record?.eventDate || nowTokyoDate());
  const arr = recordStore.get(key) || [];
  const incoming = { ...record, createdAt: new Date().toISOString() };

  if (record?._replaceLastOfType) {
    for (let i = arr.length - 1; i >= 0; i--) {
      if (arr[i]?.recordType === record.recordType) {
        arr[i] = incoming;
        recordStore.set(key, arr);
        return clone(arr);
      }
    }
  }

  arr.push(incoming);
  recordStore.set(key, arr);
  return clone(arr);
}

async function getTodayRecords(userId) {
  return clone(recordStore.get(recordKey(userId, nowTokyoDate())) || []);
}

async function getRecordsForDays(userId, days = 7) {
  const out = [];
  for (let i = 0; i < days; i++) {
    const key = recordKey(userId, dateKeyFromDaysAgo(i));
    const arr = recordStore.get(key) || [];
    out.push(...arr);
  }
  return clone(out);
}

async function saveSurveyAnswer(userId, surveyType, payload) {
  const key = `${userId}:${surveyType}`;
  const arr = surveyStore.get(key) || [];
  arr.push({ ...payload, createdAt: new Date().toISOString() });
  surveyStore.set(key, arr);
}

async function getSurveyAnswers(userId, surveyType) {
  return clone(surveyStore.get(`${userId}:${surveyType}`) || []);
}

async function addPoints(userId, points, reason) {
  const current = pointsStore.get(userId) || { total: 0, history: [] };
  const n = Number(points || 0);
  if (!n) return clone(current);
  current.total += n;
  current.history.push({ points: n, reason, createdAt: new Date().toISOString() });
  pointsStore.set(userId, current);
  return clone(current);
}

async function getPoints(userId) {
  return clone(pointsStore.get(userId) || { total: 0, history: [] });
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
  addRecord,
  getTodayRecords,
  getRecordsForDays,
  saveSurveyAnswer,
  getSurveyAnswers,
  addPoints,
  getPoints
};
