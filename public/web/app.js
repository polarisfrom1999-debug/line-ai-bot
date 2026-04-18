(function () {
  'use strict';

  const THEMES = [
    { id: 'soft-default', label: 'やさしい標準', desc: '迷ったらこれ', color: 'linear-gradient(90deg,#875d88,#ceb0d0)', tint: 'linear-gradient(180deg,rgba(206,176,208,.42),rgba(255,255,255,.92))' },
    { id: 'clear-cream', label: '明るく見やすい', desc: '黄みでまぶしさ弱め', color: 'linear-gradient(90deg,#9a7131,#f0dfae)', tint: 'linear-gradient(180deg,rgba(240,223,174,.58),rgba(255,253,248,.95))' },
    { id: 'clear-blue', label: 'くっきり見やすい', desc: '青みで文字を見やすく', color: 'linear-gradient(90deg,#34678e,#b4d3ec)', tint: 'linear-gradient(180deg,rgba(180,211,236,.55),rgba(251,254,255,.96))' },
    { id: 'night-gentle', label: '夜もやさしい', desc: '暗めでコントラスト強め', color: 'linear-gradient(90deg,#d7b0df,#8c99b8)', tint: 'linear-gradient(180deg,rgba(80,89,109,.96),rgba(35,40,51,.96))' }
  ];

  const QUICK_ACTIONS = [
    { label: '今日の流れを見たい', sub: '最近の流れを見返す', text: '私の事で覚えている事は？' },
    { label: '食事を送りたい', sub: '送り方をすぐ出す', text: '食事の送り方' },
    { label: '体重を記録したい', sub: '数字をそのまま送る', text: '体重60キロ' },
    { label: '血液検査を見返したい', sub: '画像の送り方を出す', text: '血液検査の送り方' },
    { label: '相談を続けたい', sub: '今の流れから再開', text: '今の流れから相談したい' }
  ];

  const MEMO_KEY = 'kokokara-web-memo';
  const WEB_TOKEN_KEY = 'kokokara-web-token';
  const CHAT_BACKUP_KEY = 'kokokara-web-chat-history';

  const MOCK_DATA = {
    connected: true,
    userName: 'うっし〜',
    lastUpdated: '2026-04-10 14:22',
    expiresAt: '2026-05-10 05:22',
    syncStatus: 'ライブ同期中',
    reminders: '今の流れを軽く見てから相談に入ると戻りやすいです。',
    profile: {
      goal: '50キロ',
      currentPlan: 'プレミアム',
      aiType: '理屈で整理',
      latestWeight: 60,
      latestWeightDate: '2026-04-10',
      latestBodyFat: 17,
      height: 170,
      preferredName: 'うっし〜'
    },
    chat: [
      { id: 'm1', role: 'assistant', text: '接続できました。ここからはチャットをいちばん上で見やすく使えます。', time: '14:22' },
      { id: 'm2', role: 'user', text: '私のプランは？', time: '14:29' },
      { id: 'm3', role: 'assistant', text: '今のプランは「プレミアム」です。必要なら詳しい案内も出せます。', time: '14:29' },
      { id: 'm4', role: 'user', text: '体重60キロだよ', time: '14:31' },
      { id: 'm5', role: 'assistant', text: 'ごめんね、見落としてたみたい。体重は60キロで更新しておくね。', time: '14:31' },
      { id: 'm6', role: 'user', text: 'AIタイプ変更', time: '14:32' },
      { id: 'm7', role: 'assistant', text: '【AIタイプ】\n・やさしく伴走\n・理屈で整理\n・背中を押す\n・バランス型', time: '14:32' },
      { id: 'm8', role: 'user', text: '理屈で整理', time: '14:32' },
      { id: 'm9', role: 'assistant', text: 'AIタイプを「理屈で整理」に更新しました。', time: '14:32' },
      { id: 'm10', role: 'user', text: '朝ごはん送る', time: '14:33' },
      { id: 'm11', role: 'assistant', text: '朝ごはんですね。写真が来たらすぐ見ます。', time: '14:33' },
      { id: 'm12', role: 'assistant', text: '受け取りました。今回は トースト、カッテージチーズ として見ています。ざっくり 約620kcal くらいです。', time: '14:34' }
    ],
    records: {
      weight: [
        { date: '2026-03-17', value: 62.8, bodyFat: 17.8 },
        { date: '2026-03-18', value: 62.6, bodyFat: 17.5 },
        { date: '2026-03-19', value: 62.5, bodyFat: 17.3 },
        { date: '2026-03-20', value: 62.7, bodyFat: 17.4 },
        { date: '2026-03-21', value: 62.3, bodyFat: 17.1 },
        { date: '2026-03-22', value: 62.2, bodyFat: 17.1 },
        { date: '2026-03-23', value: 62.4, bodyFat: 17.0 }
      ],
      meal: [
        { date: '2026-03-17', count: 3, kcal: 1650, breakfastCount: 1, lunchCount: 1, dinnerCount: 1, summary: '朝昼夜の3件' },
        { date: '2026-03-18', count: 2, kcal: 1220, lunchCount: 1, dinnerCount: 1, summary: '昼夜の2件' },
        { date: '2026-03-19', count: 3, kcal: 1580, breakfastCount: 1, lunchCount: 1, dinnerCount: 1, summary: '3件' },
        { date: '2026-03-20', count: 1, kcal: 620, breakfastCount: 1, summary: '朝食1件' },
        { date: '2026-03-21', count: 2, kcal: 1310, lunchCount: 1, dinnerCount: 1, summary: '2件' },
        { date: '2026-03-22', count: 3, kcal: 1490, breakfastCount: 1, lunchCount: 1, dinnerCount: 1, summary: '3件' },
        { date: '2026-03-23', count: 2, kcal: 1080, breakfastCount: 1, dinnerCount: 1, summary: '朝夜の2件' }
      ],
      lab: [
        { name: '最新日付', value: '2026-03-06', note: '血液検査' },
        { name: '見返しメモ', value: 'まだありません', note: '要約待ち' },
        { name: '次の動き', value: '画像追加で更新', note: '必要時のみ' }
      ]
    }
  };

  const state = {
    activeTab: 'chat',
    activeRecordTab: 'weight',
    rangeDays: Number(localStorage.getItem('kokokara-web-range')) || 7,
    theme: localStorage.getItem('kokokara-web-theme') || 'soft-default',
    data: null,
    chatVisibleCount: 48,
    cacheByRange: {},
    pendingQuickAction: '',
    sessionToken: localStorage.getItem(WEB_TOKEN_KEY) || '',
    connectionState: 'disconnected',
    auxPanelOpen: false,
    athleteSupportEnabled: false,
    athleteSupportData: null
  };

  const els = {
    connectBanner: document.getElementById('connectBanner'),
    connectForm: document.getElementById('connectForm'),
    connectInput: document.getElementById('connectInput'),
    connectAutoHint: document.getElementById('connectAutoHint'),
    sessionPill: document.getElementById('sessionPill'),
    sessionDetail: document.getElementById('sessionDetail'),
    refreshBtn: document.getElementById('refreshBtn'),
    disconnectBtn: document.getElementById('disconnectBtn'),
    toggleThemePanelBtn: document.getElementById('toggleThemePanelBtn'),
    themeGrid: document.getElementById('themeGrid'),
    themePanel: document.getElementById('themePanel'),
    rangeGroups: Array.from(document.querySelectorAll('.js-range-group')),
    tabButtons: Array.from(document.querySelectorAll('.tab-btn')),
    athleteTabBtn: document.getElementById('athleteTabBtn'),
    athletePanel: document.getElementById('athletePanel'),
    athleteRoot: document.getElementById('athleteRoot'),
    tabPanels: {
      chat: document.getElementById('chatPanel'),
      records: document.getElementById('recordsPanel'),
      athlete: document.getElementById('athletePanel')
    },
    chatLog: document.getElementById('chatLog'),
    chatHeadStatus: document.getElementById('chatHeadStatus'),
    goRecordsBtn: document.getElementById('goRecordsBtn'),
    openAuxBtn: document.getElementById('openAuxBtn'),
    closeAuxBtn: document.getElementById('closeAuxBtn'),
    auxPanel: document.getElementById('auxPanel'),
    loadOlderBtn: document.getElementById('loadOlderBtn'),
    composerForm: document.getElementById('composerForm'),
    composerInput: document.getElementById('composerInput'),
    plusBtn: document.getElementById('plusBtn'),
    filePicker: document.getElementById('filePicker'),
    composerHelp: document.getElementById('composerHelp'),
    saveMemoBtn: document.getElementById('saveMemoBtn'),
    sendMemoBtn: document.getElementById('sendMemoBtn'),
    contextMemoInput: document.getElementById('contextMemoInput'),
    quickActionFocusBtn: document.getElementById('quickActionFocusBtn'),
    quickActions: document.getElementById('quickActions'),
    summaryCards: document.getElementById('summaryCards'),
    recordHeadMeta: document.getElementById('recordHeadMeta'),
    recordTabButtons: Array.from(document.querySelectorAll('.record-tab')),
    recordPanels: {
      weight: document.getElementById('recordWeightPanel'),
      meal: document.getElementById('recordMealPanel'),
      lab: document.getElementById('recordLabPanel')
    },
    weightChartCanvas: document.getElementById('weightChartCanvas'),
    mealChartCanvas: document.getElementById('mealChartCanvas'),
    weightChartMeta: document.getElementById('weightChartMeta'),
    mealChartMeta: document.getElementById('mealChartMeta'),
    mealTotalValue: document.getElementById('mealTotalValue'),
    mealTotalSub: document.getElementById('mealTotalSub'),
    weightList: document.getElementById('weightList'),
    mealList: document.getElementById('mealList'),
    labMeta: document.getElementById('labMeta'),
    labGrid: document.getElementById('labGrid')
  };

  function safeArray(value) {
    return Array.isArray(value) ? value : [];
  }

  function normalizeText(value) {
    return String(value || '').trim();
  }

  function toHalfWidth(text) {
    return normalizeText(text).replace(/[０-９．％]/g, (s) => String.fromCharCode(s.charCodeAt(0) - 0xFEE0));
  }

  function parseLooseNumber(value) {
    const safe = toHalfWidth(value).replace(/[^\d.]/g, '');
    const n = Number(safe);
    return Number.isFinite(n) ? n : null;
  }

  function containsQuestionTone(text) {
    return /教えて|知りたい|なんだっけ|ですか|ますか|\?|？/.test(normalizeText(text));
  }

  function formatDate(dateText, withYear) {
    const d = new Date(dateText);
    if (Number.isNaN(d.getTime())) return dateText || '—';
    return withYear
      ? `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
      : `${d.getMonth() + 1}/${d.getDate()}`;
  }

  function getTodayIso() {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }

  function deriveReferenceDate(value) {
    const safe = normalizeText(value);
    if (/\d{4}-\d{2}-\d{2}/.test(safe)) return safe.match(/\d{4}-\d{2}-\d{2}/)[0];
    if (/\d{4}\/\d{2}\/\d{2}/.test(safe)) return safe.match(/\d{4}\/\d{2}\/\d{2}/)[0].replace(/\//g, '-');
    return getTodayIso();
  }

  function formatKcal(value) {
    return `${Math.round(Number(value || 0))}kcal`;
  }

  function parseMaybeDate(value) {
    const t = new Date(value || '');
    return Number.isNaN(t.getTime()) ? null : t;
  }

  function isExpiredAt(value) {
    const d = parseMaybeDate(value);
    if (!d) return false;
    return d.getTime() <= Date.now();
  }

  function uniqueBy(items, keyFn) {
    const seen = new Set();
    return items.filter((item) => {
      const key = keyFn(item);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }

  function sortByDateAsc(rows) {
    return safeArray(rows).slice().sort((a, b) => {
      const ta = parseMaybeDate(a.date)?.getTime() || 0;
      const tb = parseMaybeDate(b.date)?.getTime() || 0;
      return ta - tb;
    });
  }

  function dedupeWeightRowsByDate(rows) {
    const map = new Map();
    sortByDateAsc(rows).forEach((row) => {
      const key = formatDate(row.date, true);
      if (!key || key === '—') return;
      map.set(key, row);
    });
    return Array.from(map.values());
  }

  function withUnitIfMissing(value, unit) {
    const safe = normalizeText(value);
    if (!safe) return '';
    return new RegExp(`${unit}$`, 'i').test(safe) ? safe : `${safe}${unit}`;
  }

  function extractMealSlots(row) {
    const slots = [];
    const breakfast = Number(row.breakfastCount || row.breakfast || 0);
    const lunch = Number(row.lunchCount || row.lunch || 0);
    const dinner = Number(row.dinnerCount || row.dinner || 0);
    if (breakfast) slots.push({ key: '朝', count: breakfast });
    if (lunch) slots.push({ key: '昼', count: lunch });
    if (dinner) slots.push({ key: '夜', count: dinner });
    if (!slots.length) {
      const summary = normalizeText(row.summary || row.note || row.meal_label || '');
      if (/朝/.test(summary)) slots.push({ key: '朝', count: 1 });
      if (/昼/.test(summary)) slots.push({ key: '昼', count: 1 });
      if (/夜|夕/.test(summary)) slots.push({ key: '夜', count: 1 });
    }
    return slots;
  }

  function detectMealSlot(text) {
    const safe = normalizeText(text);
    if (/朝ごはん|朝食|朝/.test(safe)) return 'breakfast';
    if (/昼ごはん|昼食|昼/.test(safe)) return 'lunch';
    if (/夜ごはん|夕ごはん|夕食|夜|夕/.test(safe)) return 'dinner';
    return '';
  }

  function detectMealLikeText(text) {
    const safe = normalizeText(text);
    if (!safe || containsQuestionTone(safe)) return false;
    if (/食べ(て)?ない|食べません|嫌い|苦手|いらない|要らない|抜いた|未摂取/.test(safe)) return false;
    return /朝ごはん|昼ごはん|夜ごはん|朝食|昼食|夕食|ラーメン|カレー|ごはん|パン|トースト|ヨーグルト|おにぎり|食べた|飲んだ/.test(safe);
  }

  function detectKcal(text) {
    const m = normalizeText(text).match(/約?\s*([0-9０-９]+(?:\.[0-9０-９]+)?)\s*kcal/i);
    return m ? parseLooseNumber(m[1]) : null;
  }

  function escapeHtml(value) {
    return String(value || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  function themeTextIsDark(themeId) {
    return themeId === 'night-gentle';
  }

  function saveTheme(themeId) {
    state.theme = themeId;
    localStorage.setItem('kokokara-web-theme', themeId);
    applyTheme();
    renderThemeOptions();
    els.themePanel.classList.add('collapsed');
  }

  function applyTheme() {
    document.body.setAttribute('data-theme', state.theme);
  }

  function renderThemeOptions() {
    els.themeGrid.innerHTML = '';
    THEMES.forEach((theme) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = `theme-option${state.theme === theme.id ? ' active' : ''}`;
      btn.style.background = theme.tint;
      btn.innerHTML = `
        <span class="theme-swatch" style="background:${theme.color}"></span>
        <span class="theme-label">${theme.label}</span>
        <span class="theme-desc" style="color:${themeTextIsDark(theme.id) ? '#f2edf0' : ''}">${theme.desc}</span>
      `;
      if (themeTextIsDark(theme.id)) btn.style.color = '#f5f4f1';
      btn.addEventListener('click', () => saveTheme(theme.id));
      els.themeGrid.appendChild(btn);
    });
  }

  function toggleThemePanel() {
    els.themePanel.classList.toggle('collapsed');
  }

  function setActiveTab(tabId) {
    state.activeTab = tabId;
    if (tabId !== 'chat' && state.auxPanelOpen) state.auxPanelOpen = false;
    document.querySelectorAll('.tab-btn').forEach((btn) => {
      if (btn.classList.contains('hidden')) return;
      btn.classList.toggle('active', btn.dataset.tab === tabId);
    });
    Object.entries(els.tabPanels).forEach(([key, panel]) => {
      if (!panel) return;
      panel.classList.toggle('active', key === tabId);
    });
    renderAuxPanelState();
    if (tabId === 'athlete' && state.athleteSupportEnabled) {
      if (!state.athleteSupportData) {
        loadAthleteHome().catch(() => {});
      } else {
        renderAthleteSupport();
      }
    }
  }

  function setRecordTab(tabId) {
    state.activeRecordTab = tabId;
    els.recordTabButtons.forEach((btn) => btn.classList.toggle('active', btn.dataset.recordTab === tabId));
    Object.entries(els.recordPanels).forEach(([key, panel]) => panel.classList.toggle('active', key === tabId));
  }

  function updateRangeButtons() {
    els.rangeGroups.forEach((group) => {
      Array.from(group.querySelectorAll('.range-chip')).forEach((btn) => {
        btn.classList.toggle('active', Number(btn.dataset.range) === state.rangeDays);
      });
    });
  }

  async function setRange(days) {
    if (!days || Number.isNaN(days)) return;
    state.rangeDays = days;
    localStorage.setItem('kokokara-web-range', String(days));
    updateRangeButtons();
    await refreshForRange(days, true);
    renderAll();
  }

  function getFilteredRows(rows) {
    const list = sortByDateAsc(rows);
    if (!list.length) return [];
    const latest = parseMaybeDate(list[list.length - 1].date) || new Date();
    const start = new Date(latest);
    start.setHours(0, 0, 0, 0);
    start.setDate(start.getDate() - Math.max(0, state.rangeDays - 1));
    const filtered = list.filter((row) => {
      const date = parseMaybeDate(row.date);
      return date ? date >= start : true;
    });
    return filtered.length ? filtered : list.slice(-state.rangeDays);
  }

  function getLabelStep(length, width) {
    if (length <= 8) return 1;
    const approx = Math.max(1, Math.ceil(length / Math.max(3, Math.floor(width / 90))));
    return approx;
  }

  function summarizeWeightRows(rows) {
    const list = getFilteredRows(rows);
    if (!list.length) return { latest: '–', note: 'まだありません', sub: '体重記録なし' };
    const latest = list[list.length - 1];
    const first = list[0];
    const diff = Math.round(((latest.value || 0) - (first.value || 0)) * 10) / 10;
    return {
      latest: `${latest.value}kg`,
      note: latest.bodyFat != null ? `体脂肪率 ${latest.bodyFat}%` : '体脂肪率なし',
      sub: `${list.length}件 / ${state.rangeDays}日表示${diff === 0 ? '' : ` / ${diff > 0 ? '+' : ''}${diff}kg`}`
    };
  }

  function summarizeMealRows(rows) {
    const list = getFilteredRows(rows);
    if (!list.length) return { latest: '0kcal', note: '食事記録なし', sub: '0回' };
    const totalKcal = list.reduce((sum, row) => sum + Number(row.kcal || 0), 0);
    const totalCount = list.reduce((sum, row) => sum + Number(row.count || 0), 0);
    const latest = list[list.length - 1];
    return {
      latest: formatKcal(totalKcal),
      note: `最新 ${formatDate(latest.date, true)}`,
      sub: `${totalCount}回 / ${list.length}日分`
    };
  }

  function summarizeLabRows(rows) {
    const list = safeArray(rows);
    if (!list.length) return { latest: 'まだありません', note: '血液検査', sub: '追加待ち' };
    const primary = list[0];
    const rest = list.slice(1, 4).filter((row) => normalizeText(row.name) && normalizeText(row.value));
    return {
      latest: normalizeText(primary.value || 'まだありません'),
      note: normalizeText(primary.name || '血液検査'),
      sub: rest.length
        ? rest.map((row) => `${normalizeText(row.name)} ${normalizeText(row.value)}`).join(' · ')
        : normalizeText(primary.note || '見返しメモなし')
    };
  }

  function renderSummaryCards() {
    const data = state.data || MOCK_DATA;
    const cards = [
      { title: '体重記録', ...summarizeWeightRows(data.records.weight) },
      { title: '食事記録', ...summarizeMealRows(data.records.meal) },
      { title: '血液検査', ...summarizeLabRows(data.records.lab) }
    ];

    els.summaryCards.innerHTML = cards.map((card) => `
      <article class="summary-card">
        <h3>${card.title}</h3>
        <div class="summary-main">${card.latest}</div>
        <div class="summary-sub">${card.note}</div>
        <div class="summary-note">${card.sub}</div>
      </article>
    `).join('');
  }

  function getVar(name, fallback) {
    const raw = getComputedStyle(document.body).getPropertyValue(name).trim();
    return raw || fallback;
  }

  function resetCanvas(canvas) {
    const wrap = canvas.parentElement;
    const parentWidth = wrap ? Math.max(320, Math.floor(wrap.clientWidth - 4)) : 980;
    const logicalWidth = parentWidth;
    let logicalHeight = Number(canvas.getAttribute('height') || 320);
    if (wrap && wrap.classList && wrap.classList.contains('chart-canvas-wrap') && wrap.clientHeight > 40) {
      logicalHeight = Math.floor(wrap.clientHeight);
    }
    const ratio = window.devicePixelRatio || 1;
    canvas.width = logicalWidth * ratio;
    canvas.height = logicalHeight * ratio;
    canvas.style.width = `${logicalWidth}px`;
    canvas.style.height = `${logicalHeight}px`;
    const ctx = canvas.getContext('2d');
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    ctx.clearRect(0, 0, logicalWidth, logicalHeight);
    return { ctx, width: logicalWidth, height: logicalHeight };
  }

  function drawWeightChart(canvas, rows) {
    const { ctx, width, height } = resetCanvas(canvas);
    const list = getFilteredRows(rows);
    if (!list.length) {
      ctx.fillStyle = getVar('--muted', '#666');
      ctx.font = '13px sans-serif';
      ctx.fillText('まだ体重データがありません', 18, 28);
      return;
    }

    const pad = { top: 18, right: 18, bottom: 40, left: 48 };
    const innerW = Math.max(40, width - pad.left - pad.right);
    const innerH = Math.max(40, height - pad.top - pad.bottom);
    const values = list.map((row) => Number(row.value || 0));
    const min = Math.min(...values);
    const max = Math.max(...values);
    const gap = Math.max(max - min, 0.4);
    const labelStep = getLabelStep(list.length, innerW);

    ctx.strokeStyle = getVar('--chart-grid', 'rgba(0,0,0,.1)');
    ctx.lineWidth = 1;
    for (let i = 0; i < 4; i += 1) {
      const y = pad.top + (innerH / 3) * i;
      ctx.beginPath();
      ctx.moveTo(pad.left, y);
      ctx.lineTo(width - pad.right, y);
      ctx.stroke();
    }

    ctx.strokeStyle = getVar('--primary', '#875d88');
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    list.forEach((row, index) => {
      const x = list.length === 1 ? pad.left + innerW / 2 : pad.left + (innerW / (list.length - 1)) * index;
      const y = height - pad.bottom - ((Number(row.value || 0) - min) / gap) * innerH;
      if (index === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    });
    ctx.stroke();

    ctx.fillStyle = getVar('--surface', '#fff');
    list.forEach((row, index) => {
      const x = list.length === 1 ? pad.left + innerW / 2 : pad.left + (innerW / (list.length - 1)) * index;
      const y = height - pad.bottom - ((Number(row.value || 0) - min) / gap) * innerH;
      ctx.beginPath();
      ctx.arc(x, y, 4, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = getVar('--primary', '#875d88');
      ctx.lineWidth = 2;
      ctx.stroke();
    });

    ctx.fillStyle = getVar('--muted', '#666');
    ctx.font = '12px sans-serif';
    ctx.fillText(String(max.toFixed(1)), 8, pad.top + 6);
    ctx.fillText(String(min.toFixed(1)), 8, height - pad.bottom + 2);
    list.forEach((row, index) => {
      if (index % labelStep !== 0 && index !== list.length - 1) return;
      const x = list.length === 1 ? pad.left + innerW / 2 : pad.left + (innerW / (list.length - 1)) * index;
      ctx.fillText(formatDate(row.date), x - 16, height - 12);
    });
  }

  function drawMealChart(canvas, rows) {
    const { ctx, width, height } = resetCanvas(canvas);
    const list = getFilteredRows(rows);
    if (!list.length) {
      ctx.fillStyle = getVar('--muted', '#666');
      ctx.font = '13px sans-serif';
      ctx.fillText('まだ食事データがありません', 18, 28);
      return;
    }

    const pad = { top: 18, right: 18, bottom: 44, left: 44 };
    const innerW = Math.max(40, width - pad.left - pad.right);
    const innerH = Math.max(40, height - pad.top - pad.bottom);
    const maxKcal = Math.max(...list.map((row) => Number(row.kcal || 0)), 600);
    const step = innerW / Math.max(1, list.length);
    const barW = Math.max(14, Math.min(54, step * 0.56));
    const labelStep = getLabelStep(list.length, innerW);

    ctx.strokeStyle = getVar('--chart-grid', 'rgba(0,0,0,.1)');
    ctx.lineWidth = 1;
    for (let i = 0; i < 4; i += 1) {
      const y = pad.top + (innerH / 3) * i;
      ctx.beginPath();
      ctx.moveTo(pad.left, y);
      ctx.lineTo(width - pad.right, y);
      ctx.stroke();
    }

    ctx.fillStyle = getVar('--accent', '#ceb0d0');
    list.forEach((row, index) => {
      const x = pad.left + step * index + (step - barW) / 2;
      const h = (Number(row.kcal || 0) / maxKcal) * innerH;
      const y = height - pad.bottom - h;
      ctx.fillRect(x, y, barW, h);
      ctx.fillStyle = getVar('--text', '#222');
      ctx.font = '11px sans-serif';
      if (index % labelStep === 0 || index === list.length - 1) {
        ctx.fillText(String(Math.round(Number(row.kcal || 0))), x - 2, y - 6);
        ctx.fillText(formatDate(row.date), x - 8, height - 10);
      }
      ctx.fillStyle = getVar('--accent', '#ceb0d0');
    });
  }

  function renderWeightPanel(rows) {
    const list = getFilteredRows(rows);
    const latest = list[list.length - 1];
    els.weightChartMeta.textContent = latest
      ? `最新 ${formatDate(latest.date, true)} / ${latest.value}kg / ${list.length}件表示`
      : 'まだありません';
    drawWeightChart(els.weightChartCanvas, rows);
    els.weightList.innerHTML = list.slice().reverse().map((row) => `
      <div class="simple-row">
        <div>
          <div class="simple-row-main">${row.value}kg</div>
          <div class="simple-row-sub">体脂肪率 ${row.bodyFat != null ? `${row.bodyFat}%` : '—'}</div>
        </div>
        <div class="simple-row-sub">${formatDate(row.date, true)}</div>
      </div>
    `).join('');
  }

  function renderMealPanel(rows) {
    const list = getFilteredRows(rows);
    const totalKcal = list.reduce((sum, row) => sum + Number(row.kcal || 0), 0);
    const totalCount = list.reduce((sum, row) => sum + Number(row.count || 0), 0);
    const latest = list[list.length - 1];
    els.mealTotalValue.textContent = `${Math.round(totalKcal)} kcal`;
    els.mealTotalSub.textContent = `${totalCount}回 / ${list.length}日分`;
    els.mealChartMeta.textContent = latest
      ? `最新 ${formatDate(latest.date, true)} / ${Math.round(latest.kcal || 0)}kcal / ${list.length}日表示`
      : 'まだありません';
    drawMealChart(els.mealChartCanvas, rows);

    els.mealList.innerHTML = list.slice().reverse().map((row) => {
      const slots = extractMealSlots(row);
      return `
        <div class="simple-row">
          <div class="meal-row-left">
            <div class="simple-row-main">食事 ${row.count || 0}回 / 約${Math.round(row.kcal || 0)}kcal</div>
            <div class="simple-row-sub">${normalizeText(row.summary || '食事記録')}</div>
            <div class="meal-slot-row">
              ${slots.length ? slots.map((slot) => `<span class="slot-pill">${slot.key}${slot.count > 1 ? ` ${slot.count}` : ''}</span>`).join('') : '<span class="slot-pill">時間帯メモなし</span>'}
            </div>
          </div>
          <div class="simple-row-sub">${formatDate(row.date, true)}<br>総 ${Math.round(row.kcal || 0)}kcal</div>
        </div>
      `;
    }).join('');
  }

  function renderLabPanel(rows) {
    const items = safeArray(rows);
    const examHint = items.map((i) => i.note).find((n) => /採血日|検査日/.test(String(n || '')));
    els.labMeta.textContent = examHint || (items[0] ? `${items[0].name || '検査'} の主要指標です` : 'まだありません');
    els.labGrid.innerHTML = items.map((item) => `
      <div class="lab-pill">
        <div class="lab-name">${escapeHtml(item.name || '項目')}</div>
        <div class="lab-value">${escapeHtml(item.value)}</div>
      </div>
    `).join('');
  }

  function buildContextMemo(data) {
    const weightSummary = summarizeWeightRows(data.records.weight);
    const mealSummary = summarizeMealRows(data.records.meal);
    const pieces = [];
    if (data.profile?.currentPlan || data.profile?.selectedPlan) pieces.push(`プランは ${data.profile.currentPlan || data.profile.selectedPlan}`);
    if (data.profile?.goal) pieces.push(`目標は ${data.profile.goal}`);
    pieces.push(`体重は ${weightSummary.latest}`);
    pieces.push(`食事は ${mealSummary.latest}`);
    return `今の見返しポイント: ${pieces.join('、')}。`;
  }

  function renderQuickActions() {
    els.quickActions.innerHTML = '';
    QUICK_ACTIONS.forEach((action) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = `quick-action${state.pendingQuickAction === action.text ? ' pending' : ''}`;
      btn.innerHTML = `<span class="quick-action-label">${action.label}</span><span class="quick-action-sub">${action.sub}</span>`;
      btn.addEventListener('click', () => {
        state.pendingQuickAction = '';
        fillComposer(action.text);
        sendText(action.text);
      });
      els.quickActions.appendChild(btn);
    });
  }

  function renderChat(options = {}) {
    const data = state.data || MOCK_DATA;
    const allMessages = safeArray(data.chat);
    const visible = allMessages.slice(-state.chatVisibleCount);
    const shouldStickBottom = options.stickBottom !== false;
    const previousHeight = els.chatLog.scrollHeight;
    const previousTop = els.chatLog.scrollTop;
    els.chatLog.innerHTML = visible.map((item) => `
      <div class="message-row ${item.role === 'user' ? 'user' : 'assistant'}">
        <div>
          <div class="message-bubble">${escapeHtml(String(item.text || '')).replace(/\n/g, '<br>')}</div>
          <div class="message-meta">${escapeHtml(item.time || '')}</div>
        </div>
      </div>
    `).join('');
    if (shouldStickBottom) {
      els.chatLog.scrollTop = els.chatLog.scrollHeight;
    } else {
      els.chatLog.scrollTop = els.chatLog.scrollHeight - previousHeight + previousTop;
    }
    els.chatHeadStatus.textContent = data.syncStatus || '同期中';
    if (!els.contextMemoInput.value.trim()) {
      els.contextMemoInput.value = localStorage.getItem(MEMO_KEY) || buildContextMemo(data);
    }
    renderQuickActions();
    els.loadOlderBtn.hidden = allMessages.length <= visible.length;
  }

  function renderConnection() {
    const data = state.data || MOCK_DATA;
    const expired = isExpiredAt(data.expiresAt);
    const isConnected = Boolean(data.connected) && !expired;
    if (isConnected) {
      els.connectBanner.classList.add('hidden');
      els.sessionPill.dataset.state = state.connectionState === 'connecting' ? 'connecting' : 'connected';
      els.sessionPill.textContent = state.connectionState === 'connecting'
        ? '接続中...'
        : `接続済み ${data.userName || ''}`.trim();
      els.sessionDetail.textContent = `${data.syncStatus || '同期中'} / 更新 ${data.lastUpdated || '—'}`;
      els.disconnectBtn.disabled = false;
    } else if (expired) {
      els.connectBanner.classList.remove('hidden');
      els.sessionPill.dataset.state = 'expired';
      els.sessionPill.textContent = '接続期限切れ';
      els.sessionDetail.textContent = '接続コードの有効期限が切れています。新しい接続コードで再接続してください。';
      els.disconnectBtn.disabled = true;
    } else {
      els.connectBanner.classList.remove('hidden');
      els.sessionPill.dataset.state = 'disconnected';
      els.sessionPill.textContent = '未接続';
      els.sessionDetail.textContent = '接続コードを入力すると使えます';
      els.disconnectBtn.disabled = true;
    }
  }

  function renderAuxPanelState() {
    const appShell = document.getElementById('appShell');
    if (!appShell) return;
    appShell.classList.toggle('aux-open', Boolean(state.auxPanelOpen));
  }

  function fillComposer(text) {
    els.composerInput.value = text;
    autosizeComposer();
    els.composerInput.focus();
    els.composerInput.scrollIntoView({ block: 'nearest' });
  }

function buildAttachmentPreview(files) {
  return safeArray(files).map((file, index) => ({
    id: `local-att-${Date.now()}-${index}`,
    name: file.name || '添付ファイル',
    type: file.type || '',
    isImage: /^image\//.test(String(file.type || '')),
    url: /^image\//.test(String(file.type || '')) ? URL.createObjectURL(file) : ''
  }));
}

function renderMessageAttachments(item) {
  const files = safeArray(item.attachments);
  if (!files.length) return '';
  return `
    <div class="message-attachments">
      ${files.map((file) => {
        if (file.isImage && file.url) {
          return `
            <a class="message-attachment" href="${escapeHtml(file.url)}" target="_blank" rel="noopener noreferrer">
              <img src="${escapeHtml(file.url)}" alt="${escapeHtml(file.name || '画像')}" loading="lazy">
            </a>
          `;
        }
        return `
          <a class="message-attachment" href="${escapeHtml(file.url || '#')}" ${file.url ? 'target="_blank" rel="noopener noreferrer"' : ''}>
            <span class="message-attachment-file">
              <span class="message-attachment-name">${escapeHtml(file.name || '添付ファイル')}</span>
              <span class="message-attachment-meta">${escapeHtml(file.type || 'ファイル')}</span>
            </span>
          </a>
        `;
      }).join('')}
    </div>
  `;
}

  function sortMessages(messages) {
    return safeArray(messages).map((item, index) => ({ ...item, _index: index })).sort((a, b) => {
      const ta = parseMaybeDate(a.createdAt || a.dateTime || a.date || '')?.getTime();
      const tb = parseMaybeDate(b.createdAt || b.dateTime || b.date || '')?.getTime();
      if (Number.isFinite(ta) && Number.isFinite(tb) && ta !== tb) return ta - tb;
      return a._index - b._index;
    }).map(({ _index, ...rest }) => rest);
  }

  function mergeMessages(primary, extra) {
    const merged = uniqueBy([...safeArray(primary), ...safeArray(extra)], (item) => `${item.role}|${item.time}|${item.text}`);
    return sortMessages(merged);
  }

  function loadChatBackup() {
    try {
      const raw = localStorage.getItem(CHAT_BACKUP_KEY);
      if (!raw) return [];
      const arr = JSON.parse(raw);
      return safeArray(arr).map(normalizeMessage).filter(Boolean);
    } catch (_err) {
      return [];
    }
  }

  function saveChatBackup(messages) {
    try {
      const list = safeArray(messages).slice(-200);
      localStorage.setItem(CHAT_BACKUP_KEY, JSON.stringify(list));
    } catch (_err) {
      // ignore quota errors
    }
  }

  function buildAuthHeaders(base = {}) {
    const token = normalizeText(state.sessionToken || '');
    if (!token) return base;
    return { ...base, Authorization: `Bearer ${token}` };
  }

  function getCodeFromUrl() {
    try {
      const sp = new URLSearchParams(window.location.search);
      let code = normalizeText(sp.get('code') || sp.get('connect') || sp.get('c') || '');
      if (!code && window.location.hash) {
        const rawHash = window.location.hash.replace(/^#/, '');
        const hashQuery = rawHash.includes('?') ? rawHash.split('?').slice(1).join('?') : rawHash;
        const hsp = new URLSearchParams(hashQuery.startsWith('?') ? hashQuery.slice(1) : hashQuery);
        code = normalizeText(hsp.get('code') || hsp.get('connect') || hsp.get('c') || '');
      }
      return code;
    } catch (_e) {
      return '';
    }
  }

  function stripCodeFromUrl() {
    try {
      const u = new URL(window.location.href);
      let changed = false;
      ['code', 'connect', 'c'].forEach((k) => {
        if (u.searchParams.has(k)) {
          u.searchParams.delete(k);
          changed = true;
        }
      });
      if (u.hash && /(?:^#?\??|&)(code|connect|c)=/i.test(u.hash)) {
        u.hash = '';
        changed = true;
      }
      if (changed) {
        window.history.replaceState({}, '', `${u.pathname}${u.search}${u.hash}`);
      }
    } catch (_e) {}
  }

  function setConnectAutoHint(message) {
    if (!els.connectAutoHint) return;
    const safe = normalizeText(message || '');
    if (!safe) {
      els.connectAutoHint.classList.add('hidden');
      els.connectAutoHint.textContent = '';
      return;
    }
    els.connectAutoHint.textContent = safe;
    els.connectAutoHint.classList.remove('hidden');
  }

  function scrollComposerIntoView() {
    try {
      els.chatLog.scrollTop = els.chatLog.scrollHeight;
      requestAnimationFrame(() => {
        els.chatLog.scrollTop = els.chatLog.scrollHeight;
        els.composerForm?.scrollIntoView({ block: 'end', behavior: 'smooth' });
      });
    } catch (_e) {}
  }

  async function connectWithCode(rawInput) {
    const code = normalizeText(rawInput);
    if (!code) throw new Error('接続コードが空です');
    const json = await postJson('/api/web/link/confirm', { code }, false);
    const token = normalizeText(json.sessionToken || '');
    if (!token) throw new Error('接続コードを確認できませんでした。');
    state.sessionToken = token;
    localStorage.setItem(WEB_TOKEN_KEY, token);
    if (!state.data) state.data = {};
    state.data.connected = true;
    state.connectionState = 'connected';
    stripCodeFromUrl();
    setConnectAutoHint('');
    setActiveTab('chat');
    window.dispatchEvent(new CustomEvent('kokokara:web-connect', { detail: { code } }));
    state.chatVisibleCount = 48;
    return json;
  }

  async function fetchJson(url) {
    const res = await fetch(url, { credentials: 'include', headers: buildAuthHeaders() });
    if (!res.ok) throw new Error(String(res.status));
    return res.json();
  }

  async function tryFetchChatHistory(days) {
    const suffixes = [
      `/api/web/chat/history?limit=400`,
      `/api/web/chat-history?limit=400&days=${days}`,
      `/web/api/chat-history?limit=400&days=${days}`,
      `/api/web/messages?limit=400&days=${days}`,
      `/web/messages?limit=400&days=${days}`,
      `/api/web/chat-history?limit=400`,
      `/web/api/chat-history?limit=400`
    ];
    for (const url of suffixes) {
      try {
        const json = await fetchJson(url);
        const messages = safeArray(json.messages || json.chat || json.rows || json.data).map(normalizeMessage).filter(Boolean);
        if (messages.length) return messages;
      } catch (_error) {}
    }
    return [];
  }

  async function loadBootstrapData(days) {
    const globalCandidates = [window.__KOKOKARA_WEB_DATA__, window.__WEB_PORTAL_DATA__, window.__PORTAL_DATA__, window.__BOOTSTRAP__].filter(Boolean);
    if (globalCandidates.length) return normalizePortalData(globalCandidates[0], false);

    const scriptEl = document.getElementById('web-portal-data');
    if (scriptEl?.textContent) {
      try {
        return normalizePortalData(JSON.parse(scriptEl.textContent), false);
      } catch (_err) {}
    }

    const token = normalizeText(state.sessionToken || '');
    if (!token) {
      return normalizePortalData({ ...MOCK_DATA, connected: false }, true);
    }

    const stamp = Date.now();
    const endpoints = [
      `/api/web/bootstrap?days=${days}&range=${days}&_=${stamp}`,
      `/api/web/bootstrap?days=${days}&_=${stamp}`,
      `/api/web/bootstrap?_=${stamp}`
    ];

    for (const url of endpoints) {
      try {
        const json = await fetchJson(url);
        return normalizePortalData(json, false);
      } catch (_error) {}
    }

    const fallback = normalizePortalData({ ...MOCK_DATA, connected: true }, false);
    fallback.syncStatus = 'データ取得に失敗しました。更新ボタンで再読み込みしてください。';
    return fallback;
  }

  function normalizeMessage(item) {
    if (!item) return null;
    const text = normalizeText(item.text || item.content || item.message || item.caption || '');
    const attachments = safeArray(item.attachments || item.files || item.images).map((file, index) => ({
      id: file.id || `${item.id || 'msg'}-att-${index}`,
      name: normalizeText(file.name || file.fileName || file.filename || file.title || '添付ファイル'),
      url: file.url || file.href || file.src || file.downloadUrl || '',
      type: normalizeText(file.type || file.mimeType || ''),
      isImage: Boolean(file.isImage || /^image\//.test(String(file.type || file.mimeType || '')) || /\.(png|jpe?g|gif|webp)$/i.test(String(file.url || file.href || file.src || '')))
    })).filter((file) => file.url || file.name);
    if (!text && !attachments.length) return null;
    return {
      id: item.id || item.messageId || `${item.role || item.sender || 'assistant'}-${item.time || item.createdAt || text || 'file'}`,
      role: item.role === 'user' || item.sender === 'user' || item.isUser ? 'user' : 'assistant',
      text,
      attachments,
      time: item.time || item.createdAt || item.created_at || item.date || '',
      createdAt: item.createdAt || item.created_at || item.date || ''
    };
  }

  function recursiveCollectArrays(node, depth = 0, out = []) {
    if (!node || depth > 6) return out;
    if (Array.isArray(node)) {
      out.push(node);
      node.forEach((item) => recursiveCollectArrays(item, depth + 1, out));
      return out;
    }
    if (typeof node === 'object') {
      Object.values(node).forEach((value) => recursiveCollectArrays(value, depth + 1, out));
    }
    return out;
  }

  function pickLongestSeries(raw, normalizer, fallbackRows) {
    const arrays = recursiveCollectArrays(raw);
    let best = safeArray(fallbackRows);
    arrays.forEach((arr) => {
      const normalized = safeArray(arr).map(normalizer).filter(Boolean);
      if (normalized.length > best.length) best = normalized;
    });
    return best;
  }

  function normalizeWeightRow(row) {
    const date = row?.date || row?.measured_at || row?.logged_at || row?.created_at || row?.updated_at || row?.day || row?.x;
    const value = row?.value ?? row?.weight ?? row?.weight_kg ?? row?.latestWeight ?? row?.y;
    const weightValue = Number(value);
    if (!date || !Number.isFinite(weightValue)) return null;
    return {
      date,
      value: weightValue,
      bodyFat: row?.bodyFat ?? row?.body_fat_percent ?? row?.bodyFatPercent ?? null
    };
  }

  function normalizeMealRow(row) {
    const date = row?.date || row?.eaten_at || row?.logged_at || row?.created_at || row?.day || row?.x;
    if (!date) return null;
    const kcal = Number(row?.kcal ?? row?.total_kcal ?? row?.estimated_kcal ?? row?.totalKcal ?? row?.y ?? 0);
    return {
      date,
      count: Number(row?.count ?? row?.mealCount ?? row?.items_count ?? row?.totalCount ?? row?.total_count ?? 1),
      kcal: Number.isFinite(kcal) ? kcal : 0,
      breakfastCount: Number(row?.breakfastCount ?? row?.breakfast_count ?? row?.morningCount ?? 0),
      lunchCount: Number(row?.lunchCount ?? row?.lunch_count ?? 0),
      dinnerCount: Number(row?.dinnerCount ?? row?.dinner_count ?? row?.eveningCount ?? 0),
      summary: row?.summary || row?.note || row?.meal_label || row?.label || ''
    };
  }

  function normalizeLabRow(row) {
    if (!row || typeof row !== 'object') return null;
    const name = row.name || row.label || row.title || row.itemName || row.normalized_key;
    const rawVal = row.value != null ? String(row.value) : '';
    const unit = row.unit != null ? String(row.unit).trim() : '';
    const combined = [rawVal, unit].filter(Boolean).join(' ').trim();
    const value = combined || row.examDate || row.exam_date || row.result || '';
    if (!name && !value) return null;
    return {
      name: name || '検査',
      value: value || 'まだありません',
      note: row.note || row.summary || ''
    };
  }

  function extractProfileUpdatesFromText(text) {
    const safe = normalizeText(text);
    const updates = {};
    if (!safe || containsQuestionTone(safe)) return updates;

    const nameMatch = safe.match(/名前[は：:]\s*([^\n]+)/);
    const heightMatch = safe.match(/身長[は：:]?\s*([0-9０-９]+(?:\.[0-9０-９]+)?)/);
    const weightMatch = safe.match(/体重[は：:]?\s*([0-9０-９]+(?:\.[0-9０-９]+)?)(?:kg|ＫＧ|キロ)?/i);
    const bodyFatMatch = safe.match(/体脂肪率[は：:]?\s*([0-9０-９]+(?:\.[0-9０-９]+)?)(?:%|％)?/i);
    const goalLineMatch = safe.match(/目標[は：:]\s*([^\n]+)/);
    const goalSentenceMatch = safe.match(/目標(?:体重)?は?[「"]?([^」"\n]+)(?:」|"|です)/);
    const aiTypeMatch = safe.match(/AIタイプ(?:は|を)?[「"]?([^」"\n]+?)(?:」|"|に更新|です|として)/);
    const planMatch = safe.match(/プラン(?:候補)?(?:は|を)?[「"]?([^」"\n]+?)(?:」|"|として|です)/);

    if (nameMatch) updates.preferredName = normalizeText(nameMatch[1]);
    if (heightMatch) updates.height = parseLooseNumber(heightMatch[1]);
    if (weightMatch) updates.latestWeight = parseLooseNumber(weightMatch[1]);
    if (bodyFatMatch) updates.latestBodyFat = parseLooseNumber(bodyFatMatch[1]);
    if (goalLineMatch) updates.goal = normalizeText(goalLineMatch[1]);
    else if (goalSentenceMatch) updates.goal = normalizeText(goalSentenceMatch[1]);
    if (aiTypeMatch) updates.aiType = normalizeText(aiTypeMatch[1]);
    if (planMatch) updates.currentPlan = normalizeText(planMatch[1]);

    if (!updates.latestWeight && /^([0-9０-９]+(?:\.[0-9０-９]+)?)(?:kg|ＫＧ|キロ)$/i.test(safe)) {
      updates.latestWeight = parseLooseNumber(safe);
    }
    return updates;
  }

  function inferProfileFromChat(messages, profile, lastUpdated) {
    const merged = { ...profile };
    sortMessages(messages).forEach((msg) => {
      const updates = extractProfileUpdatesFromText(msg.text);
      if (!Object.keys(updates).length) return;
      Object.entries(updates).forEach(([key, value]) => {
        if (value == null || value === '') return;
        merged[key] = value;
        if (key === 'latestWeight') merged.latestWeightDate = deriveReferenceDate(msg.createdAt || msg.time || lastUpdated);
      });
    });
    return merged;
  }

  function maybeAppendLatestWeight(rows, profile, updatedAt) {
    const list = sortByDateAsc(rows);
    const latestWeightValue = Number(profile?.latestWeight || profile?.currentWeight || profile?.weight || 0);
    const latestBodyFat = profile?.latestBodyFat ?? profile?.bodyFat ?? profile?.body_fat_percent ?? null;
    const latestDateText = profile?.latestWeightDate || profile?.weightDate || updatedAt || '';
    if (!latestWeightValue || !latestDateText) return list;
    const latestDate = formatDate(latestDateText, true);
    const lastRow = list[list.length - 1];
    const lastDate = lastRow ? formatDate(lastRow.date, true) : '';
    if (lastRow && lastDate === latestDate) {
      lastRow.value = latestWeightValue;
      if (latestBodyFat != null) lastRow.bodyFat = latestBodyFat;
      return list;
    }
    return [...list, { date: latestDateText, value: latestWeightValue, bodyFat: latestBodyFat }];
  }

  function inferMealRowsFromChat(messages, existingRows, lastUpdated) {
    const dayMap = new Map();
    const ordered = sortMessages(messages);
    let pending = null;

    ordered.forEach((msg) => {
      const text = normalizeText(msg.text);
      if (!text) return;
      const date = deriveReferenceDate(msg.createdAt || msg.time || lastUpdated);
      if (msg.role === 'user' && detectMealLikeText(text)) {
        pending = { date, slot: detectMealSlot(text) || '', summary: text };
        return;
      }
      if (pending && msg.role === 'assistant') {
        const kcal = detectKcal(text);
        if (kcal != null || /今回は|として見ています|食事/.test(text)) {
          const row = dayMap.get(pending.date) || { date: pending.date, count: 0, kcal: 0, breakfastCount: 0, lunchCount: 0, dinnerCount: 0, summary: '' };
          row.count += 1;
          row.kcal += Number(kcal || 0);
          if (pending.slot === 'breakfast') row.breakfastCount += 1;
          if (pending.slot === 'lunch') row.lunchCount += 1;
          if (pending.slot === 'dinner') row.dinnerCount += 1;
          row.summary = [row.summary, pending.slot === 'breakfast' ? '朝' : pending.slot === 'lunch' ? '昼' : pending.slot === 'dinner' ? '夜' : '', text.includes('kcal') ? `${Math.round(kcal || 0)}kcal` : ''].filter(Boolean).join(' / ');
          dayMap.set(pending.date, row);
          pending = null;
        }
      }
    });

    const merged = new Map();
    sortByDateAsc(existingRows).forEach((row) => {
      merged.set(formatDate(row.date, true), { ...row });
    });
    Array.from(dayMap.values()).forEach((row) => {
      const key = formatDate(row.date, true);
      if (!merged.has(key)) {
        merged.set(key, row);
        return;
      }
      const current = merged.get(key);
      current.count = Math.max(Number(current.count || 0), Number(row.count || 0));
      current.kcal = Math.max(Number(current.kcal || 0), Number(row.kcal || 0));
      current.breakfastCount = Math.max(Number(current.breakfastCount || 0), Number(row.breakfastCount || 0));
      current.lunchCount = Math.max(Number(current.lunchCount || 0), Number(row.lunchCount || 0));
      current.dinnerCount = Math.max(Number(current.dinnerCount || 0), Number(row.dinnerCount || 0));
      if (!normalizeText(current.summary)) current.summary = row.summary;
    });
    return sortByDateAsc(Array.from(merged.values()));
  }

  function normalizePortalData(raw, demoMode) {
    const data = raw && typeof raw === 'object' ? raw : {};
    const profileBase = data.profile || data.userProfile || data.authoritativeProfile || {};
    const userName = data.userName || data.displayName || profileBase.preferredName || data.user?.displayName || MOCK_DATA.userName;
    const connected = demoMode
      ? Boolean(data.connected)
      : Boolean(data.connected ?? data.isConnected ?? userName);

    const fallbackWeight = safeArray(data.records?.weight || data.weightRows || data.weight_logs || data.weights).map(normalizeWeightRow).filter(Boolean);
    const fallbackMeal = safeArray(data.records?.meal || data.mealRows || data.meal_logs || data.dailyMeals || data.meals).map(normalizeMealRow).filter(Boolean);
    const fallbackLab = safeArray(data.records?.lab || data.labRows || data.lab_results || data.labSummary).map(normalizeLabRow).filter(Boolean);
    const fallbackChat = safeArray(data.chat || data.messages || data.chatHistory).map(normalizeMessage).filter(Boolean);

    const weightRows = pickLongestSeries(data, normalizeWeightRow, fallbackWeight);
    const mealRows = pickLongestSeries(data, normalizeMealRow, fallbackMeal);
    const labRows = pickLongestSeries(data, normalizeLabRow, fallbackLab);
    const chatMessages = pickLongestSeries(data, normalizeMessage, fallbackChat);

    const mergedProfile = inferProfileFromChat(chatMessages, {
      goal: profileBase.goal || data.goal || '',
      currentPlan: profileBase.currentPlan || profileBase.selectedPlan || data.currentPlan || data.selectedPlan || data.plan || '',
      aiType: profileBase.aiType || data.aiType || '',
      preferredName: profileBase.preferredName || userName || '',
      height: profileBase.height || data.height || '',
      latestWeight: profileBase.latestWeight || profileBase.currentWeight || profileBase.weight || data.latestWeight || data.currentWeight || '',
      latestWeightDate: profileBase.latestWeightDate || profileBase.weightDate || data.latestWeightDate || data.updatedAt || data.lastUpdated || '',
      latestBodyFat: profileBase.latestBodyFat || profileBase.bodyFat || data.latestBodyFat || data.bodyFat || ''
    }, data.updatedAt || data.lastUpdated || '');

    return {
      connected,
      userName,
      lastUpdated: data.lastUpdated || data.updatedAt || data.latestUpdated || MOCK_DATA.lastUpdated,
      expiresAt: data.expiresAt || data.session?.expiresAt || data.connectionExpiry || MOCK_DATA.expiresAt,
      syncStatus: data.syncStatus || data.statusText || MOCK_DATA.syncStatus,
      reminders: data.reminders || data.memo || MOCK_DATA.reminders,
      profile: mergedProfile,
      chat: chatMessages.length ? sortMessages(chatMessages) : MOCK_DATA.chat,
      records: {
        weight: maybeAppendLatestWeight(weightRows.length ? weightRows : MOCK_DATA.records.weight, mergedProfile, data.updatedAt || data.lastUpdated || ''),
        meal: mealRows.length ? sortByDateAsc(mealRows) : sortByDateAsc(MOCK_DATA.records.meal),
        lab: labRows.length ? labRows : MOCK_DATA.records.lab
      }
    };
  }

  async function refreshForRange(days, force) {
    if (!force && state.cacheByRange[days]) {
      state.data = state.cacheByRange[days];
      return;
    }
    const base = await loadBootstrapData(days);
    const backupMessages = loadChatBackup();
    const extraMessages = await tryFetchChatHistory(Math.max(days, 365));
    base.chat = mergeMessages(mergeMessages(base.chat, backupMessages), extraMessages);
    base.profile = inferProfileFromChat(base.chat, base.profile, base.lastUpdated);
    base.records.weight = dedupeWeightRowsByDate(maybeAppendLatestWeight(base.records.weight, base.profile, base.lastUpdated));
    base.records.meal = inferMealRowsFromChat(base.chat, base.records.meal, base.lastUpdated);
    state.cacheByRange[days] = base;
    state.data = base;
  }

  function addLocalMessage(role, text, attachments) {
    const entry = {
      id: `local-${Date.now()}`,
      role,
      text,
      attachments: safeArray(attachments),
      time: new Date().toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit' }),
      createdAt: new Date().toISOString()
    };
    state.data.chat.push(entry);
    state.data.chat = sortMessages(state.data.chat);
    saveChatBackup(state.data.chat);
    renderChat();
  }

  function autosizeComposer() {
    els.composerInput.style.height = 'auto';
    els.composerInput.style.height = `${Math.min(els.composerInput.scrollHeight, 180)}px`;
  }

  function setComposerStatus(message, mode) {
    const safe = normalizeText(message) || '写真・画像・ファイルを送れます';
    els.composerHelp.textContent = safe;
    els.composerHelp.dataset.mode = mode || 'idle';
  }

  function setComposerSending(isSending) {
    const sendBtn = els.composerForm.querySelector('.send-btn');
    if (sendBtn) sendBtn.disabled = Boolean(isSending);
    els.plusBtn.disabled = Boolean(isSending);
    els.composerInput.disabled = Boolean(isSending);
  }

  function updateRecordHeadMeta() {
    const data = state.data || MOCK_DATA;
    const weightCount = getFilteredRows(data.records.weight).length;
    const mealCount = getFilteredRows(data.records.meal).length;
    els.recordHeadMeta.textContent = `表示期間 ${state.rangeDays}日 / 体重 ${weightCount}件 / 食事 ${mealCount}日分`;
  }

  function renderRecords() {
    const data = state.data || MOCK_DATA;
    updateRecordHeadMeta();
    renderSummaryCards();
    renderWeightPanel(data.records.weight);
    renderMealPanel(data.records.meal);
    renderLabPanel(data.records.lab);
  }

  function renderAll() {
    applyTheme();
    renderThemeOptions();
    updateRangeButtons();
    renderConnection();
    renderChat();
    renderRecords();
    if (state.activeTab === 'athlete' && state.athleteSupportEnabled) renderAthleteSupport();
  }

  function escapeHtml(value) {
    return String(value || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function hideAthleteTab() {
    state.athleteSupportEnabled = false;
    state.athleteSupportData = null;
    if (els.athleteTabBtn) els.athleteTabBtn.classList.add('hidden');
    if (state.activeTab === 'athlete') setActiveTab('chat');
  }

  async function loadAthleteSupportGate() {
    if (!state.sessionToken) {
      hideAthleteTab();
      return;
    }
    try {
      const st = await fetchJson('/api/web/athlete-support/status');
      state.athleteSupportEnabled = Boolean(st.enabled);
      if (state.athleteSupportEnabled) {
        if (els.athleteTabBtn) els.athleteTabBtn.classList.remove('hidden');
        await loadAthleteHome();
      } else {
        hideAthleteTab();
      }
    } catch (_err) {
      hideAthleteTab();
    }
  }

  async function loadAthleteHome() {
    if (!state.sessionToken || !state.athleteSupportEnabled) return;
    const j = await fetchJson('/api/web/athlete-support/home');
    state.athleteSupportData = j;
    renderAthleteSupport();
  }

  function renderAthleteSupport() {
    if (!els.athleteRoot) return;
    if (!state.athleteSupportEnabled || !state.athleteSupportData) {
      els.athleteRoot.innerHTML = '<p class="athlete-placeholder muted">この接続では伴走（陸上）が有効になっていません。</p>';
      return;
    }
    const d = state.athleteSupportData;
    const p = d.profile || {};
    const c = d.condition || {};
    const t = d.training || {};
    const m = d.menu || {};
    const echo = d.echo || {};
    const days = d.daysToNextCompetition;
    const daysLine = days == null ? '—' : `${days} 日`;
    const md = d.monthlyDialogue || {};

    const roadmapHtml = safeArray(d.roadmap)
      .map(
        (step) => `
        <li class="roadmap-item${step.emphasis ? ' roadmap-em' : ''}">
          <div class="roadmap-title">${escapeHtml(step.label)}</div>
          <div class="roadmap-meta">${escapeHtml(step.season)}</div>
          <p class="roadmap-note">${escapeHtml(step.note)}</p>
        </li>`
      )
      .join('');

    const monthlyAthlete = safeArray(md.athlete)
      .map((line) => `<li>${escapeHtml(line)}</li>`)
      .join('');
    const monthlyParent = safeArray(md.parent)
      .map((line) => `<li>${escapeHtml(line)}</li>`)
      .join('');

    els.athleteRoot.innerHTML = `
      <div class="athlete-top">
        <div class="athlete-card">
          <h3>目標と次の本番</h3>
          <p class="muted small">次の大会日はプロフィールで設定すると、ここにカウントダウンが出ます。</p>
          <p><strong>次の本番まで:</strong> ${escapeHtml(daysLine)}</p>
          <form id="athleteProfileForm" class="athlete-form">
            <label>表示名<input name="displayName" value="${escapeHtml(p.displayName)}" autocomplete="nickname" maxlength="60"></label>
            <label>800m 目標（任意）<input name="targetTime800" value="${escapeHtml(p.targetTime800)}" placeholder="例 2:20"></label>
            <label>1500m 目標（任意）<input name="targetTime1500" value="${escapeHtml(p.targetTime1500)}" placeholder="例 4:45"></label>
            <label>次の大会名<input name="nextCompetitionName" value="${escapeHtml(p.nextCompetitionName)}"></label>
            <label>次の大会日（YYYY-MM-DD）<input name="nextCompetitionDate" value="${escapeHtml(p.nextCompetitionDate)}" pattern="\\d{4}-\\d{2}-\\d{2}"></label>
            <label>今のフォーカス<textarea name="currentFocus" rows="2" maxlength="400">${escapeHtml(p.currentFocus)}</textarea></label>
            <button type="submit" class="primary-btn small">プロフィールを保存</button>
          </form>
        </div>
        <div class="athlete-card echo-card">
          <h3>今日の返し（意味づけ）</h3>
          <p>${escapeHtml(echo.summary || '')}</p>
          <h4>練習の意味</h4>
          <pre class="echo-pre">${escapeHtml(echo.meaning || '')}</pre>
          <h4>今日の成功体験の芽</h4>
          <p>${escapeHtml(echo.successMoment || '')}</p>
          <h4>明日への一言</h4>
          <p>${escapeHtml(echo.tomorrowLine || '')}</p>
          <p class="reassurance">${safeArray(d.reassurance).map((x) => escapeHtml(x)).join(' / ')}</p>
        </div>
      </div>

      <div class="athlete-card">
        <h3>今日の提案メニューと「なぜ」</h3>
        <p><strong>${escapeHtml(m.menu || '')}</strong></p>
        <ul class="menu-meaning">
          <li><span>目的</span> ${escapeHtml(m.purpose || '')}</li>
          <li><span>つくる力</span> ${escapeHtml(m.builds || '')}</li>
          <li><span>見どころ</span> ${escapeHtml(m.keyPoint || '')}</li>
          <li><span>つながり</span> ${escapeHtml(m.bridgeHint || '')}</li>
        </ul>
      </div>

      <div class="athlete-grid-2">
        <div class="athlete-card">
          <h3>体調（軽く）</h3>
          <form id="athleteDailyForm" class="athlete-form">
            <input type="hidden" name="date" value="${escapeHtml(d.date)}">
            <label>睡眠<input name="sleep" value="${escapeHtml(c.sleep)}" placeholder="例 7h"></label>
            <label>疲労<input name="fatigue" value="${escapeHtml(c.fatigue)}" placeholder="低/中/高"></label>
            <label>脚の痛み<input name="legPain" value="${escapeHtml(c.legPain)}" placeholder="なし/軽い/あり"></label>
            <label>気分<input name="mood" value="${escapeHtml(c.mood)}" placeholder="上向き/ふつう/下向き"></label>
            <label>月経の感じ（本人のみ・詳細は書かなくてOK）<input name="menstrual" value="${escapeHtml(c.menstrual)}" placeholder="なし/あり/つらめ など"></label>
            <label>食欲<input name="appetite" value="${escapeHtml(c.appetite)}"></label>
            <label>体の感じ<input name="bodyFeel" value="${escapeHtml(c.bodyFeel)}"></label>
            <label>練習の手応え<input name="practiceFeel" value="${escapeHtml(c.practiceFeel)}"></label>
            <label>今日のひとこと<textarea name="noteShort" rows="2" maxlength="400">${escapeHtml(c.noteShort)}</textarea></label>
            <label>深く書く欄（任意）<textarea name="noteDeep" rows="3" maxlength="2000">${escapeHtml(c.noteDeep)}</textarea></label>
            <button type="submit" class="primary-btn small">体調を保存</button>
          </form>
        </div>
        <div class="athlete-card">
          <h3>練習メモ（意味づけ）</h3>
          <form id="athleteTrainingForm" class="athlete-form">
            <input type="hidden" name="date" value="${escapeHtml(d.date)}">
            <label>実施メニュー<textarea name="menu" rows="2" maxlength="400">${escapeHtml(t.menu || m.menu || '')}</textarea></label>
            <label>今日の目的<textarea name="purpose" rows="2" maxlength="400">${escapeHtml(t.purpose || m.purpose || '')}</textarea></label>
            <label>つくる力<textarea name="whatItBuilds" rows="2" maxlength="400">${escapeHtml(t.whatItBuilds || m.builds || '')}</textarea></label>
            <label>見どころ<textarea name="keyPoint" rows="2" maxlength="400">${escapeHtml(t.keyPoint || m.keyPoint || '')}</textarea></label>
            <label>RPE（0〜10）<input name="rpe" type="number" min="0" max="10" step="1" value="${t.rpe != null ? escapeHtml(String(t.rpe)) : ''}"></label>
            <label>振り返り<textarea name="selfComment" rows="3" maxlength="2000">${escapeHtml(t.selfComment)}</textarea></label>
            <button type="submit" class="primary-btn small">練習ログを保存</button>
          </form>
        </div>
      </div>

      <div class="athlete-card">
        <h3>年間ロードマップ（東京都・中1女子 800/1500）</h3>
        <ol class="roadmap-list">${roadmapHtml}</ol>
      </div>

      <div class="athlete-card">
        <h3>月1の対話ヒント（${escapeHtml(md.title || '')}）</h3>
        <div class="monthly-split">
          <div>
            <h4>選手向け</h4>
            <ul>${monthlyAthlete}</ul>
          </div>
          <div>
            <h4>親向け（Phase 2 で画面分離予定）</h4>
            <ul>${monthlyParent}</ul>
          </div>
        </div>
      </div>
    `;
    bindAthleteFormsOnce();
  }

  let athleteFormsBound = false;
  function bindAthleteFormsOnce() {
    if (athleteFormsBound || !els.athleteRoot) return;
    athleteFormsBound = true;
    els.athleteRoot.addEventListener('submit', async (event) => {
      const form = event.target;
      if (!(form instanceof HTMLFormElement)) return;
      event.preventDefault();
      const fid = form.id;
      try {
        if (fid === 'athleteProfileForm') {
          const body = Object.fromEntries(new FormData(form).entries());
          await postJson('/api/web/athlete-support/profile', body);
        } else if (fid === 'athleteDailyForm') {
          const body = Object.fromEntries(new FormData(form).entries());
          await postJson('/api/web/athlete-support/daily-condition', body);
        } else if (fid === 'athleteTrainingForm') {
          const body = Object.fromEntries(new FormData(form).entries());
          await postJson('/api/web/athlete-support/training-log', body);
        } else {
          return;
        }
        await loadAthleteHome();
      } catch (err) {
        const msg = normalizeText(err?.message) || '保存に失敗しました';
        window.alert(msg);
      }
    });
  }

  async function postJson(url, payload, useAuth = true) {
    const res = await fetch(url, {
      method: 'POST',
      credentials: 'include',
      headers: useAuth ? buildAuthHeaders({ 'Content-Type': 'application/json' }) : { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    const contentType = res.headers.get('content-type') || '';
    let json = {};
    if (contentType.includes('application/json')) {
      try {
        json = await res.json();
      } catch (_err) {
        json = {};
      }
    }
    if (!res.ok) {
      const err = new Error(json.message || json.error || `HTTP ${res.status}`);
      err.status = res.status;
      err.payload = json;
      throw err;
    }
    return json;
  }

  async function postForm(url, formData) {
    const res = await fetch(url, {
      method: 'POST',
      credentials: 'include',
      headers: buildAuthHeaders(),
      body: formData
    });
    const contentType = res.headers.get('content-type') || '';
    let json = {};
    if (contentType.includes('application/json')) {
      try {
        json = await res.json();
      } catch (_err) {
        json = {};
      }
    }
    if (!res.ok) {
      const err = new Error(json.message || json.error || `HTTP ${res.status}`);
      err.status = res.status;
      err.payload = json;
      throw err;
    }
    return json;
  }

  function applyServerReply(json) {
    const message = normalizeText(json.reply || json.message || json.text || json.assistantMessage || '');
    const portalLike = json.portalData || json.data || json.portal || json;
    const hasPortal = portalLike && typeof portalLike === 'object' && (portalLike.homeSnapshot || portalLike.recordsOverview || portalLike.chat);
    if (hasPortal) {
      const normalized = normalizePortalData(portalLike, false);
      normalized.chat = mergeMessages(state.data.chat, normalized.chat);
      state.data = normalized;
      state.cacheByRange[state.rangeDays] = normalized;
      if (message) {
        const dup = state.data.chat.some((m) => m.role === 'assistant' && normalizeText(m.text) === message);
        if (!dup) {
          addLocalMessage('assistant', message);
        } else {
          saveChatBackup(state.data.chat);
        }
      } else {
        saveChatBackup(state.data.chat);
      }
      renderAll();
    } else if (message) {
      addLocalMessage('assistant', message);
    }
  }

  async function trySendTextToServer(text) {
    try {
      const json = await postJson('/api/web/chat/send', { text, message: text, days: state.rangeDays });
      applyServerReply(json);
      return true;
    } catch (err) {
      const msg = normalizeText(err?.message || '');
      if (msg) addLocalMessage('assistant', msg);
      return false;
    }
  }

  async function tryUploadFiles(files, text) {
    const form = new FormData();
    form.append('text', text || '');
    form.append('message', text || '');
    Array.from(files || []).forEach((file) => {
      form.append('files', file);
    });
    const json = await postForm('/api/web/chat/upload', form);
    applyServerReply(json);
    return true;
  }

  async function sendText(text, files) {
    const safe = normalizeText(text);
    const pickedFiles = Array.from(files || []);
    if (!safe && !pickedFiles.length) return;

    setComposerSending(true);
    setComposerStatus('送信中です…', 'sending');
    try {
      const previewFiles = buildAttachmentPreview(pickedFiles);
      const localLabel = safe || (pickedFiles.length ? (previewFiles.some((file) => file.isImage) ? '写真を送信' : `${pickedFiles.length}件のファイルを送信`) : '');
      addLocalMessage('user', localLabel, previewFiles);

      state.pendingQuickAction = '';
      renderQuickActions();
      window.dispatchEvent(new CustomEvent('kokokara:web-send', { detail: { text: safe, files: pickedFiles.length } }));

      let delivered = false;
      let uploadError = '';
      if (pickedFiles.length) {
        try {
          delivered = await tryUploadFiles(pickedFiles, safe);
        } catch (err) {
          uploadError = normalizeText(err?.message || '') || '画像を送れませんでした。通信を確認して、もう一度写真だけ送ってください。';
          addLocalMessage('assistant', uploadError);
          setComposerStatus('送信に失敗しました。', 'error');
        }
      }

      if (!pickedFiles.length && safe) {
        const sent = await trySendTextToServer(safe);
        if (!sent) {
          setComposerStatus('送信に失敗しました。', 'error');
        } else {
          setComposerStatus('送信できました。', 'success');
        }
      } else if (pickedFiles.length && delivered) {
        setComposerStatus(safe ? 'メッセージと写真を送信できました。' : '添付を送信できました。', 'success');
      }
    } finally {
      setComposerSending(false);
    }
  }

  function saveMemo() {
    localStorage.setItem(MEMO_KEY, els.contextMemoInput.value || '');
  }

  function bindEvents() {
    els.toggleThemePanelBtn.addEventListener('click', toggleThemePanel);
    const mainTabGroup = document.getElementById('mainTabGroup');
    if (mainTabGroup) {
      mainTabGroup.addEventListener('click', (event) => {
        const btn = event.target.closest('.tab-btn');
        if (!btn || btn.classList.contains('hidden')) return;
        const tab = btn.dataset.tab;
        if (!tab) return;
        setActiveTab(tab);
        if (tab === 'chat') {
          requestAnimationFrame(() => scrollComposerIntoView());
        }
      });
    }
    if (els.goRecordsBtn) {
      els.goRecordsBtn.addEventListener('click', () => {
        setActiveTab('records');
      });
    }
    if (els.openAuxBtn) {
      els.openAuxBtn.addEventListener('click', () => {
        state.auxPanelOpen = true;
        renderAuxPanelState();
      });
    }
    if (els.closeAuxBtn) {
      els.closeAuxBtn.addEventListener('click', () => {
        state.auxPanelOpen = false;
        renderAuxPanelState();
      });
    }
    els.recordTabButtons.forEach((btn) => btn.addEventListener('click', () => setRecordTab(btn.dataset.recordTab)));

    els.rangeGroups.forEach((group) => {
      group.addEventListener('click', async (event) => {
        const btn = event.target.closest('.range-chip');
        if (!btn) return;
        await setRange(Number(btn.dataset.range));
      });
    });

    els.plusBtn.addEventListener('click', () => els.filePicker.click());
    els.filePicker.addEventListener('change', () => {
      const count = els.filePicker.files?.length || 0;
      const names = Array.from(els.filePicker.files || []).map((file) => file.name).slice(0, 2).join(' / ');
      setComposerStatus(count ? `${count}件のファイルを選びました ${names}`.trim() : '写真・画像・ファイルを送れます', count ? 'selected' : 'idle');
    });
    els.composerInput.addEventListener('input', autosizeComposer);

    els.composerForm.addEventListener('submit', async (event) => {
      event.preventDefault();
      const text = els.composerInput.value.trim();
      const files = Array.from(els.filePicker.files || []);
      if (!text && !files.length) return;
      await sendText(text, files);
      els.composerInput.value = '';
      els.filePicker.value = '';
      setComposerStatus('写真・画像・ファイルを送れます', 'idle');
      autosizeComposer();
    });

    els.connectForm.addEventListener('submit', async (event) => {
      event.preventDefault();
      const value = els.connectInput.value.trim();
      if (!value) return;
      state.connectionState = 'connecting';
      setConnectAutoHint('');
      renderConnection();
      try {
        await connectWithCode(value);
        els.connectInput.value = '';
        await refreshForRange(state.rangeDays, true);
        renderAll();
        renderChat({ stickBottom: true });
        scrollComposerIntoView();
        try {
          await loadAthleteSupportGate();
        } catch (_e2) {}
      } catch (err) {
        state.sessionToken = '';
        localStorage.removeItem(WEB_TOKEN_KEY);
        if (state.data) state.data.connected = false;
        state.connectionState = 'disconnected';
        setConnectAutoHint(normalizeText(err?.message) || '接続に失敗しました。もう一度入力してください。');
        renderConnection();
      }
    });

    els.refreshBtn.addEventListener('click', async () => {
      await refreshForRange(state.rangeDays, true);
      renderAll();
      try {
        await loadAthleteSupportGate();
      } catch (_e) {}
    });

    els.disconnectBtn.addEventListener('click', () => {
      setConnectAutoHint('');
      state.data.connected = false;
      state.sessionToken = '';
      state.connectionState = 'disconnected';
      localStorage.removeItem(WEB_TOKEN_KEY);
      hideAthleteTab();
      renderConnection();
      window.dispatchEvent(new CustomEvent('kokokara:web-disconnect'));
    });

    els.loadOlderBtn.addEventListener('click', async () => {
      state.chatVisibleCount += 100;
      const extra = await tryFetchChatHistory(365);
      if (extra.length) state.data.chat = mergeMessages(state.data.chat, extra);
      renderChat({ stickBottom: false });
    });

    els.saveMemoBtn.addEventListener('click', saveMemo);
    els.sendMemoBtn.addEventListener('click', () => {
      saveMemo();
      fillComposer(els.contextMemoInput.value);
    });
    els.contextMemoInput.addEventListener('change', saveMemo);

    els.quickActionFocusBtn.addEventListener('click', () => {
      els.composerInput.focus();
    });

    window.addEventListener('resize', () => renderRecords());
  }

  async function init() {
    els.contextMemoInput.value = localStorage.getItem(MEMO_KEY) || '';
    setConnectAutoHint('');
    const urlCode = getCodeFromUrl();
    let sessionOk = false;
    state.connectionState = state.sessionToken ? 'connecting' : 'disconnected';
    if (state.sessionToken) {
      try {
        await fetchJson('/api/web/me');
        sessionOk = true;
        state.connectionState = 'connected';
      } catch (_error) {
        sessionOk = false;
        state.sessionToken = '';
        localStorage.removeItem(WEB_TOKEN_KEY);
      }
    }
    if (sessionOk && urlCode) {
      stripCodeFromUrl();
    }
    if (!sessionOk && urlCode) {
      state.connectionState = 'connecting';
      renderConnection();
      try {
        await connectWithCode(urlCode);
      } catch (err) {
        setConnectAutoHint(normalizeText(err?.message) || '自動接続できませんでした。下の欄にコードを入れて接続してください。');
        state.sessionToken = '';
        localStorage.removeItem(WEB_TOKEN_KEY);
        if (state.data) state.data.connected = false;
        state.connectionState = 'disconnected';
        if (els.connectInput) els.connectInput.value = urlCode;
      }
    }
    await refreshForRange(state.rangeDays, true);
    bindEvents();
    renderAll();
    renderAuxPanelState();
    if (state.sessionToken) {
      renderChat({ stickBottom: true });
      requestAnimationFrame(() => scrollComposerIntoView());
      try {
        await loadAthleteSupportGate();
      } catch (_e3) {}
    }
  }

  init();
})();
