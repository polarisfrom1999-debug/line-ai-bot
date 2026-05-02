'use strict';

const { normalizeItemName, collectTrendRows, buildPanelTrendSummary } = require('./lab_trend_service');
const labItemAliasService = require('./lab_item_alias_service');
const labHistoryCompare = require('./lab_history_compare_service');
const labSessionRepository = require('../repositories/lab_session_repository');

function normalizeText(value) {
  return String(value || '').trim();
}

function getMetaPatientName(panel) {
  return normalizeText(panel?.meta?.patientName || panel?.patientName || panel?.patient_name);
}
function getMetaFacilityName(panel) {
  return normalizeText(panel?.meta?.facilityName || panel?.facilityName || panel?.facility_name);
}
function getMetaPrintDateForCopy(panel) {
  return normalizeDateToken(panel?.meta?.printDate || panel?.printDate || panel?.print_date);
}

function normalizeDateToken(token) {
  const safe = normalizeText(token);
  if (!safe) return '';
  const compact = safe.replace(/\s+/g, '');
  let m = safe.match(/(20\d{2})-(\d{2})-(\d{2})/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  m = safe.match(/(20\d{2})[\/\.年]\s*(\d{1,2})[\/\.月]\s*(\d{1,2})/);
  if (m) return `${m[1]}-${String(m[2]).padStart(2, '0')}-${String(m[3]).padStart(2, '0')}`;
  m = compact.match(/(20\d{2})[\/\.\-年]?(0?[1-9]|1[0-2])[\/\.\-月]?(0?[1-9]|[12]\d|3[01])日?/);
  if (m) return `${m[1]}-${String(m[2]).padStart(2, '0')}-${String(m[3]).padStart(2, '0')}`;
  m = safe.match(/([0-9]{2})[\/\.\-]\s*(\d{1,2})[\/\.\-]\s*(\d{1,2})/);
  if (m) {
    const yy = Number(m[1]);
    const yyyy = yy <= 39 ? 2000 + yy : 1900 + yy;
    return `${yyyy}-${String(m[2]).padStart(2, '0')}-${String(m[3]).padStart(2, '0')}`;
  }
  m = safe.match(/R\s*(\d+)[\.\/\-](\d{1,2})[\.\/\-](\d{1,2})/i);
  if (m) {
    const year = 2018 + Number(m[1]);
    return `${year}-${String(m[2]).padStart(2, '0')}-${String(m[3]).padStart(2, '0')}`;
  }
  return '';
}

function normalizeFlag(value) {
  const safe = normalizeText(value).toUpperCase();
  if (safe === 'H' || safe === 'HIGH') return 'H';
  if (safe === 'L' || safe === 'LOW') return 'L';
  return '';
}

function normalizeTarget(text) {
  const safe = normalizeText(text).toUpperCase();
  if (safe.includes('LDL/HDL')) return 'LDL/HDL比';
  if (safe.includes('LDL')) return 'LDL';
  if (safe.includes('HDL')) return 'HDL';
  if (safe.includes('HBA1C') || safe.includes('HB1AC')) return 'HbA1c';
  if (safe.includes('中性脂肪') || safe.includes('TG') || safe.includes('トリグリ')) return '中性脂肪';
  if (safe.includes('AST') || safe.includes('GOT')) return 'AST';
  if (safe.includes('ALT') || safe.includes('GPT')) return 'ALT';
  if (safe.includes('GTP')) return 'γ-GTP';
  if (safe.includes('CRE')) return 'クレアチニン';
  if (safe.includes('EGFR')) return 'eGFR';
  if (safe.includes('T-CHO') || safe.includes('総コレステロール') || safe === 'CHO') return '総コレステロール';
  if (safe.includes('血糖') || safe.includes('GLUCOSE')) return '血糖';
  if (safe.includes('尿酸')) return '尿酸';
  if (safe.includes('尿素窒素') || safe.includes('BUN')) return '尿素窒素';
  if (safe.includes('WBC') || safe.includes('白血球')) return 'WBC';
  return '';
}

function extractRequestedDate(text) {
  return normalizeDateToken(text);
}

function collectAvailableDates(panel) {
  const set = new Set();
  for (const d of panel?.examDates || []) {
    const nd = normalizeDateToken(d);
    if (nd) set.add(nd);
  }
  const latest = normalizeDateToken(panel?.latestExamDate || panel?.examDate || '');
  if (latest) set.add(latest);
  for (const item of panel?.items || []) {
    for (const row of item?.history || []) {
      const nd = normalizeDateToken(row?.date || '');
      if (nd) set.add(nd);
    }
  }
  for (const item of panel?.itemsStructured || []) {
    const d = normalizeDateToken(item?.observedDate || item?.observed_date || item?.date || '');
    if (d) set.add(d);
  }
  return [...set].sort();
}

function listImportantPreview(items = []) {
  const preferred = ['中性脂肪', 'HbA1c', 'LDL', 'HDL', 'WBC', '総コレステロール', 'AST'];
  const lines = [];
  for (const name of preferred) {
    const item = items.find((candidate) => normalizeItemName(candidate?.itemName || '') === normalizeItemName(name) && normalizeText(candidate?.value || ''));
    if (!item) continue;
    lines.push(`${item.itemName} ${item.value}${item.unit ? ` ${item.unit}` : ''}${item.flag ? ` ${item.flag}` : ''}`);
  }
  return lines.slice(0, 4);
}

function buildLabImageReply(panel) {
  const dates = collectAvailableDates(panel);
  const latest = normalizeDateToken(panel?.latestExamDate || panel?.examDate || '') || dates[dates.length - 1] || '';
  const issues = Array.isArray(panel?.issues) ? panel.issues.filter(Boolean) : [];
  const preview = listImportantPreview(panel?.items || []);
  const previewLine = preview.length ? `いま読み取れている主な数値の例は ${preview.join(' / ')} です。` : '';
  const dateLine = latest ? `検査日は ${latest} として扱っています。` : '';
  const issueLine = issues.length ? `（読み取り上の注意: ${issues[0]}）` : '';
  if ((panel?.documentKind || '').includes('multi') || dates.length >= 2) {
    const multiDate = dates.length ? `日付の候補は ${dates.join(' / ')} です。` : '';
    return [
      '今確認できる範囲では、検査結果の画像として受け取りました。',
      multiDate,
      dateLine,
      previewLine,
      issueLine,
      '要約としては、複数日付が写っている可能性があるため、項目名（例: TG、HbA1c）を指定して聞いてください。'
    ]
      .filter(Boolean)
      .join('\n');
  }
  return [
    '今確認できる範囲では、検査結果の画像として受け取りました。',
    dateLine,
    previewLine,
    issueLine,
    '聞きたい項目を「TGは？」のように短く送ってください。'
  ]
    .filter(Boolean)
    .join('\n');
}

function buildDateSelectionReply(date) {
  return `${date} を優先して見ます。このまま「TGは？」「HbA1cは？」のように聞いて大丈夫です。`;
}

function buildUnavailableDateReply(panel, requestedDate) {
  const dates = collectAvailableDates(panel);
  if (!dates.length) return `${requestedDate} はまだ確認できませんでした。`;
  return `${requestedDate} は今回の画像では見つかりませんでした。読み取れた日付は ${dates.join(' / ')} です。`;
}

function buildSaveReply(panel) {
  const dates = collectAvailableDates(panel);
  return [
    '読み取れた日付をまとめて保持しました。',
    dates.length ? `対象日付: ${dates.join(' / ')}` : null,
    'このまま「TGは？」「今までの傾向は？」のように聞いて大丈夫です。'
  ].filter(Boolean).join('\n');
}

function namesLikelyMatch(targetNorm, itemName) {
  const a = normalizeItemName(itemName || '');
  const b = targetNorm;
  if (!b) return false;
  if (a === b) return true;
  if (b === 'WBC' && /白血球|ＷＢＣ|WBC/i.test(a)) return true;
  if (b === '中性脂肪' && /中性脂肪|TG|トリグリ|トリグリセリド/i.test(a)) return true;
  if (b === 'HbA1c' && /HbA1c|ヘモグロビン|糖化/i.test(a)) return true;
  if (b === 'LDL' && /LDL|悪玉/i.test(a)) return true;
  if (b === 'HDL' && /HDL|善玉/i.test(a)) return true;
  if (a.includes(b) || b.includes(a)) return true;
  return false;
}

function findItem(panel, targetName) {
  const safe = normalizeTarget(targetName);
  const items = panel?.items || [];
  if (safe) {
    const exact = items.find((item) => normalizeItemName(item?.itemName || '') === safe);
    if (exact) return exact;
    const loose = items.find((item) => namesLikelyMatch(safe, item?.itemName || ''));
    if (loose) return loose;
  }
  const raw = normalizeText(targetName);
  if (!raw) return null;
  const fromItems = items.find((item) => namesLikelyMatch(normalizeItemName(raw), item?.itemName || '')) || null;
  if (fromItems) return fromItems;
  const structured = Array.isArray(panel?.itemsStructured) ? panel.itemsStructured : [];
  const canon = safe || normalizeTarget(raw) || normalizeItemName(raw);
  if (!canon) return null;
  const st = structured.find((it) => {
    const display = normalizeItemName(it?.name || it?.rawName || it?.itemName || '');
    if (display && normalizeItemName(display) === canon) return true;
    const nk = normalizeText(it?.normalizedKey || '').toLowerCase();
    const map = {
      triglycerides_tg: '中性脂肪',
      ast_got: 'AST',
      alt_gpt: 'ALT',
      ldl_cholesterol: 'LDL',
      hdl_cholesterol: 'HDL',
      hba1c: 'HbA1c',
      creatinine: 'クレアチニン',
      hemoglobin: '血色素量',
      glucose: '血糖',
      wbc: 'WBC'
    };
    const mapped = map[nk];
    return mapped && normalizeItemName(mapped) === canon;
  });
  if (!st) return null;
  return {
    itemName: canon,
    value: normalizeText(st.value || ''),
    unit: normalizeText(st.unit || ''),
    flag: normalizeText(st.flag || ''),
    history: []
  };
}

function findValueForDate(panel, targetName, selectedDate) {
  const item = findItem(panel, targetName);
  if (!item) return null;
  const safeDate = normalizeDateToken(selectedDate);
  const rows = collectTrendRows(panel, item.itemName);
  if (!rows.length) return null;
  if (safeDate) return rows.find((row) => row.date === safeDate) || null;
  return rows[rows.length - 1] || null;
}

function buildReferenceSentence(row) {
  const low = row?.referenceLow;
  const high = row?.referenceHigh;
  if (low == null && high == null) return '';
  if (low != null && high != null) return `基準 ${low}〜${high}`;
  if (low != null) return `基準下限 ${low}`;
  return `基準上限 ${high}`;
}

function buildFlagSentence(row) {
  if (row?.flag === 'H') return 'やや高めです。';
  if (row?.flag === 'L') return 'やや低めです。';
  return '基準内です。';
}

function extractMetricFromRawText(rawText, targetCanon) {
  const t = normalizeText(rawText).replace(/\s+/g, ' ');
  if (!t) return null;
  const num = (s) => String(s || '').replace(/,/g, '').trim();

  const tryLdl = () => {
    const patterns = [
      /LDL[-‐\s]?C?\s*[：:]\s*(\d+(?:\.\d+)?)\s*(mg\/dL|mmol\/L)?/i,
      /LDL[-‐\s]?C?\s+(\d+(?:\.\d+)?)\s*(mg\/dL|mmol\/L)?/i,
      /悪玉[^\d]{0,6}(\d+(?:\.\d+)?)\s*(mg\/dL)?/i,
    ];
    for (const re of patterns) {
      const m = t.match(re);
      if (m) return { itemName: 'LDLコレステロール', value: num(m[1]), unit: normalizeText(m[2] || 'mg/dL') };
    }
    return null;
  };

  const tryTg = () => {
    const patterns = [
      /(?:中性脂肪|トリグリセリド)\s*[：:]\s*(\d+(?:\.\d+)?)\s*(mg\/dL)?/i,
      /(?:中性脂肪|トリグリセリド)\s+(\d+(?:\.\d+)?)\s*(mg\/dL)?/i,
      /\bTG\b\s*[：:]\s*(\d+(?:\.\d+)?)\s*(mg\/dL)?/i,
      /\bTG\b\s+(\d+(?:\.\d+)?)\s*(mg\/dL)?/i,
    ];
    for (const re of patterns) {
      const m = t.match(re);
      if (m) return { itemName: '中性脂肪', value: num(m[1]), unit: normalizeText(m[2] || 'mg/dL') };
    }
    return null;
  };

  if (targetCanon === 'LDL') return tryLdl();
  if (targetCanon === '中性脂肪') return tryTg();
  return null;
}

function looksLikeJsonDump(s) {
  const t = normalizeText(s);
  return t.startsWith('{') || /"items"\s*:|"examDate"\s*:/.test(t);
}

function buildReadableInventoryReply(panel) {
  const exam = normalizeText(panel?.latestExamDate || panel?.examDate || '');
  const items = Array.isArray(panel?.items) ? panel.items : [];
  const structured = Array.isArray(panel?.itemsStructured) ? panel.itemsStructured : [];
  const lines = items
    .map((it) => {
      const v = normalizeText(it?.value || it?.currentValue || '');
      if (!v) return '';
      const u = it.unit ? ` ${it.unit}` : '';
      const f = it.flag ? ` ${it.flag}` : '';
      return `・${normalizeText(it.itemName || '項目')}: ${v}${u}${f}`;
    })
    .filter(Boolean);

  const raw = normalizeText(panel?.rawText || '');

  const fromMinSchema = structured
    .filter((b) => normalizeText(b?.normalizedKey) && normalizeText(b?.value))
    .map((b) => {
      const label = normalizeText(b.name || b.rawName || b.normalizedKey);
      const v = normalizeText(b.value);
      const u = b.unit ? ` ${b.unit}` : '';
      const f = b.flag ? ` ${b.flag}` : '';
      return `・${label || '項目'}: ${v}${u}${f}`;
    });
  const merged = lines.length > 0 ? lines : fromMinSchema;

  const nameOnlyLines = [];
  for (const it of items) {
    const nm = normalizeText(it?.itemName || it?.name || '');
    const v = normalizeText(it?.value || it?.currentValue || '');
    if (nm && !v) nameOnlyLines.push(`・${nm}: （数値はまだ確定できていません）`);
  }
  for (const block of structured) {
    if (normalizeText(block?.normalizedKey)) {
      const nm = normalizeText(block.name || block.rawName || block.normalizedKey);
      const v = normalizeText(block.value || '');
      if (nm && !v) {
        const line = `・${nm}: （数値はまだ確定できていません）`;
        if (!nameOnlyLines.some((x) => x.includes(nm))) nameOnlyLines.push(line);
      }
      continue;
    }
    const nm = normalizeText(block?.name_normalized || block?.name_original || '');
    if (!nm) continue;
    const hasVal = Array.isArray(block?.results)
      && block.results.some((r) => normalizeText(r?.value || ''));
    if (hasVal) continue;
    const line = `・${nm}: （数値はまだ確定できていません）`;
    if (!nameOnlyLines.some((x) => x.includes(nm))) nameOnlyLines.push(line);
  }

  const hintLines = [];
  const pd = getMetaPrintDateForCopy(panel);
  if (pd) hintLines.push(`印刷日の候補: ${pd}`);
  const pn = getMetaPatientName(panel);
  if (pn) hintLines.push(`氏名らしき文字列: ${pn}`);
  const fc = getMetaFacilityName(panel);
  if (fc) hintLines.push(`施設名らしき文字列: ${fc}`);
  const dateCandidates = collectAvailableDates(panel);
  if (dateCandidates.length) hintLines.push(`日付候補: ${dateCandidates.join(' / ')}`);

  const headParts = ['検査結果から読み取れた候補（数値があるものは併記）:'];
  if (exam) headParts.unshift(`検査日: ${exam}`);
  if (merged.length) {
    return [...headParts, ...merged.slice(0, 28)].join('\n');
  }
  if (nameOnlyLines.length) {
    const tail = hintLines.length ? ['', 'そのほか読めた断片:', ...hintLines] : [];
    return [...headParts, ...nameOnlyLines.slice(0, 24), ...tail].join('\n');
  }
  if (raw && !looksLikeJsonDump(raw)) {
    const clip = raw.length > 400 ? `${raw.slice(0, 400)}…` : raw;
    const tail = hintLines.length ? ['', 'そのほか:', ...hintLines] : [];
    return [...headParts, '（項目名の自動認識は難しいですが、テキストから次の抜粋を読み取りました）', clip, ...tail].join('\n');
  }
  if (hintLines.length) {
    return ['数値付きの項目はまだ抽出できていませんが、次の断片は拾えています:', ...hintLines].join('\n');
  }
  return [exam ? `検査日: ${exam}` : '検査日は確認中です。', '数値付きの項目はまだ抽出できていません。画像をもう一度送るか、紙の数値を書いてください。'].join('\n');
}

/** 数値一覧の依頼: JSON は出さず自然文のみ */
function buildNaturalAllValuesReply(panel) {
  const items = Array.isArray(panel?.items) ? panel.items : [];
  const structured = Array.isArray(panel?.itemsStructured) ? panel.itemsStructured : [];
  const lines = [];
  for (const it of items) {
    const nm = normalizeText(it?.itemName || it?.name || '');
    const v = normalizeText(it?.value || it?.currentValue || '');
    if (!nm) continue;
    const u = it.unit ? ` ${it.unit}` : '';
    const f = it.flag ? ` ${it.flag}` : '';
    if (v) lines.push(`・${nm}: ${v}${u}${f}`);
    else lines.push(`・${nm}: 数値はこの画像ではまだ拾えきれていないみたい`);
  }
  if (!lines.length) {
    for (const b of structured) {
      if (!normalizeText(b?.normalizedKey)) continue;
      const nm = normalizeText(b.name || b.rawName || b.normalizedKey);
      const v = normalizeText(b.value || '');
      if (!nm) continue;
      const u = b.unit ? ` ${b.unit}` : '';
      const f = b.flag ? ` ${b.flag}` : '';
      if (v) lines.push(`・${nm}: ${v}${u}${f}`);
      else lines.push(`・${nm}: 数値はこの画像ではまだ拾えきれていないみたい`);
    }
  }
  if (lines.length) {
    return ['この画像からうかがえる数値だけ、次のとおりです。', ...lines.slice(0, 26)].join('\n');
  }
  return buildReadableInventoryReply(panel);
}

function buildExamDateQuickReply(panel) {
  const dates = collectAvailableDates(panel);
  const latest = normalizeDateToken(panel?.latestExamDate || panel?.examDate || '') || dates[dates.length - 1] || '';
  if (latest) return `検査日（保存済み）: ${latest}${dates.length > 1 ? `（他候補: ${dates.join(' / ')}）` : ''}`;
  if (dates.length) return `検査日の候補: ${dates.join(' / ')}`;
  return '検査日はまだパネルに入っていません。画像をもう一度送るか、「〇〇年〇月〇日」と日付を送ってください。';
}

function buildPatientNameReply(panel) {
  const name = getMetaPatientName(panel);
  return name ? `患者名は「${name}」です。` : '患者名はこの画像からは確定できませんでした。';
}

function buildFacilityNameReply(panel) {
  const facility = getMetaFacilityName(panel);
  return facility ? `医療機関名は「${facility}」です。` : '病院名・クリニック名はこの画像からは確定できませんでした。';
}

function buildPrintDateReply(panel) {
  const printDate = getMetaPrintDateForCopy(panel);
  return printDate ? `印刷日は ${printDate} です。` : '印刷日はこの画像からは確定できませんでした。';
}

function buildLatestDateReply(panel) {
  const dates = collectAvailableDates(panel);
  const latest = dates[dates.length - 1] || normalizeDateToken(panel?.latestExamDate || panel?.examDate || '');
  if (!latest) return '検査日の候補はまだ確定できていません。';
  return `一番新しい検査日は ${latest} です。`;
}

function buildAbnormalItemsReply(panel) {
  const out = [];
  const items = Array.isArray(panel?.items) ? panel.items : [];
  for (const item of items) {
    const history = Array.isArray(item?.history) ? item.history : [];
    const latestFlagged = history.slice().reverse().find((row) => normalizeFlag(row?.flag));
    if (latestFlagged) {
      out.push(`・${item.itemName || '項目'}: ${latestFlagged.date} ${latestFlagged.value}${latestFlagged.unit ? ` ${latestFlagged.unit}` : ''} ${normalizeFlag(latestFlagged.flag)}`);
      continue;
    }
    if (normalizeFlag(item?.flag)) {
      out.push(`・${item.itemName || '項目'}: ${item.value}${item.unit ? ` ${item.unit}` : ''} ${normalizeFlag(item.flag)}`);
    }
  }
  if (!out.length) return '今回読み取れた範囲では、H/L フラグ付きの項目は見当たりませんでした。';
  return ['H/L フラグ付きの項目です。', ...out].join('\n');
}

function buildItemReply(panel, targetName, selectedDate) {
  const row = findValueForDate(panel, targetName, selectedDate);
  if (!row) {
    const label = normalizeTarget(targetName) || targetName;
    const item = findItem(panel, targetName);
    const loose = normalizeText(item?.value || item?.currentValue || '');
    if (item && loose) {
      const unit = item.unit ? ` ${item.unit}` : '';
      const flag = item.flag ? ` ${item.flag}` : '';
      return `${item.itemName || label} は、いま読み取れている範囲では ${loose}${unit}${flag} です。保存の途中でも、画像から拾えた値としてお伝えします。`;
    }
    const fromRaw = extractMetricFromRawText(panel?.rawText || '', label);
    if (fromRaw?.value) {
      const u = fromRaw.unit ? ` ${fromRaw.unit}` : '';
      return `${fromRaw.itemName} は、画像から抜き出したテキスト上では ${fromRaw.value}${u} として読めます（構造化itemsに無い場合のフォールバックです）。`;
    }
    const names = (panel?.items || []).map((it) => normalizeText(it?.itemName || '')).filter(Boolean);
    const hint = names.length ? `見えている候補: ${names.slice(0, 10).join(' / ')}` : 'まだ読める項目が増える可能性があるので、少し時間を置いてもう一度同じ項目名で聞いてください。';
    return `${label} はこの画像からまだ特定しきれていません。${hint}`;
  }

  const unit = row.unit ? ` ${row.unit}` : '';
  const reference = buildReferenceSentence(row);
  const flagSentence = buildFlagSentence(row);
  const trendRows = collectTrendRows(panel, row.itemName);
  const latestIndex = trendRows.findIndex((candidate) => candidate.date === row.date && String(candidate.value) === String(row.value));
  const previous = latestIndex > 0 ? trendRows[latestIndex - 1] : null;
  let compareLine = '';
  if (previous) {
    const nowNum = Number(row.value);
    const prevNum = Number(previous.value);
    if (Number.isFinite(nowNum) && Number.isFinite(prevNum)) {
      const delta = Math.round((nowNum - prevNum) * 10) / 10;
      const absDelta = Math.abs(delta);
      const direction = delta > 0 ? '上がっています' : delta < 0 ? '下がっています' : '横ばいです';
      compareLine = `前回 ${previous.date} の ${previous.value}${previous.unit ? ` ${previous.unit}` : ''} と比べて ${absDelta}${row.unit ? ` ${row.unit}` : ''} ${direction}`;
    }
  }
  const core = [
    `${row.itemName} は ${row.date} で ${row.value}${unit} です。`,
    compareLine || null,
    reference ? `${reference} で、${flagSentence}` : flagSentence
  ]
    .filter(Boolean)
    .join(' ');
  return `${core} まとめると、上記がいま確認できる範囲の回答です。結果の解釈は主治医の説明を優先してください。`;
}

function buildTrendReply(panel, text) {
  const target = normalizeTarget(text || '');
  if (target) {
    const rows = collectTrendRows(panel, target);
    if (!rows.length) return `${target} は、まだ傾向を安定してまとめ切れていません。`;
    const latest = rows[rows.length - 1];
    const previous = rows.length >= 2 ? rows[rows.length - 2] : null;
    const highest = [...rows].sort((a, b) => Number(b.value) - Number(a.value))[0];
    const lowest = [...rows].sort((a, b) => Number(a.value) - Number(b.value))[0];
    const latestLabel = `${latest.value}${latest.unit ? ` ${latest.unit}` : ''}${latest.flag ? ` ${latest.flag}` : ''}`;
    const highestLabel = `${highest.value}${highest.unit ? ` ${highest.unit}` : ''}${highest.flag ? ` ${highest.flag}` : ''}`;
    const lowestLabel = `${lowest.value}${lowest.unit ? ` ${lowest.unit}` : ''}${lowest.flag ? ` ${lowest.flag}` : ''}`;
    let compareLine = null;
    if (previous) {
      const nowNum = Number(latest.value);
      const prevNum = Number(previous.value);
      if (Number.isFinite(nowNum) && Number.isFinite(prevNum)) {
        const delta = Math.round((nowNum - prevNum) * 10) / 10;
        const direction = delta > 0 ? '高め傾向' : delta < 0 ? '改善傾向' : '横ばい';
        compareLine = `前回 ${previous.date} 比: ${delta > 0 ? '+' : ''}${delta}${latest.unit ? ` ${latest.unit}` : ''}（${direction}）`;
      }
    }
    return [
      `${target} の見えている推移です。`,
      `最新: ${latest.date} ${latestLabel}`,
      compareLine,
      rows.length >= 2 ? `高かった日: ${highest.date} ${highestLabel}` : null,
      rows.length >= 2 ? `低かった日: ${lowest.date} ${lowestLabel}` : null,
      `並び: ${rows.map((r) => `${r.date} ${r.value}${r.flag ? r.flag : ''}`).join(' / ')}`
    ].filter(Boolean).join('\n');
  }
  return buildPanelTrendSummary(panel);
}

function shouldHandleTrendQuestion(text) {
  const safe = normalizeText(text);
  return /傾向|推移|今まで|過去から|比較|一番高|直近2|2件|二件|前回と|前と比|流れは/.test(safe);
}

function shouldHandleSaveAll(text) {
  return /全部保存|読み取れた日付を全部保存|日付を全部保存|まとめて保存/.test(normalizeText(text));
}

const RESEND_PROMPT = '採血結果がもう少し大きく・まっすぐ写るよう、同じ用紙でもう一度送ってもらえると助かります。';

/**
 * 患者名・医療機関を1つの自然文で（新本流 follow 用）
 */
function buildPatientAndClinicReply(panel) {
  const p = getMetaPatientName(panel);
  const f = getMetaFacilityName(panel);
  const printDate = getMetaPrintDateForCopy(panel);
  const lead = '今確認できる範囲では、';
  if (p && f) {
    return `${lead}患者名は「${p}」、医療機関は「${f}」のようです。${printDate ? ` 用紙の日付欄の候補に ${printDate} が見えています。` : ''}`;
  }
  if (p) return `${lead}患者名は「${p}」のようです。医療機関名の欄は、まだはっきり読めていないです。${printDate ? ` 日付欄の断片: ${printDate}。` : ''}`;
  if (f) return `${lead}医療機関は「${f}」のようです。患者名の欄は、まだはっきり読めていないです。`;
  return `患者名と医療機関名の欄は、いまの写りだと取りにくいです。${RESEND_PROMPT}`;
}

/**
 * 検査日・印刷日（日付系の短文 follow）
 */
function buildDateFollowupNaturalReply(panel) {
  const body = buildExamDateQuickReply(panel);
  if (!/まだ|入っていません|送って|書いて|パネルに/.test(body)) return body;
  const printDate = getMetaPrintDateForCopy(panel);
  const exam = normalizeText(panel?.latestExamDate || panel?.examDate || '');
  if (printDate) return `採血日（検査日）の行がまだはっきりしない一方で、用紙の日付欄の候補として ${printDate} という日付の断片を拾っています。同じ用紙でもう少し上から写すと、日付が定かになりやすいです。`;
  if (exam) return `記録上は ${exam} 寄りの行が見えています。画像がさらに鮮明であれば、採血日の確定もしやすくなります。`;
  return `検査日が写真からまだ定かに読み切れていません。${RESEND_PROMPT}`;
}

/**
 * 読めた項目の要約（内部語を避け、箇条書き中心）
 */
function buildGentleReadableSummaryReply(panel) {
  const items = Array.isArray(panel?.items) ? panel.items : [];
  const withVal = items
    .map((it) => {
      const nm = normalizeText(it?.itemName || '');
      const v = normalizeText(it?.value || it?.currentValue || '');
      if (!nm) return null;
      if (v) return { nm, v, u: normalizeText(it?.unit || ''), f: normalizeText(it?.flag || '') };
      return null;
    })
    .filter(Boolean);
  if (withVal.length) {
    const lines = withVal.slice(0, 20).map((r) => {
      const u = r.u ? ` ${r.u}` : '';
      const f = r.f ? `（${r.f}）` : '';
      return `・${r.nm}: ${r.v}${u}${f}`;
    });
    return `読み取れる範囲の数値としては、\n${lines.join('\n')}\n他にも枠の端などにまだ出てくる可能性はあります。`;
  }
  return buildReadableInventoryReply(panel);
}

/**
 * 悪い値（H/L 付き）用の要約
 */
function buildGentleAbnormalReply(panel) {
  const raw = buildAbnormalItemsReply(panel);
  if (!/見当たり/.test(raw)) return raw;
  if (listImportantPreview(panel?.items || []).length) {
    return `H/L マーク付きの目立った異常値は、いまの画像からは拾えていません。一方で、まず掴めている主な測定値の例は ${listImportantPreview(panel?.items || []).join(' / ')} です。` + (normalizeText(panel?.rawText) ? ' 用紙全体がもっと鮮明に写ると、H/L も拾いやすいです。' : '');
  }
  return `H や L の目印付きの値は、今の段階の画像でははっきりしません。${RESEND_PROMPT}`;
}

function stripAliasForLabel(groupKey) {
  return String(groupKey || '').replace(/^alias:/, '') || '';
}

function displayLabelForComparison(c) {
  if (!c) return '該当項目';
  const a = stripAliasForLabel(c.groupKey);
  if (a) {
    const cn = labItemAliasService.canonicalToLabel ? labItemAliasService.canonicalToLabel(a) : '';
    if (cn) return cn;
  }
  if (c.latest) return normalizeText(c.latest.displayName) || a || '該当項目';
  return '該当項目';
}

/**
 * 同一キー1項目の前回比（1〜2文、医療断定はしない）
 */
function buildKeyDeltaReply(comparison) {
  if (!comparison || !comparison.latest) {
    return '前回分と突き合わせられる行を、いまの保存範囲からは作れませんでした。';
  }
  if (!comparison.canCompare) {
    if (comparison.reason === 'undated_incomparable' && comparison.previous) {
      return '比較に必要な「観測日（印刷日/検査日）」を2点ともに保存行から取れないため、採取前後としての前回比は述べられません。数値上の推測で前回比の言い方はしません。';
    }
    if (comparison.reason === 'single_session' || (comparison.previous == null)) {
      const l = comparison.latest;
      const u = l.unit ? ` ${l.unit}` : '';
      return `前回分と併せての比較に必要な、観測日の揃った別日分が足りていないか、まだ1回分しかありません。いま分かる範囲では、${l.observedDate ? `観測日候補 ${l.observedDate} で ` : ''}${l.value}${u} です。前回採取からの差分の言い切りはしません。`;
    }
  }
  const l = comparison.latest;
  const p = comparison.previous;
  const label = displayLabelForComparison(comparison);
  if (!l || !p) {
    return '前回分が特定できないため、差分の説明は出し切れません。';
  }
  const u = l.unit || p.unit ? ` ${(l.unit || p.unit) || ''}` : '';
  if (comparison.delta == null) {
    return `差分の数の取り扱いが難しい行です。前回分は ${p.observedDate} で ${p.value}、直近分は ${l.observedDate} で ${l.value} と読めています（医学的な解釈は行いません）。`;
  }
  const abs = Math.abs(comparison.delta);
  const dabs = abs % 1 < 1e-9 || abs % 1 > 0.999 ? String(Math.round(abs)) : abs.toFixed(1);
  let rel = 'ほぼ同程度';
  if (comparison.direction === 'up') rel = '数値的には上がる方向';
  if (comparison.direction === 'down') rel = '数値的には下がる方向';
  return `${label}は、前回分（${p.observedDate} ころ: ${p.value}）に対し、直近分（${l.observedDate} ころ: ${l.value}）では差が約${dabs}${u} あり、${rel}に見えます。`;
}

/**
 * 前回比の要約（複数項目を最大3、全体1〜3文）
 * @param {object} [options] historySessionsCount, comparisonAvailable
 */
function buildOverallHistoryDeltaReply(pickedComparisons, options = {}) {
  const hsc = options.historySessionsCount;
  const cav = options.comparisonAvailable;
  const use = (Array.isArray(pickedComparisons) ? pickedComparisons : [])
    .filter((c) => c && c.canCompare)
    .slice(0, 3);
  if (!use.length) {
    if (cav === false && hsc != null && hsc >= 2) {
      return '保存は複数回分あっても、比較用の観測日（印刷日/検査日）が2点ともに揃わない、または枠同士の対応が取れないため、前回採取からの変化の推測は出しません。';
    }
    if (hsc != null && hsc < 2) {
      return '前回分と併せて比較するには、少なくとも別日分の用紙が2回分取り込まれているのが望ましいです。いまの保存件数が1回分の場合、前回比の言い切りはしません。';
    }
    return '同日の行同士の重なりが、まだ十分に出ていないようです。観測日が揃った比較点が作れないため、前回比の推測は出しません。';
  }
  const one = use.map((c) => buildKeyDeltaReply(c)).filter(Boolean);
  if (!one.length) {
    return '前回採分との照合に必要な行が、保存データ上ではまとまっていないようです。';
  }
  return one.join(' ');
}

/**
 * 悪化の可能性がある行＋前回分との H 変化（1〜3文）
 */
function buildAbnormalChangeReply(latestRowList, worseningList) {
  const a = Array.isArray(latestRowList) ? latestRowList : [];
  const w = Array.isArray(worseningList) ? worseningList : [];
  const out = [];
  if (a.length) {
    const s = a.slice(0, 10).map(
      (r) => {
        const u = r.unit ? ` ${r.unit}` : '';
        return `「${r.displayName}」${r.value}${u}（${r.flag}）`;
      }
    );
    out.push(`今回分の読み取り上、目印 H/L 付きとして拾えた行に、${s.join('、')} などがあります。`);
  } else {
    out.push('今回分の枠取り上、H または L の明確な行は拾い切れていない可能性があります。印字が薄い用紙では見落としが出ることがあります。');
  }
  if (w.length) {
    out.push('直前に保存してある1回分と併せる範囲で見ると、' + w.slice(0, 3).map((e) => {
      const pr = e.previous
        ? `${e.previous.value}${e.previous.unit ? ` ${e.previous.unit}` : ''} 付近`
        : '基準内付近';
      return `「${e.displayName}」は、前回分（${pr}）に比し今回 H（${e.current.value}${e.current.unit ? ` ${e.current.unit}` : ''}）の見え方です。`;
    }).join(' '));
  }
  return out.join(' ').slice(0, 1000);
}

/**
 * TG/中性脂肪の直近1キーの推移
 */
/**
 * 「傾向と対策」系（保存2回分以上なら前回比を短く併記。医療断定はしない）
 */
function buildTrendAndCountermeasuresReply(panel, historySessions = []) {
  const lines = [];
  const items = Array.isArray(panel?.items) ? panel.items : [];

  for (const it of items) {
    const fl = normalizeFlag(it?.flag);
    const v = normalizeText(it?.value || it?.currentValue || '');
    const nm = normalizeText(it?.itemName || '');
    if (!nm || !v) continue;
    if (fl === 'H' || fl === 'L') {
      lines.push(
        `${nm} は ${v}${it.unit ? ` ${it.unit}` : ''} で、印字上は ${fl === 'H' ? '基準より高めの目印（H）' : '基準より低めの目印（L）'}が見えています。`
      );
    }
    if (lines.length >= 4) break;
  }
  if (lines.length < 2) {
    const prev = listImportantPreview(panel?.items || []);
    for (const s of prev) {
      if (lines.length >= 4) break;
      const firstWord = normalizeText(s.split(/\s+/)[0]);
      if (firstWord && !lines.some((l) => l.includes(firstWord))) {
        lines.push(`${s} が今回の枠から読み取れています。`);
      }
    }
  }

  const hs = Array.isArray(historySessions) ? historySessions : [];
  let deltaBlock = '';
  if (hs.length >= 2) {
    const comparisons = labHistoryCompare.summarizeMultisessionComparisons(hs);
    const picked = labHistoryCompare.pickOverallLines(comparisons).filter((c) => c && c.canCompare).slice(0, 2);
    if (picked.length) {
      deltaBlock =
        '保存が2回分以上ある項目については、' +
        picked
          .map((c) => buildKeyDeltaReply(c))
          .filter(Boolean)
          .join(' ') +
        ' ';
    }
  }

  const mid = lines.slice(0, 4).join(' ');
  const tail =
    '今後の見方としては、用紙の基準と医師の説明を優先し、ここでの文章はメモ代わりの補助にとどめてください。医療上の判断の代わりにはなりません。';
  if (!normalizeText(mid) && !normalizeText(deltaBlock)) {
    return `今回の画像から主要項目を十分には拾えていないため、傾向の言い切りは控えます。項目名を指定して聞いてください。`;
  }
  return `${mid}${deltaBlock}${tail}`.replace(/\s{2,}/g, ' ').trim();
}

function toFiniteNumber(value) {
  const n = Number(String(value || '').replace(/,/g, '').trim());
  return Number.isFinite(n) ? n : null;
}

function collectLatestRowsFromPanel(panel) {
  const out = [];
  const items = Array.isArray(panel?.items) ? panel.items : [];
  for (const it of items) {
    const name = normalizeItemName(it?.itemName || it?.name || '');
    if (!name) continue;
    const rows = collectTrendRows(panel, name);
    const latest = rows.length ? rows[rows.length - 1] : null;
    if (!latest || !normalizeText(latest?.value || '')) continue;
    out.push({
      name,
      date: normalizeDateToken(latest.date || ''),
      value: normalizeText(latest.value || ''),
      unit: normalizeText(latest.unit || ''),
      flag: normalizeFlag(latest.flag || ''),
      referenceLow: latest.referenceLow ?? null,
      referenceHigh: latest.referenceHigh ?? null
    });
  }
  return out;
}

function isReferenceOut(row) {
  const v = toFiniteNumber(row?.value);
  if (v == null) return false;
  const lo = toFiniteNumber(row?.referenceLow);
  const hi = toFiniteNumber(row?.referenceHigh);
  if (lo != null && v < lo) return true;
  if (hi != null && v > hi) return true;
  return false;
}

function buildAbnormalSummaryReply(panel) {
  const latestRows = collectLatestRowsFromPanel(panel);
  const flagged = latestRows.filter((r) => r.flag === 'H' || r.flag === 'L');
  const outOfRange = latestRows.filter((r) => isReferenceOut(r) && !flagged.some((f) => f.name === r.name));
  if (!flagged.length && !outOfRange.length) {
    return '今確認できる範囲では、H/L や明確な基準外として拾えた値は目立っていません。主治医の説明を優先してください。';
  }
  const lines = [];
  for (const r of [...flagged, ...outOfRange].slice(0, 6)) {
    const unit = r.unit ? ` ${r.unit}` : '';
    const mark = r.flag ? ` ${r.flag}` : '';
    lines.push(`・${r.name}: ${r.date || '日付不明'} ${r.value}${unit}${mark}`);
  }
  return ['今確認できる範囲では、注意して見たい値は次のとおりです。', ...lines, '主治医の説明を優先してください。'].join('\n');
}

function buildHighLowReply(panel, mode = 'high') {
  const latestRows = collectLatestRowsFromPanel(panel);
  const picked = latestRows.filter((r) => (mode === 'high' ? r.flag === 'H' : r.flag === 'L'));
  if (!picked.length) {
    return mode === 'high'
      ? '今確認できる範囲では、H マーク付きの高めの値は目立っていません。主治医の説明を優先してください。'
      : '今確認できる範囲では、L マーク付きの低めの値は目立っていません。主治医の説明を優先してください。';
  }
  const lines = picked.slice(0, 6).map((r) => `・${r.name}: ${r.date || '日付不明'} ${r.value}${r.unit ? ` ${r.unit}` : ''} ${r.flag}`);
  return [
    mode === 'high' ? '今確認できる範囲で高め（H）として読めた値です。' : '今確認できる範囲で低め（L）として読めた値です。',
    ...lines,
    '主治医の説明を優先してください。'
  ].join('\n');
}

function buildBalanceReply(panel) {
  const groups = [
    { label: '脂質系', names: ['中性脂肪', 'LDL', 'HDL', '総コレステロール', 'LDL/HDL比'] },
    { label: '肝機能系', names: ['AST', 'ALT', 'γ-GTP'] },
    { label: '糖代謝系', names: ['HbA1c', '血糖'] },
    { label: '腎機能系', names: ['クレアチニン', 'eGFR', '尿酸'] }
  ];
  const lines = [];
  for (const g of groups) {
    const values = [];
    for (const nm of g.names) {
      const rows = collectTrendRows(panel, nm);
      const latest = rows.length ? rows[rows.length - 1] : null;
      if (!latest || !normalizeText(latest?.value || '')) continue;
      values.push(`${nm} ${latest.value}${latest.unit ? ` ${latest.unit}` : ''}${latest.flag ? ` ${latest.flag}` : ''}`);
    }
    if (values.length) lines.push(`・${g.label}: ${values.slice(0, 3).join(' / ')}`);
  }
  if (!lines.length) {
    return '今確認できる範囲では、バランス評価に必要な主要項目が十分にそろっていません。主治医の説明を優先してください。';
  }
  return ['今確認できる範囲でのバランス整理です。', ...lines, '主治医の説明を優先してください。'].join('\n');
}

/**
 * 保存済み lab_sessions の日付目安一覧（最大5件表示、合計件数は全件）
 */
function buildSavedLabSessionsDatesReply(historyRows) {
  const rows = Array.isArray(historyRows) ? historyRows : [];
  if (!rows.length) {
    return '保存済みの検査セッションはまだありません。';
  }
  const total = rows.length;
  const lines = [];
  let ambiguousInList = 0;
  for (let i = 0; i < Math.min(5, rows.length); i += 1) {
    const row = rows[i];
    const rep = labSessionRepository.repDateForRow(row);
    const printD = normalizeDateToken(row.print_date || '');
    const exArr = Array.isArray(row.exam_dates_json) ? row.exam_dates_json : [];
    const exJoined = exArr.map((d) => normalizeDateToken(String(d))).filter(Boolean).slice(0, 2);
    const parsedItems = Array.isArray(row.parsed_items_json) ? row.parsed_items_json : [];
    const parsedDates = Array.from(new Set(parsedItems
      .map((it) => normalizeDateToken(it?.observedDate || it?.observed_date || ''))
      .filter(Boolean))).slice(0, 3);
    if (rep || parsedDates.length) {
      const bits = [];
      if (printD && printD !== rep) bits.push(`印刷日 ${printD}`);
      if (exJoined.length) bits.push(`採血日候補 ${exJoined.join('・')}`);
      if (parsedDates.length) bits.push(`観測日候補 ${parsedDates.join('・')}`);
      const displayRep = rep || parsedDates[parsedDates.length - 1];
      const extra = bits.length ? `（${bits.join(' / ')}）` : '';
      lines.push(`${i + 1}. 代表日 ${displayRep}${extra}`);
    } else {
      ambiguousInList += 1;
      lines.push(`${i + 1}. 日付不明の保存データ（印刷日・採血日の抽出が弱い可能性があります）`);
    }
  }
  const ambNote =
    ambiguousInList > 0
      ? `\n上記のうち、日付不明として扱った行が ${ambiguousInList} 件あります。`
      : '';
  const summary = '要約としては、保存の新しい順に先頭を列挙しています。単一の画像だけから複数日付を断定したわけではありません。';
  return `保存済みの検査関連データは合計 ${total} 件です。日付の目安は次のとおりです。\n${lines.join('\n')}${ambNote}\n${summary}`.trim();
}

function buildTgProgressReply(compare) {
  if (!compare) {
    return '中性脂肪（TG）行が、比較用の保存行としてまだ作れていません。';
  }
  if (!compare.canCompare) {
    if (compare.reason === 'undated_incomparable' && compare.previous) {
      return '中性脂肪（TG）の2回分の保存は見えても、観測日（印刷日/検査日）が2点ともに取れないため、採取前後としての「推移」は述べません。前回採取からの差分の推測は出しません。';
    }
    const l = compare.latest;
    if (l) {
      const u = l.unit ? ` ${l.unit}` : '';
      return l.observedDate
        ? `比較不能です（観測日が1点分しか揃っていない、または2回分の観測日が同時に取れていません）。保存上は少なくとも ${l.observedDate} 付近の行で ${l.value}${u} と読めます。採取日の前後比の言い切りはしません。`
        : `観測日が定かでない1点分として、中性脂肪（TG）相当の行は ${l.value}${u} と読めます。前回分との前後差の推測は出しません。`;
    }
    return '中性脂肪（TG）の行が、比較用の保存行としてまだ作れていません。';
  }
  return `TG（中性脂肪）について、${buildKeyDeltaReply(compare)}`;
}

module.exports = {
  normalizeTarget,
  extractRequestedDate,
  collectAvailableDates,
  buildLabImageReply,
  buildDateSelectionReply,
  buildUnavailableDateReply,
  buildSaveReply,
  buildItemReply,
  buildTrendReply,
  shouldHandleTrendQuestion,
  shouldHandleSaveAll,
  buildReadableInventoryReply,
  buildExamDateQuickReply,
  buildPatientNameReply,
  buildFacilityNameReply,
  buildPrintDateReply,
  buildLatestDateReply,
  buildAbnormalItemsReply,
  buildNaturalAllValuesReply,
  extractMetricFromRawText,
  buildPatientAndClinicReply,
  buildDateFollowupNaturalReply,
  buildGentleReadableSummaryReply,
  buildGentleAbnormalReply,
  RESEND_PROMPT,
  buildKeyDeltaReply,
  buildOverallHistoryDeltaReply,
  buildAbnormalChangeReply,
  buildTgProgressReply,
  buildTrendAndCountermeasuresReply,
  buildSavedLabSessionsDatesReply,
  buildAbnormalSummaryReply,
  buildHighLowReply,
  buildBalanceReply
};
