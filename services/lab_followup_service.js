'use strict';

const { normalizeItemName, collectTrendRows, buildPanelTrendSummary } = require('./lab_trend_service');
const labItemAliasService = require('./lab_item_alias_service');

function normalizeText(value) {
  return String(value || '').trim();
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
  const previewLine = preview.length ? `いま拾えてるのは ${preview.join(' / ')} 。` : '';
  const dateLine = latest ? `検査日は ${latest} として見てる。` : '';
  const issueLine = issues.length ? `（注意: ${issues[0]}）` : '';
  if ((panel?.documentKind || '').includes('multi') || dates.length >= 2) {
    const multiDate = dates.length ? `日付は ${dates.join(' / ')} 。` : '';
    return [`検査の画像ありがとう。推移表っぽいね。`, multiDate, dateLine, previewLine, issueLine, `TGやHbA1c、気になるところを一文で。`].filter(Boolean).join('\n');
  }
  return [`検査だね、受け取ったよ。`, dateLine, previewLine, issueLine, `聞きたい項目を送って。`].filter(Boolean).join('\n');
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
  return items.find((item) => namesLikelyMatch(normalizeItemName(raw), item?.itemName || '')) || null;
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

  const merged = [...lines];

  const nameOnlyLines = [];
  for (const it of items) {
    const nm = normalizeText(it?.itemName || it?.name || '');
    const v = normalizeText(it?.value || it?.currentValue || '');
    if (nm && !v) nameOnlyLines.push(`・${nm}: （数値はまだ確定できていません）`);
  }
  const structured = Array.isArray(panel?.itemsStructured) ? panel.itemsStructured : [];
  for (const block of structured) {
    const nm = normalizeText(block?.name_normalized || block?.name_original || '');
    if (!nm) continue;
    const hasVal = Array.isArray(block?.results)
      && block.results.some((r) => normalizeText(r?.value || ''));
    if (hasVal) continue;
    const line = `・${nm}: （数値はまだ確定できていません）`;
    if (!nameOnlyLines.some((x) => x.includes(nm))) nameOnlyLines.push(line);
  }

  const hintLines = [];
  const pd = normalizeDateToken(panel?.printDate || panel?.print_date || '');
  if (pd) hintLines.push(`印刷日の候補: ${pd}`);
  const pn = normalizeText(panel?.patientName || panel?.patient_name || '');
  if (pn) hintLines.push(`氏名らしき文字列: ${pn}`);
  const fc = normalizeText(panel?.facilityName || panel?.facility_name || '');
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
  if (lines.length) {
    return ['この画像からうかがえる数値だけ、静かに並べるね。', ...lines.slice(0, 26)].join('\n');
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
  const name = normalizeText(panel?.patientName || panel?.patient_name || '');
  return name ? `患者名は「${name}」です。` : '患者名はこの画像からは確定できませんでした。';
}

function buildFacilityNameReply(panel) {
  const facility = normalizeText(panel?.facilityName || panel?.facility_name || '');
  return facility ? `医療機関名は「${facility}」です。` : '病院名・クリニック名はこの画像からは確定できませんでした。';
}

function buildPrintDateReply(panel) {
  const printDate = normalizeDateToken(panel?.printDate || panel?.print_date || '');
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
  return [
    `${row.itemName} は ${row.date} で ${row.value}${unit} です。`,
    compareLine || null,
    reference ? `${reference} で、${flagSentence}` : flagSentence
  ].filter(Boolean).join(' ');
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
};
