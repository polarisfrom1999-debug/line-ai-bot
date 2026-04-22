'use strict';

let supabase = null;
try {
  ({ supabase } = require('./supabase_service'));
} catch (_error) {
  supabase = null;
}

function normalizeText(value) {
  return String(value || '').trim();
}

function toTokyoYmd(date = new Date()) {
  return new Intl.DateTimeFormat('sv-SE', {
    timeZone: 'Asia/Tokyo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).format(date);
}

async function recordReachability(tag, files = [], meta = {}) {
  const safeTag = normalizeText(tag);
  if (!safeTag) return { ok: false, reason: 'missing_tag' };
  if (!supabase) return { ok: false, reason: 'missing_supabase' };
  const day = toTokyoYmd();
  const now = new Date().toISOString();
  const safeFiles = [...new Set((Array.isArray(files) ? files : []).map((x) => normalizeText(x)).filter(Boolean))];
  try {
    const existing = await supabase
      .from('phasee_route_reachability_daily')
      .select('id,count,files_jsonb')
      .eq('day_ymd', day)
      .eq('tag', safeTag)
      .limit(1)
      .maybeSingle();
    if (existing?.data?.id) {
      const prevFiles = Array.isArray(existing.data.files_jsonb) ? existing.data.files_jsonb : [];
      const mergedFiles = [...new Set([...prevFiles, ...safeFiles])];
      await supabase
        .from('phasee_route_reachability_daily')
        .update({
          count: Number(existing.data.count || 0) + 1,
          last_seen_at: now,
          files_jsonb: mergedFiles,
          meta_jsonb: meta && typeof meta === 'object' ? meta : {},
        })
        .eq('id', existing.data.id);
      return { ok: true, day, tag: safeTag, updated: true };
    }
    await supabase.from('phasee_route_reachability_daily').insert({
      day_ymd: day,
      tag: safeTag,
      count: 1,
      last_seen_at: now,
      files_jsonb: safeFiles,
      meta_jsonb: meta && typeof meta === 'object' ? meta : {},
    });
    return { ok: true, day, tag: safeTag, inserted: true };
  } catch (error) {
    return { ok: false, reason: normalizeText(error?.message || 'record_failed') };
  }
}

module.exports = {
  recordReachability,
};
