"use strict";

const { supabase } = require('./supabase_service');
const { ensureUser } = require('./user_service');
const contextMemoryService = require('./context_memory_service');

function normalizeText(value) {
  return String(value || '').trim();
}

function sanitizePreferredName(value) {
  const safe = normalizeText(value)
    .replace(/^(私の名前は|名前は|名前：|名前:)/u, '')
    .replace(/(です|だよ|ですよ|と呼んでください|って呼んで|と呼んで).*$/u, '')
    .replace(/\s+/g, '')
    .trim();

  if (!safe) return '';
  if (safe.length > 16) return '';
  if (/今日|昨日|明日|暖か|眠い|しんど|痛い|なりそう|です$|ます$/.test(safe)) return '';
  return safe;
}

function toHalfWidth(text) {
  return normalizeText(text).replace(/[０-９．％]/g, (s) => String.fromCharCode(s.charCodeAt(0) - 0xFEE0));
}

function normalizeProfileValue(key, value) {
  const safe = normalizeText(value);
  if (!safe) return '';
  if (key === 'preferredName') return sanitizePreferredName(safe);
  if (key === 'weight') return toHalfWidth(safe).replace(/[^\d.]/g, '');
  if (key === 'bodyFat') return toHalfWidth(safe).replace(/[^\d.]/g, '');
  if (key === 'height') return toHalfWidth(safe).replace(/[^\d.]/g, '');
  return safe;
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

async function safeRows(builder, fallback = []) {
  try {
    const { data, error } = await builder();
    if (error) throw error;
    return Array.isArray(data) ? data : fallback;
  } catch (_error) {
    return fallback;
  }
}

async function safeUpsert(table, rows, options = {}) {
  try {
    const query = supabase.from(table).upsert(rows, options);
    const { error } = await query;
    if (error) throw error;
    return true;
  } catch (_error) {
    return false;
  }
}

async function safeUpdate(table, values, matcher) {
  try {
    let query = supabase.from(table).update(values);
    for (const [key, value] of Object.entries(matcher || {})) {
      query = query.eq(key, value);
    }
    const { error } = await query;
    if (error) throw error;
    return true;
  } catch (_error) {
    return false;
  }
}

async function getUserByLineUserId(lineUserId) {
  const safeLineUserId = normalizeText(lineUserId);
  if (!safeLineUserId) return null;
  try {
    return await ensureUser(supabase, safeLineUserId, 'Asia/Tokyo');
  } catch (_error) {
    return null;
  }
}

async function getProfileFacts(userId) {
  const safeUserId = normalizeText(userId);
  if (!safeUserId) return [];
  return safeRows(() => supabase
    .from('user_profile_facts')
    .select('field_key, field_value, field_unit, source_kind, confidence, updated_at')
    .eq('user_id', safeUserId)
    .order('updated_at', { ascending: false }));
}

function rowsToFactMap(rows = []) {
  const factMap = {};
  for (const row of rows) {
    const key = normalizeText(row.field_key);
    if (!key || factMap[key]) continue;
    factMap[key] = {
      value: normalizeText(row.field_value),
      unit: normalizeText(row.field_unit),
      sourceKind: normalizeText(row.source_kind),
      confidence: row.confidence == null ? null : Number(row.confidence),
      updatedAt: row.updated_at || null
    };
  }
  return factMap;
}

async function getLatestWeightRow(userId) {
  const safeUserId = normalizeText(userId);
  if (!safeUserId) return null;
  return safeMaybeSingle(() => supabase
    .from('weight_logs')
    .select('logged_at, weight_kg, body_fat_pct')
    .eq('user_id', safeUserId)
    .order('logged_at', { ascending: false })
    .limit(1)
    .maybeSingle());
}




async function inferPreferredNameFromRecentMessages(lineUserId) {
  const safeLineUserId = normalizeText(lineUserId);
  if (!safeLineUserId) return '';
  try {
    const recent = await contextMemoryService.getRecentMessages(safeLineUserId, 40);
    const userMessages = Array.isArray(recent) ? recent.filter((row) => row && row.role === 'user').slice().reverse() : [];
    for (const row of userMessages) {
      const safe = normalizeText(row.content || '');
      if (!safe) continue;
      const match = safe.match(/^(?:私は|ぼくは|僕は|俺は)?\s*([ぁ-んァ-ヶ一-龠A-Za-z0-9〜～ー\-]{1,16})(?:です|だよ|です！|だよ！|といいます)$/u);
      if (!match) continue;
      const inferred = sanitizePreferredName(match[1]);
      if (inferred) return inferred;
    }
  } catch (_error) {}
  return '';
}

async function getLatestPatientName(userId) {
  const safeUserId = normalizeText(userId);
  if (!safeUserId) return '';
  return safeMaybeSingle(() => supabase
    .from('lab_documents')
    .select('patient_name, updated_at')
    .eq('user_id', safeUserId)
    .not('patient_name', 'is', null)
    .order('updated_at', { ascending: false })
    .limit(1)
    .maybeSingle(), null).then((row) => sanitizePreferredName(row?.patient_name || ''));
}

async function getAuthoritativeProfileByLineUser(lineUserId) {
  const user = await getUserByLineUserId(lineUserId);
  if (!user) return null;

  const [factRows, latestWeight, latestPatientName, recentPreferredName] = await Promise.all([
    getProfileFacts(user.id),
    getLatestWeightRow(user.id),
    getLatestPatientName(user.id),
    inferPreferredNameFromRecentMessages(lineUserId)
  ]);

  const factMap = rowsToFactMap(factRows);
  const displayName = sanitizePreferredName(user.display_name || user.preferred_name || user.name || factMap.preferredName?.value || latestPatientName || recentPreferredName || '') || '';
  const preferredName = sanitizePreferredName(factMap.preferredName?.value || displayName || latestPatientName || recentPreferredName || '');

  const weightFromFacts = normalizeProfileValue('weight', factMap.weight?.value || '');
  const bodyFatFromFacts = normalizeProfileValue('bodyFat', factMap.bodyFat?.value || '');
  const latestWeightValue = latestWeight?.weight_kg != null ? String(latestWeight.weight_kg) : (weightFromFacts || '');
  const latestBodyFatValue = latestWeight?.body_fat_pct != null ? String(latestWeight.body_fat_pct) : (bodyFatFromFacts || '');

  return {
    userId: user.id,
    lineUserId: user.line_user_id,
    preferredName,
    displayName: preferredName || 'ここから。ユーザー',
    age: normalizeProfileValue('age', factMap.age?.value || ''),
    height: normalizeProfileValue('height', factMap.height?.value || ''),
    goal: normalizeText(factMap.goal?.value || ''),
    latestWeight: latestWeightValue,
    latestBodyFat: latestBodyFatValue,
    latestWeightDate: latestWeight?.logged_at ? String(latestWeight.logged_at).slice(0, 10) : null,
    factMap,
    user
  };
}

async function persistProfilePatchByLineUser(lineUserId, patch = {}, options = {}) {
  const user = await getUserByLineUserId(lineUserId);
  if (!user) return { ok: false, reason: 'user_not_found' };

  const sourceKind = normalizeText(options.sourceKind || 'chat_profile');
  const confidence = Number.isFinite(Number(options.confidence)) ? Number(options.confidence) : 0.95;
  const normalizedPatch = {
    preferredName: normalizeProfileValue('preferredName', patch.preferredName),
    age: normalizeProfileValue('age', patch.age),
    height: normalizeProfileValue('height', patch.height),
    weight: normalizeProfileValue('weight', patch.weight),
    bodyFat: normalizeProfileValue('bodyFat', patch.bodyFat),
    goal: normalizeText(patch.goal)
  };

  const rows = Object.entries(normalizedPatch)
    .filter(([, value]) => normalizeText(value))
    .map(([fieldKey, fieldValue]) => ({
      user_id: user.id,
      field_key: fieldKey,
      field_value: String(fieldValue),
      field_unit: fieldKey === 'height' ? 'cm' : fieldKey === 'weight' ? 'kg' : fieldKey === 'bodyFat' ? '%' : '',
      source_kind: sourceKind,
      confidence,
      updated_at: new Date().toISOString()
    }));

  if (normalizedPatch.preferredName) {
    await safeUpdate('users', { display_name: normalizedPatch.preferredName }, { id: user.id });
  }

  if (rows.length) {
    await safeUpsert('user_profile_facts', rows, { onConflict: 'user_id,field_key' });
  }

  return { ok: true, userId: user.id, lineUserId: user.line_user_id, savedKeys: rows.map((row) => row.field_key) };
}

function buildDisplayName(profile = {}) {
  return sanitizePreferredName(profile.preferredName || profile.displayName || '') || 'ここから。ユーザー';
}

module.exports = {
  sanitizePreferredName,
  getAuthoritativeProfileByLineUser,
  persistProfilePatchByLineUser,
  buildDisplayName
};
