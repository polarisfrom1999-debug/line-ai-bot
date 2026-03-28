'use strict';

const shortMemoryStore = new Map();
const longMemoryStore = new Map();
const userStateStore = new Map();
const recentMessageStore = new Map();
const dailyRecordStore = new Map();
const weeklySurveyStore = new Map();
const monthlySurveyStore = new Map();
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
  currentIntent: null,
  currentStateFlags: [],
  companionshipMode: 'balanced',
  lastUserNeed: null,
  activeHealthTheme: null,
  conversationBridge: null,
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
  onboardingCompleted: false,
  narrativeMemory: {
    strugglePatterns: [],
    reliefPatterns: [],
    supportStyleNotes: [],
    recurringTopics: [],
    backgroundContexts: []
  }
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

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function mergeDeep(base, patch) {
  if (!isPlainObject(patch)) return patch;
  const result = isPlainObject(base) ? { ...base } : {};

  for (const [key, value] of Object.entries(patch)) {
    if (isPlainObject(value)) {
      result[key] = mergeDeep(result[key], value);
    } else if (Array.isArray(value)) {
      result[key] = [...value];
    } else {
      result[key] = value;
    }
  }

  return result;
}

function nowIso() {
  return new Date().toISOString();
}

function getTodayKey() {
  return new Intl.DateTimeFormat('sv-SE', {
    timeZone: 'Asia/Tokyo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).format(new Date());
}

function getWeekKey() {
  const now = new Date();
  const tokyo = new Date(now.toLocaleString('en-US', { timeZone: 'Asia/Tokyo' }));
  const day = tokyo.getDay() || 7;
  tokyo.setHours(0, 0, 0, 0);
  tokyo.setDate(tokyo.getDate() - (day - 1));
  return new Intl.DateTimeFormat('sv-SE', {
    timeZone: 'Asia/Tokyo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).format(tokyo);
}

function getMonthKey() {
  const now = new Date();
  const parts = new Intl.DateTimeFormat('sv-SE', {
    timeZone: 'Asia/Tokyo',
    year: 'numeric',
    month: '2-digit'
  }).formatToParts(now);

  const map = {};
  for (const part of parts) {
    map[part.type] = part.value;
  }
  return `${map.year}-${map.month}`;
}

function buildDailyRecordBucket() {
  return {
    meals: [],
    exercises: [],
    weights: [],
    labs: []
  };
}

function buildSurveyBucket() {
  return {
    startedAt: null,
    updatedAt: null,
    answers: {},
    completed: false
  };
}

function normalizeString(value) {
  return String(value || '').trim();
}

function uniquePush(target, value) {
  const safe = normalizeString(value);
  if (!safe) return target;
  if (!target.includes(safe)) target.push(safe);
  return target;
}

function normalizeTopicLabel(value) {
  const safe = normalizeString(value);
  if (!safe) return '';
  return safe.length > 40 ? `${safe.slice(0, 40)}…` : safe;
}

function addNarrativeItems(next, key, values) {
  if (!Array.isArray(next?.narrativeMemory?.[key])) return;
  for (const value of values) uniquePush(next.narrativeMemory[key], value);
}

function inferNarrativePatchFromMessages(messages) {
  const userText = (Array.isArray(messages) ? messages : [])
    .filter((m) => m?.role === 'user')
    .map((m) => normalizeString(m.content))
    .join('\n');

  const patch = {
    strugglePatterns: [],
    reliefPatterns: [],
    supportStyleNotes: [],
    recurringTopics: [],
    backgroundContexts: []
  };

  if (!userText) return patch;

  if (/疲れた|寝不足|だるい|眠い/.test(userText)) patch.strugglePatterns.push('疲労や睡眠不足が出やすい');
  if (/痛い|腰痛|首|肩|骨折/.test(userText)) patch.strugglePatterns.push('痛みが行動制限につながりやすい');
  if (/不安|焦る|停滞|増えた/.test(userText)) patch.strugglePatterns.push('停滞や変化に不安が出やすい');
  if (/隠したい|言いづらい|怒られ/.test(userText)) patch.supportStyleNotes.push('責められない安心感を重視する');
  if (/理屈|理由|なんで/.test(userText)) patch.supportStyleNotes.push('理由や見通しがあると受け取りやすい');
  if (/やさしく|寄り添って|厳しくしない/.test(userText)) patch.supportStyleNotes.push('やさしい伴走の温度が合いやすい');
  if (/安心した|落ち着いた|休めた/.test(userText)) patch.reliefPatterns.push('安心感や休息で整いやすい');
  if (/仕事|残業|忙しい/.test(userText)) patch.backgroundContexts.push('仕事都合でリズムが乱れやすい');
  if (/家族|子ども|家庭/.test(userText)) patch.backgroundContexts.push('家族都合を考慮した伴走が必要');
  if (/ラーメン|ごはん|食べた|朝ごはん|昼ごはん|夜ごはん/.test(userText)) patch.recurringTopics.push('食事');
  if (/歩いた|運動|ジョギング|スクワット|筋トレ/.test(userText)) patch.recurringTopics.push('運動');
  if (/睡眠|眠い|寝不足/.test(userText)) patch.recurringTopics.push('睡眠');
  if (/むくみ|便通|水分/.test(userText)) patch.recurringTopics.push('身体ノイズ');
  if (/LDL|HDL|中性脂肪|HbA1c|血液検査/.test(userText)) patch.recurringTopics.push('血液検査');

  return patch;
}

async function getShortMemory(userId) {
  const value = shortMemoryStore.get(userId);
  return clone(value || DEFAULT_SHORT_MEMORY);
}

async function saveShortMemory(userId, payload) {
  const current = await getShortMemory(userId);
  const next = mergeDeep(current, payload || {});
  shortMemoryStore.set(userId, next);
  return clone(next);
}

async function clearShortMemory(userId) {
  shortMemoryStore.set(userId, clone(DEFAULT_SHORT_MEMORY));
  return clone(DEFAULT_SHORT_MEMORY);
}

async function getLongMemory(userId) {
  const value = longMemoryStore.get(userId);
  return clone(value || DEFAULT_LONG_MEMORY);
}

async function mergeLongMemory(userId, patch) {
  const current = await getLongMemory(userId);
  const next = clone(current);
  next.narrativeMemory = mergeDeep(DEFAULT_LONG_MEMORY.narrativeMemory, current.narrativeMemory || {});

  if (Array.isArray(patch)) {
    for (const candidate of patch) {
      uniquePush(next.lifeContext, candidate);
    }
  } else {
    const safePatch = patch || {};

    if (safePatch.preferredName != null) next.preferredName = safePatch.preferredName;
    if (safePatch.goal != null) next.goal = safePatch.goal;
    if (safePatch.age != null) next.age = safePatch.age;
    if (safePatch.weight != null) next.weight = safePatch.weight;
    if (safePatch.bodyFat != null) next.bodyFat = safePatch.bodyFat;
    if (safePatch.aiType != null) next.aiType = safePatch.aiType;
    if (safePatch.constitutionType != null) next.constitutionType = safePatch.constitutionType;
    if (safePatch.trialStartedAt != null) next.trialStartedAt = safePatch.trialStartedAt;
    if (safePatch.selectedPlan != null) next.selectedPlan = safePatch.selectedPlan;
    if (safePatch.onboardingCompleted != null) next.onboardingCompleted = Boolean(safePatch.onboardingCompleted);
    if (safePatch.stagnationTendency != null) next.stagnationTendency = safePatch.stagnationTendency;

    if (Array.isArray(safePatch.eatingPattern)) {
      for (const item of safePatch.eatingPattern) uniquePush(next.eatingPattern, item);
    }
    if (Array.isArray(safePatch.bodySignals)) {
      for (const item of safePatch.bodySignals) uniquePush(next.bodySignals, item);
    }
    if (Array.isArray(safePatch.exerciseBarrier)) {
      for (const item of safePatch.exerciseBarrier) uniquePush(next.exerciseBarrier, item);
    }
    if (Array.isArray(safePatch.supportPreference)) {
      for (const item of safePatch.supportPreference) uniquePush(next.supportPreference, item);
    }
    if (Array.isArray(safePatch.lifeContext)) {
      for (const item of safePatch.lifeContext) uniquePush(next.lifeContext, item);
    }

    const narrativePatch = safePatch.narrativeMemory || {};
    addNarrativeItems(next, 'strugglePatterns', narrativePatch.strugglePatterns || []);
    addNarrativeItems(next, 'reliefPatterns', narrativePatch.reliefPatterns || []);
    addNarrativeItems(next, 'supportStyleNotes', narrativePatch.supportStyleNotes || []);
    addNarrativeItems(next, 'recurringTopics', narrativePatch.recurringTopics || []);
    addNarrativeItems(next, 'backgroundContexts', narrativePatch.backgroundContexts || []);
  }

  longMemoryStore.set(userId, next);
  return clone(next);
}

async function getUserState(userId) {
  const value = userStateStore.get(userId);
  return clone(value || DEFAULT_USER_STATE);
}

async function updateUserState(userId, nextState) {
  const current = await getUserState(userId);
  const merged = mergeDeep(current, nextState || {});
  userStateStore.set(userId, merged);
  return clone(merged);
}

async function getRecentMessages(userId, limit = 20) {
  const arr = recentMessageStore.get(userId) || [];
  return clone(arr.slice(-limit));
}

async function appendRecentMessage(userId, role, content) {
  const safeContent = normalizeString(content);
  if (!userId || !role || !safeContent) return;

  const arr = recentMessageStore.get(userId) || [];
  arr.push({
    role,
    content: safeContent,
    createdAt: nowIso()
  });

  recentMessageStore.set(userId, arr.slice(-120));
}

async function rememberFromConversation(userId) {
  const messages = await getRecentMessages(userId, 50);
  const inferred = inferNarrativePatchFromMessages(messages);
  return mergeLongMemory(userId, {
    narrativeMemory: inferred,
    lifeContext: inferred.backgroundContexts || []
  });
}

async function buildRecentSummary(userId, _days = 3) {
  const messages = await getRecentMessages(userId, 40);
  const userText = messages
    .filter((m) => m.role === 'user')
    .map((m) => m.content)
    .join('\n');

  const parts = [];
  if (/疲れ|眠い|寝不足|だるい/.test(userText)) parts.push('最近は疲れや眠さの話が少し出ています。');
  if (/不安|つらい|しんどい|苦しい|痛い/.test(userText)) parts.push('心身のしんどさや痛みの話題があります。');
  if (/ラーメン|ごはん|朝ごはん|昼ごはん|夜ごはん|寿司|味噌汁|卵|ヨーグルト|バナナ/.test(userText)) parts.push('食事の記録は少しずつ続いています。');
  if (/歩いた|ジョギング|スクワット|運動|走りました|走った/.test(userText)) parts.push('運動の話題も入ってきています。');
  if (/血液検査|LDL|HDL|中性脂肪|HbA1c/.test(userText)) parts.push('血液検査への関心があります。');

  return parts.join(' ') || '';
}

async function addDailyRecord(userId, record) {
  const key = `${userId}:${getTodayKey()}`;
  const current = dailyRecordStore.get(key) || buildDailyRecordBucket();
  const next = clone(current);

  if (record?.type === 'meal') next.meals.push({ ...record, createdAt: nowIso() });
  if (record?.type === 'exercise') next.exercises.push({ ...record, createdAt: nowIso() });
  if (record?.type === 'weight') next.weights.push({ ...record, createdAt: nowIso() });
  if (record?.type === 'lab') next.labs.push({ ...record, createdAt: nowIso() });

  dailyRecordStore.set(key, next);

  const points = await addPoints(userId, inferPointsFromRecord(record));
  return {
    ...clone(next),
    points
  };
}

function inferPointsFromRecord(record) {
  if (!record?.type) return 0;
  if (record.type === 'meal') return 1;
  if (record.type === 'exercise') return 1;
  if (record.type === 'weight') return 1;
  if (record.type === 'lab') return 2;
  return 0;
}

async function getTodayRecords(userId) {
  const key = `${userId}:${getTodayKey()}`;
  return clone(dailyRecordStore.get(key) || buildDailyRecordBucket());
}

async function getAllDailyRecordKeysForUser(userId) {
  const keys = [];
  for (const key of dailyRecordStore.keys()) {
    if (key.startsWith(`${userId}:`)) keys.push(key);
  }
  keys.sort();
  return keys;
}

async function getRecentDailyRecords(userId, limit = 7) {
  const keys = await getAllDailyRecordKeysForUser(userId);
  const selected = keys.slice(-limit);
  return selected.map((key) => ({
    date: key.split(':')[1],
    records: clone(dailyRecordStore.get(key) || buildDailyRecordBucket())
  }));
}

async function getWeeklySurvey(userId) {
  const key = `${userId}:${getWeekKey()}`;
  return clone(weeklySurveyStore.get(key) || buildSurveyBucket());
}

async function saveWeeklySurvey(userId, patch) {
  const key = `${userId}:${getWeekKey()}`;
  const current = weeklySurveyStore.get(key) || buildSurveyBucket();
  const next = mergeDeep(current, patch || {});
  if (!next.startedAt) next.startedAt = nowIso();
  next.updatedAt = nowIso();
  weeklySurveyStore.set(key, next);
  return clone(next);
}

async function getMonthlySurvey(userId) {
  const key = `${userId}:${getMonthKey()}`;
  return clone(monthlySurveyStore.get(key) || buildSurveyBucket());
}

async function saveMonthlySurvey(userId, patch) {
  const key = `${userId}:${getMonthKey()}`;
  const current = monthlySurveyStore.get(key) || buildSurveyBucket();
  const next = mergeDeep(current, patch || {});
  if (!next.startedAt) next.startedAt = nowIso();
  next.updatedAt = nowIso();
  monthlySurveyStore.set(key, next);
  return clone(next);
}

async function getPoints(userId) {
  return Number(pointsStore.get(userId) || 0);
}

async function addPoints(userId, amount) {
  const current = await getPoints(userId);
  const next = current + Number(amount || 0);
  pointsStore.set(userId, next);
  return next;
}

async function resetAllMemory(userId) {
  shortMemoryStore.delete(userId);
  longMemoryStore.delete(userId);
  userStateStore.delete(userId);
  recentMessageStore.delete(userId);

  for (const key of [...dailyRecordStore.keys()]) {
    if (key.startsWith(`${userId}:`)) dailyRecordStore.delete(key);
  }
  for (const key of [...weeklySurveyStore.keys()]) {
    if (key.startsWith(`${userId}:`)) weeklySurveyStore.delete(key);
  }
  for (const key of [...monthlySurveyStore.keys()]) {
    if (key.startsWith(`${userId}:`)) monthlySurveyStore.delete(key);
  }

  pointsStore.delete(userId);
}

module.exports = {
  getShortMemory,
  saveShortMemory,
  clearShortMemory,
  getLongMemory,
  mergeLongMemory,
  getUserState,
  updateUserState,
  getRecentMessages,
  appendRecentMessage,
  rememberFromConversation,
  buildRecentSummary,
  addDailyRecord,
  getTodayRecords,
  getRecentDailyRecords,
  getWeeklySurvey,
  saveWeeklySurvey,
  getMonthlySurvey,
  saveMonthlySurvey,
  getPoints,
  addPoints,
  resetAllMemory,
  normalizeTopicLabel
};
