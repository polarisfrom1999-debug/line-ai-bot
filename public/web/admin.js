(function () {
  'use strict';
  const state = { users: [], selected: '', daily: null, weekly: null, monthly: null, consults: [], lastConsultAnswer: '' };
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
  function fmtDate(v) { const d = new Date(v || ''); return Number.isNaN(d.getTime()) ? '' : d.toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo' }); }
  function fmtDateOnly(v) { const d = new Date(v || ''); return Number.isNaN(d.getTime()) ? '' : d.toLocaleDateString('ja-JP', { timeZone: 'Asia/Tokyo' }); }
  function fmtTime(v) { const d = new Date(v || ''); return Number.isNaN(d.getTime()) ? '' : d.toLocaleTimeString('ja-JP', { timeZone: 'Asia/Tokyo', hour: '2-digit', minute: '2-digit' }); }
  function esc(v) { return String(v || '').replace(/[&<>"]/g, (m) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[m])); }

  async function loadUsers(options = {}) {
    const skipAutoLoad = Boolean(options.skipAutoLoad);
    const q = encodeURIComponent(qs('userSearch').value || '');
    const { items } = await jget(`/api/web/admin/users?q=${q}`);
    state.users = items || [];
    if (!state.selected && state.users[0]) state.selected = state.users[0].lineUserId;
    renderUsers();
    if (!skipAutoLoad && state.selected) await loadAllForUser();
  }
  function renderUsers() {
    qs('userList').innerHTML = state.users.map((u) => `
      <div class="item ${u.lineUserId === state.selected ? 'active' : ''} ${u.unreadCount > 0 ? 'unread' : ''}" data-id="${esc(u.lineUserId)}">
        <div class="item-top">
          <strong class="name">${esc(u.displayName || '未設定ユーザー')}</strong>${u.unreadCount > 0 ? `<span class="badge">NEW ${u.unreadCount}</span>` : ''}
          <small class="time">${esc(fmtDate(u.lastMessageAt))}</small>
        </div>
        <div class="preview">${esc(u.lastPreview || 'メッセージあり')}</div>
        <small class="subid">${esc(u.helperId || '')}</small>
      </div>`).join('');
    qs('userList').querySelectorAll('.item').forEach((el) => {
      el.addEventListener('click', async () => { state.selected = el.dataset.id; renderUsers(); await loadAllForUser(); });
    });
  }
  async function loadHistory() {
    const { items } = await jget(`/api/web/admin/chat/history?lineUserId=${encodeURIComponent(state.selected)}`);
    let lastDate = '';
    qs('chatHistory').innerHTML = (items || []).map((m) => {
      const curDate = fmtDateOnly(m.createdAt);
      const sep = curDate && curDate !== lastDate ? `<div class="date-sep">${esc(curDate)}</div>` : '';
      lastDate = curDate || lastDate;
      return `${sep}<div class="row ${m.role}">
        <div class="bubble">${esc(m.text || '')}</div>
        ${(m.attachments || []).map((a) => a.file_type === 'image'
          ? `<a href="${esc(a.file_url)}" target="_blank"><img src="${esc(a.file_url)}" style="max-width:120px"></a>`
          : `<a href="${esc(a.file_url)}" target="_blank">🎬 ${esc(a.file_name || 'video')}</a>`).join('<br>')}
        <div class="meta">${m.role === 'user' ? '利用者' : '返信'} ${esc(fmtTime(m.createdAt))}</div>
      </div>`;
    }).join('');
    qs('chatHistory').scrollTop = qs('chatHistory').scrollHeight;
    const newest = (items || []).slice(-1)[0]?.createdAt || '';
    await jpost('/api/web/admin/thread/read', { lineUserId: state.selected, lastReadMessageAt: newest });
    await loadUsers({ skipAutoLoad: true });
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
  async function loadAllForUser() { await loadHistory(); await loadSummaries(); await loadDrafts(); renderConsultLog(); }

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
  async function refreshDraft(type) {
    await loadDrafts();
    setStatus(`${type === 'weekly' ? '週間' : '月間'}下書きを再読込しました`);
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

  function renderConsultLog() {
    qs('consultLog').innerHTML = state.consults.map((item) => `
      <div class="consult-item">
        <div class="q">Q: ${esc(item.q)}</div>
        <div class="a">${esc(item.a)}</div>
      </div>
    `).join('') || '<div class="consult-item">AI相談の履歴はここに表示されます。</div>';
  }

  async function askConsult(ev) {
    ev.preventDefault();
    if (!state.selected) return;
    const prompt = qs('consultInput').value.trim();
    if (!prompt) return;
    const reportType = qs('consultType').value || 'weekly';
    const out = await jpost('/api/web/admin/consult', { lineUserId: state.selected, prompt, reportType });
    const answer = String(out.answer || '').trim();
    state.lastConsultAnswer = answer;
    state.consults.push({ q: prompt, a: answer });
    state.consults = state.consults.slice(-6);
    qs('consultInput').value = '';
    renderConsultLog();
  }

  function applyConsultToDraft(type) {
    const t = String(state.lastConsultAnswer || '').trim();
    if (!t) return setStatus('先にAI相談を実行してください');
    const box = type === 'weekly' ? qs('weekDraftText') : qs('monthDraftText');
    box.value = `${box.value ? `${box.value}\n\n` : ''}${t}`;
    setStatus(`${type === 'weekly' ? '週報' : '月報'}下書きへ反映しました`);
  }

  function bind() {
    qs('userSearch').addEventListener('input', () => loadUsers().catch((e) => setStatus(e.message)));
    qs('refreshDisplayName').addEventListener('click', async () => {
      if (!state.selected) return;
      await jpost('/api/web/admin/users/refresh-display-name', { lineUserId: state.selected });
      await loadUsers({ skipAutoLoad: true });
      setStatus('表示名を更新しました');
    });
    qs('sendForm').addEventListener('submit', (e) => sendMessage(e).catch((er) => setStatus(er.message)));
    document.querySelectorAll('.consult .tabs button').forEach((b) => b.addEventListener('click', () => {
      document.querySelectorAll('.consult .tabs button').forEach((x) => x.classList.remove('active'));
      b.classList.add('active');
      const tab = b.dataset.tab;
      ['panelToday', 'panelWeek', 'panelMonth'].forEach((id) => qs(id).classList.remove('active'));
      qs(`panel${tab.charAt(0).toUpperCase()}${tab.slice(1)}`).classList.add('active');
    }));
    document.querySelectorAll('.drafts .tabs button').forEach((b) => b.addEventListener('click', () => {
      document.querySelectorAll('.drafts .tabs button').forEach((x) => x.classList.remove('active'));
      b.classList.add('active');
      ['panelWeekDraft', 'panelMonthDraft'].forEach((id) => qs(id).classList.remove('active'));
      qs(`panel${b.dataset.tab.charAt(0).toUpperCase()}${b.dataset.tab.slice(1)}`).classList.add('active');
    }));
    qs('genWeek').addEventListener('click', () => generateDraft('weekly').catch((e) => setStatus(e.message)));
    qs('genMonth').addEventListener('click', () => generateDraft('monthly').catch((e) => setStatus(e.message)));
    qs('reloadWeek').addEventListener('click', () => refreshDraft('weekly').catch((e) => setStatus(e.message)));
    qs('reloadMonth').addEventListener('click', () => refreshDraft('monthly').catch((e) => setStatus(e.message)));
    qs('saveWeek').addEventListener('click', () => saveDraft('weekly').catch((e) => setStatus(e.message)));
    qs('saveMonth').addEventListener('click', () => saveDraft('monthly').catch((e) => setStatus(e.message)));
    qs('consultForm').addEventListener('submit', (e) => askConsult(e).catch((er) => setStatus(er.message)));
    qs('applyToWeek').addEventListener('click', () => applyConsultToDraft('weekly'));
    qs('applyToMonth').addEventListener('click', () => applyConsultToDraft('monthly'));
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
