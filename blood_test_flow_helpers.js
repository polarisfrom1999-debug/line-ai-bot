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

  const match = s.match(/-?\d+(\.\d+)?/);
  if (!match) return null;

  const num = Number(match[0]);
  if (!Number.isFinite(num)) return null;

  return String(num);
}

function toNumberOrNull(input) {
  const normalized = normalizeNumberInput(input);
  if (normalized == null) return null;
  const num = Number(normalized);
  return Number.isFinite(num) ? num : null;
}

function formatMaybeNumber(value) {
  if (value === undefined || value === null || value === "") return null;
  const num = Number(value);
  if (!Number.isFinite(num)) return String(value);
  return Number.isInteger(num) ? String(num) : String(num);
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
  const itemOrder = ["hba1c", "fasting_glucose", "ldl", "hdl", "triglycerides", "ast", "alt", "ggt", "uric_acid", "creatinine"];
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

async function getRecentLabResults(supabase, userId, limit = 6) {
  const { data, error } = await supabase
    .from("lab_results")
    .select("measured_at,hba1c,fasting_glucose,ldl,hdl,triglycerides,ast,alt,ggt,uric_acid,creatinine")
    .eq("user_id", userId)
    .order("measured_at", { ascending: false })
    .limit(limit);

  if (error) throw error;
  return data || [];
}

function pickComparisonItems(current, previous) {
  const targets = [
    { key: "hba1c", label: "HbA1c", better: "lower" },
    { key: "ldl", label: "LDL", better: "lower" },
    { key: "fasting_glucose", label: "血糖", better: "lower" },
    { key: "uric_acid", label: "尿酸", better: "lower" },
    { key: "creatinine", label: "クレアチニン", better: "lower" },
    { key: "hdl", label: "HDL", better: "higher" },
    { key: "triglycerides", label: "TG", better: "lower" },
  ];

  const comments = [];

  for (const target of targets) {
    const curr = toNumberOrNull(current?.[target.key]);
    const prev = toNumberOrNull(previous?.[target.key]);
    if (curr == null || prev == null) continue;
    if (curr === prev) continue;

    const diff = Number((curr - prev).toFixed(2));
    const absDiff = Math.abs(diff);

    if (absDiff === 0) continue;

    if (target.better === "lower") {
      if (diff < 0) {
        comments.push(`${target.label}は前回の${formatMaybeNumber(prev)}から${formatMaybeNumber(curr)}へ下がっていて良い流れです。`);
      } else {
        comments.push(`${target.label}は前回の${formatMaybeNumber(prev)}から${formatMaybeNumber(curr)}へ上がっています。`);
      }
    } else {
      if (diff > 0) {
        comments.push(`${target.label}は前回の${formatMaybeNumber(prev)}から${formatMaybeNumber(curr)}へ上がっていて良い変化です。`);
      } else {
        comments.push(`${target.label}は前回の${formatMaybeNumber(prev)}から${formatMaybeNumber(curr)}へ下がっています。`);
      }
    }
  }

  return comments.slice(0, 3);
}

function buildPostSaveComparisonMessage(savedRow, recentRows) {
  const rows = Array.isArray(recentRows) ? recentRows : [];
  if (!rows.length) {
    return "保存しました。これで今後の変化も見やすくなりますね。";
  }

  const currentDate = savedRow?.measured_at || null;
  const previous = rows.find((r) => r.measured_at !== currentDate);

  if (!previous) {
    return "保存しました。まだ比較回数は少ないですが、これから変化を追いやすくなりますね。";
  }

  const comments = pickComparisonItems(savedRow, previous);
  const lines = [];
  lines.push("保存しました。これで今後の変化も見やすくなりますね。");
  lines.push("");
  lines.push(`前回: ${String(previous.measured_at).replace(/-/g, "/")}`);
  lines.push(`今回: ${String(savedRow.measured_at).replace(/-/g, "/")}`);

  if (comments.length) {
    lines.push("");
    lines.push("【前回との比較】");
    for (const c of comments) lines.push(`・${c}`);
  } else {
    lines.push("");
    lines.push("前回と比較できる主要項目はまだ少ないですが、データはしっかり蓄積されています。");
  }

  return lines.join("\n");
}

function buildLabHistoryText(rows, itemKey, label) {
  const valid = (rows || [])
    .filter((r) => r && r.measured_at && r[itemKey] != null)
    .sort((a, b) => String(a.measured_at).localeCompare(String(b.measured_at)));

  if (!valid.length) {
    return `${label}の推移データはまだありません。`;
  }

  const lines = [];
  lines.push(`【${label}の推移】`);
  for (const row of valid) {
