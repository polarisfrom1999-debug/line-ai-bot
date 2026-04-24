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

function toIso(v) {
  const d = new Date(v || '');
  return Number.isNaN(d.getTime()) ? '' : d.toISOString();
}

async function getManagedUsers({ query = '', limit = 80 } = {}) {
  if (!supabase) return [];
  const q = normalizeText(query).toLowerCase();
  const { data, error } = await supabase
    .from('chat_logs')
    .select('line_user_id,message_text,created_at,role')
    .not('line_user_id', 'is', null)
    .order('created_at', { ascending: false })
    .limit(2000);
  if (error || !Array.isArray(data)) return [];
  const map = new Map();
  for (const row of data) {
    const uid = normalizeText(row.line_user_id);
    if (!uid) continue;
    const cur = map.get(uid) || {
      lineUserId: uid,
      lastMessageAt: '',
      lastPreview: '',
      lastRole: '',
      unread: false
    };
    const iso = toIso(row.created_at);
    if (!cur.lastMessageAt || (iso && iso > cur.lastMessageAt)) {
      cur.lastMessageAt = iso;
      cur.lastPreview = normalizeText(row.message_text).slice(0, 120);
      cur.lastRole = normalizeText(row.role || '');
    }
    map.set(uid, cur);
  }
  let items = Array.from(map.values()).sort((a, b) => String(b.lastMessageAt).localeCompare(String(a.lastMessageAt)));
  if (q) {
    items = items.filter((u) => u.lineUserId.toLowerCase().includes(q) || String(u.lastPreview || '').toLowerCase().includes(q));
  }
  return items.slice(0, Math.max(1, Number(limit) || 80));
}

async function getUserChatHistory(lineUserId, { limit = 200 } = {}) {
  if (!supabase) return [];
  const uid = normalizeText(lineUserId);
  if (!uid) return [];
  const { data, error } = await supabase
    .from('chat_logs')
    .select('id,role,message_text,message_type,created_at,metadata,source_channel,line_user_id')
    .eq('line_user_id', uid)
    .order('created_at', { ascending: true })
    .limit(Math.max(20, Number(limit) || 200));
  if (error || !Array.isArray(data)) return [];
  return data.map((r) => ({
    id: r.id,
    role: normalizeText(r.role || '') === 'user' ? 'user' : 'assistant',
    text: normalizeText(r.message_text || ''),
    messageType: normalizeText(r.message_type || 'text'),
    createdAt: toIso(r.created_at) || new Date().toISOString(),
    attachments: Array.isArray(r?.metadata?.attachments) ? r.metadata.attachments : []
  }));
}

async function insertAdminMessage({ lineUserId, text = '', attachments = [], adminUserId = '' } = {}) {
  if (!supabase) return { ok: false, reason: 'missing_supabase' };
  const uid = normalizeText(lineUserId);
  if (!uid) return { ok: false, reason: 'missing_user' };
  const payload = {
    line_user_id: uid,
    role: 'assistant',
    source_channel: 'web_admin',
    message_type: attachments.length ? 'text_with_attachments' : 'text',
    message_text: normalizeText(text || ''),
    created_at: new Date().toISOString(),
    metadata: {
      sentBy: 'web_admin',
      adminUserId: normalizeText(adminUserId || ''),
      attachments
    }
  };
  const { error } = await supabase.from('chat_logs').insert(payload);
  if (error) return { ok: false, reason: normalizeText(error.message || 'insert_failed') };
  return { ok: true };
}

async function getDraft(userId, reportType, periodStart, periodEnd) {
  if (!supabase) return null;
  const { data, error } = await supabase
    .from('report_drafts')
    .select('*')
    .eq('user_id', normalizeText(userId))
    .eq('report_type', normalizeText(reportType))
    .eq('period_start', normalizeText(periodStart))
    .eq('period_end', normalizeText(periodEnd))
    .order('updated_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) return null;
  return data || null;
}

async function upsertDraft(row = {}) {
  if (!supabase) return { ok: false };
  const payload = {
    user_id: normalizeText(row.user_id),
    report_type: normalizeText(row.report_type),
    period_start: normalizeText(row.period_start),
    period_end: normalizeText(row.period_end),
    source_summary_json: row.source_summary_json || {},
    draft_text: normalizeText(row.draft_text || ''),
    edited_text: normalizeText(row.edited_text || ''),
    status: normalizeText(row.status || 'draft'),
    updated_at: new Date().toISOString()
  };
  const { error } = await supabase.from('report_drafts').upsert(payload, { onConflict: 'user_id,report_type,period_start,period_end' });
  if (error) return { ok: false, reason: normalizeText(error.message || 'upsert_failed') };
  return { ok: true };
}

async function getThemeByAdmin(adminUserId) {
  if (!supabase) return null;
  const { data, error } = await supabase
    .from('web_theme_settings')
    .select('*')
    .eq('admin_user_id', normalizeText(adminUserId))
    .limit(1)
    .maybeSingle();
  if (error) return null;
  return data || null;
}

async function upsertTheme({ adminUserId, themeId, accentColor } = {}) {
  if (!supabase) return { ok: false };
  const payload = {
    admin_user_id: normalizeText(adminUserId),
    theme_id: normalizeText(themeId),
    accent_color: normalizeText(accentColor),
    updated_at: new Date().toISOString()
  };
  const { error } = await supabase.from('web_theme_settings').upsert(payload, { onConflict: 'admin_user_id' });
  if (error) return { ok: false, reason: normalizeText(error.message || 'theme_upsert_failed') };
  return { ok: true };
}

module.exports = {
  getManagedUsers,
  getUserChatHistory,
  insertAdminMessage,
  getDraft,
  upsertDraft,
  getThemeByAdmin,
  upsertTheme
};
