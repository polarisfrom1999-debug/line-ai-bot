'use strict';

let supabase = null;
try {
  ({ supabase } = require('../services/supabase_service'));
} catch (_error) {
  supabase = null;
}

function normalizeText(value) {
  return String(value || '').trim();
}

/**
 * 運動消費（活動 kcal）を期間内で合計
 * @returns {{ totalKcal: number, rowCount: number, rows: object[] } | null }
 */
async function getActivityBurnInRange(userId, fromIso, toIso) {
  if (!supabase) return { totalKcal: 0, rowCount: 0, rows: [] };
  const uid = normalizeText(userId);
  if (!uid || !normalizeText(fromIso) || !normalizeText(toIso)) {
    return { totalKcal: 0, rowCount: 0, rows: [] };
  }
  try {
    const { data, error } = await supabase
      .from('activity_logs')
      .select('id, logged_at, estimated_activity_kcal')
      .eq('user_id', uid)
      .gte('logged_at', fromIso)
      .lt('logged_at', toIso);
    if (error) {
      return { totalKcal: 0, rowCount: 0, rows: [] };
    }
    const rows = Array.isArray(data) ? data : [];
    let totalKcal = 0;
    for (const r of rows) {
      const k = Number(r?.estimated_activity_kcal);
      if (Number.isFinite(k)) totalKcal += k;
    }
    return { totalKcal, rowCount: rows.length, rows };
  } catch (_e) {
    return { totalKcal: 0, rowCount: 0, rows: [] };
  }
}

module.exports = {
  getActivityBurnInRange,
};
