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

function shortId(v) {
  const s = normalizeText(v);
  if (s.length <= 12) return s;
  return `${s.slice(0, 6)}...${s.slice(-4)}`;
}

function isSystemLikeMessage(role, messageType, text) {
  const r = normalizeText(role).toLowerCase();
  const mt = normalizeText(messageType).toLowerCase();
  const t = normalizeText(text);
  if (r === 'system' || r === 'tool') return true;
  if (mt === 'system' || mt === 'tool') return true;
  if (/^\[system\]/i.test(t)) return true;
  if (/^intent=|^mode=/.test(t)) return true;
  return false;
}

function pickDisplayName(userRow = {}) {
  const p1 = normalizeText(userRow.line_display_name || userRow.display_name || '');
  const p2 = normalizeText(userRow.preferred_name || userRow.nickname || userRow.name || '');
  const p3 = normalizeText(
    userRow?.metadata?.patientName
    || userRow?.metadata?.patient_name
    || userRow?.metadata?.fullName
    || userRow?.metadata?.name
    || ''
  );
  return p1 || p2 || p3 || '';
}

async function getManagedUsers({ query = '', limit = 80, adminUserId = '' } = {}) {
  if (!supabase) return [];
  const q = normalizeText(query).toLowerCase();
  const { data, error } = await supabase
    .from('chat_logs')
    .select('line_user_id,message_text,created_at,role,message_type,metadata')
    .not('line_user_id', 'is', null)
    .order('created_at', { ascending: false })
    .limit(4000);
  if (error || !Array.isArray(data)) return [];
  const { data: usersData } = await supabase
    .from('users')
    .select('id,line_user_id,line_display_name,display_name,preferred_name,nickname,name,metadata')
    .not('line_user_id', 'is', null)
    .limit(5000);
  const { data: readData } = await supabase
    .from('admin_thread_reads')
    .select('line_user_id,last_read_message_at')
    .eq('admin_user_id', normalizeText(adminUserId || ''))
    .limit(5000);
  const readMap = new Map();
  for (const r of Array.isArray(readData) ? readData : []) {
    readMap.set(normalizeText(r.line_user_id), toIso(r.last_read_message_at));
  }
  const userMap = new Map();
  for (const u of Array.isArray(usersData) ? usersData : []) {
    userMap.set(normalizeText(u.line_user_id), u);
  }
  const map = new Map();
  for (const row of data) {
    const uid = normalizeText(row.line_user_id);
    if (!uid) continue;
    const cur = map.get(uid) || {
      lineUserId: uid,
      lastMessageAt: '',
      lastPreview: '',
      lastRole: '',
      unread: false,
      displayName: '',
      helperId: shortId(uid),
      unreadCount: 0,
      hasNew: false
    };
    const profile = userMap.get(uid) || {};
    const picked = pickDisplayName(profile);
    cur.displayName = picked || `未設定ユーザー (${shortId(uid)})`;
    const iso = toIso(row.created_at);
    if (!cur.lastMessageAt || (iso && iso > cur.lastMessageAt)) {
      cur.lastMessageAt = iso;
      const txt = normalizeText(row.message_text);
      if (!isSystemLikeMessage(row.role, row.message_type, txt)) {
        cur.lastPreview = txt.slice(0, 120);
      } else if (!cur.lastPreview) {
        cur.lastPreview = 'メッセージあり';
      }
      cur.lastRole = normalizeText(row.role || '');
    }
    if (!cur.lastPreview) {
      const txt = normalizeText(row.message_text);
      if (!isSystemLikeMessage(row.role, row.message_type, txt)) {
        cur.lastPreview = txt.slice(0, 120);
      }
    }
    const readAt = readMap.get(uid) || '';
    if (
      normalizeText(row.role) === 'user'
      && iso
      && (!readAt || iso > readAt)
      && !isSystemLikeMessage(row.role, row.message_type, normalizeText(row.message_text))
    ) {
      cur.unreadCount += 1;
      cur.hasNew = true;
    }
    map.set(uid, cur);
  }
  let items = Array.from(map.values()).sort((a, b) => String(b.lastMessageAt).localeCompare(String(a.lastMessageAt)));
  if (q) {
    items = items.filter((u) =>
      u.lineUserId.toLowerCase().includes(q)
      || String(u.displayName || '').toLowerCase().includes(q)
      || String(u.lastPreview || '').toLowerCase().includes(q)
      || String(u.helperId || '').toLowerCase().includes(q)
    );
  }
  return items.slice(0, Math.max(1, Number(limit) || 80));
}

async function getUserChatHistory(lineUserId, { limit = 120, before = '', keyword = '' } = {}) {
  if (!supabase) return [];
  const uid = normalizeText(lineUserId);
  if (!uid) return [];
  let q = supabase
    .from('chat_logs')
    .select('id,role,message_text,message_type,created_at,metadata,source_channel,line_user_id')
    .eq('line_user_id', uid)
    .order('created_at', { ascending: false })
    .limit(Math.max(20, Number(limit) || 120));
  const beforeIso = toIso(before);
  if (beforeIso) q = q.lt('created_at', beforeIso);
  const safeKeyword = normalizeText(keyword);
  if (safeKeyword) q = q.ilike('message_text', `%${safeKeyword}%`);
  const { data, error } = await q;
  if (error || !Array.isArray(data)) return [];
  const rows = data.slice().reverse();
  return rows.map((r) => ({
    id: r.id,
    role: normalizeText(r.role || '').toLowerCase(),
    text: normalizeText(r.message_text || ''),
    messageType: normalizeText(r.message_type || 'text'),
    createdAt: toIso(r.created_at) || new Date().toISOString(),
    attachments: Array.isArray(r?.metadata?.attachments) ? r.metadata.attachments : []
  }));
}

async function markThreadRead({ adminUserId, lineUserId, lastReadMessageAt }) {
  if (!supabase) return { ok: false };
  const payload = {
    admin_user_id: normalizeText(adminUserId),
    line_user_id: normalizeText(lineUserId),
    last_read_message_at: normalizeText(lastReadMessageAt) || new Date().toISOString(),
    updated_at: new Date().toISOString()
  };
  const { error } = await supabase.from('admin_thread_reads').upsert(payload, { onConflict: 'admin_user_id,line_user_id' });
  if (error) return { ok: false, reason: normalizeText(error.message || 'mark_read_failed') };
  return { ok: true };
}

async function syncLineDisplayName(lineUserId, displayName) {
  if (!supabase) return { ok: false };
  const uid = normalizeText(lineUserId);
  const name = normalizeText(displayName);
  if (!uid || !name) return { ok: false };
  const { error } = await supabase
    .from('users')
    .update({
      line_display_name: name,
      display_name: name,
      updated_at: new Date().toISOString()
    })
    .eq('line_user_id', uid);
  if (error) return { ok: false, reason: normalizeText(error.message || 'sync_display_name_failed') };
  return { ok: true };
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
  markThreadRead,
  syncLineDisplayName,
  insertAdminMessage,
  getDraft,
  upsertDraft,
  getThemeByAdmin,
  upsertTheme
};
