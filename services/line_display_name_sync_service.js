'use strict';

const { ensureUser } = require('./user_service');

function normalizeText(v) {
  return String(v || '').trim();
}

function classifyDbError(message) {
  const safe = String(message || '').toLowerCase();
  if (!safe) return 'db_error';
  if (safe.includes('schema cache') || safe.includes('could not find the') || safe.includes('column')) return 'schema_cache';
  return 'db_error';
}

/**
 * line_user_id 行を必ず作ってから id で更新（update 0 行のまま成功扱いにしない）
 */
async function syncLineDisplayNameToDb(supabase, lineUserId, displayName, { mode = 'webhook' } = {}) {
  if (!supabase) {
    console.info('[phasee-new] line_display_name_sync', { ok: false, mode, reason: 'missing_supabase' });
    return { ok: false, reason: 'missing_supabase' };
  }
  const uid = normalizeText(lineUserId);
  const name = normalizeText(displayName);
  if (!uid || !name) {
    console.info('[phasee-new] line_display_name_sync', { ok: false, mode, reason: 'missing_uid_or_name' });
    return { ok: false, reason: 'missing_uid_or_name' };
  }
  let user;
  try {
    user = await ensureUser(supabase, uid, 'Asia/Tokyo');
  } catch (e) {
    const detail = String(e?.message || e || 'ensure_user_failed');
    console.info('[phasee-new] line_display_name_sync', { ok: false, mode, reason: 'ensure_user_failed', detail: detail.slice(0, 200) });
    return { ok: false, reason: 'ensure_user_failed' };
  }
  if (!user?.id) {
    console.info('[phasee-new] line_display_name_sync', { ok: false, mode, reason: 'no_user_id' });
    return { ok: false, reason: 'no_user_id' };
  }
  const now = new Date().toISOString();
  const patch = {
    line_display_name: name,
    display_name: name,
    line_display_name_synced_at: now,
    line_display_name_sync_error: '',
    updated_at: now
  };
  const { data, error } = await supabase
    .from('users')
    .update(patch)
    .eq('id', user.id)
    .select('id');
  if (error) {
    const detail = String(error.message || 'db_update');
    const reason = classifyDbError(detail);
    try {
      await supabase
        .from('users')
        .update({ line_display_name_sync_error: detail.slice(0, 500), updated_at: now })
        .eq('id', user.id);
    } catch (_e) {
      // 監査列未適用の環境でも本処理は失敗扱いのまま
    }
    console.info('[phasee-new] line_display_name_sync', { ok: false, mode, reason, detail: detail.slice(0, 200) });
    return { ok: false, reason, detail };
  }
  if (!Array.isArray(data) || !data.length) {
    console.info('[phasee-new] line_display_name_sync', { ok: false, mode, reason: 'update_zero_rows', userId: String(user.id) });
    return { ok: false, reason: 'update_zero_rows' };
  }
  console.info('[phasee-new] line_display_name_sync', { ok: true, mode, line_user_id: uid, userDbId: user.id });
  return { ok: true };
}

module.exports = { syncLineDisplayNameToDb };
