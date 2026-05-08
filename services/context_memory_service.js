'use strict';

const fs = require('fs');
const path = require('path');
let supabase = null;
let ensureUser = null;
try {
  ({ supabase } = require('./supabase_service'));
  ({ ensureUser } = require('./user_service'));
} catch (_error) {
  supabase = null;
  ensureUser = null;
}

const labItemAliasService = require('./lab_item_alias_service');

const SNAPSHOT_PATH = process.env.CONTEXT_MEMORY_SNAPSHOT_PATH || path.join(process.cwd(), '.kokokara_context_snapshot.json');
let snapshotLoaded = false;
let flushTimer = null;

const shortMemoryStore = new Map();
const longMemoryStore = new Map();
const userStateStore = new Map();
const recentMessageStore = new Map();
const dailyRecordStore = new Map();
const weeklySurveyStore = new Map();
const monthlySurveyStore = new Map();
const pointsStore = new Map();
const labHistoryStore = new Map();

const DEFAULT_SHORT_MEMORY = {
  lastTopic: null,
  lastImageType: null,
  pendingRecordCandidate: null,
  pendingClarification: null,
  lastEmotionTone: 'neutral',
  lastAdvice: null,
  recentSmallTalkTopic: null,
  lastAssistantReplySnapshot: null,
  followUpContext: null,
  activeHealthTheme: null,
  movementVideoSession: null,
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
  voiceStyle: null,
  constitutionType: null,
  conversationStyleMemory: {
    likedExamples: [],
    dislikedExamples: [],
    updatedAt: null
  },
  trialStartedAt: null,
  selectedPlan: null,
  onboardingCompleted: false,
  /** @see services/relationship_phase_service.js */
  relationshipPhase: 'phase_1_professional_trust',
  relationshipPhaseUpdatedAt: null,
  relationshipPhaseMeta: null
};

const DEFAULT_USER_STATE = {
  nagiScore: 5,
  gasolineScore: 5,
  trustScore: 3,
  relationshipScore: 0,
  relationshipStage: 'coach',
  totalTurns: 0,
  recallStyle: 'direct',
  lastEmotionTone: 'neutral',
  updatedAt: null
};


function normalizeText(value) {
  return String(value || '').trim();
}

function sanitizePreferredName(value) {
  const safe = normalizeText(value)
    .replace(/^(名前[は：:]?\s*)/u, '')
    .replace(/(です|だよ|だよね|ですよ|になります|になりそう).*$/u, '')
    .replace(/\s+/g, '')
    .trim();

  if (!safe) return '';
  if (safe.length > 12) return '';
  if (/今日|昨日|明日|暖か|眠い|しんど|痛い|なりそう|です$|ます$/.test(safe)) return '';
  return safe;
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}


function serializeMap(map) {
  return Object.fromEntries(map.entries());
}

function deserializeMap(obj) {
  return new Map(Object.entries(obj || {}));
}

function ensureSnapshotLoaded() {
  if (snapshotLoaded) return;
  snapshotLoaded = true;
  try {
    if (!fs.existsSync(SNAPSHOT_PATH)) return;
    const raw = JSON.parse(fs.readFileSync(SNAPSHOT_PATH, 'utf8'));
    for (const [target, source] of [
      [shortMemoryStore, raw.shortMemoryStore],
      [longMemoryStore, raw.longMemoryStore],
      [userStateStore, raw.userStateStore],
      [recentMessageStore, raw.recentMessageStore],
      [dailyRecordStore, raw.dailyRecordStore],
      [weeklySurveyStore, raw.weeklySurveyStore],
      [monthlySurveyStore, raw.monthlySurveyStore],
      [pointsStore, raw.pointsStore],
      [labHistoryStore, raw.labHistoryStore]
    ]) {
      const restored = deserializeMap(source);
      for (const [k, v] of restored.entries()) target.set(k, v);
    }
  } catch (_error) {}
}

function flushSnapshotNow() {
  try {
    fs.writeFileSync(SNAPSHOT_PATH, JSON.stringify({
      shortMemoryStore: serializeMap(shortMemoryStore),
      longMemoryStore: serializeMap(longMemoryStore),
      userStateStore: serializeMap(userStateStore),
      recentMessageStore: serializeMap(recentMessageStore),
      dailyRecordStore: serializeMap(dailyRecordStore),
      weeklySurveyStore: serializeMap(weeklySurveyStore),
      monthlySurveyStore: serializeMap(monthlySurveyStore),
      pointsStore: serializeMap(pointsStore),
      labHistoryStore: serializeMap(labHistoryStore)
    }, null, 2));
  } catch (_error) {}
}

function scheduleSnapshotFlush() {
  if (flushTimer) clearTimeout(flushTimer);
  flushTimer = setTimeout(() => {
    flushTimer = null;
    flushSnapshotNow();
  }, 150);
}

function formatTokyoDate(value) {
  const d = value ? new Date(value) : new Date();
  if (Number.isNaN(d.getTime())) return '';
  return new Intl.DateTimeFormat('sv-SE', {
    timeZone: 'Asia/Tokyo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).format(d);
}

function getTokyoDayRangeIso(dayOffset = 0) {
  const now = new Date();
  const tokyoNow = new Date(now.toLocaleString('en-US', { timeZone: 'Asia/Tokyo' }));
  tokyoNow.setHours(0, 0, 0, 0);
  tokyoNow.setDate(tokyoNow.getDate() + Number(dayOffset || 0));
  const start = new Date(tokyoNow.getTime() - (9 * 60 * 60 * 1000));
  const end = new Date(start.getTime() + (24 * 60 * 60 * 1000));
  return { startIso: start.toISOString(), endIso: end.toISOString() };
}

async function resolvePersistentUser(lineUserId) {
  if (!supabase || !ensureUser) return null;
  const safe = normalizeString(lineUserId);
  if (!safe) return null;
  try {
    return await ensureUser(supabase, safe, 'Asia/Tokyo');
  } catch (_error) {
    return null;
  }
}

async function safeRows(builder, fallback = []) {
  try {
    const { data, error } = await builder();
    if (error) throw error;
    return Array.isArray(data) ? data : fallback;
  } catch (_error) {
    return fallback;
  }
}

async function safeMaybeSingle(builder, fallback = null) {
  try {
    const { data, error } = await builder();
    if (error) throw error;
    return data || fallback;
  } catch (_error) {
    return fallback;
  }
}

async function persistLongMemoryToDb(lineUserId, next) {
  const user = await resolvePersistentUser(lineUserId);
  if (!user || !supabase) return false;

  const rows = [];
  const pushFact = (fieldKey, value, fieldUnit = '') => {
    const safeValue = normalizeString(value);
    if (!safeValue) return;
    rows.push({
      user_id: user.id,
      field_key: fieldKey,
      field_value: safeValue,
      field_unit: fieldUnit,
      source_kind: 'context_memory',
      confidence: 0.98,
      updated_at: nowIso()
    });
  };

  pushFact('preferredName', next.preferredName);
  pushFact('age', next.age);
  pushFact('height', next.height, 'cm');
  pushFact('weight', next.weight, 'kg');
  pushFact('bodyFat', next.bodyFat, '%');
  pushFact('goal', next.goal);
  pushFact('aiType', next.aiType);
  pushFact('voiceStyle', next.voiceStyle);
  pushFact('constitutionType', next.constitutionType);
  pushFact('selectedPlan', next.selectedPlan);
  pushFact('onboardingCompleted', String(Boolean(next.onboardingCompleted)));
  pushFact('trialStartedAt', next.trialStartedAt);

  if (rows.length) {
    try {
      await supabase.from('user_profile_facts').upsert(rows, { onConflict: 'user_id,field_key' });
    } catch (_error) {}
  }

  const userPatch = {};
  if (normalizeString(next.preferredName)) userPatch.display_name = normalizeString(next.preferredName);
  if (normalizeString(next.aiType)) userPatch.ai_type = normalizeString(next.aiType);
  if (normalizeString(next.selectedPlan)) userPatch.selected_plan = normalizeString(next.selectedPlan);
  if (Object.keys(userPatch).length) {
    try {
      await supabase.from('users').update(userPatch).eq('id', user.id);
    } catch (_error) {}
  }

  return true;
}

async function hydrateLongMemoryFromDb(lineUserId) {
  const user = await resolvePersistentUser(lineUserId);
  if (!user || !supabase) return null;

  const [factRows, latestWeight] = await Promise.all([
    safeRows(() => supabase
      .from('user_profile_facts')
      .select('field_key, field_value, updated_at')
      .eq('user_id', user.id)
      .order('updated_at', { ascending: false })),
    safeMaybeSingle(() => supabase
      .from('weight_logs')
      .select('logged_at, weight_kg, body_fat_pct')
      .eq('user_id', user.id)
      .order('logged_at', { ascending: false })
      .limit(1)
      .maybeSingle(), null)
  ]);

  const factMap = {};
  for (const row of factRows) {
    const key = normalizeString(row.field_key);
    if (!key || factMap[key] != null) continue;
    factMap[key] = normalizeString(row.field_value);
  }

  return {
    preferredName: factMap.preferredName || normalizeString(user.display_name || ''),
    goal: factMap.goal || '',
    age: factMap.age || '',
    height: factMap.height || '',
    weight: latestWeight?.weight_kg != null ? String(latestWeight.weight_kg) : (factMap.weight || ''),
    bodyFat: latestWeight?.body_fat_pct != null ? String(latestWeight.body_fat_pct) : (factMap.bodyFat || ''),
    aiType: factMap.aiType || normalizeString(user.ai_type || ''),
    voiceStyle: factMap.voiceStyle || '',
    constitutionType: factMap.constitutionType || '',
    trialStartedAt: factMap.trialStartedAt || '',
    selectedPlan: factMap.selectedPlan || normalizeString(user.selected_plan || ''),
    onboardingCompleted: factMap.onboardingCompleted === 'true'
  };
}

async function persistDailyRecordToDb(lineUserId, record) {
  const user = await resolvePersistentUser(lineUserId);
  if (!user || !supabase || !record?.type) return false;
  const now = nowIso();
  try {
    if (record.type === 'meal') {
      const mealAnalysisService = require('./meal_analysis_service');
      const labelProbe = [
        normalizeString(record.summary || record.name || ''),
        ...(Array.isArray(record.items) ? record.items : []),
        ...(Array.isArray(record.food_items) ? record.food_items : [])
      ].join(' ');
      if (mealAnalysisService.isMealMetaOrCorrectionText(labelProbe)) {
        console.info('[meal] insert_blocked_meta_text', {
          userId: lineUserId,
          label: normalizeString(record.summary || record.name || '').slice(0, 80)
        });
        return false;
      }
      const eatenAtIso = record.eatenAt
        ? new Date(record.eatenAt).toISOString()
        : now;
      const foodItems = Array.isArray(record.food_items) && record.food_items.length
        ? record.food_items
        : (Array.isArray(record.items) ? record.items : (normalizeString(record.name) ? [normalizeString(record.name)] : []));
      const rawModel = {
        ...(typeof record === 'object' ? record : {}),
        sourceLineMessageId: normalizeString(record.sourceLineMessageId || ''),
        dedupeKey: normalizeString(record.dedupeKey || ''),
        sourceImageHash: normalizeString(record.sourceImageHash || record.imageHash || '')
      };
      console.info('[meal] insert_attempt', {
        userId: lineUserId,
        eatenAt: eatenAtIso,
        kcal: Number(record.kcal || record.estimatedNutrition?.kcal || 0) || 0,
        label: normalizeString(record.summary || record.name || '').slice(0, 48),
        hasMessageId: Boolean(normalizeString(record.sourceLineMessageId || ''))
      });
      await supabase.from('meal_logs').insert({
        user_id: user.id,
        eaten_at: eatenAtIso,
        meal_label: normalizeString(record.summary || record.name || '食事'),
        food_items: foodItems,
        estimated_kcal: Number(record.kcal || record.estimatedNutrition?.kcal || 0) || null,
        protein_g: Number(record.protein || record.estimatedNutrition?.protein || 0) || null,
        fat_g: Number(record.fat || record.estimatedNutrition?.fat || 0) || null,
        carbs_g: Number(record.carbs || record.estimatedNutrition?.carbs || 0) || null,
        confidence: record.confidence != null ? Number(record.confidence) : null,
        ai_comment: normalizeString(record.comment || record.amountNote || '食事記録'),
        raw_model_json: rawModel
      });
      try {
        const mealRecalcRepository = require('../repositories/meal_recalc_repository');
        const sourceMessageId = normalizeString(record.sourceLineMessageId || '');
        const dedupeKey = normalizeString(record.dedupeKey || '');
        const sourceImageId = normalizeString(record.sourceImageId || '');
        const existsByMessage = sourceMessageId
          ? await safeMaybeSingle(() => supabase
            .from('base_meals')
            .select('id')
            .eq('user_id', lineUserId)
            .eq('source_message_id', sourceMessageId)
            .limit(1)
            .maybeSingle(), null)
          : null;
        const existsByImage = !existsByMessage && sourceImageId
          ? await safeMaybeSingle(() => supabase
            .from('base_meals')
            .select('id')
            .eq('user_id', lineUserId)
            .eq('source_image_id', sourceImageId)
            .limit(1)
            .maybeSingle(), null)
          : null;
        if (!existsByMessage && !existsByImage) {
          await mealRecalcRepository.createBaseMeal({
            userId: lineUserId,
            eatenAt: eatenAtIso,
            sourceMessageId,
            sourceImageId,
            mealLabel: normalizeString(record.summary || record.name || '食事'),
            basePayloadJson: {
              dedupeKey,
              items: Array.isArray(foodItems) ? foodItems : [],
              estimatedNutrition: {
                kcal: Number(record.kcal || record.estimatedNutrition?.kcal || 0) || 0,
                protein: Number(record.protein || record.estimatedNutrition?.protein || 0) || 0,
                fat: Number(record.fat || record.estimatedNutrition?.fat || 0) || 0,
                carbs: Number(record.carbs || record.estimatedNutrition?.carbs || 0) || 0
              }
            }
          });
        }
      } catch (_mirrorError) {
        // base_meals mirror is best-effort; keep meal_logs save as source of truth.
      }
      console.info('[meal] saved', { userId: lineUserId });
      try {
        const mealLogQueryService = require('./meal_log_query_service');
        const todayKey = getTodayKey();
        const raw = await mealLogQueryService.getMealLogsByDateRange(lineUserId, todayKey, todayKey);
        const totals = mealLogQueryService.aggregateMealLogs(raw);
        console.info('[meal] recomputed_today_total', { count: totals.count, kcal: totals.kcal });
      } catch (_e) {
        /* optional recompute log */
      }
      return true;
    }
    if (record.type === 'exercise') {
      await supabase.from('activity_logs').insert({
        user_id: user.id,
        logged_at: now,
        steps: record.steps != null ? Number(record.steps) : null,
        walking_minutes: record.minutes != null ? Number(record.minutes) : null,
        estimated_activity_kcal: record.estimatedCalories != null ? Number(record.estimatedCalories) : null,
        exercise_summary: normalizeString(record.summary || record.name || '運動'),
        raw_detail_json: record
      });
      return true;
    }
    if (record.type === 'weight') {
      await supabase.from('weight_logs').insert({
        user_id: user.id,
        logged_at: now,
        weight_kg: record.weight != null ? Number(record.weight) : null,
        body_fat_pct: record.bodyFat != null ? Number(record.bodyFat) : null
      });
      return true;
    }
  } catch (_error) {}
  return false;
}

async function readDailyRecordsFromDb(lineUserId, days = 1) {
  const user = await resolvePersistentUser(lineUserId);
  if (!user || !supabase) return null;
  const range = getTokyoDayRangeIso(-(Math.max(1, Number(days || 1)) - 1));
  const todayEnd = getTokyoDayRangeIso(1).startIso;

  const [meals, exercises, weights] = await Promise.all([
    safeRows(() => supabase.from('meal_logs').select('id, eaten_at, meal_label, food_items, estimated_kcal, protein_g, fat_g, carbs_g, raw_model_json').eq('user_id', user.id).gte('eaten_at', range.startIso).lt('eaten_at', todayEnd).order('eaten_at', { ascending: true })),
    safeRows(() => supabase.from('activity_logs').select('logged_at, steps, walking_minutes, estimated_activity_kcal, exercise_summary, raw_detail_json').eq('user_id', user.id).gte('logged_at', range.startIso).lt('logged_at', todayEnd).order('logged_at', { ascending: true })),
    safeRows(() => supabase.from('weight_logs').select('logged_at, weight_kg, body_fat_pct').eq('user_id', user.id).gte('logged_at', range.startIso).lt('logged_at', todayEnd).order('logged_at', { ascending: true }))
  ]);

  const grouped = new Map();
  const ensureBucket = (dateKey) => {
    if (!grouped.has(dateKey)) grouped.set(dateKey, buildDailyRecordBucket());
    return grouped.get(dateKey);
  };

  for (const row of meals) {
    const dateKey = formatTokyoDate(row.eaten_at);
    ensureBucket(dateKey).meals.push(mealPayloadFromDbRow(row, dateKey));
  }
  for (const row of exercises) {
    const dateKey = formatTokyoDate(row.logged_at);
    ensureBucket(dateKey).exercises.push({
      type: 'exercise',
      name: normalizeString(row.raw_detail_json?.name || row.exercise_summary || '運動'),
      summary: normalizeString(row.exercise_summary || row.raw_detail_json?.summary || '運動'),
      minutes: row.walking_minutes != null ? Number(row.walking_minutes) : null,
      steps: row.steps != null ? Number(row.steps) : null,
      estimatedCalories: row.estimated_activity_kcal != null ? Number(row.estimated_activity_kcal) : null,
      createdAt: row.logged_at
    });
  }
  for (const row of weights) {
    const dateKey = formatTokyoDate(row.logged_at);
    ensureBucket(dateKey).weights.push({
      type: 'weight',
      summary: '体重記録',
      weight: row.weight_kg != null ? Number(row.weight_kg) : null,
      bodyFat: row.body_fat_pct != null ? Number(row.body_fat_pct) : null,
      createdAt: row.logged_at
    });
  }

  return grouped;
}

async function getPersistedPoints(lineUserId) {
  const user = await resolvePersistentUser(lineUserId);
  if (!user || !supabase) return null;
  const row = await safeMaybeSingle(() => supabase
    .from('user_profile_facts')
    .select('field_value, updated_at')
    .eq('user_id', user.id)
    .eq('field_key', 'points_balance')
    .order('updated_at', { ascending: false })
    .limit(1)
    .maybeSingle(), null);
  if (!row) return null;
  const num = Number(row.field_value || 0);
  return Number.isFinite(num) ? num : 0;
}

async function persistPointsToDb(lineUserId, totalPoints) {
  const user = await resolvePersistentUser(lineUserId);
  if (!user || !supabase) return false;
  try {
    await supabase.from('user_profile_facts').upsert({
      user_id: user.id,
      field_key: 'points_balance',
      field_value: String(Number(totalPoints || 0)),
      field_unit: 'pt',
      source_kind: 'context_memory',
      confidence: 0.99,
      updated_at: nowIso()
    }, { onConflict: 'user_id,field_key' });
    return true;
  } catch (_error) {
    return false;
  }
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

function addCalendarDaysToTokyoYmd(ymd, deltaDays) {
  const m = String(ymd || '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return '';
  const dt = new Date(`${m[1]}-${m[2]}-${m[3]}T12:00:00+09:00`);
  dt.setDate(dt.getDate() + Number(deltaDays || 0));
  return new Intl.DateTimeFormat('sv-SE', {
    timeZone: 'Asia/Tokyo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).format(dt);
}

function tokyoNoonIsoFromYmd(ymd) {
  const safe = normalizeString(ymd);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(safe)) return null;
  return `${safe}T12:00:00+09:00`;
}

function mealPayloadFromDbRow(row, dateKey = '') {
  const items = Array.isArray(row?.food_items) ? row.food_items : [];
  return {
    type: 'meal',
    id: row?.id,
    date: dateKey || formatTokyoDate(row?.eaten_at),
    summary: normalizeString(row?.meal_label || '食事'),
    name: normalizeString(row?.meal_label || '食事'),
    items,
    food_items: items,
    kcal: Number(row?.estimated_kcal || 0),
    protein: Number(row?.protein_g || 0),
    fat: Number(row?.fat_g || 0),
    carbs: Number(row?.carbs_g || 0),
    estimatedNutrition: {
      kcal: Number(row?.estimated_kcal || 0),
      protein: Number(row?.protein_g || 0),
      fat: Number(row?.fat_g || 0),
      carbs: Number(row?.carbs_g || 0)
    },
    createdAt: row?.eaten_at || nowIso()
  };
}

async function fetchLatestMealLogRow(lineUserId) {
  const user = await resolvePersistentUser(lineUserId);
  if (!user || !supabase) return null;
  return safeMaybeSingle(() => supabase
    .from('meal_logs')
    .select('id, eaten_at, meal_label, food_items, estimated_kcal, protein_g, fat_g, carbs_g, raw_model_json, deleted_at')
    .eq('user_id', user.id)
    .is('deleted_at', null)
    .order('eaten_at', { ascending: false })
    .limit(1)
    .maybeSingle(), null);
}

async function adjustLastMealNutrition(lineUserId, adjust = {}) {
  const user = await resolvePersistentUser(lineUserId);
  if (!user || !supabase) return { ok: false, reason: 'no_user' };
  const row = await fetchLatestMealLogRow(lineUserId);
  if (!row?.id) return { ok: false, reason: 'no_db_meal' };

  const before = {
    kcal: Number(row.estimated_kcal || 0),
    protein: Number(row.protein_g || 0),
    fat: Number(row.fat_g || 0),
    carbs: Number(row.carbs_g || 0)
  };
  const mode = normalizeString(adjust.mode || 'replace');
  const ratio = Number(adjust.ratio || 1);
  const componentName = normalizeString(adjust.componentName || adjust.component || '');
  const overrideKcal = adjust.kcal != null ? Number(adjust.kcal) : null;
  const next = { ...before };

  if (mode === 'set_zero') {
    next.kcal = 0;
  } else if (mode === 'partial') {
    const safeRatio = Number.isFinite(ratio) && ratio > 0 && ratio <= 1 ? ratio : 0.5;
    next.kcal = Math.round((before.kcal * safeRatio) * 10) / 10;
    next.protein = Math.round((before.protein * safeRatio) * 10) / 10;
    next.fat = Math.round((before.fat * safeRatio) * 10) / 10;
    next.carbs = Math.round((before.carbs * safeRatio) * 10) / 10;
  } else if (mode === 'replace' && Number.isFinite(overrideKcal)) {
    next.kcal = Math.max(0, Math.round(overrideKcal * 10) / 10);
  } else if (mode === 'component_ratio' || mode === 'component_zero') {
    const items = Array.isArray(row?.food_items) ? row.food_items.map((x) => normalizeString(x)).filter(Boolean) : [];
    const target = componentName || (items[0] || '');
    const safeRatio = mode === 'component_zero' ? 0 : (Number.isFinite(ratio) && ratio >= 0 && ratio <= 1 ? ratio : 0.5);
    const share = items.length > 0 ? (1 / items.length) : 1;
    const reduce = 1 - safeRatio;
    const delta = share * reduce;
    next.kcal = Math.max(0, Math.round((before.kcal * (1 - delta)) * 10) / 10);
    next.protein = Math.max(0, Math.round((before.protein * (1 - delta)) * 10) / 10);
    next.fat = Math.max(0, Math.round((before.fat * (1 - delta)) * 10) / 10);
    next.carbs = Math.max(0, Math.round((before.carbs * (1 - delta)) * 10) / 10);
    adjust.componentName = target;
  }

  const raw = row?.raw_model_json && typeof row.raw_model_json === 'object'
    ? { ...row.raw_model_json }
    : {};
  raw.correction = {
    mode,
    ratio: Number.isFinite(ratio) ? ratio : null,
    appliedAt: nowIso(),
    before,
    after: next,
    componentName: componentName || normalizeString(adjust.componentName || '')
  };
  raw.adoptedNutrition = {
    kcal: Number(next.kcal || 0),
    protein: Number(next.protein || 0),
    fat: Number(next.fat || 0),
    carbs: Number(next.carbs || 0)
  };

  try {
    const { error } = await supabase
      .from('meal_logs')
      .update({
        estimated_kcal: next.kcal,
        protein_g: next.protein,
        fat_g: next.fat,
        carbs_g: next.carbs,
        raw_model_json: raw
      })
      .eq('id', row.id)
      .eq('user_id', user.id);
    if (error) return { ok: false, reason: normalizeString(error.message || 'update_failed') };
  } catch (error) {
    return { ok: false, reason: normalizeString(error?.message || 'update_failed') };
  }

  const verify = await safeMaybeSingle(() => supabase
    .from('meal_logs')
    .select('id, estimated_kcal, protein_g, fat_g, carbs_g')
    .eq('id', row.id)
    .eq('user_id', user.id)
    .limit(1)
    .maybeSingle(), null);
  if (!verify?.id) return { ok: false, reason: 'read_after_write_not_found' };
  const afterRead = {
    kcal: Number(verify.estimated_kcal || 0),
    protein: Number(verify.protein_g || 0),
    fat: Number(verify.fat_g || 0),
    carbs: Number(verify.carbs_g || 0)
  };
  if (
    Math.abs(afterRead.kcal - Number(next.kcal || 0)) > 0.11
    || Math.abs(afterRead.protein - Number(next.protein || 0)) > 0.11
    || Math.abs(afterRead.fat - Number(next.fat || 0)) > 0.11
    || Math.abs(afterRead.carbs - Number(next.carbs || 0)) > 0.11
  ) {
    return { ok: false, reason: 'read_after_write_mismatch', mealId: row.id, expected: next, actual: afterRead };
  }

  clearUserDailyRecordCache(lineUserId);
  scheduleSnapshotFlush();
  return { ok: true, mealId: row.id, before, after: afterRead, mode };
}

function popLastMealFromDailyBucket(lineUserId, dateKey) {
  ensureSnapshotLoaded();
  const key = `${lineUserId}:${dateKey}`;
  const bucket = dailyRecordStore.get(key);
  if (!bucket?.meals?.length) return null;
  const moved = bucket.meals.pop();
  dailyRecordStore.set(key, bucket);
  return moved;
}

function pushMealToDailyBucket(lineUserId, dateKey, mealPayload) {
  ensureSnapshotLoaded();
  const key = `${lineUserId}:${dateKey}`;
  const bucket = dailyRecordStore.get(key) || buildDailyRecordBucket();
  bucket.meals.push({ ...mealPayload, date: dateKey });
  dailyRecordStore.set(key, bucket);
}

async function relocateLastMealToTokyoDate(lineUserId, targetYmd) {
  const safeDate = normalizeString(targetYmd);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(safeDate)) return { ok: false, reason: 'bad_date' };

  const user = await resolvePersistentUser(lineUserId);
  if (!user || !supabase) {
    const moved = popLastMealFromDailyBucket(lineUserId, getTodayKey());
    if (!moved) return { ok: false, reason: 'no_memory_meal' };
    pushMealToDailyBucket(lineUserId, safeDate, moved);
    scheduleSnapshotFlush();
    return { ok: true, targetYmd: safeDate, memoryOnly: true };
  }

  const row = await fetchLatestMealLogRow(lineUserId);
  if (!row?.id) return { ok: false, reason: 'no_db_meal' };
  const eatenAt = tokyoNoonIsoFromYmd(safeDate);
  if (!eatenAt) return { ok: false, reason: 'bad_date' };
  try {
    const { error } = await supabase.from('meal_logs').update({ eaten_at: eatenAt }).eq('id', row.id);
    if (error) return { ok: false, reason: normalizeString(error.message || 'update_failed') };
  } catch (error) {
    return { ok: false, reason: normalizeString(error?.message || 'update_failed') };
  }

  console.info('[meal] relocate_applied', { userId: lineUserId, mealId: row.id, targetYmd: safeDate });
  clearUserDailyRecordCache(lineUserId);
  scheduleSnapshotFlush();
  return { ok: true, mealId: row.id, targetYmd: safeDate };
}

async function deleteLastMealLog(lineUserId) {
  const user = await resolvePersistentUser(lineUserId);
  if (!user || !supabase) {
    const moved = popLastMealFromDailyBucket(lineUserId, getTodayKey());
    if (!moved) return { ok: false, reason: 'no_memory_meal' };
    scheduleSnapshotFlush();
    return { ok: true, memoryOnly: true };
  }

  const row = await fetchLatestMealLogRow(lineUserId);
  if (!row?.id) return { ok: false, reason: 'no_db_meal' };
  try {
    const { error } = await supabase
      .from('meal_logs')
      .update({ deleted_at: nowIso(), deleted_reason: 'user_request' })
      .eq('id', row.id)
      .eq('user_id', user.id);
    if (error) return { ok: false, reason: normalizeString(error.message || 'delete_failed') };
  } catch (error) {
    return { ok: false, reason: normalizeString(error?.message || 'delete_failed') };
  }

  console.info('[meal] delete_last_applied', { userId: lineUserId, mealId: row.id });
  clearUserDailyRecordCache(lineUserId);
  scheduleSnapshotFlush();
  return { ok: true, mealId: row.id };
}

async function deleteMealLogsByIds(lineUserId, ids = []) {
  const user = await resolvePersistentUser(lineUserId);
  const idList = [...new Set((Array.isArray(ids) ? ids : []).map((x) => normalizeString(x)).filter(Boolean))];
  if (!user || !supabase || !idList.length) {
    return { ok: false, deleted: 0, reason: !user ? 'no_user' : 'no_ids' };
  }
  let deleted = 0;
  try {
    for (const id of idList) {
      const { error } = await supabase
        .from('meal_logs')
        .update({ deleted_at: nowIso(), deleted_reason: 'bulk_user_request' })
        .eq('id', id)
        .eq('user_id', user.id);
      if (!error) deleted += 1;
    }
  } catch (error) {
    return { ok: false, deleted, reason: normalizeString(error?.message || 'delete_failed') };
  }
  if (deleted > 0) {
    console.info('[meal] delete_by_ids_applied', { userId: lineUserId, deleted, ids: idList });
    clearUserDailyRecordCache(lineUserId);
    scheduleSnapshotFlush();
  }
  return { ok: deleted > 0, deleted, mealIds: idList };
}

function clearUserDailyRecordCache(lineUserId) {
  ensureSnapshotLoaded();
  const prefix = `${lineUserId}:`;
  for (const key of [...dailyRecordStore.keys()]) {
    if (key.startsWith(prefix)) dailyRecordStore.delete(key);
  }
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
  if (safe.includes('WBC') || safe.includes('白血球')) return 'WBC';
  if (safe.includes('GLUCOSE')) return '血糖';
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
  ensureSnapshotLoaded();
  const value = shortMemoryStore.get(userId);
  return clone(value || DEFAULT_SHORT_MEMORY);
}

async function saveShortMemory(userId, payload) {
  ensureSnapshotLoaded();
  const current = await getShortMemory(userId);
  const next = mergeDeep(current, payload || {});
  shortMemoryStore.set(userId, next);
  scheduleSnapshotFlush();
  return clone(next);
}

async function clearShortMemory(userId) {
  ensureSnapshotLoaded();
  shortMemoryStore.set(userId, clone(DEFAULT_SHORT_MEMORY));
  scheduleSnapshotFlush();
  return clone(DEFAULT_SHORT_MEMORY);
}

async function getLongMemory(userId) {
  ensureSnapshotLoaded();
  const cached = longMemoryStore.get(userId);
  if (cached) return clone(cached);
  const hydrated = await hydrateLongMemoryFromDb(userId);
  if (hydrated) {
    const next = mergeDeep(DEFAULT_LONG_MEMORY, hydrated);
    longMemoryStore.set(userId, next);
    scheduleSnapshotFlush();
    return clone(next);
  }
  return clone(DEFAULT_LONG_MEMORY);
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

    if (safePatch.preferredName != null) {
      const preferredName = sanitizePreferredName(safePatch.preferredName);
      if (preferredName) next.preferredName = preferredName;
    }
    if (safePatch.goal != null) next.goal = safePatch.goal;
    if (safePatch.age != null) next.age = safePatch.age;
    if (safePatch.weight != null) next.weight = safePatch.weight;
    if (safePatch.bodyFat != null) next.bodyFat = safePatch.bodyFat;
    if (safePatch.aiType != null) next.aiType = safePatch.aiType;
    if (safePatch.voiceStyle != null) next.voiceStyle = safePatch.voiceStyle;
    if (safePatch.constitutionType != null) next.constitutionType = safePatch.constitutionType;
    if (safePatch.trialStartedAt != null) next.trialStartedAt = safePatch.trialStartedAt;
    if (safePatch.selectedPlan != null) next.selectedPlan = safePatch.selectedPlan;
    if (safePatch.onboardingCompleted != null) next.onboardingCompleted = Boolean(safePatch.onboardingCompleted);
    if (safePatch.stagnationTendency != null) next.stagnationTendency = safePatch.stagnationTendency;
    if (safePatch.relationshipPhase != null) next.relationshipPhase = safePatch.relationshipPhase;
    if (safePatch.relationshipPhaseUpdatedAt != null) next.relationshipPhaseUpdatedAt = safePatch.relationshipPhaseUpdatedAt;
    if (safePatch.relationshipPhaseMeta != null && typeof safePatch.relationshipPhaseMeta === 'object') {
      next.relationshipPhaseMeta = { ...(next.relationshipPhaseMeta || {}), ...safePatch.relationshipPhaseMeta };
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
    if (safePatch.conversationStyleMemory && typeof safePatch.conversationStyleMemory === 'object') {
      const cur = next.conversationStyleMemory && typeof next.conversationStyleMemory === 'object'
        ? next.conversationStyleMemory
        : { likedExamples: [], dislikedExamples: [], updatedAt: null };
      const likedExamples = Array.isArray(cur.likedExamples) ? [...cur.likedExamples] : [];
      const dislikedExamples = Array.isArray(cur.dislikedExamples) ? [...cur.dislikedExamples] : [];
      const incomingLiked = Array.isArray(safePatch.conversationStyleMemory.likedExamples)
        ? safePatch.conversationStyleMemory.likedExamples
        : [];
      const incomingDisliked = Array.isArray(safePatch.conversationStyleMemory.dislikedExamples)
        ? safePatch.conversationStyleMemory.dislikedExamples
        : [];
      for (const item of incomingLiked) uniquePush(likedExamples, item);
      for (const item of incomingDisliked) uniquePush(dislikedExamples, item);
      next.conversationStyleMemory = {
        likedExamples: likedExamples.slice(-30),
        dislikedExamples: dislikedExamples.slice(-30),
        updatedAt: safePatch.conversationStyleMemory.updatedAt || nowIso()
      };
    }
  }

  longMemoryStore.set(userId, next);
  scheduleSnapshotFlush();
  await persistLongMemoryToDb(userId, next);
  return clone(next);
}

async function getUserState(userId) {
  ensureSnapshotLoaded();
  const value = userStateStore.get(userId);
  return clone(value || DEFAULT_USER_STATE);
}

async function updateUserState(userId, nextState) {
  const current = await getUserState(userId);
  const merged = mergeDeep(current, nextState || {});
  userStateStore.set(userId, merged);
  scheduleSnapshotFlush();
  return clone(merged);
}

async function getRecentMessages(userId, limit = 20) {
  ensureSnapshotLoaded();
  const arr = recentMessageStore.get(userId) || [];
  return clone(arr.slice(-limit));
}

async function appendRecentMessage(userId, role, content, meta = {}) {
  const safeContent = normalizeString(content);
  if (!userId || !role || !safeContent) return;

  const arr = recentMessageStore.get(userId) || [];
  arr.push({
    role,
    content: safeContent,
    messageId: normalizeString(meta?.messageId || ''),
    createdAt: nowIso()
  });

  recentMessageStore.set(userId, arr.slice(-120));
  scheduleSnapshotFlush();
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

  return parts.join(' ') || '';
}

async function isDuplicateMealInsert(lineUserId, record) {
  if (record?.type !== 'meal') return false;
  const user = await resolvePersistentUser(lineUserId);
  if (!user || !supabase) return false;
  const sid = normalizeString(record.sourceLineMessageId || '');
  const dk = normalizeString(record.dedupeKey || '');
  const imgHash = normalizeString(record.sourceImageHash || record.imageHash || '');
  const sinceRecent = new Date(Date.now() - 12 * 60 * 1000).toISOString();
  const sinceLong = new Date(Date.now() - 48 * 3600 * 1000).toISOString();
  const rows = await safeRows(() => supabase
    .from('meal_logs')
    .select('id, raw_model_json, estimated_kcal, meal_label, eaten_at')
    .eq('user_id', user.id)
    .gte('eaten_at', sinceLong)
    .order('eaten_at', { ascending: false })
    .limit(120));
  const recent = rows.filter((r) => String(r.eaten_at || '') >= sinceRecent);

  const matchRow = (r) => {
    const raw = r?.raw_model_json && typeof r.raw_model_json === 'object' ? r.raw_model_json : {};
    if (sid && normalizeString(raw.sourceLineMessageId) === sid) return 'sourceLineMessageId';
    if (dk && normalizeString(raw.dedupeKey) === dk) return 'dedupeKey';
    if (imgHash && normalizeString(raw.sourceImageHash || raw.imageHash) === imgHash) return 'sourceImageHash';
    return '';
  };

  for (const r of rows) {
    const m = matchRow(r);
    if (m) {
      console.info('[meal] duplicate_detected', { reason: m, mealLogId: r.id, sourceLineMessageId: sid || null, dedupeKey: dk || null });
      return true;
    }
  }

  const kcal = Number(record.kcal || record.estimatedNutrition?.kcal || 0);
  const label = normalizeString(record.summary || record.name);
  if (!label && !kcal) return false;
  const tNew = record.eatenAt ? new Date(record.eatenAt).getTime() : Date.now();
  for (const r of recent) {
    if (Number(r.estimated_kcal || 0) === kcal && normalizeString(r.meal_label) === label) {
      const tOld = new Date(r.eaten_at).getTime();
      if (Number.isFinite(tNew) && Number.isFinite(tOld) && Math.abs(tNew - tOld) <= 10 * 60 * 1000) {
        console.info('[meal] duplicate_detected', { reason: 'near_time_same_kcal_label', mealLogId: r.id, kcal, label: label.slice(0, 40) });
        return true;
      }
    }
  }
  return false;
}

async function addDailyRecord(userId, record) {
  ensureSnapshotLoaded();
  const key = `${userId}:${getTodayKey()}`;
  const current = dailyRecordStore.get(key) || buildDailyRecordBucket();
  const next = clone(current);

  if (record?.type === 'meal') {
    if (await isDuplicateMealInsert(userId, record)) {
      console.info('[meal] skipped_duplicate', { userId, reason: 'db_or_recent_fingerprint' });
      return {
        ...clone(dailyRecordStore.get(key) || buildDailyRecordBucket()),
        points: await getPoints(userId)
      };
    }
    next.meals.push({ ...record, createdAt: nowIso() });
  }
  if (record?.type === 'exercise') next.exercises.push({ ...record, createdAt: nowIso() });
  if (record?.type === 'weight') next.weights.push({ ...record, createdAt: nowIso() });
  if (record?.type === 'lab') next.labs.push({ ...record, createdAt: nowIso() });

  dailyRecordStore.set(key, next);
  scheduleSnapshotFlush();
  await persistDailyRecordToDb(userId, record);

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
  ensureSnapshotLoaded();
  const persisted = await readDailyRecordsFromDb(userId, 1);
  // DBに繋げた場合は「今日」は常にDBスナップショットを優先（空でもメモリに逃げない）
  if (persisted instanceof Map) {
    return clone(persisted.get(getTodayKey()) || buildDailyRecordBucket());
  }
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
  ensureSnapshotLoaded();
  const persisted = await readDailyRecordsFromDb(userId, limit);
  if (persisted && persisted.size) {
    return [...persisted.entries()].sort((a, b) => String(a[0]).localeCompare(String(b[0]))).slice(-limit).map(([date, records]) => ({ date, records: clone(records) }));
  }
  const keys = await getAllDailyRecordKeysForUser(userId);
  const selected = keys.slice(-limit);
  return selected.map((key) => ({
    date: key.split(':')[1],
    records: clone(dailyRecordStore.get(key) || buildDailyRecordBucket())
  }));
}

async function getLatestWeightEntry(userId) {
  ensureSnapshotLoaded();
  const persisted = await readDailyRecordsFromDb(userId, 14);
  if (persisted && persisted.size) {
    const weights = [];
    for (const [date, bucket] of [...persisted.entries()].sort((a, b) => String(a[0]).localeCompare(String(b[0])))) {
      for (const item of bucket.weights || []) weights.push({ ...item, date });
    }
    if (weights.length) return clone(weights[weights.length - 1]);
  }
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
  const examDate = normalizeString(panel.examDate || panel.latestExamDate || panel.reportDate || '');
  let items = (Array.isArray(panel.items) ? panel.items : [])
    .map(normalizeLabPanelItem)
    .filter((item) => item.itemName && (item.value || item.history.length));

  const hasRawRows =
    (Array.isArray(panel.rawExtractedItems) && panel.rawExtractedItems.length > 0)
    || (Array.isArray(panel.structuredRows) && panel.structuredRows.length > 0);

  if (!items.length) {
    const derivedMap = labItemAliasService.buildLabItemMapFromPanel(panel);
    const derivedList = Object.values(derivedMap || {});
    items = derivedList
      .map((entry) => normalizeLabPanelItem({
        itemName: entry.label || entry.rawLabel || '',
        value: entry.value || '',
        unit: entry.unit || '',
        flag: '',
        history: examDate && entry.value
          ? [{ date: examDate, value: String(entry.value), unit: entry.unit || '', flag: '' }]
          : []
      }))
      .filter((item) => item.itemName && item.value);
  }

  const normalizedPanel = {
    examDate,
    source: normalizeString(panel.source || 'image'),
    capturedAt: nowIso(),
    items,
    latestExamDate: normalizeString(panel.latestExamDate || panel.examDate || ''),
    reportDate: normalizeString(panel.reportDate || ''),
    examDates: Array.isArray(panel.examDates) ? panel.examDates.map(normalizeString).filter(Boolean) : [],
    rawExtractedItems: Array.isArray(panel.rawExtractedItems) ? clone(panel.rawExtractedItems) : [],
    rawPayload: panel.rawPayload ? clone(panel.rawPayload) : null,
    rawText: normalizeString(panel.rawText || ''),
    sourceImageId: normalizeString(panel.sourceImageId || '')
  };

  // 項目が空でも raw 行や検査日があれば保持し、follow-up で別名辞書から拾えるようにする。
  if (!normalizedPanel.items.length && !normalizedPanel.examDate && !hasRawRows) return null;

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
        items: [...map.values()],
        rawExtractedItems: normalizedPanel.rawExtractedItems?.length ? normalizedPanel.rawExtractedItems : (existing.rawExtractedItems || []),
        rawPayload: normalizedPanel.rawPayload || existing.rawPayload || null
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
  ensureSnapshotLoaded();
  const persisted = await getPersistedPoints(userId);
  if (persisted != null) {
    pointsStore.set(userId, persisted);
    scheduleSnapshotFlush();
    return Number(persisted || 0);
  }
  return Number(pointsStore.get(userId) || 0);
}

async function addPoints(userId, amount) {
  ensureSnapshotLoaded();
  const current = await getPoints(userId);
  const next = current + Number(amount || 0);
  pointsStore.set(userId, next);
  scheduleSnapshotFlush();
  await persistPointsToDb(userId, next);
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
  scheduleSnapshotFlush();
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
  resetAllMemory,
  getTokyoTodayYmd: () => getTodayKey(),
  addCalendarDaysToTokyoYmd,
  relocateLastMealToTokyoDate,
  deleteLastMealLog,
  deleteMealLogsByIds
  ,
  adjustLastMealNutrition
};
