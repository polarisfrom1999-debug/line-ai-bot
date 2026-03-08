const LAB_ITEM_LABELS = {
  measured_at: "日付",
  hba1c: "HbA1c",
  fasting_glucose: "血糖",
  ldl: "LDL",
  hdl: "HDL",
  triglycerides: "TG",
  ast: "AST",
  alt: "ALT",
  ggt: "γGTP",
  uric_acid: "尿酸",
  creatinine: "クレアチニン",
};

function normalizeDateInput(input) {
  const s = String(input || "").trim().replace(/\./g, "/").replace(/-/g, "/");
  const m = s.match(/^(\d{4})\/(\d{1,2})\/(\d{1,2})$/);
  if (!m) return null;
  const yyyy = m[1];
  const mm = m[2].padStart(2, "0");
  const dd = m[3].padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

function normalizeNumberInput(input) {
  if (input === undefined || input === null) return null;
  if (typeof input === "number") return Number.isFinite(input) ? String(input) : null;

  const s = String(input)
    .trim()
    .replace(/,/g, "")
    .replace(/　/g, " ");

  if (!s) return null;

  // 例:
  // "151 H" -> 151
  // "164L" -> 164
  // "5.6" -> 5.6
  // "0.79 mg/dL" -> 0.79
  // "↑151" -> 151
  // "  67  " -> 67
  const match = s.match(/-?\d+(\.\d+)?/);
  if (!match) return null;

  const num = Number(match[0]);
  if (!Number.isFinite(num)) return null;

  return String(num);
}

function renderPanelSummary(panelDate, items) {
  const lines = [];
  lines.push("血液検査の内容を読み取りました。");
  lines.push("少し見えにくい所もあるので、まずは一緒に確認させてくださいね。");
  lines.push("");
  lines.push("【検査日】");
  lines.push(panelDate.replace(/-/g, "/"));
  lines.push("");
  lines.push("【読み取れた項目】");

  const order = ["hba1c", "fasting_glucose", "ldl", "hdl", "triglycerides", "ast", "alt", "ggt", "uric_acid", "creatinine"];
  for (const key of order) {
    if (items?.[key] != null && items[key] !== "") {
      lines.push(`${LAB_ITEM_LABELS[key]}: ${items[key]}`);
    }
  }

  lines.push("");
  lines.push("この内容でよければ保存できます。");
  lines.push("間違いがあれば修正したい項目を選んでください。");
  return lines.join("\n");
}

function buildLabQuickReplyMain(items = {}) {
  const labels = ["この内容で保存", "日付を修正"];
  const itemOrder = ["hba1c", "ldl", "hdl", "triglycerides", "ast", "alt", "ggt"];
  for (const key of itemOrder) {
    if (items[key] != null && items[key] !== "") labels.push(`${LAB_ITEM_LABELS[key]}を修正`);
  }
  labels.push("他の項目を修正");
  return labels.slice(0, 13);
}

async function createLabDraftSession(supabase, payload) {
  const { data, error } = await supabase
    .from("lab_import_sessions")
    .insert(payload)
    .select("*")
    .single();
  if (error) throw error;
  return data;
}

async function getOpenLabDraft(supabase, userId) {
  const { data, error } = await supabase
    .from("lab_import_sessions")
    .select("*")
    .eq("user_id", userId)
    .eq("status", "draft")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return data || null;
}

async function setActiveLabCorrection(supabase, sessionId, itemName, panelDate) {
  const { error } = await supabase
    .from("lab_import_sessions")
    .update({ active_item_name: itemName, active_panel_date: panelDate })
    .eq("id", sessionId);
  if (error) throw error;
}

async function clearActiveLabCorrection(supabase, sessionId) {
  const { error } = await supabase
    .from("lab_import_sessions")
    .update({ active_item_name: null, active_panel_date: null })
    .eq("id", sessionId);
  if (error) throw error;
}

async function applyLabCorrection(supabase, session, correctedValue) {
  const itemName = session.active_item_name;
  let panelDate = session.active_panel_date;
  if (!itemName || !panelDate) throw new Error("No active correction target");

  const working = JSON.parse(JSON.stringify(session.working_data_json || {}));
  if (!working[panelDate]) working[panelDate] = {};

  if (itemName === "measured_at") {
    const date = normalizeDateInput(correctedValue);
    if (!date) throw new Error("INVALID_DATE");
    const existing = working[panelDate];
    delete working[panelDate];
    working[date] = existing;
    panelDate = date;
  } else {
    const num = normalizeNumberInput(correctedValue);
    if (!num) throw new Error("INVALID_NUMBER");
    working[panelDate][itemName] = num;
  }

  const { data, error } = await supabase
    .from("lab_import_sessions")
    .update({
      working_data_json: working,
      active_item_name: null,
      active_panel_date: null,
    })
    .eq("id", session.id)
    .select("*")
    .single();

  if (error) throw error;

  if (itemName !== "measured_at") {
    await supabase.from("lab_import_items").insert({
      session_id: session.id,
      panel_date: panelDate,
      item_name: itemName,
      original_value: String((session.working_data_json?.[session.active_panel_date] || {})[itemName] ?? ""),
      corrected_value: String(correctedValue),
      is_corrected: true,
    });
  }

  return data;
}

async function confirmLabDraftToResults(supabase, session, panelDate) {
  const items = (session.working_data_json || {})[panelDate] || {};

  const row = {
    user_id: session.user_id,
    measured_at: panelDate,
    hba1c: normalizeNumberInput(items.hba1c),
    fasting_glucose: normalizeNumberInput(items.fasting_glucose),
    ldl: normalizeNumberInput(items.ldl),
    hdl: normalizeNumberInput(items.hdl),
    triglycerides: normalizeNumberInput(items.triglycerides),
    ast: normalizeNumberInput(items.ast),
    alt: normalizeNumberInput(items.alt),
    ggt: normalizeNumberInput(items.ggt),
    uric_acid: normalizeNumberInput(items.uric_acid),
    creatinine: normalizeNumberInput(items.creatinine),
    source_image_url: session.source_image_url ?? null,
    import_session_id: session.id,
    is_user_confirmed: true,
    ai_summary: "ユーザー確認後に保存された血液検査結果です。",
  };

  const { data: existing, error: existingErr } = await supabase
    .from("lab_results")
    .select("id")
    .eq("user_id", session.user_id)
    .eq("measured_at", panelDate)
    .limit(1)
    .maybeSingle();

  if (existingErr) throw existingErr;

  if (existing?.id) {
    const { error: updateErr } = await supabase
      .from("lab_results")
      .update(row)
      .eq("id", existing.id);
    if (updateErr) throw updateErr;
  } else {
    const { error: insertErr } = await supabase.from("lab_results").insert(row);
    if (insertErr) throw insertErr;
  }

  const { error: sessionErr } = await supabase
    .from("lab_import_sessions")
    .update({
      status: "confirmed",
      selected_date: panelDate,
      active_item_name: null,
      active_panel_date: null,
    })
    .eq("id", session.id);

  if (sessionErr) throw sessionErr;
}

module.exports = {
  LAB_ITEM_LABELS,
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
};
