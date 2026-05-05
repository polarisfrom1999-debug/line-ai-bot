'use strict';

let supabase = null;
try {
  ({ supabase } = require('../services/supabase_service'));
} catch (_e) {
  supabase = null;
}

function normalizeText(v) {
  return String(v || '').trim();
}

let cachedRows = null;
let cachedAt = 0;
const CACHE_MS = 60 * 1000;

async function getAllActiveMasterRows(forceRefresh = false) {
  if (!supabase) return [];
  const now = Date.now();
  if (!forceRefresh && cachedRows && now - cachedAt < CACHE_MS) return cachedRows;
  try {
    const q = await supabase
      .from('lab_item_master')
      .select('id,normalized_key,display_name_ja,display_name_en,aliases_json,category,default_unit,is_active,sort_order')
      .eq('is_active', true)
      .order('sort_order', { ascending: true });
    if (q?.error || !Array.isArray(q.data)) {
      cachedRows = [];
      cachedAt = now;
      return [];
    }
    cachedRows = q.data;
    cachedAt = now;
    return cachedRows;
  } catch (_e) {
    return [];
  }
}

function invalidateCache() {
  cachedRows = null;
  cachedAt = 0;
}

module.exports = {
  getAllActiveMasterRows,
  invalidateCache
};
