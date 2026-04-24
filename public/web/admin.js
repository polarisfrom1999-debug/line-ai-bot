(function () {
  'use strict';
  const state = { users: [], selected: '', daily: null, weekly: null, monthly: null };
  const qs = (id) => document.getElementById(id);
  const token = localStorage.getItem('kokokara-web-token') || '';
  const headers = token ? { Authorization: `Bearer ${token}` } : {};

  async function jget(url) {
    const res = await fetch(url, { headers, credentials: 'include' });
    const json = await res.json();
    if (!res.ok || json.ok === false) throw new Error(json.message || json.error || 'request_failed');
    return json;
  }
  async function jpost(url, body) {
    const res = await fetch(url, {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify(body || {})
    });
    const json = await res.json();
    if (!res.ok || json.ok === false) throw new Error(json.message || json.error || 'request_failed');
    return json;
  }
  async function postForm(url, formData) {
    const res = await fetch(url, { method: 'POST', headers, credentials: 'include', body: formData });
    const json = await res.json();
    if (!res.ok || json.ok === false) throw new Error(json.message || json.error || 'request_failed');
    return json;
  }
  function setStatus(s) { qs('status').textContent = s || ''; }
  function fmtDate(v) { const d = new Date(v || ''); return Number.isNaN(d.getTime()) ? '' : d.toLocaleString('ja-JP'); }
  function esc(v) { return String(v || '').replace(/[&<>"]/g, (m) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[m])); }

  async function loadUsers() {
    const q = encodeURIComponent(qs('userSearch').value || '');
    const { items } = await jget(`/api/web/admin/users?q=${q}`);
    state.users = items || [];
    if (!state.selected && state.users[0]) state.selected = state.users[0].lineUserId;
    renderUsers();
    if (state.selected) await loadAllForUser();
  }
  function renderUsers() {
    qs('userList').innerHTML = state.users.map((u) => `
      <div class="item ${u.lineUserId === state.selected ? 'active' : ''}" data-id="${esc(u.lineUserId)}">
        <div>${esc(u.lineUserId)}</div>
        <div>${esc(u.lastPreview || '')}</div>
        <small>${esc(fmtDate(u.lastMessageAt))}</small>
      </div>`).join('');
    qs('userList').querySelectorAll('.item').forEach((el) => {
      el.addEventListener('click', async () => { state.selected = el.dataset.id; renderUsers(); await loadAllForUser(); });
    });
  }
  async function loadHistory() {
    const { items } = await jget(`/api/web/admin/chat/history?lineUserId=${encodeURIComponent(state.selected)}`);
    qs('chatHistory').innerHTML = (items || []).map((m) => `
      <div class="row ${m.role}">
        <div class="bubble">${esc(m.text || '')}</div>
        ${(m.attachments || []).map((a) => a.file_type === 'image'
          ? `<a href="${esc(a.file_url)}" target="_blank"><img src="${esc(a.file_url)}" style="max-width:120px"></a>`
          : `<a href="${esc(a.file_url)}" target="_blank">🎬 ${esc(a.file_name || 'video')}</a>`).join('<br>')}
      </div>`).join('');
    qs('chatHistory').scrollTop = qs('chatHistory').scrollHeight;
  }
  function renderSummary() {
    const d = state.daily, w = state.weekly, m = state.monthly;
    qs('panelToday').innerHTML = d ? `摂取 ${d.intakeKcal} / 活動 ${d.activityKcal} / 収支 ${d.netKcal}<br>食事 ${d.mealCount} / 補正 ${d.totalCorrectionEventCount}` : 'データなし';
    qs('panelWeek').innerHTML = w ? `摂取 ${w.totals.weekIntakeKcal} / 活動 ${w.totals.weekActivityKcal} / 収支 ${w.totals.weekNetKcal}<br>食事 ${w.totals.weekMealCount} / 補正 ${w.totals.weekCorrectionEventCount}` : 'データなし';
    qs('panelMonth').innerHTML = m ? `摂取 ${m.totals.monthIntakeKcal} / 活動 ${m.totals.monthActivityKcal} / 収支 ${m.totals.monthNetKcal}<br>食事 ${m.totals.monthMealCount} / 補正 ${m.totals.monthCorrectionEventCount}` : 'データなし';
  }
  async function loadSummaries() {
    const uid = encodeURIComponent(state.selected);
    state.daily = (await jget(`/api/web/admin/summary/daily?lineUserId=${uid}`)).summary;
    state.weekly = (await jget(`/api/web/admin/summary/weekly?lineUserId=${uid}`)).summary;
    state.monthly = (await jget(`/api/web/admin/summary/monthly?lineUserId=${uid}`)).summary;
    renderSummary();
  }
  async function loadAllForUser() { await loadHistory(); await loadSummaries(); await loadDrafts(); }

  async function loadDrafts() {
    if (state.weekly) {
      const q = `lineUserId=${encodeURIComponent(state.selected)}&reportType=weekly&periodStart=${state.weekly.fromYmd}&periodEnd=${state.weekly.toYmd}`;
      const { item } = await jget(`/api/web/admin/report-draft?${q}`);
      qs('weekDraftText').value = (item && (item.edited_text || item.draft_text)) || '';
    }
    if (state.monthly) {
      const q = `lineUserId=${encodeURIComponent(state.selected)}&reportType=monthly&periodStart=${state.monthly.fromYmd}&periodEnd=${state.monthly.toYmd}`;
      const { item } = await jget(`/api/web/admin/report-draft?${q}`);
      qs('monthDraftText').value = (item && (item.edited_text || item.draft_text)) || '';
    }
  }
  async function generateDraft(type) {
    const { draftText } = await jpost('/api/web/admin/report-draft/generate', { lineUserId: state.selected, reportType: type });
    if (type === 'weekly') qs('weekDraftText').value = draftText;
    else qs('monthDraftText').value = draftText;
  }
  async function saveDraft(type) {
    const s = type === 'weekly' ? state.weekly : state.monthly;
    const t = type === 'weekly' ? qs('weekDraftText').value : qs('monthDraftText').value;
    await jpost('/api/web/admin/report-draft/save', {
      lineUserId: state.selected, reportType: type, periodStart: s.fromYmd, periodEnd: s.toYmd,
      draftText: t, editedText: t, sourceSummaryJson: s
    });
    setStatus(`${type} 下書きを保存しました`);
  }

  async function sendMessage(ev) {
    ev.preventDefault();
    if (!state.selected) return;
    const text = qs('messageInput').value.trim();
    const files = Array.from(qs('fileInput').files || []);
    let attachments = [];
    if (files.length) {
      const fd = new FormData();
      fd.append('lineUserId', state.selected);
      files.forEach((f) => fd.append('files', f));
      const up = await postForm('/api/web/admin/attachments/upload', fd);
      attachments = up.attachments || [];
    }
    await jpost('/api/web/admin/chat/send', { lineUserId: state.selected, text, attachments });
    qs('messageInput').value = '';
    qs('fileInput').value = '';
    await loadHistory();
    setStatus('送信しました');
  }

  function bind() {
    qs('userSearch').addEventListener('input', () => loadUsers().catch((e) => setStatus(e.message)));
    qs('sendForm').addEventListener('submit', (e) => sendMessage(e).catch((er) => setStatus(er.message)));
    document.querySelectorAll('.tabs button').forEach((b) => b.addEventListener('click', () => {
      document.querySelectorAll('.tabs button').forEach((x) => x.classList.remove('active'));
      b.classList.add('active');
      const tab = b.dataset.tab;
      document.querySelectorAll('.panel').forEach((p) => p.classList.remove('active'));
      qs(`panel${tab.charAt(0).toUpperCase()}${tab.slice(1)}`).classList.add('active');
    }));
    qs('genWeek').addEventListener('click', () => generateDraft('weekly').catch((e) => setStatus(e.message)));
    qs('genMonth').addEventListener('click', () => generateDraft('monthly').catch((e) => setStatus(e.message)));
    qs('saveWeek').addEventListener('click', () => saveDraft('weekly').catch((e) => setStatus(e.message)));
    qs('saveMonth').addEventListener('click', () => saveDraft('monthly').catch((e) => setStatus(e.message)));
    qs('saveTheme').addEventListener('click', async () => {
      await jpost('/api/web/admin/theme', { themeId: qs('themeId').value, accentColor: '' });
      setStatus('テーマを保存しました');
    });
  }

  async function init() {
    bind();
    try {
      const t = await jget('/api/web/admin/theme');
      if (t.item?.theme_id) qs('themeId').value = t.item.theme_id;
    } catch (_e) {}
    await loadUsers();
    setStatus('読み込み完了');
  }

  init().catch((e) => setStatus(e.message));
})();
