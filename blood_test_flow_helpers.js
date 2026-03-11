'use strict';

function pad2(v) {
  return String(v).padStart(2, '0');
}

function formatDateOnly(value) {
  if (!value) return '';
  const s = String(value).trim();

  const direct = s.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})/);
  if (direct) {
    return `${direct[1]}-${pad2(direct[2])}-${pad2(direct[3])}`;
  }

  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return '';
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

function normalizeDateInput(text) {
  const s = String(text || '')
    .trim()
    .replace(/[年/.]/g, '-')
    .replace(/月/g, '-')
    .replace(/日/g, '')
    .replace(/\s+/g, '');

  const m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (!m) return null;

  return `${m[1]}-${pad2(m[2])}-${pad2(m[3])}`;
}

function parseNumberInput(text) {
  const raw = String(text || '').trim().replace(/,/g, '');
  const m = raw.match(/-?\d+(?:\.\d+)?/);
  if (!m) return null;

  const num = Number(m[0]);
  return Number.isFinite(num) ? num : null;
}

function normalizeLabValue(value) {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;

  const parsed = parseNumberInput(String(value));
  return parsed === null ? null : parsed;
}

function normalizeWorkingData(workingData) {
  const out = {};

  for (const [dateKey, items] of Object.entries(workingData || {})) {
    const date = formatDateOnly(dateKey);
    if (!date) continue;

    out[date] = {
      hba1c: normalizeLabValue(items?.hba1c),
      fasting_glucose: normalizeLabValue(items?.fasting_glucose),
      ldl: normalizeLabValue(items?.ldl),
      hdl: normalizeLabValue(items?.hdl),
      triglycerides: normalizeLabValue(items?.triglycerides),
      ast: normalizeLabValue(items?.ast),
      alt: normalizeLabValue(items?.alt),
      ggt: normalizeLabValue(items?.ggt),
      uric_acid: normalizeLabValue(items?.uric_acid),
      creatinine: normalizeLabValue(items?.creatinine),
    };
  }

  return out;
}

function buildMeasuredAtIso(dateStr) {
  const dateOnly = formatDateOnly(dateStr);
  if (!dateOnly) return null;
  return `${dateOnly}T00:00:00+09:00`;
}

async function closePreviousDrafts(supabase, userId) {
  const { error } = await supabase
    .from('lab_import_sessions')
    .update({ status: 'replaced' })
    .eq('user_id', userId)
    .eq('status', 'draft');

  if (error) throw error;
}

async function createLabDraftSession(supabase, payload) {
  await closePreviousDrafts(supabase, payload.user_id);

  const insertPayload = {
    ...payload,
    detected_dates_json: Array.isArray(payload.detected_dates_json)
      ? payload.detected_dates_json.map(formatDateOnly).filter(Boolean)
      : [],
    selected_date: payload.selected_date ? formatDateOnly(payload.selected_date) : null,
    working_data_json: normalizeWorkingData(payload.working_data_json || {}),
  };

  const { data, error } = await supabase
    .from('lab_import_sessions')
    .insert(insertPayload)
    .select('*')
    .single();

  if (error) throw error;
  return data;
}

async function getOpenLabDraft(supabase, userId) {
  const nowIso = new Date().toISOString();

  const { data, error } = await supabase
    .from('lab_import_sessions')
    .select('*')
    .eq('user_id', userId)
    .eq('status', 'draft')
    .gt('expires_at', nowIso)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) throw error;
  if (!data) return null;

  return {
    ...data,
    working_data_json: normalizeWorkingData(data.working_data_json || {}),
  };
}

async function setActiveLabCorrection(supabase, sessionId, field, selectedDate) {
  const { data, error } = await supabase
    .from('lab_import_sessions')
    .update({
      active_item_name: field,
      selected_date: selectedDate ? formatDateOnly(selectedDate) : null,
    })
    .eq('id', sessionId)
    .select('*')
    .single();

  if (error) throw error;
  return data;
}

async function applyLabCorrection(supabase, openLabDraft, inputText) {
  const field = String(openLabDraft?.active_item_name || '').trim();
  if (!field) {
    throw new Error('NO_ACTIVE_FIELD');
  }

  const workingData = normalizeWorkingData(openLabDraft.working_data_json || {});
  let selectedDate = formatDateOnly(openLabDraft.selected_date);

  if (!selectedDate) {
    selectedDate = String(Object.keys(workingData).sort().pop() || '');
  }

  if (!selectedDate) {
    throw new Error('INVALID_DATE');
  }

  if (!workingData[selectedDate]) {
    workingData[selectedDate] = {};
  }

  if (field === 'date') {
    const nextDate = normalizeDateInput(inputText);
    if (!nextDate) throw new Error('INVALID_DATE');

    const existing = workingData[selectedDate] || {};
    delete workingData[selectedDate];
    workingData[nextDate] = existing;
    selectedDate = nextDate;
  } else {
    const value = parseNumberInput(inputText);
    if (value === null) throw new Error('INVALID_NUMBER');
    workingData[selectedDate][field] = value;
  }

  const { data, error } = await supabase
    .from('lab_import_sessions')
    .update({
      selected_date: selectedDate,
      active_item_name: null,
      working_data_json: workingData,
    })
    .eq('id', openLabDraft.id)
    .select('*')
    .single();

  if (error) throw error;

  return {
    ...data,
    working_data_json: normalizeWorkingData(data.working_data_json || {}),
  };
}

async function findExistingLabResultByDate(supabase, userId, dateStr) {
  const measuredAt = buildMeasuredAtIso(dateStr);
  if (!measuredAt) return null;

  const { data, error } = await supabase
    .from('lab_results')
    .select('*')
    .eq('user_id', userId)
    .eq('measured_at', measuredAt)
    .limit(1)
    .maybeSingle();

  if (error) throw error;
  return data || null;
}

function buildLabResultPayload(openLabDraft, dateStr) {
  const dateOnly = formatDateOnly(dateStr);
  const row = normalizeWorkingData(openLabDraft.working_data_json || {})[dateOnly] || {};

  return {
    user_id: openLabDraft.user_id,
    measured_at: buildMeasuredAtIso(dateOnly),
    hba1c: row.hba1c ?? null,
    fasting_glucose: row.fasting_glucose ?? null,
    ldl: row.ldl ?? null,
    hdl: row.hdl ?? null,
    triglycerides: row.triglycerides ?? null,
    ast: row.ast ?? null,
    alt: row.alt ?? null,
    ggt: row.ggt ?? null,
    uric_acid: row.uric_acid ?? null,
    creatinine: row.creatinine ?? null,
    source_image_url: openLabDraft.source_image_url || null,
    import_session_id: openLabDraft.id,
    is_user_confirmed: true,
    ai_summary: null,
  };
}

async function upsertLabResultForDate(supabase, openLabDraft, dateStr) {
  const payload = buildLabResultPayload(openLabDraft, dateStr);
  if (!payload.measured_at) throw new Error('INVALID_DATE');

  const existing = await findExistingLabResultByDate(supabase, openLabDraft.user_id, dateStr);

  if (existing?.id) {
    const { data, error } = await supabase
      .from('lab_results')
      .update(payload)
      .eq('id', existing.id)
      .select('*')
      .single();

    if (error) throw error;
    return data;
  }

  const { data, error } = await supabase
    .from('lab_results')
    .insert(payload)
    .select('*')
    .single();

  if (error) throw error;
  return data;
}

async function closeLabDraftSession(supabase, sessionId) {
  const { error } = await supabase
    .from('lab_import_sessions')
    .update({
      status: 'confirmed',
      active_item_name: null,
    })
    .eq('id', sessionId);

  if (error) throw error;
}

async function confirmLabDraftToResults(supabase, openLabDraft, selectedDate) {
  const dateOnly = formatDateOnly(selectedDate);
  if (!dateOnly) throw new Error('INVALID_DATE');

  const saved = await upsertLabResultForDate(supabase, openLabDraft, dateOnly);
  await closeLabDraftSession(supabase, openLabDraft.id);
  return saved;
}

async function confirmAllLabDraftToResults(supabase, openLabDraft) {
  const workingData = normalizeWorkingData(openLabDraft.working_data_json || {});
  const dates = Object.keys(workingData).sort();

  if (!dates.length) {
    throw new Error('NO_DATES_TO_SAVE');
  }

  const savedRows = [];

  for (const date of dates) {
    const saved = await upsertLabResultForDate(supabase, openLabDraft, date);
    savedRows.push(saved);
  }

  await closeLabDraftSession(supabase, openLabDraft.id);
  return savedRows;
}

async function getRecentLabResults(supabase, userId, limit = 12) {
  const { data, error } = await supabase
    .from('lab_results')
    .select('*')
    .eq('user_id', userId)
    .order('measured_at', { ascending: false })
    .limit(limit);

  if (error) throw error;
  return Array.isArray(data) ? data : [];
}

function metricLine(label, current, previous) {
  const cur = normalizeLabValue(current);
  const prev = normalizeLabValue(previous);

  if (cur === null) return null;
  if (prev === null) return `${label}: ${cur}`;

  const diff = Math.round((cur - prev) * 100) / 100;
  const diffText = diff === 0 ? '変化なし' : diff > 0 ? `前回より +${diff}` : `前回より ${diff}`;
  return `${label}: ${cur}（${diffText}）`;
}

function buildPostSaveComparisonMessage(savedRow, recentRows) {
  const savedDate = formatDateOnly(savedRow?.measured_at);
  const rows = Array.isArray(recentRows) ? recentRows : [];

  const previous = rows
    .filter((r) => formatDateOnly(r.measured_at) !== savedDate)
    .sort((a, b) => {
      const aTime = new Date(a.measured_at || 0).getTime();
      const bTime = new Date(b.measured_at || 0).getTime();
      return bTime - aTime;
    })[0] || null;

  const lines = [
    savedDate ? `検査日: ${savedDate}` : null,
    metricLine('HbA1c', savedRow?.hba1c, previous?.hba1c),
    metricLine('空腹時血糖', savedRow?.fasting_glucose, previous?.fasting_glucose),
    metricLine('LDL', savedRow?.ldl, previous?.ldl),
    metricLine('HDL', savedRow?.hdl, previous?.hdl),
    metricLine('中性脂肪', savedRow?.triglycerides, previous?.triglycerides),
    metricLine('AST', savedRow?.ast, previous?.ast),
    metricLine('ALT', savedRow?.alt, previous?.alt),
    metricLine('γ-GTP', savedRow?.ggt, previous?.ggt),
    metricLine('尿酸', savedRow?.uric_acid, previous?.uric_acid),
    metricLine('クレアチニン', savedRow?.creatinine, previous?.creatinine),
  ].filter(Boolean);

  if (!lines.length) {
    return '今回の血液検査データを保存しました。';
  }

  return lines.join('\n');
}

module.exports = {
  createLabDraftSession,
  getOpenLabDraft,
  setActiveLabCorrection,
  applyLabCorrection,
  confirmLabDraftToResults,
  confirmAllLabDraftToResults,
  getRecentLabResults,
  buildPostSaveComparisonMessage,
  formatDateOnly,
};