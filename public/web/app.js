
const APP_VERSION = 'phase12-root-rebuild';

const state = {
  token: localStorage.getItem('kokokara_web_token') || '',
  profile: null,
  currentView: localStorage.getItem('kokokara_web_view') || 'home',
  currentTab: localStorage.getItem('kokokara_web_tab') || 'meals',
  recordRange: localStorage.getItem('kokokara_web_range') || '30d',
  chatDraft: localStorage.getItem('kokokara_web_draft') || '',
  cache: {
    home: null,
    sidebar: null,
    recordsOverview: null,
    starters: []
  },
  loading: false,
  bootstrapped: false,
  lastLoadedAt: null,
  lastSeenAt: localStorage.getItem('kokokara_web_last_seen_at') || '',
  sessionExpiresAt: null,
  viewRequestId: 0,
  autoRefreshAt: 0,
  syncVersion: '',
  syncState: { version: '', scopeVersions: { chat: '', records: '', home: '' }, hint: '' },
  syncPollHandle: null,
  pendingSync: null,
  pendingSyncCount: 0,
  syncHintShownAt: 0,
  realtime: { source: null, status: 'off' }
};

function qs(sel) { return document.querySelector(sel); }
function qsa(sel) { return Array.from(document.querySelectorAll(sel)); }
function escapeHtml(text) {
  return String(text || '').replace(/[&<>"']/g, (c) => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));
}

function extractCodeCandidate(value) {
  const safe = String(value || '').trim();
  if (!safe) return '';
  if (/^https?:\/\//i.test(safe)) {
    try {
      const url = new URL(safe);
      return String(url.searchParams.get('code') || url.searchParams.get('token') || '').trim();
    } catch (_error) {
      return safe;
    }
  }
  return safe;
}

function readCodeFromLocation() {
  try {
    const url = new URL(window.location.href);
    return String(url.searchParams.get('code') || '').trim();
  } catch (_error) {
    return '';
  }
}

function clearCodeFromLocation() {
  try {
    const url = new URL(window.location.href);
    url.searchParams.delete('code');
    window.history.replaceState({}, '', `${url.pathname}${url.search}${url.hash}`);
  } catch (_error) {}
}

function normalizeSyncPayload(sync = {}) {
  return {
    version: sync?.version || '',
    chatChangedAt: sync?.chatChangedAt || '',
    recordsChangedAt: sync?.recordsChangedAt || '',
    homeChangedAt: sync?.homeChangedAt || '',
    scopeVersions: {
      chat: sync?.scopeVersions?.chat || sync?.chatChangedAt || '',
      records: sync?.scopeVersions?.records || sync?.recordsChangedAt || '',
      home: sync?.scopeVersions?.home || sync?.homeChangedAt || ''
    },
    scopes: {
      chat: sync?.scopes?.chat !== false,
      records: sync?.scopes?.records !== false,
      home: sync?.scopes?.home !== false
    },
    reason: sync?.reason || '',
    hint: sync?.hint || ''
  };
}

function syncScopeChanged(scope, nextSync) {
  const nextValue = nextSync?.scopeVersions?.[scope] || '';
  const prevValue = state.syncState?.scopeVersions?.[scope] || '';
  return Boolean(nextValue && nextValue !== prevValue);
}

function reasonLabel(reason = '') {
  const map = {
    line_chat: 'LINEで会話が増えました。',
    line_meal: 'LINEで食事の記録が増えました。',
    line_weight: 'LINEで体重まわりの更新がありました。',
    line_lab: 'LINEで血液検査まわりの更新がありました。',
    line_activity: 'LINEで運動や活動の更新がありました。',
    line_image: 'LINEで画像の更新がありました。',
    web_chat: 'WEBで新しい相談が反映されました。',
    line_update: 'LINE側で新しい更新があります。'
  };
  return map[String(reason || '')] || '';
}

function buildPendingSyncMessage(sync, count = 1) {
  const base = reasonLabel(sync?.reason) || sync?.hint || 'LINE側で更新があります。';
  if (count > 1) return `${base} いま入力中の相談文は守り、まとめて反映できます。`;
  return `${base} 入力中の相談文はそのまま守り、送信後か更新ボタンで反映します。`;
}

function rememberSyncState(sync) {
  const normalized = normalizeSyncPayload(sync || {});
  state.syncVersion = normalized.version || state.syncVersion || '';
  state.syncState = normalized;
  return normalized;
}

function visitSinceQuery() {
  return state.lastSeenAt ? `since=${encodeURIComponent(state.lastSeenAt)}` : '';
}

function rememberVisitNow(at = new Date().toISOString()) {
  state.lastSeenAt = at;
  localStorage.setItem('kokokara_web_last_seen_at', state.lastSeenAt);
}

function clearVisitMarkers() {
  state.lastSeenAt = '';
  localStorage.removeItem('kokokara_web_last_seen_at');
}

function todayYmdMinusDays(days) {
  const now = new Date();
  const tokyo = new Date(new Date(now).toLocaleString('en-US', { timeZone: 'Asia/Tokyo' }));
  tokyo.setDate(tokyo.getDate() - days);
  const y = tokyo.getFullYear();
  const m = String(tokyo.getMonth() + 1).padStart(2, '0');
  const d = String(tokyo.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function currentDraft() {
  return qs('#chatInput') ? qs('#chatInput').value.trim() : state.chatDraft.trim();
}

function syncSendButton() {
  const sendBtn = qs('#sendBtn');
  if (!sendBtn) return;
  sendBtn.disabled = state.loading || !currentDraft();
}

function persistDraft(value) {
  state.chatDraft = String(value || '');
  localStorage.setItem('kokokara_web_draft', state.chatDraft);
  syncSendButton();
}

function beginViewRequest() {
  state.viewRequestId = Number(state.viewRequestId || 0) + 1;
  return state.viewRequestId;
}

function isCurrentViewRequest(requestId) {
  return !requestId || Number(requestId) === Number(state.viewRequestId || 0);
}

function isStale(ms = 90 * 1000) {
  if (!state.lastLoadedAt) return true;
  return Date.now() - state.lastLoadedAt.getTime() > ms;
}

function autoResizeChatInput() {
  const input = qs('#chatInput');
  if (!input) return;
  input.style.height = 'auto';
  input.style.height = `${Math.min(Math.max(input.scrollHeight, 88), 220)}px`;
}

function markLoaded() {
  state.lastLoadedAt = new Date();
  const text = state.lastLoadedAt.toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit' });
  const sessionInfo = state.sessionExpiresAt ? ` / 接続期限 ${String(state.sessionExpiresAt).slice(0, 16).replace('T', ' ')}` : '';
  qs('#sessionInfo').textContent = state.profile ? `最終更新 ${text}${sessionInfo}` : '';
}

function setLiveState(status = 'off', message = '') {
  state.realtime.status = status;
  const el = qs('#liveState');
  if (!el) return;
  el.className = 'small live-state';
  if (status === 'ok') el.classList.add('ok');
  if (status === 'waiting') el.classList.add('waiting');
  if (status === 'off') el.classList.add('off');
  el.textContent = message || (status === 'ok' ? 'ライブ同期中' : status === 'waiting' ? 'ライブ同期を再接続しています' : 'ライブ同期は未接続です');
}

function closeRealtime() {
  if (state.realtime.source) {
    try { state.realtime.source.close(); } catch (_error) {}
  }
  state.realtime.source = null;
  setLiveState(state.token ? 'waiting' : 'off');
}

function connectRealtime() {
  if (!state.token || typeof window.EventSource === 'undefined') {
    setLiveState(state.token ? 'waiting' : 'off');
    return;
  }
  closeRealtime();
  const source = new EventSource(`/api/web/events?token=${encodeURIComponent(state.token)}`);
  state.realtime.source = source;
  setLiveState('waiting', 'ライブ同期を接続しています…');

  source.addEventListener('connected', async (event) => {
    setLiveState('ok', 'ライブ同期中');
    try {
      const payload = JSON.parse(event.data || '{}');
      if (payload?.sync) rememberSyncState(payload.sync);
    } catch (_error) {}
  });

  source.addEventListener('sync', async (event) => {
    try {
      const payload = JSON.parse(event.data || '{}');
      if (payload?.sync) await refreshFromSyncStatus(payload.sync);
      else if (payload?.version) await refreshFromSyncStatus(payload);
    } catch (_error) {}
  });

  source.addEventListener('ping', () => {
    if (state.realtime.status !== 'ok') setLiveState('ok', 'ライブ同期中');
  });

  source.onerror = () => {
    setLiveState('waiting', 'ライブ同期を再接続しています…');
  };
}


function setStatus(text, variant = 'default') {
  const el = qs('#statusStrip');
  el.textContent = text || '準備しています…';
  el.className = 'status-strip';
  if (variant === 'error') el.classList.add('error');
  if (variant === 'success') el.classList.add('success');
}

function setLoading(flag, text = '') {
  state.loading = Boolean(flag);
  qs('#connectBtn').disabled = state.loading;
  qs('#refreshBtn').disabled = state.loading;
  syncSendButton();
  if (text) setStatus(text, 'default');
}

function resetAuthState(message = '接続が切れました。もう一度コードを入力してください。') {
  localStorage.removeItem('kokokara_web_token');
  state.token = '';
  state.profile = null;
  state.sessionExpiresAt = null;
  state.bootstrapped = false;
  state.syncVersion = '';
  state.syncState = { version: '', scopeVersions: { chat: '', records: '', home: '' }, hint: '' };
  state.pendingSync = null;
  state.pendingSyncCount = 0;
  state.cache = { home: null, sidebar: null, recordsOverview: null, starters: [] };
  clearVisitMarkers();
  closeRealtime();
  renderProfile();
  qs('#connectPanel').hidden = false;
  qsa('.view-panel').forEach((panel) => { panel.hidden = true; });
  setMessage(message, true);
  setStatus(message, 'error');
  syncSendButton();
}

async function api(path, options = {}) {
  const headers = { 'Content-Type': 'application/json', ...(options.headers || {}) };
  if (state.token) headers.Authorization = `Bearer ${state.token}`;
  const res = await fetch(`/api/web${path}`, { ...options, headers });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || data.ok === false) {
    const message = data.message || '通信でエラーが起きました。';
    const error = new Error(message);
    error.status = res.status || 500;
    if (res.status === 401) error.isAuthError = true;
    throw error;
  }
  return data;
}

async function validateSessionToken() {
  if (!state.token) return null;
  try {
    return await api('/me');
  } catch (error) {
    if (error.isAuthError) {
      resetAuthState(error.message || '接続が切れました。もう一度コードを入力してください。');
      return null;
    }
    throw error;
  }
}

function setMessage(text, isError = false) {
  const el = qs('#connectMessage');
  el.textContent = text;
  el.style.color = isError ? '#b91c1c' : '#6b7280';
}

function renderProfile() {
  const box = qs('#profileCard');
  const logoutBtn = qs('#logoutBtn');
  const refreshBtn = qs('#refreshBtn');
  if (!state.profile) {
    box.textContent = '未接続です';
    qs('#sessionInfo').textContent = '';
    logoutBtn.hidden = true;
    refreshBtn.hidden = true;
    return;
  }
  box.innerHTML = `接続済み<br>${escapeHtml(state.profile.displayName || 'ここから。ユーザー')}`;
  logoutBtn.hidden = false;
  refreshBtn.hidden = false;
  markLoaded();
}

function showView(view) {
  state.currentView = view;
  localStorage.setItem('kokokara_web_view', view);
  qsa('.nav-btn').forEach((btn) => btn.classList.toggle('active', btn.dataset.view === view));
  qsa('.view-panel').forEach((panel) => { panel.hidden = true; });
  qs('#connectPanel').hidden = Boolean(state.token);
  if (state.token) qs(`#${view}View`).hidden = false;
  if (view === 'chat') {
    autoResizeChatInput();
    syncSendButton();
  }
}

function renderStarterChips(prompts = []) {
  const row = qs('#starterRow');
  const usable = Array.isArray(prompts) && prompts.length ? prompts : [
    '今日の流れを見て、今いちばん意識することを教えて',
    '最近の食事の傾向をやさしく整理して',
    '体重の流れをどう受け止めればいいか教えて'
  ];
  state.cache.starters = usable;
  row.innerHTML = usable.map((prompt) => `<button class="starter-chip" data-prompt="${escapeHtml(prompt)}">${escapeHtml(prompt)}</button>`).join('');
  qsa('.starter-chip').forEach((btn) => btn.addEventListener('click', () => {
    const prompt = btn.dataset.prompt || '';
    qs('#chatInput').value = prompt;
    persistDraft(prompt);
    autoResizeChatInput();
    qs('#chatInput').focus();
  }));
}

function renderCareFocus(items = []) {
  const box = qs('#careFocusGrid');
  const usable = Array.isArray(items) ? items.filter(Boolean).slice(0, 3) : [];
  if (!usable.length) {
    box.innerHTML = '';
    return;
  }
  box.innerHTML = usable.map((item) => `
    <div class="care-focus-card">
      <h3>${escapeHtml(item.title || '今日の見方')}</h3>
      <p>${escapeHtml(item.body || '')}</p>
      ${item.prompt ? `<button class="mini-btn care-focus-btn" data-prompt="${escapeHtml(item.prompt)}">このことを相談する</button>` : ''}
    </div>
  `).join('');
  qsa('.care-focus-btn').forEach((btn) => btn.addEventListener('click', () => {
    const prompt = btn.dataset.prompt || '';
    fillChatPrompt(prompt);
  }));
}


function fillChatPrompt(prompt, options = {}) {
  const requestId = options.requestId || beginViewRequest();
  showView('chat');
  const applyPrompt = async () => {
    try {
      setLoading(true, options.loadingText || '相談画面を開いています…');
      await loadChat(requestId);
      if (!isCurrentViewRequest(requestId)) return;
      qs('#chatInput').value = prompt;
      persistDraft(prompt);
      autoResizeChatInput();
      qs('#chatInput').focus();
      setStatus(options.successText || '相談の入口を用意しました。', 'success');
    } catch (error) {
      if (error.isAuthError) return resetAuthState(error.message);
      setStatus(error.message || '相談画面を開けませんでした。', 'error');
    } finally {
      setLoading(false);
    }
  };
  applyPrompt();
}

function renderConsultLanes(targetId, items = []) {
  const box = qs(`#${targetId}`);
  if (!box) return;
  const usable = Array.isArray(items) ? items.filter(Boolean).slice(0, 4) : [];
  if (!usable.length) {
    box.innerHTML = '';
    return;
  }
  box.innerHTML = usable.map((item) => `
    <div class="consult-lane-card">
      <h3>${escapeHtml(item.title || '相談の入口')}</h3>
      <p>${escapeHtml(item.body || '')}</p>
      <button class="mini-btn consult-lane-btn" data-prompt="${escapeHtml(item.prompt || '')}">ここから相談する</button>
    </div>
  `).join('');
  box.querySelectorAll('.consult-lane-btn').forEach((btn) => btn.addEventListener('click', () => {
    const prompt = btn.dataset.prompt || '';
    fillChatPrompt(prompt);
  }));
}

function renderTimeline(targetId, items = []) {
  const box = qs(`#${targetId}`);
  if (!box) return;
  const usable = Array.isArray(items) ? items.filter(Boolean).slice(0, 8) : [];
  if (!usable.length) {
    box.innerHTML = '<div class="empty">最近の流れはまだ少なめです。LINEやWEBで記録や相談を重ねると、ここに流れが見えてきます。</div>';
    return;
  }
  box.innerHTML = usable.map((item) => `
    <div class="timeline-item">
      <div class="timeline-meta"><span>${escapeHtml(item.label || '')}</span><span>${escapeHtml(item.date || '')}</span></div>
      <div class="timeline-title">${escapeHtml(item.title || '')}</div>
      <div class="timeline-summary">${escapeHtml(item.summary || '')}</div>
    </div>
  `).join('');
}

function renderProgressSnapshot(snapshot = {}) {
  const box = qs('#progressSnapshot');
  if (!box) return;
  if (!snapshot || (!snapshot.headline && !snapshot.body)) {
    box.innerHTML = '<div class="empty">記録や相談が重なると、ここに続けられている流れが見えてきます。</div>';
    return;
  }
  const metrics = [
    snapshot.streakDays ? `${snapshot.streakDays}日連続で接点あり` : '',
    snapshot.touchDays7 != null ? `直近7日で${snapshot.touchDays7}日触れています` : '',
    snapshot.recentEvents ? `最近の記録・相談 ${snapshot.recentEvents}件` : ''
  ].filter(Boolean);
  box.innerHTML = `
    <div class="progress-snapshot">
      ${snapshot.badge ? `<div class="progress-badge">${escapeHtml(snapshot.badge)}</div>` : ''}
      <div class="progress-headline">${escapeHtml(snapshot.headline || '')}</div>
      <div class="progress-body">${escapeHtml(snapshot.body || '')}</div>
      <div class="progress-metrics">${metrics.map((item) => `<span class="metric-chip">${escapeHtml(item)}</span>`).join('')}</div>
    </div>
  `;
}

function renderSmallWins(items = [], note = '') {
  const box = qs('#smallWins');
  const noteEl = qs('#reassuranceNote');
  if (box) {
    const usable = Array.isArray(items) ? items.filter(Boolean).slice(0, 3) : [];
    box.innerHTML = usable.length
      ? `<div class="small-wins">${usable.map((item) => `<div class="small-win-item">${escapeHtml(item)}</div>`).join('')}</div>`
      : '<div class="empty">今日はここから一つ整えられれば十分です。</div>';
  }
  if (noteEl) noteEl.textContent = note || '';
}

function renderChatReflection(reflection = {}) {
  const box = qs('#chatReflection');
  if (!box) return;
  const items = [
    ['受け止め', reflection.received],
    ['見方', reflection.perspective],
    ['次の一歩', reflection.nextStep]
  ].filter(([, value]) => value);
  box.innerHTML = items.length
    ? `<div class="chat-reflection">${items.map(([label, value]) => `<div class="reflection-row"><div class="reflection-label">${escapeHtml(label)}</div><div>${escapeHtml(value)}</div></div>`).join('')}</div>`
    : '<div class="empty">相談を始めると、ここに今の見方が整理されます。</div>';
}

function renderFollowupPrompts(items = []) {
  const box = qs('#followupPrompts');
  if (!box) return;
  const usable = Array.isArray(items) ? items.filter(Boolean).slice(0, 4) : [];
  box.innerHTML = usable.length
    ? usable.map((item) => `<button class="followup-chip" data-followup="${escapeHtml(item)}">${escapeHtml(item)}</button>`).join('')
    : '<div class="empty">相談の流れができると、次に聞きやすいことがここに出ます。</div>';
  box.querySelectorAll('.followup-chip').forEach((btn) => btn.addEventListener('click', () => {
    fillChatPrompt(btn.dataset.followup || '', { loadingText: '相談の流れを開いています…', successText: '次の聞き方を用意しました。' });
  }));
}

function syncStatusNotice(text) {
  const message = text || 'LINEで新しい更新があります。必要に応じて最新状態へ反映します。';
  setStatus(message, 'default');
  const el = qs('#statusStrip');
  el.innerHTML = `<span class="pulse-dot"></span>${escapeHtml(message)}`;
  el.classList.add('notice');
}

function hasActiveTyping() {
  const draft = currentDraft();
  return state.currentView === 'chat' && Boolean(draft);
}

function renderSupportMode(targetId, mode = {}) {
  const box = qs(`#${targetId}`);
  if (!box) return;
  if (!mode || (!mode.headline && !mode.body)) {
    box.innerHTML = '<div class="empty">今の過ごし方の目安が、ここにやさしく出てきます。</div>';
    return;
  }
  const signals = Array.isArray(mode.signals) ? mode.signals.filter(Boolean).slice(0, 3) : [];
  const tone = ['rest', 'steady', 'forward'].includes(mode.tone) ? mode.tone : 'steady';
  box.innerHTML = `
    <div class="support-mode">
      ${mode.label ? `<div class="support-mode-badge ${tone}">${escapeHtml(mode.label)}</div>` : ''}
      ${mode.headline ? `<div class="support-mode-headline">${escapeHtml(mode.headline)}</div>` : ''}
      ${mode.body ? `<div class="support-mode-body">${escapeHtml(mode.body)}</div>` : ''}
      ${signals.length ? `<div class="support-mode-signals">${signals.map((item) => `<div class="support-mode-signal">${escapeHtml(item)}</div>`).join('')}</div>` : ''}
      ${mode.prompt ? `<button class="mini-btn support-mode-btn" data-prompt="${escapeHtml(mode.prompt)}">${escapeHtml(mode.actionLabel || 'この流れで相談する')}</button>` : ''}
    </div>
  `;
  box.querySelectorAll('.support-mode-btn').forEach((btn) => btn.addEventListener('click', () => fillChatPrompt(btn.dataset.prompt || '')));
}

function renderStuckPrompts(targetId, prompts = []) {
  const box = qs(`#${targetId}`);
  if (!box) return;
  const usable = Array.isArray(prompts) ? prompts.filter(Boolean).slice(0, 5) : [];
  if (!usable.length) {
    box.innerHTML = '<div class="empty">相談に迷った時の入口が、ここに出てきます。</div>';
    return;
  }
  box.innerHTML = `<div class="stuck-prompt-list">${usable.map((item) => `<button class="stuck-prompt-chip" data-stuck-prompt="${escapeHtml(item)}">${escapeHtml(item)}</button>`).join('')}</div>`;
  box.querySelectorAll('.stuck-prompt-chip').forEach((btn) => btn.addEventListener('click', () => fillChatPrompt(btn.dataset.stuckPrompt || '', { loadingText: '相談の入口を開いています…', successText: 'そのまま相談を始められます。' })));
}


function renderReturnDigest(targetId, digest = {}) {
  const box = qs(`#${targetId}`);
  if (!box) return;
  if (!digest || (!digest.headline && !(Array.isArray(digest.bullets) && digest.bullets.length))) {
    box.innerHTML = '<div class="empty">最近の流れが増えると、ここに今見ておきたい変化がまとまって出てきます。</div>';
    return;
  }
  const bullets = Array.isArray(digest.bullets) ? digest.bullets.filter(Boolean).slice(0, 4) : [];
  box.innerHTML = `
    <div class="return-digest">
      ${digest.badge ? `<div class="return-digest-badge">${escapeHtml(digest.badge)}</div>` : ''}
      ${digest.headline ? `<div class="return-digest-headline">${escapeHtml(digest.headline)}</div>` : ''}
      ${digest.body ? `<div class="return-digest-body">${escapeHtml(digest.body)}</div>` : ''}
      ${bullets.length ? `<div class="return-digest-bullets">${bullets.map((item) => `<div class="return-digest-item">${escapeHtml(item)}</div>`).join('')}</div>` : ''}
      ${digest.prompt ? `<button class="mini-btn return-digest-btn" data-prompt="${escapeHtml(digest.prompt)}">この流れを相談する</button>` : ''}
    </div>
  `;
  box.querySelectorAll('.return-digest-btn').forEach((btn) => btn.addEventListener('click', () => fillChatPrompt(btn.dataset.prompt || '')));
}

function renderSinceDigest(targetId, digest = {}) {
  const box = qs(`#${targetId}`);
  if (!box) return;
  const bullets = Array.isArray(digest.bullets) ? digest.bullets.filter(Boolean).slice(0, 5) : [];
  const recent = Array.isArray(digest.recent) ? digest.recent.filter(Boolean).slice(0, 3) : [];
  if (!digest || (!digest.headline && !bullets.length && !recent.length)) {
    box.innerHTML = '<div class="empty">前回から増えたことがある時、ここにやさしく出てきます。</div>';
    return;
  }
  box.innerHTML = `
    <div class="since-digest">
      ${digest.badge ? `<div class="since-digest-badge">${escapeHtml(digest.badge)}</div>` : ''}
      ${digest.headline ? `<div class="since-digest-headline">${escapeHtml(digest.headline)}</div>` : ''}
      ${digest.body ? `<div class="since-digest-body">${escapeHtml(digest.body)}</div>` : ''}
      ${bullets.length ? `<div class="since-digest-bullets">${bullets.map((item) => `<div class="since-digest-item">${escapeHtml(item)}</div>`).join('')}</div>` : ''}
      ${recent.length ? `<div class="since-digest-list">${recent.map((item) => `<div class="since-digest-row">${escapeHtml(item)}</div>`).join('')}</div>` : ''}
      ${digest.prompt ? `<button class="mini-btn since-digest-btn" data-prompt="${escapeHtml(digest.prompt)}">${escapeHtml(digest.actionLabel || 'この増え方を相談する')}</button>` : ''}
    </div>
  `;
  box.querySelectorAll('.since-digest-btn').forEach((btn) => btn.addEventListener('click', () => fillChatPrompt(btn.dataset.prompt || '')));
}

function renderMicroStep(targetId, micro = {}) {
  const box = qs(`#${targetId}`);
  if (!box) return;
  if (!micro || (!micro.headline && !(Array.isArray(micro.steps) && micro.steps.length))) {
    box.innerHTML = '<div class="empty">ここに、今すぐ負担を増やさずにできる小さな一歩が出てきます。</div>';
    return;
  }
  const steps = Array.isArray(micro.steps) ? micro.steps.filter(Boolean).slice(0, 4) : [];
  box.innerHTML = `
    <div class="micro-step">
      ${micro.label ? `<div class="micro-step-badge">${escapeHtml(micro.label)}</div>` : ''}
      ${micro.headline ? `<div class="micro-step-headline">${escapeHtml(micro.headline)}</div>` : ''}
      ${micro.body ? `<div class="micro-step-body">${escapeHtml(micro.body)}</div>` : ''}
      ${steps.length ? `<div class="micro-step-list">${steps.map((item) => `<div class="micro-step-item">${escapeHtml(item)}</div>`).join('')}</div>` : ''}
      ${micro.prompt ? `<button class="mini-btn micro-step-btn" data-prompt="${escapeHtml(micro.prompt)}">${escapeHtml(micro.actionLabel || 'この一歩から相談する')}</button>` : ''}
    </div>
  `;
  box.querySelectorAll('.micro-step-btn').forEach((btn) => btn.addEventListener('click', () => fillChatPrompt(btn.dataset.prompt || '')));
}


function renderConsultationCarry(targetId, carry = {}) {
  const box = qs(`#${targetId}`);
  if (!box) return;
  const clarified = Array.isArray(carry.clarified) ? carry.clarified.filter(Boolean).slice(0, 3) : [];
  const canWait = Array.isArray(carry.canWait) ? carry.canWait.filter(Boolean).slice(0, 2) : [];
  const remember = Array.isArray(carry.remember) ? carry.remember.filter(Boolean).slice(0, 2) : [];
  if (!carry || (!carry.headline && !clarified.length && !canWait.length && !remember.length)) {
    box.innerHTML = '<div class="empty">相談や記録を重ねると、ここに「今日はここまでで十分」という整理が出てきます。</div>';
    return;
  }
  box.innerHTML = `
    <div class="consultation-carry">
      ${carry.headline ? `<div class="consultation-carry-headline">${escapeHtml(carry.headline)}</div>` : ''}
      ${carry.body ? `<div class="consultation-carry-body">${escapeHtml(carry.body)}</div>` : ''}
      ${clarified.length ? `<div class="consultation-carry-group"><div class="consultation-carry-label">整理できていること</div>${clarified.map((item) => `<div class="consultation-carry-item">${escapeHtml(item)}</div>`).join('')}</div>` : ''}
      ${canWait.length ? `<div class="consultation-carry-group"><div class="consultation-carry-label">今日ぜんぶ決めなくてよいこと</div>${canWait.map((item) => `<div class="consultation-carry-item soft">${escapeHtml(item)}</div>`).join('')}</div>` : ''}
      ${remember.length ? `<div class="consultation-carry-group"><div class="consultation-carry-label">覚えておくと楽なこと</div>${remember.map((item) => `<div class="consultation-carry-item keep">${escapeHtml(item)}</div>`).join('')}</div>` : ''}
      ${carry.prompt ? `<button class="mini-btn consultation-carry-btn" data-prompt="${escapeHtml(carry.prompt)}">${escapeHtml(carry.actionLabel || 'この整理を相談する')}</button>` : ''}
    </div>
  `;
  box.querySelectorAll('.consultation-carry-btn').forEach((btn) => btn.addEventListener('click', () => fillChatPrompt(btn.dataset.prompt || '', { loadingText: 'ここまでの整理から相談を開いています…', successText: 'ここまでの整理をそのまま相談できます。' })));
}

function renderReturnAnchor(targetId, anchor = {}) {
  const box = qs(`#${targetId}`);
  if (!box) return;
  if (!anchor || (!anchor.headline && !(Array.isArray(anchor.anchors) && anchor.anchors.length))) {
    box.innerHTML = '<div class="empty">今の状態に合う戻りやすい形が、ここにやさしく出てきます。</div>';
    return;
  }
  const anchors = Array.isArray(anchor.anchors) ? anchor.anchors.filter(Boolean).slice(0, 4) : [];
  box.innerHTML = `
    <div class="return-anchor">
      ${anchor.badge ? `<div class="return-anchor-badge">${escapeHtml(anchor.badge)}</div>` : ''}
      ${anchor.headline ? `<div class="return-anchor-headline">${escapeHtml(anchor.headline)}</div>` : ''}
      ${anchor.body ? `<div class="return-anchor-body">${escapeHtml(anchor.body)}</div>` : ''}
      ${anchors.length ? `<div class="return-anchor-list">${anchors.map((item) => `<div class="return-anchor-item">${escapeHtml(item)}</div>`).join('')}</div>` : ''}
      ${anchor.prompt ? `<button class="mini-btn return-anchor-btn" data-prompt="${escapeHtml(anchor.prompt)}">${escapeHtml(anchor.actionLabel || '戻りやすい形を相談する')}</button>` : ''}
    </div>
  `;
  box.querySelectorAll('.return-anchor-btn').forEach((btn) => btn.addEventListener('click', () => fillChatPrompt(btn.dataset.prompt || '', { loadingText: '戻りやすい形から相談を開いています…', successText: '戻りやすい形をそのまま相談できます。' })));
}

function renderActionPlan(items = []) {
  const box = qs('#actionPlan');
  if (!box) return;
  const usable = Array.isArray(items) ? items.filter(Boolean).slice(0, 3) : [];
  if (!usable.length) {
    box.innerHTML = '<div class="empty">いまの流れに応じた進め方が、ここに出てきます。</div>';
    return;
  }
  box.innerHTML = usable.map((item) => `
    <div class="action-plan-step">
      <div class="action-plan-slot">${escapeHtml(item.slot || '今')}</div>
      <div class="action-plan-title">${escapeHtml(item.title || '')}</div>
      <div class="action-plan-body">${escapeHtml(item.body || '')}</div>
      ${item.prompt ? `<button class="mini-btn action-plan-btn" data-prompt="${escapeHtml(item.prompt)}">この流れで相談する</button>` : ''}
    </div>
  `).join('');
  qsa('.action-plan-btn').forEach((btn) => btn.addEventListener('click', () => fillChatPrompt(btn.dataset.prompt || '')));
}


function renderSupportCompass(targetId, compass = {}) {
  const box = qs(`#${targetId}`);
  if (!box) return;
  if (!compass || (!compass.headline && !(Array.isArray(compass.anchors) && compass.anchors.length))) {
    box.innerHTML = '<div class="empty">相談を重ねると、ここに今の相談の土台が見えてきます。</div>';
    return;
  }
  const anchors = Array.isArray(compass.anchors) ? compass.anchors.filter(Boolean).slice(0, 4) : [];
  box.innerHTML = `
    <div class="support-compass">
      ${compass.headline ? `<div class="support-compass-headline">${escapeHtml(compass.headline)}</div>` : ''}
      ${compass.body ? `<div class="support-compass-body">${escapeHtml(compass.body)}</div>` : ''}
      ${anchors.length ? `<div class="support-anchor-list">${anchors.map((item) => `<div class="support-anchor-item"><div class="support-anchor-label">${escapeHtml(item.label || '')}</div><div>${escapeHtml(item.value || '')}</div></div>`).join('')}</div>` : ''}
      ${compass.prompt ? `<button class="mini-btn support-compass-btn" data-prompt="${escapeHtml(compass.prompt)}">この土台で相談する</button>` : ''}
    </div>
  `;
  box.querySelectorAll('.support-compass-btn').forEach((btn) => btn.addEventListener('click', () => fillChatPrompt(btn.dataset.prompt || '')));
}

function renderReentryGuide(targetId, guide = {}) {
  const box = qs(`#${targetId}`);
  if (!box) return;
  if (!guide || (!guide.headline && !guide.body)) {
    box.innerHTML = '<div class="empty">ここを開いた時の入り方が、ここにやさしく出てきます。</div>';
    return;
  }
  const steps = Array.isArray(guide.steps) ? guide.steps.filter(Boolean).slice(0, 3) : [];
  box.innerHTML = `
    <div class="reentry-guide">
      ${guide.headline ? `<div class="reentry-headline">${escapeHtml(guide.headline)}</div>` : ''}
      ${guide.body ? `<div class="reentry-body">${escapeHtml(guide.body)}</div>` : ''}
      ${steps.length ? `<div class="reentry-step-list">${steps.map((step) => `<div class="reentry-step">${escapeHtml(step)}</div>`).join('')}</div>` : ''}
      ${guide.prompt ? `<button class="mini-btn reentry-guide-btn" data-prompt="${escapeHtml(guide.prompt)}">この流れで相談する</button>` : ''}
    </div>
  `;
  box.querySelectorAll('.reentry-guide-btn').forEach((btn) => btn.addEventListener('click', () => fillChatPrompt(btn.dataset.prompt || '')));
}

function renderConversationBridge(targetId, bridge = {}) {
  const box = qs(`#${targetId}`);
  if (!box) return;
  if (!bridge || (!bridge.headline && !bridge.body && !bridge.userTopic && !bridge.assistantSupport)) {
    box.innerHTML = '<div class="empty">最近の相談が増えると、ここに続きから話しやすい流れが出てきます。</div>';
    return;
  }
  box.innerHTML = `
    <div class="bridge-card">
      ${bridge.badge ? `<div class="bridge-badge">${escapeHtml(bridge.badge)}</div>` : ''}
      ${bridge.headline ? `<div class="bridge-headline">${escapeHtml(bridge.headline)}</div>` : ''}
      ${bridge.body ? `<div class="bridge-body">${escapeHtml(bridge.body)}</div>` : ''}
      ${bridge.userTopic ? `<div class="bridge-block"><div class="bridge-label">前回の相談</div><div>${escapeHtml(bridge.userTopic)}</div></div>` : ''}
      ${bridge.assistantSupport ? `<div class="bridge-block"><div class="bridge-label">AI牛込の返し</div><div>${escapeHtml(bridge.assistantSupport)}</div></div>` : ''}
      ${bridge.continuePrompt ? `<button class="mini-btn bridge-continue-btn" data-prompt="${escapeHtml(bridge.continuePrompt)}">この続きから相談する</button>` : ''}
    </div>
  `;
  box.querySelectorAll('.bridge-continue-btn').forEach((btn) => btn.addEventListener('click', () => fillChatPrompt(btn.dataset.prompt || '', { loadingText: '前回の流れを開いています…', successText: '前回の流れから相談を始められます。' })));
}

function renderResumePrompts(targetId, prompts = []) {
  const box = qs(`#${targetId}`);
  if (!box) return;
  const usable = Array.isArray(prompts) ? prompts.filter(Boolean).slice(0, 4) : [];
  if (!usable.length) {
    box.innerHTML = '<div class="empty">ここまでの相談や記録が重なると、続きから話しやすい入口がここに出ます。</div>';
    return;
  }
  box.innerHTML = usable.map((item) => `<button class="resume-prompt-chip" data-resume-prompt="${escapeHtml(item)}">${escapeHtml(item)}</button>`).join('');
  box.querySelectorAll('.resume-prompt-chip').forEach((btn) => btn.addEventListener('click', () => {
    fillChatPrompt(btn.dataset.resumePrompt || '', { loadingText: '前回からつながる相談を開いています…', successText: '前回の流れから相談を始められます。' });
  }));
}

function renderHome(data) {
  state.cache.home = data;
  qs('#todayDateLabel').textContent = data.todayYmd || '';
  qs('#todaySummary').textContent = data.todaySummary || '今日はここから整えていける日です。';
  qs('#mealStatus').innerHTML = `朝: ${data.mealStatus?.breakfast ? 'あり' : 'なし'}<br>昼: ${data.mealStatus?.lunch ? 'あり' : 'なし'}<br>夜: ${data.mealStatus?.dinner ? 'あり' : 'なし'}`;
  qs('#weightStatus').innerHTML = data.weightStatus?.latestValue != null
    ? `体重: ${data.weightStatus.latestValue}kg${data.weightStatus.latestBodyFat != null ? ` / 体脂肪 ${data.weightStatus.latestBodyFat}%` : ''}<br><span class="small">${data.weightStatus.recordedToday ? '今日は入力済み' : `最新日 ${data.weightStatus.latestDate || ''}`}</span>`
    : '体重記録はまだありません';
  const alerts = Array.isArray(data.alerts) && data.alerts.length ? data.alerts : ['大きく崩れてはいません'];
  qs('#alertList').innerHTML = alerts.map((item) => `<li>${escapeHtml(item)}</li>`).join('');
  qs('#aiNote').textContent = data.aiNote || '今日は一つだけ整えられれば十分です。';
  const lines = Array.isArray(data.fullSummary) ? data.fullSummary.slice(0, 3) : [];
  qs('#summaryLines').innerHTML = lines.length
    ? lines.map((line) => `<div class="summary-line">${escapeHtml(line)}</div>`).join('')
    : '';
  renderProgressSnapshot(data.progressSnapshot || {});
  renderSmallWins(data.smallWins || [], data.reassuranceNote || '');
  renderSupportMode('supportModeHome', data.supportMode || {});
  renderStuckPrompts('stuckPromptsHome', data.stuckPrompts || []);
  renderReturnDigest('returnDigestHome', data.returnDigest || {});
  renderSinceDigest('sinceDigestHome', data.sinceDigest || {});
  renderMicroStep('microStepHome', data.microStep || {});
  renderActionPlan(data.actionPlan || []);
  renderConsultationCarry('consultationCarryHome', data.consultationCarry || {});
  renderReturnAnchor('returnAnchorHome', data.returnAnchor || {});
  renderSupportCompass('supportCompassHome', data.supportCompass || {});
  renderResumePrompts('resumePromptsHome', data.resumePrompts || []);
  renderReentryGuide('reentryGuideHome', data.reentryGuide || {});
  renderConversationBridge('conversationBridgeHome', data.conversationBridge || {});
  if (data.starters) renderStarterChips(data.starters);
  renderCareFocus(data.careFocus || []);
  renderConsultLanes('consultLanesHome', data.consultLanes || []);
  renderTimeline('timelineHome', data.recentTimeline || []);
}

function appendChat(role, text, metaText = '', pending = false) {
  const log = qs('#chatLog');
  const div = document.createElement('div');
  div.className = `chat-bubble ${role}${pending ? ' pending' : ''}`;
  div.textContent = text;
  log.appendChild(div);
  if (metaText) {
    const meta = document.createElement('div');
    meta.className = 'chat-bubble meta';
    meta.textContent = metaText;
    log.appendChild(meta);
  }
  log.scrollTop = log.scrollHeight;
  return div;
}

function renderChatHistory(messages) {
  const log = qs('#chatLog');
  log.innerHTML = '';
  if (!messages.length) {
    appendChat('assistant', 'ここから相談を始められます。');
    return;
  }
  messages.forEach((msg) => appendChat(msg.role === 'user' ? 'user' : 'assistant', msg.text, msg.sourceChannel === 'line' ? 'LINEの会話履歴' : 'WEBの会話履歴'));
}

function renderSidebar(data) {
  state.cache.sidebar = data;
  qs('#sideCards').innerHTML = `
    <div class="side-card"><h3>今日のまとめ</h3><p>${escapeHtml(data.todaySummary || '')}</p></div>
    <div class="side-card"><h3>直近の食事</h3>${(data.recentMeals || []).length ? `<ul>${data.recentMeals.map((item) => `<li>${escapeHtml(item)}</li>`).join('')}</ul>` : '<div class="empty">まだありません</div>'}</div>
    <div class="side-card"><h3>直近体重</h3><p>${data.latestWeight?.value != null ? `${data.latestWeight.value}kg${data.latestWeight.bodyFat != null ? ` / 体脂肪 ${data.latestWeight.bodyFat}%` : ''}` : 'まだありません'}</p></div>
    <div class="side-card"><h3>最新検査メモ</h3><p>${escapeHtml(data.latestLabNote || 'まだありません')}</p></div>
  `;
}

function trendText(trend) {
  if (!trend || trend.delta == null) return '';
  if (trend.direction === 'flat') return `直近${trend.days}日でほぼ横ばい`;
  const prefix = trend.direction === 'up' ? '+' : '';
  return `直近${trend.days}日で ${prefix}${trend.delta}kg`;
}

function renderRecordsOverview(data) {
  state.cache.recordsOverview = data;
  const items = [
    { label: '食事記録', value: data?.mealsCount != null ? `${data.mealsCount}件` : '0件', sub: data?.latestMealDate ? `最新 ${data.latestMealDate}` : 'まだありません' },
    { label: '体重記録', value: data?.latestWeightValue != null ? `${data.latestWeightValue}kg` : '未記録', sub: data?.latestWeightDate ? `最新 ${data.latestWeightDate}` : 'まだありません', trend: trendText(data?.weightTrend) },
    { label: '血液検査', value: data?.latestLabDate || '未登録', sub: data?.latestLabNote || 'まだありません' }
  ];
  qs('#recordsOverview').innerHTML = items.map((item) => `
    <div class="overview-card">
      <div class="label">${escapeHtml(item.label)}</div>
      <div>${escapeHtml(item.value)}</div>
      <div class="small">${escapeHtml(item.sub)}</div>
      ${item.trend ? `<div class="trend-chip">${escapeHtml(item.trend)}</div>` : ''}
    </div>
  `).join('');
}

function renderMeals(items) {
  qs('#tabMeals').innerHTML = items.length ? items.map((item) => `
    <div class="record-item">
      <div class="record-date">${escapeHtml(item.date)} / ${escapeHtml(item.slot)}</div>
      <div>${escapeHtml(item.summary)}</div>
      <div class="small">${item.estimatedKcal != null ? `${item.estimatedKcal}kcal` : ''}</div>
      ${item.comment ? `<div class="small">${escapeHtml(item.comment)}</div>` : ''}
    </div>
  `).join('') : '<div class="empty">食事記録はまだありません。LINEで食事や写真を送ると、ここに増えていきます。</div>';
}

function renderWeights(payload) {
  const latest = payload.latest;
  qs('#tabWeights').innerHTML = `
    ${latest ? `<div class="weight-item"><div class="weight-date">最新</div><div>${latest.value != null ? `${latest.value}kg` : ''}${latest.bodyFat != null ? ` / 体脂肪 ${latest.bodyFat}%` : ''}</div><div class="small">${escapeHtml(latest.date || '')}</div>${payload.trend ? `<div class="trend-chip">${escapeHtml(trendText(payload.trend))}</div>` : ''}</div>` : '<div class="empty">体重記録はまだありません。LINEで体重を送ると、ここで流れを見返せます。</div>'}
    ${(payload.series || []).map((item) => `<div class="weight-item"><div class="weight-date">${escapeHtml(item.date)}</div><div>${item.value != null ? `${item.value}kg` : '-' }${item.bodyFat != null ? ` / 体脂肪 ${item.bodyFat}%` : ''}</div></div>`).join('')}
  `;
}

function renderLabs(payload) {
  const latestBlock = payload.latest ? `<div class="lab-item"><div class="lab-date">最新 ${escapeHtml(payload.latest.examDate || '')}</div><div>${(payload.latest.items || []).map((item) => `${escapeHtml(item.itemName)} ${escapeHtml(item.value)}`).join(' / ')}</div><div class="small">${escapeHtml(payload.latest.summaryNote || '')}</div></div>` : '<div class="empty">血液検査データはまだありません。検査結果を送ると、ここから見返せるようになります。</div>';
  const listBlock = (payload.items || []).map((row) => `<div class="lab-item"><div class="lab-date">${escapeHtml(row.examDate || '')}</div><div>${(row.items || []).map((item) => `${escapeHtml(item.itemName)} ${escapeHtml(item.value)}`).join(' / ')}</div></div>`).join('');
  qs('#tabLabs').innerHTML = `${latestBlock}${listBlock}`;
}

async function loadBootstrap(force = false, requestId = 0) {
  if (!state.token) return null;
  if (state.bootstrapped && !force) return null;
  const sinceQuery = visitSinceQuery();
  const data = await api(`/bootstrap${sinceQuery ? `?${sinceQuery}` : ''}`);
  if (!isCurrentViewRequest(requestId)) return null;
  state.profile = data.profile;
  state.sessionExpiresAt = data.session?.expiresAt || null;
  rememberSyncState(data.sync || {});
  renderProfile();
  const homePayload = { ...(data.home || {}), starters: data.starters || [], consultLanes: data.consultLanes || data.home?.consultLanes || [], recentTimeline: data.recentTimeline || data.home?.recentTimeline || [] };
  renderHome(homePayload);
  renderSidebar(data.sidebar || {});
  renderRecordsOverview(data.recordsOverview || {});
  renderConsultLanes('consultLanesChat', data.consultLanes || data.home?.consultLanes || []);
  renderConsultLanes('consultLanesRecords', data.consultLanes || data.home?.consultLanes || []);
  renderTimeline('timelineRecords', data.recentTimeline || data.home?.recentTimeline || []);
  renderStarterChips(data.starters || []);
  renderSupportMode('supportModeHome', data.supportMode || data.home?.supportMode || {});
  renderSupportMode('supportModeChat', data.supportMode || data.home?.supportMode || {});
  renderSupportMode('supportModeRecords', data.supportMode || data.home?.supportMode || {});
  renderReturnDigest('returnDigestHome', data.returnDigest || data.home?.returnDigest || {});
  renderReturnDigest('returnDigestChat', data.returnDigest || data.home?.returnDigest || {});
  renderSinceDigest('sinceDigestChat', data.sinceDigest || data.home?.sinceDigest || {});
  renderReturnDigest('returnDigestRecords', data.returnDigest || data.home?.returnDigest || {});
  renderSinceDigest('sinceDigestRecords', data.sinceDigest || data.home?.sinceDigest || {});
  renderMicroStep('microStepHome', data.microStep || data.home?.microStep || {});
  renderMicroStep('microStepChat', data.microStep || data.home?.microStep || {});
  renderMicroStep('microStepRecords', data.microStep || data.home?.microStep || {});
  renderConsultationCarry('consultationCarryHome', data.consultationCarry || data.home?.consultationCarry || {});
  renderConsultationCarry('consultationCarryChat', data.consultationCarry || data.home?.consultationCarry || {});
  renderConsultationCarry('consultationCarryRecords', data.consultationCarry || data.home?.consultationCarry || {});
  renderReturnAnchor('returnAnchorHome', data.returnAnchor || data.home?.returnAnchor || {});
  renderReturnAnchor('returnAnchorChat', data.returnAnchor || data.home?.returnAnchor || {});
  renderReturnAnchor('returnAnchorRecords', data.returnAnchor || data.home?.returnAnchor || {});
  renderStuckPrompts('stuckPromptsHome', data.stuckPrompts || data.home?.stuckPrompts || []);
  renderStuckPrompts('stuckPromptsChat', data.stuckPrompts || data.home?.stuckPrompts || []);
  renderStuckPrompts('stuckPromptsRecords', data.stuckPrompts || data.home?.stuckPrompts || []);
  renderSupportCompass('supportCompassHome', data.supportCompass || data.home?.supportCompass || {});
  renderSupportCompass('supportCompassChat', data.supportCompass || data.home?.supportCompass || {});
  renderResumePrompts('resumePromptsHome', data.resumePrompts || data.home?.resumePrompts || []);
  renderResumePrompts('resumePromptsChat', data.resumePrompts || data.home?.resumePrompts || []);
  renderReentryGuide('reentryGuideHome', data.reentryGuide || data.home?.reentryGuide || {});
  renderReentryGuide('reentryGuideChat', data.reentryGuide || data.home?.reentryGuide || {});
  renderReentryGuide('reentryGuideRecords', data.reentryGuide || data.home?.reentryGuide || {});
  renderConversationBridge('conversationBridgeHome', data.conversationBridge || data.home?.conversationBridge || {});
  renderConversationBridge('conversationBridgeChat', data.conversationBridge || data.home?.conversationBridge || {});
  renderConversationBridge('conversationBridgeRecords', data.conversationBridge || data.home?.conversationBridge || {});
  renderChatReflection(data.reflection || {});
  renderFollowupPrompts(data.followups || []);
  qs('#chatStatusLabel').textContent = data.profile?.displayName ? `${data.profile.displayName}さんの相談画面` : '';
  const chatInput = qs('#chatInput');
  if (chatInput) {
    chatInput.value = state.chatDraft || '';
    autoResizeChatInput();
    syncSendButton();
  }
  state.bootstrapped = true;
  markLoaded();
  return data;
}

async function loadHome(requestId = 0) {
  const sinceQuery = visitSinceQuery();
  const data = await api(`/home${sinceQuery ? `?${sinceQuery}` : ''}`);
  if (!isCurrentViewRequest(requestId)) return;
  renderHome(data);
  renderRecordsOverview(data.recordsOverview || state.cache.recordsOverview || {});
  renderStarterChips(data.starters || state.cache.starters || []);
  renderSupportMode('supportModeHome', data.supportMode || state.cache.home?.supportMode || {});
  renderStuckPrompts('stuckPromptsHome', data.stuckPrompts || state.cache.home?.stuckPrompts || []);
  renderReturnDigest('returnDigestHome', data.returnDigest || state.cache.home?.returnDigest || {});
  renderSinceDigest('sinceDigestHome', data.sinceDigest || state.cache.home?.sinceDigest || {});
  renderMicroStep('microStepHome', data.microStep || state.cache.home?.microStep || {});
  renderConsultationCarry('consultationCarryHome', data.consultationCarry || state.cache.home?.consultationCarry || {});
  renderReturnAnchor('returnAnchorHome', data.returnAnchor || state.cache.home?.returnAnchor || {});
  renderSupportCompass('supportCompassHome', data.supportCompass || state.cache.home?.supportCompass || {});
  renderResumePrompts('resumePromptsHome', data.resumePrompts || state.cache.home?.resumePrompts || []);
  renderReentryGuide('reentryGuideHome', data.reentryGuide || state.cache.home?.reentryGuide || {});
  renderConversationBridge('conversationBridgeHome', data.conversationBridge || state.cache.home?.conversationBridge || {});
  renderChatReflection(data.reflection || state.cache.home?.reflection || {});
  renderFollowupPrompts(data.followups || []);
  markLoaded();
}

async function loadChat(requestId = 0) {
  const sinceQuery = visitSinceQuery();
  const payload = await api(`/chat/bundle${sinceQuery ? `?${sinceQuery}` : ''}`);
  if (!isCurrentViewRequest(requestId)) return;
  renderChatHistory(payload.messages || []);
  renderSidebar(payload.sidebar || {});
  renderConsultLanes('consultLanesChat', payload.consultLanes || []);
  renderSupportMode('supportModeChat', payload.supportMode || state.cache.home?.supportMode || {});
  renderStuckPrompts('stuckPromptsChat', payload.stuckPrompts || state.cache.home?.stuckPrompts || []);
  renderSupportCompass('supportCompassChat', payload.supportCompass || state.cache.home?.supportCompass || {});
  renderReturnDigest('returnDigestChat', payload.returnDigest || state.cache.home?.returnDigest || {});
  renderSinceDigest('sinceDigestChat', payload.sinceDigest || state.cache.home?.sinceDigest || {});
  renderMicroStep('microStepChat', payload.microStep || state.cache.home?.microStep || {});
  renderConsultationCarry('consultationCarryChat', payload.consultationCarry || state.cache.home?.consultationCarry || {});
  renderReturnAnchor('returnAnchorChat', payload.returnAnchor || state.cache.home?.returnAnchor || {});
  renderResumePrompts('resumePromptsChat', payload.resumePrompts || state.cache.home?.resumePrompts || []);
  renderReentryGuide('reentryGuideChat', payload.reentryGuide || state.cache.home?.reentryGuide || {});
  renderConversationBridge('conversationBridgeChat', payload.conversationBridge || state.cache.home?.conversationBridge || {});
  renderChatReflection(payload.reflection || {});
  renderFollowupPrompts(payload.followups || []);
  renderActionPlan(payload.actionPlan || state.cache.home?.actionPlan || []);
  markLoaded();
}

async function loadRecords(requestId = 0) {
  const sinceQuery = visitSinceQuery();
  const payload = await api(`/records/bundle?range=${encodeURIComponent(state.recordRange)}&labsLimit=10${sinceQuery ? `&${sinceQuery}` : ''}`);
  if (!isCurrentViewRequest(requestId)) return;
  const overview = payload.overview || {};
  renderRecordsOverview(overview);
  renderConsultLanes('consultLanesRecords', payload.consultLanes || []);
  renderSupportMode('supportModeRecords', payload.supportMode || state.cache.home?.supportMode || {});
  renderStuckPrompts('stuckPromptsRecords', payload.stuckPrompts || state.cache.home?.stuckPrompts || []);
  renderReturnDigest('returnDigestRecords', payload.returnDigest || state.cache.home?.returnDigest || {});
  renderSinceDigest('sinceDigestRecords', payload.sinceDigest || state.cache.home?.sinceDigest || {});
  renderMicroStep('microStepRecords', payload.microStep || state.cache.home?.microStep || {});
  renderConsultationCarry('consultationCarryRecords', payload.consultationCarry || state.cache.home?.consultationCarry || {});
  renderReturnAnchor('returnAnchorRecords', payload.returnAnchor || state.cache.home?.returnAnchor || {});
  renderTimeline('timelineRecords', payload.recentTimeline || []);
  renderReentryGuide('reentryGuideRecords', payload.reentryGuide || state.cache.home?.reentryGuide || {});
  renderConversationBridge('conversationBridgeRecords', payload.conversationBridge || state.cache.home?.conversationBridge || {});
  renderMeals(payload.meals?.items || []);
  renderWeights(payload.weights || {});
  renderLabs({ latest: payload.latestLab || null, items: payload.labs?.items || [] });
  qs('#recordsStatusLabel').textContent = overview.latestMealDate ? `最新の食事 ${overview.latestMealDate}` : '記録が増えるとここに反映されます';
  markLoaded();
}

async function loadCurrentView(force = false, requestId = 0) {
  if (!state.token) return;
  if (force) {
    await loadBootstrap(true, requestId);
    if (!isCurrentViewRequest(requestId) || state.currentView === 'home') return;
  }
  if (state.currentView === 'home') await loadHome(requestId);
  if (state.currentView === 'chat') await loadChat(requestId);
  if (state.currentView === 'records') await loadRecords(requestId);
}

async function applyTargetedSyncRefresh(sync, requestId) {
  const changed = {
    chat: syncScopeChanged('chat', sync),
    records: syncScopeChanged('records', sync),
    home: syncScopeChanged('home', sync)
  };
  const anyChanged = changed.chat || changed.records || changed.home;
  if (!anyChanged) {
    rememberSyncState(sync);
    return { changed: false, summary: '' };
  }

  let loadedHome = false;
  let loadedChat = false;
  let loadedRecords = false;

  if (changed.home && state.currentView === 'home') {
    await loadHome(requestId);
    loadedHome = true;
  } else if (state.currentView === 'chat') {
    if (changed.chat || changed.home) {
      await loadChat(requestId);
      loadedChat = true;
    }
  } else if (state.currentView === 'records') {
    if (changed.records || changed.home) {
      await loadRecords(requestId);
      loadedRecords = true;
    }
  }

  if (state.currentView !== 'home' && changed.home && !loadedHome) {
    const sinceQuery = visitSinceQuery();
    const home = await api(`/home${sinceQuery ? `?${sinceQuery}` : ''}`);
    if (isCurrentViewRequest(requestId)) {
      renderHome(home);
      renderRecordsOverview(home.recordsOverview || state.cache.recordsOverview || {});
      renderStarterChips(home.starters || state.cache.starters || []);
      loadedHome = true;
    }
  }

  if (state.currentView !== 'chat' && changed.chat && !loadedChat) {
    const sinceQuery = visitSinceQuery();
    const chatBundle = await api(`/chat/bundle${sinceQuery ? `?${sinceQuery}` : ''}`);
    if (isCurrentViewRequest(requestId)) {
      renderSidebar(chatBundle.sidebar || {});
      renderSupportCompass('supportCompassChat', chatBundle.supportCompass || state.cache.home?.supportCompass || {});
      renderReturnDigest('returnDigestChat', chatBundle.returnDigest || state.cache.home?.returnDigest || {});
      renderMicroStep('microStepChat', chatBundle.microStep || state.cache.home?.microStep || {});
      renderConsultationCarry('consultationCarryChat', chatBundle.consultationCarry || state.cache.home?.consultationCarry || {});
      renderReturnAnchor('returnAnchorChat', chatBundle.returnAnchor || state.cache.home?.returnAnchor || {});
      renderResumePrompts('resumePromptsChat', chatBundle.resumePrompts || state.cache.home?.resumePrompts || []);
      renderReentryGuide('reentryGuideChat', chatBundle.reentryGuide || state.cache.home?.reentryGuide || {});
      renderConversationBridge('conversationBridgeChat', chatBundle.conversationBridge || state.cache.home?.conversationBridge || {});
      renderChatReflection(chatBundle.reflection || {});
      renderFollowupPrompts(chatBundle.followups || []);
      loadedChat = true;
    }
  }

  if (state.currentView !== 'records' && changed.records && !loadedRecords) {
    const sinceQuery = visitSinceQuery();
    const recordsBundle = await api(`/records/bundle?range=${encodeURIComponent(state.recordRange)}&labsLimit=10${sinceQuery ? `&${sinceQuery}` : ''}`);
    if (isCurrentViewRequest(requestId)) {
      renderRecordsOverview(recordsBundle.overview || state.cache.recordsOverview || {});
      renderReturnDigest('returnDigestRecords', recordsBundle.returnDigest || state.cache.home?.returnDigest || {});
      renderMicroStep('microStepRecords', recordsBundle.microStep || state.cache.home?.microStep || {});
      renderConsultationCarry('consultationCarryRecords', recordsBundle.consultationCarry || state.cache.home?.consultationCarry || {});
      renderReturnAnchor('returnAnchorRecords', recordsBundle.returnAnchor || state.cache.home?.returnAnchor || {});
      renderTimeline('timelineRecords', recordsBundle.recentTimeline || []);
      renderReentryGuide('reentryGuideRecords', recordsBundle.reentryGuide || state.cache.home?.reentryGuide || {});
      renderConversationBridge('conversationBridgeRecords', recordsBundle.conversationBridge || state.cache.home?.conversationBridge || {});
      loadedRecords = true;
    }
  }

  rememberSyncState(sync);
  return {
    changed: true,
    summary: [changed.chat ? '会話' : '', changed.records ? '記録' : '', changed.home ? 'ホーム' : ''].filter(Boolean).join('・')
  };
}


async function refreshFromSyncStatus(sync) {
  const normalized = normalizeSyncPayload(sync);
  const nextVersion = normalized.version || '';
  if (!nextVersion || nextVersion === state.syncVersion) return;
  if (hasActiveTyping()) {
    state.pendingSync = normalized;
    state.pendingSyncCount = Number(state.pendingSyncCount || 0) + 1;
    rememberSyncState({ ...state.syncState, version: nextVersion });
    syncStatusNotice(buildPendingSyncMessage(normalized, state.pendingSyncCount));
    return;
  }
  state.pendingSync = null;
  state.pendingSyncCount = 0;
  const requestId = beginViewRequest();
  try {
    setLoading(true, normalized.reason === 'line_update' ? 'LINEの更新を反映しています…' : '最新状態を反映しています…');
    const result = await applyTargetedSyncRefresh(normalized, requestId);
    if (!isCurrentViewRequest(requestId)) return;
    if (result.changed) {
      const summary = result.summary ? `${result.summary}を更新しました。` : '最新状態を更新しました。';
      setStatus(summary, 'success');
    }
  } catch (error) {
    if (error.isAuthError) return resetAuthState(error.message);
    setStatus(error.message || '同期更新でエラーが起きました。', 'error');
  } finally {
    setLoading(false);
  }
}


async function pollSyncStatus() {
  if (!state.token || state.loading || document.hidden) return;
  try {
    const sync = await api('/sync/status');
    await refreshFromSyncStatus(sync);
  } catch (error) {
    if (error.isAuthError) resetAuthState(error.message);
  }
}

function startSyncPolling() {
  if (state.syncPollHandle) return;
  state.syncPollHandle = window.setInterval(() => {
    pollSyncStatus();
  }, 18000);
}

async function initializeSession(force = false) {
  const requestId = beginViewRequest();
  if (!state.token) {
    closeRealtime();
    showView('home');
    renderProfile();
    setStatus(`LINEで接続コードを発行してから、ここで入力してください。 (${APP_VERSION})`);
    syncSendButton();
    return;
  }
  try {
    setLoading(true, 'WEBの準備をしています…');
    const me = await validateSessionToken();
    if (!me) return;
    state.profile = me.profile || state.profile;
    state.sessionExpiresAt = me.session?.expiresAt || state.sessionExpiresAt;
    renderProfile();
    await loadBootstrap(force, requestId);
    state.pendingSync = null;
    state.pendingSyncCount = 0;
    qs('#connectPanel').hidden = true;
    showView(state.currentView);
    if (!isCurrentViewRequest(requestId)) return;
    if (state.currentView === 'chat') await loadChat(requestId);
    if (state.currentView === 'records') await loadRecords(requestId);
    connectRealtime();
    rememberVisitNow();
    setStatus('最新状態を読み込みました。', 'success');
  } catch (error) {
    if (error.isAuthError) return resetAuthState(error.message);
    if (error.isAuthError) { resetAuthState(error.message); return; }
    setMessage(error.message, true);
    setStatus(error.message, 'error');
  } finally {
    setLoading(false);
  }
}

async function connect() {
  const code = extractCodeCandidate(qs('#codeInput').value).trim();
  if (!code) return setMessage('接続コードを入力してください。', true);
  try {
    setLoading(true, '接続を確認しています…');
    const result = await api('/link/confirm', { method: 'POST', body: JSON.stringify({ code }) });
    state.token = result.sessionToken;
    state.profile = result.profile;
    state.sessionExpiresAt = result.expiresAt || null;
    state.bootstrapped = false;
    localStorage.setItem('kokokara_web_token', state.token);
    renderProfile();
    setMessage(`接続できました。 (${APP_VERSION})`);
    setStatus('接続できました。最新情報を読み込みます。', 'success');
    await initializeSession(true);
    qs('#codeInput').value = '';
    clearCodeFromLocation();
  } catch (error) {
    if (error.isAuthError) { resetAuthState(error.message); return; }
    setMessage(error.message, true);
    setStatus(error.message, 'error');
  } finally {
    setLoading(false);
  }
}

async function sendChat(prefillText = '') {
  const input = qs('#chatInput');
  const text = (prefillText || input.value).trim();
  if (!text || state.loading) return;
  appendChat('user', text, 'WEBから送信');
  const pendingBubble = appendChat('assistant', '考えています…', 'AI牛込', true);
  input.value = '';
  persistDraft('');
  autoResizeChatInput();
  try {
    setLoading(true, '返答を考えています…');
    const result = await api('/chat/send', { method: 'POST', body: JSON.stringify({ message: text }) });
    pendingBubble.remove();
    const assistantText = result.assistantMessage?.text || result.reply || '受け取りました。';
    appendChat('assistant', assistantText, 'AI牛込');
    renderSidebar(result.supportCards || {});
    if (result.homeSnapshot) renderHome({ ...result.homeSnapshot, starters: result.starters || [], consultLanes: result.homeSnapshot.consultLanes || [], recentTimeline: result.homeSnapshot.recentTimeline || [] });
    renderRecordsOverview(result.recordsOverview || state.cache.recordsOverview || {});
    renderConsultLanes('consultLanesChat', result.homeSnapshot?.consultLanes || []);
    renderConsultLanes('consultLanesRecords', result.homeSnapshot?.consultLanes || []);
    renderTimeline('timelineHome', result.homeSnapshot?.recentTimeline || []);
    renderTimeline('timelineRecords', result.homeSnapshot?.recentTimeline || []);
    renderStarterChips(result.starters || state.cache.starters || []);
    renderChatReflection(result.reflection || {});
    renderFollowupPrompts(result.followups || []);
    renderActionPlan(result.actionPlan || result.homeSnapshot?.actionPlan || []);
    renderSupportMode('supportModeHome', result.supportMode || result.homeSnapshot?.supportMode || {});
    renderSupportMode('supportModeChat', result.supportMode || result.homeSnapshot?.supportMode || {});
    renderSupportMode('supportModeRecords', result.supportMode || result.homeSnapshot?.supportMode || {});
    renderStuckPrompts('stuckPromptsHome', result.stuckPrompts || result.homeSnapshot?.stuckPrompts || []);
    renderStuckPrompts('stuckPromptsChat', result.stuckPrompts || result.homeSnapshot?.stuckPrompts || []);
    renderStuckPrompts('stuckPromptsRecords', result.stuckPrompts || result.homeSnapshot?.stuckPrompts || []);
    renderSupportCompass('supportCompassHome', result.supportCompass || result.homeSnapshot?.supportCompass || {});
    renderSupportCompass('supportCompassChat', result.supportCompass || result.homeSnapshot?.supportCompass || {});
    renderReturnDigest('returnDigestHome', result.returnDigest || result.homeSnapshot?.returnDigest || {});
    renderSinceDigest('sinceDigestHome', result.sinceDigest || result.homeSnapshot?.sinceDigest || {});
    renderReturnDigest('returnDigestChat', result.returnDigest || result.homeSnapshot?.returnDigest || {});
    renderSinceDigest('sinceDigestChat', result.sinceDigest || result.homeSnapshot?.sinceDigest || {});
    renderReturnDigest('returnDigestRecords', result.returnDigest || result.homeSnapshot?.returnDigest || {});
    renderSinceDigest('sinceDigestRecords', result.sinceDigest || result.homeSnapshot?.sinceDigest || {});
    renderMicroStep('microStepHome', result.microStep || result.homeSnapshot?.microStep || {});
    renderMicroStep('microStepChat', result.microStep || result.homeSnapshot?.microStep || {});
    renderMicroStep('microStepRecords', result.microStep || result.homeSnapshot?.microStep || {});
    renderConsultationCarry('consultationCarryHome', result.consultationCarry || result.homeSnapshot?.consultationCarry || {});
    renderConsultationCarry('consultationCarryChat', result.consultationCarry || result.homeSnapshot?.consultationCarry || {});
    renderConsultationCarry('consultationCarryRecords', result.consultationCarry || result.homeSnapshot?.consultationCarry || {});
    renderReturnAnchor('returnAnchorHome', result.returnAnchor || result.homeSnapshot?.returnAnchor || {});
    renderReturnAnchor('returnAnchorChat', result.returnAnchor || result.homeSnapshot?.returnAnchor || {});
    renderReturnAnchor('returnAnchorRecords', result.returnAnchor || result.homeSnapshot?.returnAnchor || {});
    renderResumePrompts('resumePromptsHome', result.resumePrompts || result.homeSnapshot?.resumePrompts || []);
    renderResumePrompts('resumePromptsChat', result.resumePrompts || result.homeSnapshot?.resumePrompts || []);
    renderReentryGuide('reentryGuideHome', result.reentryGuide || result.homeSnapshot?.reentryGuide || {});
    renderReentryGuide('reentryGuideChat', result.reentryGuide || result.homeSnapshot?.reentryGuide || {});
    renderReentryGuide('reentryGuideRecords', result.reentryGuide || result.homeSnapshot?.reentryGuide || {});
    renderConversationBridge('conversationBridgeHome', result.conversationBridge || result.homeSnapshot?.conversationBridge || {});
    renderConversationBridge('conversationBridgeChat', result.conversationBridge || result.homeSnapshot?.conversationBridge || {});
    renderConversationBridge('conversationBridgeRecords', result.conversationBridge || result.homeSnapshot?.conversationBridge || {});
    rememberSyncState(result.sync || {});
    markLoaded();
    rememberVisitNow();
    if (state.pendingSync) {
      const pending = state.pendingSync;
      state.pendingSync = null;
      state.pendingSyncCount = 0;
      await refreshFromSyncStatus(pending);
    } else {
      setStatus('返答を更新しました。', 'success');
    }
  } catch (error) {
    pendingBubble.remove();
    input.value = text;
    persistDraft(text);
    autoResizeChatInput();
    if (error.isAuthError) return resetAuthState(error.message);
    appendChat('assistant', error.message || '送信に失敗しました。', 'エラー');
    setStatus(error.message || '送信に失敗しました。', 'error');
  } finally {
    setLoading(false);
  }
}

async function logout() {
  try { await api('/logout', { method: 'POST' }); } catch (_) {}
  resetAuthState('接続を解除しました。');
  setMessage('接続を解除しました。');
  setStatus('接続を解除しました。', 'success');
}

function switchTab(tab) {
  state.currentTab = tab;
  localStorage.setItem('kokokara_web_tab', tab);
  qsa('.tab-btn').forEach((btn) => btn.classList.toggle('active', btn.dataset.tab === tab));
  qs('#tabMeals').hidden = tab !== 'meals';
  qs('#tabWeights').hidden = tab !== 'weights';
  qs('#tabLabs').hidden = tab !== 'labs';
}

function switchRange(range) {
  state.recordRange = range;
  localStorage.setItem('kokokara_web_range', range);
  qsa('.range-btn').forEach((btn) => btn.classList.toggle('active', btn.dataset.range === range));
}

qsa('.nav-btn').forEach((btn) => btn.addEventListener('click', async () => {
  showView(btn.dataset.view);
  const requestId = beginViewRequest();
  try {
    setLoading(true, '表示を更新しています…');
    await loadCurrentView(false, requestId);
    setStatus('表示を更新しました。', 'success');
  } catch (error) {
    if (error.isAuthError) return resetAuthState(error.message);
    setStatus(error.message, 'error');
  } finally {
    setLoading(false);
  }
}));
qsa('.tab-btn').forEach((btn) => btn.addEventListener('click', () => switchTab(btn.dataset.tab)));
qsa('.range-btn').forEach((btn) => btn.addEventListener('click', async () => {
  switchRange(btn.dataset.range);
  if (state.currentView !== 'records' || !state.token) return;
  const requestId = beginViewRequest();
  try {
    setLoading(true, '表示範囲を切り替えています…');
    await loadRecords(requestId);
    setStatus('表示範囲を切り替えました。', 'success');
  } catch (error) {
    if (error.isAuthError) return resetAuthState(error.message);
    setStatus(error.message, 'error');
  } finally {
    setLoading(false);
  }
}));
qsa('[data-go-view]').forEach((btn) => btn.addEventListener('click', async () => {
  showView(btn.dataset.goView);
  const requestId = beginViewRequest();
  if (btn.dataset.goView === 'chat') {
    await loadChat(requestId);
    if (isCurrentViewRequest(requestId)) qs('#chatInput').focus();
  }
  if (btn.dataset.goView === 'records') await loadRecords(requestId);
}));
qs('#connectBtn').addEventListener('click', connect);
qs('#codeInput').addEventListener('keydown', (e) => { if (e.key === 'Enter') connect(); });
qs('#sendBtn').addEventListener('click', () => sendChat());
qs('#chatInput').addEventListener('input', async (e) => {
  persistDraft(e.target.value || '');
  autoResizeChatInput();
  if (!e.target.value.trim() && state.pendingSync && !state.loading) {
    const pending = state.pendingSync;
    state.pendingSync = null;
    state.pendingSyncCount = 0;
    await refreshFromSyncStatus(pending);
  }
});
qs('#chatInput').addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendChat(); }
});
qs('#logoutBtn').addEventListener('click', logout);
qs('#refreshBtn').addEventListener('click', () => initializeSession(true));

async function refreshIfStale() {
  if (!state.token || state.loading || document.hidden || !isStale()) return;
  if (Date.now() - Number(state.autoRefreshAt || 0) < 15000) return;
  state.autoRefreshAt = Date.now();
  try {
    await initializeSession(true);
  } catch (_) {}
}

document.addEventListener('visibilitychange', () => {
  if (!document.hidden) refreshIfStale();
});
window.addEventListener('focus', () => refreshIfStale());

switchTab(state.currentTab);
switchRange(state.recordRange);
qs('#chatInput').value = state.chatDraft || '';
autoResizeChatInput();
syncSendButton();
startSyncPolling();

const initialCode = readCodeFromLocation();
if (initialCode && !state.token) {
  qs('#codeInput').value = initialCode;
  connect();
} else {
  initializeSession();
}

window.addEventListener('pagehide', () => { if (state.token) rememberVisitNow(); });
window.addEventListener('beforeunload', () => { if (state.token) rememberVisitNow(); });
