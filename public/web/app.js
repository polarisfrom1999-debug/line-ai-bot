(function () {
  'use strict';

  const THEMES = [
    {
      id: 'soft-default',
      label: 'やさしい標準',
      desc: '迷ったらこれ',
      color: 'linear-gradient(90deg,#8b5d84,#cda6c7)'
    },
    {
      id: 'clear-soft',
      label: '明るく見やすい',
      desc: '白っぽく見たい時',
      color: 'linear-gradient(90deg,#8e6d46,#dcc4a7)'
    },
    {
      id: 'calm-high-contrast',
      label: 'くっきり見やすい',
      desc: '文字の見分けを強める',
      color: 'linear-gradient(90deg,#406688,#a9c4dc)'
    },
    {
      id: 'night-gentle',
      label: '夜もやさしい',
      desc: '暗めでまぶしさ控えめ',
      color: 'linear-gradient(90deg,#cba7cb,#7d8ea5)'
    }
  ];

  const QUICK_ACTIONS = [
    '今日の流れを見たい',
    '食事を送りたい',
    '体重を記録したい',
    '血液検査を見返したい',
    '相談を続けたい'
  ];

  const MOCK_DATA = {
    connected: true,
    userName: 'うっし〜',
    lastUpdated: '14:22',
    expiresAt: '2026-05-10 05:22',
    syncStatus: 'ライブ同期中',
    reminders: '今の流れを軽く見てから相談に入ると戻りやすいです。',
    chat: [
      { role: 'assistant', text: '接続できました。ここからはチャットをいちばん上で見やすく使えます。', time: '14:22' },
      { role: 'user', text: '私のプランは？', time: '14:29' },
      { role: 'assistant', text: '今のプランは「プレミアム」です。必要なら詳しい案内も出せます。', time: '14:29' }
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
        { date: '2026-03-17', count: 3, kcal: 1650, summary: '朝昼夜の3件' },
        { date: '2026-03-18', count: 2, kcal: 1220, summary: '昼夜の2件' },
        { date: '2026-03-19', count: 3, kcal: 1580, summary: '3件' },
        { date: '2026-03-20', count: 1, kcal: 620, summary: '朝食1件' },
        { date: '2026-03-21', count: 2, kcal: 1310, summary: '2件' },
        { date: '2026-03-22', count: 3, kcal: 1490, summary: '3件' },
        { date: '2026-03-23', count: 2, kcal: 1080, summary: '2件' }
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
    rangeDays: 7,
    theme: localStorage.getItem('kokokara-web-theme') || 'soft-default',
    data: null
  };

  const els = {
    body: document.body,
    connectBanner: document.getElementById('connectBanner'),
    connectForm: document.getElementById('connectForm'),
    connectInput: document.getElementById('connectInput'),
    sessionPill: document.getElementById('sessionPill'),
    sessionDetail: document.getElementById('sessionDetail'),
    refreshBtn: document.getElementById('refreshBtn'),
    disconnectBtn: document.getElementById('disconnectBtn'),
    quickRangeGroup: document.getElementById('quickRangeGroup'),
    recordRangeGroup: document.getElementById('recordRangeGroup'),
    themeGrid: document.getElementById('themeGrid'),
    themePanel: document.getElementById('themePanel'),
    toggleThemePanelBtn: document.getElementById('toggleThemePanelBtn'),
    tabButtons: Array.from(document.querySelectorAll('.tab-btn')),
    tabPanels: {
      chat: document.getElementById('chatPanel'),
      records: document.getElementById('recordsPanel')
    },
    chatLog: document.getElementById('chatLog'),
    composerForm: document.getElementById('composerForm'),
    composerInput: document.getElementById('composerInput'),
    plusBtn: document.getElementById('plusBtn'),
    filePicker: document.getElementById('filePicker'),
    composerHelp: document.getElementById('composerHelp'),
    chatHeadStatus: document.getElementById('chatHeadStatus'),
    contextCardBody: document.getElementById('contextCardBody'),
    quickActions: document.getElementById('quickActions'),
    summaryCards: document.getElementById('summaryCards'),
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
    weightList: document.getElementById('weightList'),
    mealList: document.getElementById('mealList'),
    labMeta: document.getElementById('labMeta'),
    labGrid: document.getElementById('labGrid')
  };

  function formatDate(dateText) {
    const d = new Date(dateText);
    if (Number.isNaN(d.getTime())) return dateText;
    return `${d.getMonth() + 1}/${d.getDate()}`;
  }

  function safeArray(value) {
    return Array.isArray(value) ? value : [];
  }

  function saveTheme(themeId) {
    state.theme = themeId;
    localStorage.setItem('kokokara-web-theme', themeId);
    applyTheme();
    renderThemeOptions();
  }

  function applyTheme() {
    document.body.setAttribute('data-theme', state.theme === 'soft-default' ? '' : state.theme);
  }

  function renderThemeOptions() {
    els.themeGrid.innerHTML = '';
    THEMES.forEach((theme) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = `theme-option${state.theme === theme.id ? ' active' : ''}`;
      btn.innerHTML = `
        <span class="theme-swatch" style="background:${theme.color}"></span>
        <span class="theme-label">${theme.label}</span>
        <span class="theme-desc">${theme.desc}</span>
      `;
      btn.addEventListener('click', () => saveTheme(theme.id));
      els.themeGrid.appendChild(btn);
    });
  }

  function toggleThemePanel() {
    els.themePanel.classList.toggle('collapsed');
  }

  function setActiveTab(tabId) {
    state.activeTab = tabId;
    els.tabButtons.forEach((btn) => btn.classList.toggle('active', btn.dataset.tab === tabId));
    Object.entries(els.tabPanels).forEach(([key, panel]) => panel.classList.toggle('active', key === tabId));
  }

  function setRecordTab(tabId) {
    state.activeRecordTab = tabId;
    els.recordTabButtons.forEach((btn) => btn.classList.toggle('active', btn.dataset.recordTab === tabId));
    Object.entries(els.recordPanels).forEach(([key, panel]) => panel.classList.toggle('active', key === tabId));
  }

  function updateRangeButtons() {
    const groups = [els.quickRangeGroup, els.recordRangeGroup].filter(Boolean);
    groups.forEach((group) => {
      Array.from(group.querySelectorAll('.range-chip')).forEach((btn) => {
        btn.classList.toggle('active', Number(btn.dataset.range) === state.rangeDays);
      });
    });
  }

  function setRange(days) {
    state.rangeDays = days;
    updateRangeButtons();
    renderRecords();
  }

  function getFilteredRows(rows) {
    const list = safeArray(rows);
    if (state.rangeDays === 90) return list.slice(-90);
    if (state.rangeDays === 30) return list.slice(-30);
    return list.slice(-7);
  }

  function calcWeightSummary(weightRows) {
    const rows = safeArray(weightRows);
    if (!rows.length) return { latest: '–', note: 'まだありません', sub: '最新データなし' };
    const latest = rows[rows.length - 1];
    const first = rows[0];
    const diff = first && latest ? Math.round((latest.value - first.value) * 10) / 10 : 0;
    return {
      latest: `${latest.value}kg`,
      note: latest.bodyFat != null ? `体脂肪率 ${latest.bodyFat}%` : '体脂肪率なし',
      sub: diff === 0 ? '直近で大きな変化なし' : `開始より ${diff > 0 ? '+' : ''}${diff}kg`
    };
  }

  function calcMealSummary(mealRows) {
    const rows = safeArray(mealRows);
    if (!rows.length) return { latest: '0件', note: 'まだありません', sub: '食事記録なし' };
    const totalCount = rows.reduce((sum, row) => sum + (row.count || 0), 0);
    const latest = rows[rows.length - 1];
    return {
      latest: `${totalCount}件`,
      note: `最新 ${latest.date}`,
      sub: latest.summary || '最近の食事流れ'
    };
  }

  function calcLabSummary(labRows) {
    const rows = safeArray(labRows);
    const latest = rows[0];
    return {
      latest: latest?.value || 'まだありません',
      note: latest?.name || '血液検査',
      sub: rows[1]?.value || '最新メモはまだありません'
    };
  }

  function renderSummaryCards() {
    const data = state.data || MOCK_DATA;
    const weightSummary = calcWeightSummary(getFilteredRows(data.records.weight));
    const mealSummary = calcMealSummary(getFilteredRows(data.records.meal));
    const labSummary = calcLabSummary(data.records.lab);
    const cards = [
      { title: '体重記録', ...weightSummary },
      { title: '食事記録', ...mealSummary },
      { title: '血液検査', ...labSummary }
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

  function drawLineChart(canvas, rows, valueKey, options) {
    const ctx = canvas.getContext('2d');
    const width = canvas.width;
    const height = canvas.height;
    const ratio = window.devicePixelRatio || 1;
    canvas.width = width * ratio;
    canvas.height = height * ratio;
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;
    ctx.scale(ratio, ratio);
    ctx.clearRect(0, 0, width, height);

    if (!rows.length) {
      ctx.fillStyle = getComputedStyle(document.body).getPropertyValue('--muted');
      ctx.font = '14px sans-serif';
      ctx.fillText('まだデータがありません', 18, 28);
      return;
    }

    const pad = { top: 22, right: 20, bottom: 36, left: 42 };
    const values = rows.map((row) => Number(row[valueKey] || 0));
    const min = Math.min(...values);
    const max = Math.max(...values);
    const gap = max === min ? 1 : max - min;

    ctx.strokeStyle = 'rgba(120,120,120,0.16)';
    ctx.lineWidth = 1;
    for (let i = 0; i < 4; i += 1) {
      const y = pad.top + ((height - pad.top - pad.bottom) / 3) * i;
      ctx.beginPath();
      ctx.moveTo(pad.left, y);
      ctx.lineTo(width - pad.right, y);
      ctx.stroke();
    }

    ctx.strokeStyle = getComputedStyle(document.body).getPropertyValue('--primary').trim();
    ctx.lineWidth = 3;
    ctx.beginPath();
    rows.forEach((row, index) => {
      const x = pad.left + ((width - pad.left - pad.right) / Math.max(rows.length - 1, 1)) * index;
      const y = height - pad.bottom - ((Number(row[valueKey] || 0) - min) / gap) * (height - pad.top - pad.bottom);
      if (index === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });
    ctx.stroke();

    ctx.fillStyle = getComputedStyle(document.body).getPropertyValue('--primary').trim();
    rows.forEach((row, index) => {
      const x = pad.left + ((width - pad.left - pad.right) / Math.max(rows.length - 1, 1)) * index;
      const y = height - pad.bottom - ((Number(row[valueKey] || 0) - min) / gap) * (height - pad.top - pad.bottom);
      ctx.beginPath();
      ctx.arc(x, y, 4, 0, Math.PI * 2);
      ctx.fill();
    });

    ctx.fillStyle = getComputedStyle(document.body).getPropertyValue('--muted').trim();
    ctx.font = '12px sans-serif';
    rows.forEach((row, index) => {
      const x = pad.left + ((width - pad.left - pad.right) / Math.max(rows.length - 1, 1)) * index;
      ctx.fillText(formatDate(row.date), x - 12, height - 10);
    });

    ctx.fillText(`${options.unit}${Math.round(max * 10) / 10}`, 8, pad.top + 4);
    ctx.fillText(`${options.unit}${Math.round(min * 10) / 10}`, 8, height - pad.bottom);
  }

  function drawBarChart(canvas, rows) {
    const ctx = canvas.getContext('2d');
    const width = canvas.width;
    const height = canvas.height;
    const ratio = window.devicePixelRatio || 1;
    canvas.width = width * ratio;
    canvas.height = height * ratio;
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;
    ctx.scale(ratio, ratio);
    ctx.clearRect(0, 0, width, height);

    if (!rows.length) {
      ctx.fillStyle = getComputedStyle(document.body).getPropertyValue('--muted');
      ctx.font = '14px sans-serif';
      ctx.fillText('まだデータがありません', 18, 28);
      return;
    }

    const pad = { top: 24, right: 20, bottom: 38, left: 34 };
    const max = Math.max(...rows.map((row) => row.count || 0), 1);
    const innerWidth = width - pad.left - pad.right;
    const innerHeight = height - pad.top - pad.bottom;
    const step = innerWidth / rows.length;
    const barWidth = Math.max(18, step * 0.5);

    rows.forEach((row, index) => {
      const x = pad.left + step * index + (step - barWidth) / 2;
      const barHeight = ((row.count || 0) / max) * innerHeight;
      const y = height - pad.bottom - barHeight;
      ctx.fillStyle = getComputedStyle(document.body).getPropertyValue('--accent').trim();
      ctx.fillRect(x, y, barWidth, barHeight);
      ctx.fillStyle = getComputedStyle(document.body).getPropertyValue('--muted').trim();
      ctx.font = '12px sans-serif';
      ctx.fillText(String(row.count || 0), x + 2, y - 6);
      ctx.fillText(formatDate(row.date), x - 2, height - 10);
    });
  }

  function renderWeightPanel(rows) {
    const filtered = getFilteredRows(rows);
    const latest = filtered[filtered.length - 1];
    els.weightChartMeta.textContent = latest ? `最新 ${latest.date} / ${latest.value}kg` : 'まだありません';
    drawLineChart(els.weightChartCanvas, filtered, 'value', { unit: '' });
    els.weightList.innerHTML = filtered.slice().reverse().map((row) => `
      <div class="simple-row">
        <div>
          <div class="simple-row-main">${row.value}kg</div>
          <div class="simple-row-sub">体脂肪率 ${row.bodyFat ?? '–'}%</div>
        </div>
        <div class="simple-row-sub">${row.date}</div>
      </div>
    `).join('');
  }

  function renderMealPanel(rows) {
    const filtered = getFilteredRows(rows);
    const latest = filtered[filtered.length - 1];
    els.mealChartMeta.textContent = latest ? `最新 ${latest.date} / ${latest.count}件` : 'まだありません';
    drawBarChart(els.mealChartCanvas, filtered);
    els.mealList.innerHTML = filtered.slice().reverse().map((row) => `
      <div class="simple-row">
        <div>
          <div class="simple-row-main">${row.count}件 / 約${row.kcal}kcal</div>
          <div class="simple-row-sub">${row.summary || '食事記録'}</div>
        </div>
        <div class="simple-row-sub">${row.date}</div>
      </div>
    `).join('');
  }

  function renderLabPanel(rows) {
    const items = safeArray(rows);
    els.labMeta.textContent = items[0]?.value || 'まだありません';
    els.labGrid.innerHTML = items.map((item) => `
      <div class="lab-pill">
        <div class="lab-name">${item.name}</div>
        <div class="lab-value">${item.value}</div>
        <div class="simple-row-sub">${item.note || ''}</div>
      </div>
    `).join('');
  }

  function renderRecords() {
    const data = state.data || MOCK_DATA;
    renderSummaryCards();
    renderWeightPanel(data.records.weight);
    renderMealPanel(data.records.meal);
    renderLabPanel(data.records.lab);
  }

  function renderChat() {
    const data = state.data || MOCK_DATA;
    els.chatLog.innerHTML = safeArray(data.chat).map((item) => `
      <div class="message-row ${item.role}">
        <div>
          <div class="message-bubble">${item.text}</div>
          <div class="message-meta">${item.time || ''}</div>
        </div>
      </div>
    `).join('');
    els.chatLog.scrollTop = els.chatLog.scrollHeight;
    els.chatHeadStatus.textContent = data.syncStatus || '同期中';
    els.contextCardBody.textContent = data.reminders || '必要な時だけ、直近の流れをここにまとめます。';
    els.quickActions.innerHTML = QUICK_ACTIONS.map((label) => `<button type="button" class="quick-action">${label}</button>`).join('');
  }

  function renderConnection() {
    const data = state.data || MOCK_DATA;
    if (data.connected) {
      els.connectBanner.classList.add('hidden');
      els.sessionPill.textContent = `接続済み ${data.userName || ''}`.trim();
      els.sessionDetail.textContent = `最終更新 ${data.lastUpdated || '—'} / 接続期限 ${data.expiresAt || '—'} / ${data.syncStatus || '同期中'}`;
    } else {
      els.connectBanner.classList.remove('hidden');
      els.sessionPill.textContent = '未接続';
      els.sessionDetail.textContent = '接続コードを入力すると使えます';
    }
  }

  async function loadBootstrapData() {
    const globalCandidates = [
      window.__KOKOKARA_WEB_DATA__,
      window.__WEB_PORTAL_DATA__,
      window.__PORTAL_DATA__,
      window.__BOOTSTRAP__
    ].filter(Boolean);
    if (globalCandidates.length) return normalizePortalData(globalCandidates[0]);

    const scriptEl = document.getElementById('web-portal-data');
    if (scriptEl?.textContent) {
      try {
        return normalizePortalData(JSON.parse(scriptEl.textContent));
      } catch (_err) {}
    }

    const endpoints = [
      '/api/web/portal-data',
      '/web/api/portal-data',
      '/api/web/portal',
      '/web/data'
    ];

    for (const url of endpoints) {
      try {
        const res = await fetch(url, { credentials: 'include' });
        if (!res.ok) continue;
        const json = await res.json();
        return normalizePortalData(json);
      } catch (_err) {}
    }

    return normalizePortalData(MOCK_DATA, true);
  }

  function normalizePortalData(raw, demoMode) {
    const data = raw && typeof raw === 'object' ? raw : {};
    const userName = data.userName || data.displayName || data.profile?.preferredName || data.user?.displayName || '';
    const connected = demoMode ? true : Boolean(data.connected ?? data.isConnected ?? userName);
    const weights = safeArray(data.records?.weight || data.weightRows || data.weight_logs).map((row) => ({
      date: row.date || row.measured_at || row.logged_at || row.created_at,
      value: Number(row.value ?? row.weight ?? row.weight_kg ?? 0),
      bodyFat: row.bodyFat ?? row.body_fat_percent ?? row.bodyFatPercent ?? null
    })).filter((row) => row.date && Number.isFinite(row.value));

    const meals = safeArray(data.records?.meal || data.mealRows || data.meal_logs).map((row) => ({
      date: row.date || row.eaten_at || row.logged_at || row.created_at,
      count: Number(row.count ?? row.mealCount ?? row.items_count ?? 1),
      kcal: Number(row.kcal ?? row.total_kcal ?? row.estimated_kcal ?? 0),
      summary: row.summary || row.note || row.meal_label || ''
    })).filter((row) => row.date);

    const labs = safeArray(data.records?.lab || data.labRows || data.lab_results || data.labSummary).map((row) => ({
      name: row.name || row.label || '検査',
      value: row.value || row.examDate || row.exam_date || 'まだありません',
      note: row.note || row.summary || ''
    }));

    return {
      connected,
      userName: userName || 'うっし〜',
      lastUpdated: data.lastUpdated || data.updatedAt || '14:22',
      expiresAt: data.expiresAt || data.connectionExpiry || '—',
      syncStatus: data.syncStatus || data.statusText || 'ライブ同期中',
      reminders: data.reminders || data.memo || '必要な時だけ、直近の流れをここにまとめます。',
      chat: safeArray(data.chat || data.messages).length ? (data.chat || data.messages).map((item) => ({
        role: item.role === 'assistant' || item.role === 'user' ? item.role : (item.isUser ? 'user' : 'assistant'),
        text: item.text || item.content || '',
        time: item.time || item.createdAt || item.created_at || ''
      })) : MOCK_DATA.chat,
      records: {
        weight: weights.length ? weights : MOCK_DATA.records.weight,
        meal: meals.length ? meals : MOCK_DATA.records.meal,
        lab: labs.length ? labs : MOCK_DATA.records.lab
      }
    };
  }

  function addLocalMessage(role, text) {
    const entry = {
      role,
      text,
      time: new Date().toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit' })
    };
    state.data.chat.push(entry);
    renderChat();
  }

  function autosizeComposer() {
    els.composerInput.style.height = 'auto';
    els.composerInput.style.height = `${Math.min(els.composerInput.scrollHeight, 180)}px`;
  }

  function bindEvents() {
    els.toggleThemePanelBtn.addEventListener('click', toggleThemePanel);

    els.tabButtons.forEach((btn) => {
      btn.addEventListener('click', () => setActiveTab(btn.dataset.tab));
    });

    els.recordTabButtons.forEach((btn) => {
      btn.addEventListener('click', () => setRecordTab(btn.dataset.recordTab));
    });

    [els.quickRangeGroup, els.recordRangeGroup].filter(Boolean).forEach((group) => {
      group.addEventListener('click', (event) => {
        const btn = event.target.closest('.range-chip');
        if (!btn) return;
        setRange(Number(btn.dataset.range));
      });
    });

    els.plusBtn.addEventListener('click', () => els.filePicker.click());
    els.filePicker.addEventListener('change', () => {
      const count = els.filePicker.files?.length || 0;
      els.composerHelp.textContent = count ? `${count}件のファイルを選びました` : '写真・画像・ファイルを送れます';
    });

    els.composerInput.addEventListener('input', autosizeComposer);

    els.composerForm.addEventListener('submit', (event) => {
      event.preventDefault();
      const text = els.composerInput.value.trim();
      if (!text) return;
      addLocalMessage('user', text);
      els.composerInput.value = '';
      autosizeComposer();
      window.dispatchEvent(new CustomEvent('kokokara:web-send', { detail: { text } }));
    });

    els.connectForm.addEventListener('submit', (event) => {
      event.preventDefault();
      const value = els.connectInput.value.trim();
      if (!value) return;
      state.data.connected = true;
      renderConnection();
      setActiveTab('chat');
      window.dispatchEvent(new CustomEvent('kokokara:web-connect', { detail: { code: value } }));
    });

    els.refreshBtn.addEventListener('click', async () => {
      state.data = await loadBootstrapData();
      renderAll();
    });

    els.disconnectBtn.addEventListener('click', () => {
      state.data.connected = false;
      renderConnection();
      window.dispatchEvent(new CustomEvent('kokokara:web-disconnect'));
    });
  }

  function renderAll() {
    applyTheme();
    renderThemeOptions();
    updateRangeButtons();
    renderConnection();
    renderChat();
    renderRecords();
  }

  async function init() {
    state.data = await loadBootstrapData();
    bindEvents();
    renderAll();
  }

  init();
})();
