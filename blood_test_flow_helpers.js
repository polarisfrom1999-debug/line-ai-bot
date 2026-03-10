const LAB_ITEM_LABELS = {
  measured_at: '日付',
  hba1c: 'HbA1c',
  fasting_glucose: '血糖',
  ldl: 'LDL',
  hdl: 'HDL',
  triglycerides: 'TG',
  ast: 'AST',
  alt: 'ALT',
  ggt: 'γGTP',
  uric_acid: '尿酸',
  creatinine: 'クレアチニン',
};

function formatDateOnly(value) {
  if (!value) return '';
  return String(value).slice(0, 10).replace(/-/g, '/');
}

function normalizeDateInput(input) {
  const s = String(input || '').trim().replace(/\./g, '/').replace(/-/g, '/');
  const m = s.match(/^(\d{4})\/(\d{1,2})\/(\d{1,2})$/);
  if (!m) return null;
  const yyyy = m[1];
  const mm = m[2].padStart(2, '0');
  const dd = m[3].padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

function normalizeNumberInput(input) {
  const s = String(input || '')
    .trim()
    .replace(/,/g, '')
    .replace(/\s*[A-Za-zＨＬHL]+\s*$/u, '');
  if (!/^-?\d+(\.\d+)?$/.test(s)) return null;
  return s;
}

function toNumberOrNull(v) {
  if (v == null || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function renderPanelSummary(panelDate, items) {
  const lines = [];
  lines.push('血液検査の内容を読み取りました。');
  lines.push('少し見えにくい所もあるので、まずは一緒に確認させてくださいね。');
  lines.push('');
  lines.push('【検査日】');
  lines.push(formatDateOnly(panelDate));
  lines.push('');
  lines.push('【読み取れた項目】');

  const order = [
    'hba1c',
    'fasting_glucose',
    'ldl',
    'hdl',
    'triglycerides',
    'ast',
    'alt',
    'ggt',
    'uric_acid',
    'creatinine',
  ];

  for (const key of order) {
    if (items?.[key] != null && items[key] !== '') {
      lines.push(`${LAB_ITEM_LABELS[key]}: ${items[key]}`);
    }
  }

  lines.push('');
  lines.push('この内容でよければ保存できます。');
  lines.push('間違いがあれば修正したい項目を選んでください。');
  return lines.join('\n');
}

function buildLabQuickReplyMain(items = {}) {
  const labels = ['この内容で保存', '日付を修正'];

  const itemOrder = [
    'hba1c',
    'fasting_glucose',
    'ldl',
    'hdl',
    'triglycerides',
    'ast',
    'alt',
    'ggt',
    'uric_acid',
    'creatinine',
  ];

  for (const key of itemOrder) {
    if (items[key] != null && items[key] !== '') {
      labels.push(`${LAB_ITEM_LABELS[key]}を修正`);
    }
  }

  labels.push('他の項目を修正');
  return labels.slice(0, 13);
}

async function createLabDraftSession(supabase, payload) {
  const { data, error } = await supabase
    .from('lab_import_sessions')
    .insert(payload)
    .select('*')
    .single();
  if (error) throw error;
  return data;
}

async function getOpenLabDraft(supabase, userId) {
  const { data, error } = await supabase
    .from('lab_import_sessions')
    .select('*')
    .eq('user_id', userId)
    .eq('status', 'draft')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) throw error;
  return data || null;
}

async function setActiveLabCorrection(supabase, sessionId, itemName, panelDate) {
  const { error } = await supabase
    .from('lab_import_sessions')
    .update({ active_item_name: itemName, active_panel_date: panelDate })
    .eq('id', sessionId);

  if (error) throw error;
}

async function clearActiveLabCorrection(supabase, sessionId) {
  const { error } = await supabase
    .from('lab_import_sessions')
    .update({ active_item_name: null, active_panel_date: null })
    .eq('id', sessionId);

  if (error) throw error;
}

async function applyLabCorrection(supabase, session, correctedValue) {
  const itemName = session.active_item_name;
  let panelDate = session.active_panel_date;

  if (!itemName || !panelDate) {
    throw new Error('No active correction target');
  }

  const working = JSON.parse(JSON.stringify(session.working_data_json || {}));
  if (!working[panelDate]) working[panelDate] = {};

  if (itemName === 'measured_at') {
    const date = normalizeDateInput(correctedValue);
    if (!date) throw new Error('INVALID_DATE');

    const existing = working[panelDate];
    delete working[panelDate];
    working[date] = existing;
    panelDate = date;
  } else {
    const num = normalizeNumberInput(correctedValue);
    if (!num) throw new Error('INVALID_NUMBER');
    working[panelDate][itemName] = num;
  }

  const { data, error } = await supabase
    .from('lab_import_sessions')
    .update({
      working_data_json: working,
      active_item_name: null,
      active_panel_date: null,
      selected_date: panelDate,
    })
    .eq('id', session.id)
    .select('*')
    .single();

  if (error) throw error;

  if (itemName !== 'measured_at') {
    await supabase.from('lab_import_items').insert({
      session_id: session.id,
      panel_date: panelDate,
      item_name: itemName,
      original_value: String((session.working_data_json?.[session.active_panel_date] || {})[itemName] ?? ''),
      corrected_value: String(correctedValue),
      is_corrected: true,
    });
  }

  return data;
}

async function confirmLabDraftToResults(supabase, session, panelDate) {
  const cleanDate = String(panelDate).slice(0, 10);
  const items = (session.working_data_json || {})[panelDate] || (session.working_data_json || {})[cleanDate] || {};

  const row = {
    user_id: session.user_id,
    measured_at: cleanDate,
    hba1c: toNumberOrNull(items.hba1c),
    fasting_glucose: toNumberOrNull(items.fasting_glucose),
    ldl: toNumberOrNull(items.ldl),
    hdl: toNumberOrNull(items.hdl),
    triglycerides: toNumberOrNull(items.triglycerides),
    ast: toNumberOrNull(items.ast),
    alt: toNumberOrNull(items.alt),
    ggt: toNumberOrNull(items.ggt),
    uric_acid: toNumberOrNull(items.uric_acid),
    creatinine: toNumberOrNull(items.creatinine),
    source_image_url: session.source_image_url ?? null,
    import_session_id: session.id,
    is_user_confirmed: true,
    ai_summary: 'ユーザー確認後に保存された血液検査結果です。',
  };

  const { data: existing, error: findError } = await supabase
    .from('lab_results')
    .select('id, measured_at')
    .eq('user_id', session.user_id)
    .gte('measured_at', `${cleanDate}T00:00:00`)
    .lt('measured_at', `${cleanDate}T23:59:59`)
    .limit(1)
    .maybeSingle();

  if (findError) throw findError;

  if (existing?.id) {
    const { error: updateErr } = await supabase
      .from('lab_results')
      .update(row)
      .eq('id', existing.id);
    if (updateErr) throw updateErr;
  } else {
    const { error: insertErr } = await supabase.from('lab_results').insert(row);
    if (insertErr) throw insertErr;
  }

  const { error: sessionErr } = await supabase
    .from('lab_import_sessions')
    .update({
      status: 'confirmed',
      selected_date: cleanDate,
      active_item_name: null,
      active_panel_date: null,
    })
    .eq('id', session.id);

  if (sessionErr) throw sessionErr;
}

async function getRecentLabResults(supabase, userId, limit = 6) {
  const { data, error } = await supabase
    .from('lab_results')
    .select('*')
    .eq('user_id', userId)
    .order('measured_at', { ascending: false })
    .limit(limit);

  if (error) throw error;
  return data || [];
}

function compareValue(curr, prev, lowerIsBetter = true) {
  const c = toNumberOrNull(curr);
  const p = toNumberOrNull(prev);
  if (c == null || p == null) return null;
  if (c === p) return 'same';

  if (lowerIsBetter) {
    return c < p ? 'improved' : 'worsened';
  }
  return c > p ? 'improved' : 'worsened';
}

function buildPostSaveComparisonMessage(savedRow, recentRows) {
  const currentDate = String(savedRow?.measured_at || '').slice(0, 10);

  const previous = (recentRows || []).find(
    (r) => String(r.measured_at || '').slice(0, 10) !== currentDate
  );

  const lines = [];
  lines.push('保存しました。これで今後の変化も見やすくなりますね。');
  lines.push('');
  lines.push(`前回: ${previous ? formatDateOnly(previous.measured_at) : '比較データなし'}`);
  lines.push(`今回: ${formatDateOnly(savedRow.measured_at)}`);
  lines.push('');

  if (!previous) {
    lines.push('前回と比較できる主要項目はまだ少ないですが、データはしっかり蓄積されています。');
    return lines.join('\n');
  }

  const comments = [];

  const rules = [
    { key: 'hba1c', label: 'HbA1c', lowerIsBetter: true },
    { key: 'fasting_glucose', label: '血糖', lowerIsBetter: true },
    { key: 'ldl', label: 'LDL', lowerIsBetter: true },
    { key: 'hdl', label: 'HDL', lowerIsBetter: false },
    { key: 'triglycerides', label: 'TG', lowerIsBetter: true },
    { key: 'uric_acid', label: '尿酸', lowerIsBetter: true },
    { key: 'creatinine', label: 'クレアチニン', lowerIsBetter: true },
  ];

  for (const rule of rules) {
    const curr = toNumberOrNull(savedRow?.[rule.key]);
    const prev = toNumberOrNull(previous?.[rule.key]);
    if (curr == null || prev == null) continue;

    const result = compareValue(curr, prev, rule.lowerIsBetter);
    if (result === 'improved') {
      comments.push(`${rule.label}は ${prev} → ${curr} で良い変化が見えています。`);
    } else if (result === 'worsened') {
      comments.push(`${rule.label}は ${prev} → ${curr} でした。ここは次回また一緒に流れを見ていきましょう。`);
    } else {
      comments.push(`${rule.label}は ${prev} → ${curr} で大きく崩さず維持できています。`);
    }
  }

  if (!comments.length) {
    lines.push('前回と比較できる主要項目はまだ少ないですが、データはしっかり蓄積されています。');
    return lines.join('\n');
  }

  lines.push(...comments.slice(0, 4));
  return lines.join('\n');
}

function buildLabHistoryText(rows, key, label) {
  const validRows = (rows || [])
    .filter((row) => row && row[key] != null)
    .sort((a, b) => String(a.measured_at).localeCompare(String(b.measured_at)));

  if (!validRows.length) {
    return `【${label}の推移】\nまだデータがありません。`;
  }

  const lines = [`【${label}の推移】`];
  for (const row of validRows) {
    lines.push(`${formatDateOnly(row.measured_at)}: ${row[key]}`);
  }
  return lines.join('\n');
}

module.exports = {
  LAB_ITEM_LABELS,
  formatDateOnly,
  normalizeDateInput,
  normalizeNumberInput,
  renderPanelSummary,
  buildLabQuickReplyMain,
  createLabDraftSession,
  getOpenLabDraft,
  setActiveLabCorrection,
  clearActiveLabCorrection,
  applyLabCorrection,
  confirmLabDraftToResults,
  getRecentLabResults,
  buildPostSaveComparisonMessage,
  buildLabHistoryText,
};
