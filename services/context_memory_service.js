'use strict';

const shortMemoryStore = new Map();
const longMemoryStore = new Map();
const userStateStore = new Map();
const recentMessageStore = new Map();
const dailyRecordStore = new Map();
const weeklySurveyStore = new Map();
const monthlySurveyStore = new Map();
const pointsStore = new Map();
const labHistoryStore = new Map();
const { getBusinessDayKey, getBusinessWeekKey } = require('./day_boundary_service');

const DEFAULT_SHORT_MEMORY = {
  lastTopic: null,
  lastImageType: null,
  pendingRecordCandidate: null,
  pendingClarification: null,
  lastEmotionTone: 'neutral',
  lastAdvice: null,
  recentSmallTalkTopic: null,
  followUpContext: null,
  activeHealthTheme: null,
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
  height: null,
  weight: null,
  bodyFat: null,
  aiType: null,
  voiceStyle: null,
  constitutionType: null,
  constitutionMainType: null,
  constitutionSubType: null,
  constitutionSurveyScores: {},
  constitutionSurveyAnswers: {},
  constitutionCheckedAt: null,
  periodicConstitutionAnswers: {},
  periodicConstitutionDeltaMap: {},
  periodicConstitutionCheckedAt: null,
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

function getTodayKey(date = new Date()) {
  return getBusinessDayKey(date);
}

function getWeekKey(date = new Date()) {
  return getBusinessWeekKey(date);
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

function normalizeLabItemName(value) {
  const safe = normalizeString(value)
    .replace(/ｈｂａ１ｃ/gi, 'HbA1c')
    .replace(/hb1ac/gi, 'HbA1c')
    .replace(/γ/gi, 'γ')
    .toUpperCase();

  if (!safe) return '';
  if (safe.includes('LDL')) return 'LDL';
  if (safe.includes('HDL')) return 'HDL';
  if (safe.includes('HBA1C')) return 'HbA1c';
  if (safe.includes('中性脂肪') || safe.includes('TG')) return '中性脂肪';
  if (safe.includes('AST') || safe.includes('GOT')) return 'AST';
  if (safe.includes('ALT') || safe.includes('GPT')) return 'ALT';
  if (safe.includes('γ-GTP') || safe.includes('GTP')) return 'γ-GTP';
  if (safe.includes('LDH')) return 'LDH';
  if (safe.includes('ALP')) return 'ALP';
  if (safe.includes('クレアチニン') || safe.includes('CRE')) return 'クレアチニン';
  if (safe.includes('EGFR')) return 'eGFR';
  if (safe.includes('尿酸') || safe.includes('UA')) return '尿酸';
  if (safe.includes('血糖')) return '血糖';
  if (safe.includes('空腹時血糖')) return '空腹時血糖';
  return normalizeString(value);
}

function normalizeLabPanelItem(item) {
  const itemName = normalizeLabItemName(item?.itemName || item?.name || '');
  const value = normalizeString(item?.value || item?.currentValue || '');
  const unit = normalizeString(item?.unit || item?.currentUnit || '');
  const flag = normalizeString(item?.flag || item?.currentFlag || '');
  const history = Array.isArray(item?.history)
    ? item.history
      .map((row) => ({
        date: normalizeString(row?.date || ''),
        value: normalizeString(row?.value || ''),
        unit: normalizeString(row?.unit || unit),
        flag: normalizeString(row?.flag || '')
      }))
      .filter((row) => row.date && row.value)
    : [];

  return {
    itemName,
    value,
    unit,
    flag,
    history
  };
}

function sortByDateAsc(items) {
  return [...items].sort((a, b) => String(a.date || '').localeCompare(String(b.date || '')));
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

  if (Array.isArray(patch)) {
    for (const candidate of patch) {
      uniquePush(next.lifeContext, candidate);
    }
  } else {
    const safePatch = patch || {};

    if (safePatch.preferredName != null) next.preferredName = safePatch.preferredName;
    if (safePatch.goal != null) next.goal = safePatch.goal;
    if (safePatch.age != null) next.age = safePatch.age;
    if (safePatch.height != null) next.height = safePatch.height;
    if (safePatch.weight != null) next.weight = safePatch.weight;
    if (safePatch.bodyFat != null) next.bodyFat = safePatch.bodyFat;
    if (safePatch.aiType != null) next.aiType = safePatch.aiType;
    if (safePatch.voiceStyle != null) next.voiceStyle = safePatch.voiceStyle;
    if (safePatch.constitutionType != null) next.constitutionType = safePatch.constitutionType;
    if (safePatch.constitutionMainType != null) next.constitutionMainType = safePatch.constitutionMainType;
    if (safePatch.constitutionSubType != null) next.constitutionSubType = safePatch.constitutionSubType;
    if (safePatch.constitutionCheckedAt != null) next.constitutionCheckedAt = safePatch.constitutionCheckedAt;
    if (safePatch.periodicConstitutionCheckedAt != null) next.periodicConstitutionCheckedAt = safePatch.periodicConstitutionCheckedAt;
    if (safePatch.trialStartedAt != null) next.trialStartedAt = safePatch.trialStartedAt;
    if (safePatch.selectedPlan != null) next.selectedPlan = safePatch.selectedPlan;
    if (safePatch.onboardingCompleted != null) next.onboardingCompleted = Boolean(safePatch.onboardingCompleted);
    if (safePatch.stagnationTendency != null) next.stagnationTendency = safePatch.stagnationTendency;

    if (isPlainObject(safePatch.constitutionSurveyScores)) {
      next.constitutionSurveyScores = { ...safePatch.constitutionSurveyScores };
    }
    if (isPlainObject(safePatch.constitutionSurveyAnswers)) {
      next.constitutionSurveyAnswers = { ...safePatch.constitutionSurveyAnswers };
    }
    if (isPlainObject(safePatch.periodicConstitutionAnswers)) {
      next.periodicConstitutionAnswers = { ...safePatch.periodicConstitutionAnswers };
    }
    if (isPlainObject(safePatch.periodicConstitutionDeltaMap)) {
      next.periodicConstitutionDeltaMap = { ...safePatch.periodicConstitutionDeltaMap };
    }

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

async function buildRecentSummary(userId, _days = 3) {
  const messages = await getRecentMessages(userId, 40);
  const userText = messages
    .filter((m) => m.role === 'user')
    .map((m) => m.content)
    .join('\n');

  const parts = [];
  if (/疲れ|眠い|寝不足|だるい/.test(userText)) parts.push('最近は疲れや眠さの話が少し出ています。');
  if (/不安|つらい|しんどい|苦しい|痛い|限界/.test(userText)) parts.push('心身のしんどさや痛みの話題があります。');
  if (/ラーメン|ごはん|朝ごはん|昼ごはん|夜ごはん|寿司|味噌汁|卵|ヨーグルト|バナナ/.test(userText)) parts.push('食事の記録は少しずつ続いています。');
  if (/歩いた|ジョギング|スクワット|運動|走りました|走った/.test(userText)) parts.push('運動の話題も入ってきています。');
  if (/血液検査|LDL|HDL|中性脂肪|HbA1c/.test(userText)) parts.push('血液検査への関心があります。');
  if (/身長|体重|体脂肪率/.test(userText)) parts.push('体組成や代謝の話題が出ています。');

  return parts.join(' ') || '';
}

async function addDailyRecord(userId, record, options = {}) {
  const targetDateKey = normalizeString(options?.targetDateKey || record?.targetDateKey || getTodayKey(options?.now || new Date()));
  const key = `${userId}:${targetDateKey}`;
  const current = dailyRecordStore.get(key) || buildDailyRecordBucket();
  const next = clone(current);
  const recordedAt = normalizeString(options?.recordedAt || record?.recordedAt || nowIso()) || nowIso();

  const payload = { ...record, createdAt: recordedAt, targetDateKey };
  delete payload.targetDateKey;

  if (record?.type === 'meal') next.meals.push(payload);
  if (record?.type === 'exercise') next.exercises.push(payload);
  if (record?.type === 'weight') next.weights.push(payload);
  if (record?.type === 'lab') next.labs.push(payload);

  dailyRecordStore.set(key, next);

  const points = await addPoints(userId, inferPointsFromRecord(record));
  return {
    ...clone(next),
    points,
    targetDateKey
  };
}

function buildDailyResultWithMeta(userId, dateKey, bucket) {
  return {
    date: dateKey,
    weekKey: getWeekKey(new Date(`${dateKey}T12:00:00+09:00`)),
    records: clone(bucket || buildDailyRecordBucket())
  };
}

async function getTodayRecords(userId, date = new Date()) {
  const dayKey = getTodayKey(date);
  const key = `${userId}:${dayKey}`;
  return clone(dailyRecordStore.get(key) || buildDailyRecordBucket());
}

async function getDailyRecordsByKey(userId, dateKey) {
  const safeDateKey = normalizeString(dateKey);
  const key = `${userId}:${safeDateKey}`;
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
  return selected.map((key) => {
    const dateKey = key.split(':')[1];
    return {
      date: dateKey,
      weekKey: getWeekKey(new Date(`${dateKey}T12:00:00+09:00`)),
      records: clone(dailyRecordStore.get(key) || buildDailyRecordBucket())
    };
  });
}

async function getLatestWeightEntry(userId) {
  const days = await getRecentDailyRecords(userId, 14);
  const weights = [];
  for (const day of days) {
    for (const item of day.records?.weights || []) {
      weights.push({ ...item, date: day.date });
    }
  }
  return clone(weights.slice(-1)[0] || null);
}

async function upsertLabPanel(userId, panel) {
  if (!userId || !panel) return null;

  const current = clone(labHistoryStore.get(userId) || []);
  const examDate = normalizeString(panel.examDate || '');
  const items = (Array.isArray(panel.items) ? panel.items : [])
    .map(normalizeLabPanelItem)
    .filter((item) => item.itemName && (item.value || item.history.length));

  if (!items.length) return null;

  const normalizedPanel = {
    examDate,
    source: normalizeString(panel.source || 'image'),
    capturedAt: nowIso(),
    items
  };

  let merged = false;
  for (let i = 0; i < current.length; i += 1) {
    const existing = current[i];
    if (examDate && existing.examDate === examDate) {
      const map = new Map();
      for (const item of existing.items || []) {
        map.set(normalizeLabItemName(item.itemName), normalizeLabPanelItem(item));
      }
      for (const item of normalizedPanel.items) {
        const key = normalizeLabItemName(item.itemName);
        const before = map.get(key) || { itemName: key, value: '', unit: '', flag: '', history: [] };
        const history = sortByDateAsc([
          ...(before.history || []),
          ...(item.history || [])
        ].filter((row) => row.date && row.value));
        map.set(key, {
          itemName: item.itemName,
          value: item.value || before.value,
          unit: item.unit || before.unit,
          flag: item.flag || before.flag,
          history
        });
      }
      current[i] = {
        ...existing,
        ...normalizedPanel,
        items: [...map.values()]
      };
      merged = true;
      break;
    }
  }

  if (!merged) current.push(normalizedPanel);
  current.sort((a, b) => String(a.examDate || '').localeCompare(String(b.examDate || '')));
  labHistoryStore.set(userId, current);
  return clone(normalizedPanel);
}

async function getLatestLabPanel(userId) {
  const panels = clone(labHistoryStore.get(userId) || []);
  return panels.slice(-1)[0] || null;
}

async function findLabItemTrend(userId, itemName) {
  const safeItem = normalizeLabItemName(itemName);
  if (!safeItem) return [];

  const panels = clone(labHistoryStore.get(userId) || []);
  const rows = [];
  const seen = new Set();

  for (const panel of panels) {
    for (const item of panel.items || []) {
      if (normalizeLabItemName(item.itemName) !== safeItem) continue;

      if (panel.examDate && item.value) {
        const key = `${panel.examDate}:${item.value}:${item.unit || ''}`;
        if (!seen.has(key)) {
          seen.add(key);
          rows.push({
            date: panel.examDate,
            itemName: item.itemName,
            value: item.value,
            unit: item.unit,
            flag: item.flag
          });
        }
      }

      for (const historyRow of item.history || []) {
        const key = `${historyRow.date}:${historyRow.value}:${historyRow.unit || ''}`;
        if (seen.has(key)) continue;
        seen.add(key);
        rows.push({
          date: historyRow.date,
          itemName: item.itemName,
          value: historyRow.value,
          unit: historyRow.unit || item.unit,
          flag: historyRow.flag || ''
        });
      }
    }
  }

  return sortByDateAsc(rows);
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
  labHistoryStore.delete(userId);

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
  buildRecentSummary,
  addDailyRecord,
  getTodayRecords,
  getDailyRecordsByKey,
  getRecentDailyRecords,
  getLatestWeightEntry,
  upsertLabPanel,
  getLatestLabPanel,
  findLabItemTrend,
  getWeeklySurvey,
  saveWeeklySurvey,
  getMonthlySurvey,
  saveMonthlySurvey,
  getPoints,
  addPoints,
  resetAllMemory
};
