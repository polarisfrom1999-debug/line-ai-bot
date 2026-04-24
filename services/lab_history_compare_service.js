'use strict';

const labItemAliasService = require('./lab_item_alias_service');

function normalizeText(value) {
  return String(value || '').trim();
}

const EPS_RATIO = 0.0001;

/**
 * 観測日: print_date → 最大 exam 日付。取れない場合は空（並びは session の created_at desc で別途）
 */
function representativeDateForSession(row) {
  if (!row || typeof row !== 'object') return '';
  const pd = normalizeDateTokenFromRow(row.print_date);
  if (pd) return pd;
  const ex = Array.isArray(row.exam_dates_json) ? row.exam_dates_json : [];
  const dates = ex
    .map((d) => normalizeDateTokenFromRow(d))
    .filter(Boolean)
    .sort();
  if (dates.length) return dates[dates.length - 1];
  return '';
}

function normalizeDateTokenFromRow(token) {
  if (token == null) return '';
  const safe = String(token).trim();
  if (!safe) return '';
  const m = safe.match(/(20\d{2})-(\d{2})-(\d{2})/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  const m2 = safe.match(/(20\d{2})[\/\.\-](\d{1,2})[\/\.\-](\d{1,2})/);
  if (m2) {
    return `${m2[1]}-${String(m2[2]).padStart(2, '0')}-${String(m2[3]).padStart(2, '0')}`;
  }
  return '';
}

/**
 * 比較用共通1行
 * { normalizedKey, observedDate, value, flag, sessionId, displayName, rawName, unit }
 */
function normalizeParsedItemToCommon(sessionId, observedDate, item, sessionCreatedAt) {
  if (!item || typeof item !== 'object') return null;
  const normalizedKey = normalizeText(item.normalizedKey || item.normalized_key || '');
  const value = pickValue(item);
  if (!value && !normalizeText(item.value)) return null;
  const displayName = normalizeText(
    item.name
    || item.itemName
    || item.label_in_image
    || item.labelInImage
    || normalizedKey
  );
  const rawName = normalizeText(item.rawName || item.raw_name || item.label_in_image || item.labelInImage || '');
  return {
    normalizedKey: normalizedKey || displayName,
    observedDate: observedDate || '',
    value: value || normalizeText(item.value || item.currentValue || ''),
    flag: normalizeHlFlag(item.flag),
    sessionId: Number(sessionId) || 0,
    displayName: displayName || normalizedKey,
    rawName: rawName || displayName,
    unit: normalizeText(item.unit || ''),
    sessionCreatedAt: String(sessionCreatedAt || '')
  };
}

function pickValue(item) {
  return normalizeText(
    item.value
    || item.currentValue
    || item.valueText
    || item.value_text
  );
}

function normalizeHlFlag(f) {
  const s = normalizeText(f).toUpperCase();
  if (s === 'H' || s === 'HIGH' || s === 'Ｈ' || s === '↑') return 'H';
  if (s === 'L' || s === 'LOW' || s === 'Ｌ' || s === '↓') return 'L';
  return '';
}

/**
 * parsed normalizedKey から慣用エイリアス（alias 名簿に無い表記用）
 */
function heuristicAliasFromNormalizedKey(nk) {
  const t = String(nk || '').toLowerCase();
  if (t.includes('triglycerid') || t.includes('中性脂肪')) return 'tg';
  if (t.startsWith('ldl') && t.includes('chol')) return 'ldl';
  if (t === 'ldl_cholesterol' || t.includes('ldl-cho')) return 'ldl';
  if (t.startsWith('hdl') && t.includes('chol')) return 'hdl';
  if (t === 'hdl_cholesterol') return 'hdl';
  if (t.includes('hba1c') || t.includes('hemoglobin')) return 'hba1c';
  if (t === 'ast_got' || t === 'ast' || t.includes('got(')) return 'ast';
  if (t === 'alt_gpt' || t === 'alt' || t.includes('gpt(')) return 'alt';
  if (t.includes('gamma_gtp') || t.includes('γ-gtp') || t === 'ggt' || t.includes('gtp')) return 'ggt';
  if (t.includes('creatinin')) return 'cr';
  if (t === 'raw_label:血糖' || t.includes('glucose')) return 'glu';
  if (t.includes('rbc') || t.includes('wbc') || t.includes('白血球')) return 'wbc';
  if (t.includes('uric') || t.includes('尿酸') || t === 'ua') return 'ua';
  return '';
}

/**
 * エイリアス上の安定的なグルーピング（同一検査意の別 normalizedKey 対策）
 * @returns {string}
 */
function stableGroupKeyFromCommon(row) {
  if (!row) return '';
  const fromNk = labItemAliasService.normalizeLabCanonicalKey(
    String(row.normalizedKey || '')
  );
  if (fromNk) return `alias:${fromNk}`;
  const h = heuristicAliasFromNormalizedKey(row.normalizedKey);
  if (h) return `alias:${h}`;
  const fromDisp = labItemAliasService.normalizeLabCanonicalKey(
    String(row.displayName || row.rawName || '')
  );
  if (fromDisp) return `alias:${fromDisp}`;
  return `nk:${String(row.normalizedKey || '').toLowerCase()}`;
}

function flattenSessionItems(sessionRow) {
  const sid = sessionRow?.id;
  const obs = representativeDateForSession(sessionRow);
  const sca = String(sessionRow?.created_at || '');
  const list = Array.isArray(sessionRow?.parsed_items_json) ? sessionRow.parsed_items_json : [];
  const byGroup = new Map();
  for (const raw of list) {
    const row = normalizeParsedItemToCommon(sid, obs, raw, sca);
    if (!row || !row.value) continue;
    if (!row.normalizedKey) continue;
    const gk = stableGroupKeyFromCommon(row);
    if (!gk) continue;
    if (!byGroup.has(gk)) byGroup.set(gk, row);
  }
  return [...byGroup.values()];
}

/**
 * 代表日新しい順（日付が無い行は created_at desc。観測日が同じなら created_at desc）
 */
function sortSessionsForHistory(rows) {
  return [...(rows || [])]
    .map((r) => ({ ...r, _rep: representativeDateForSession(r) }))
    .sort((a, b) => {
      const ra = a._rep;
      const rb = b._rep;
      if (ra && rb) {
        const c = String(rb).localeCompare(String(ra));
        if (c !== 0) return c;
        return String(b.created_at || '').localeCompare(String(a.created_at || ''));
      }
      if (ra && !rb) return -1;
      if (!ra && rb) return 1;
      return String(b.created_at || '').localeCompare(String(a.created_at || ''));
    });
}

/**
 * グループキーごとに、観測日昇順（同一日は session id で安定）
 * @param {object[]} allCommonRows
 */
function buildSeriesByGroupKey(allCommonRows) {
  const m = new Map();
  for (const row of allCommonRows) {
    const gk = stableGroupKeyFromCommon(row);
    if (!gk) continue;
    if (!m.has(gk)) m.set(gk, []);
    m.get(gk).push({ ...row, groupKey: gk });
  }
  for (const [, arr] of m) {
    arr.sort((a, b) => {
      const da = String(a.observedDate || '').localeCompare(String(b.observedDate || ''));
      if (da !== 0) return da;
      return String(b.sessionCreatedAt || '').localeCompare(String(a.sessionCreatedAt || ''));
    });
  }
  return m;
}

/**
 * 同じ「観測日付ラベル」+ session は1点。観測日が空のときは session 単位で分離（upload 順序は sessionCreatedAt）
 */
function uniqueSeriesByDate(series) {
  const byD = new Map();
  for (const p of series) {
    const d = p.observedDate
      || `_undated_s${p.sessionId}_${p.sessionCreatedAt || ''}`;
    if (!byD.has(d)) byD.set(d, p);
  }
  return [...byD.values()].sort((a, b) => {
    const hasA = Boolean(a.observedDate);
    const hasB = Boolean(b.observedDate);
    if (hasA && hasB) {
      return String(a.observedDate).localeCompare(String(b.observedDate));
    }
    if (hasA && !hasB) return -1;
    if (!hasA && hasB) return 1;
    return String(a.sessionCreatedAt || '').localeCompare(String(b.sessionCreatedAt || ''));
  });
}

/**
 * 直近値・前回値比較
 * @returns {{
 *  canCompare: boolean,
 *  reason: 'two_sessions'|'single_session'|'no_series'|'' ,
 *  latest: object|null,
 *  previous: object|null,
 *  delta: number|null,
 *  direction: 'up'|'down'|'flat'|'unknown',
 *  groupKey: string
 * }}
 */
function compareKeySeries(groupKey, series) {
  const u = uniqueSeriesByDate(series);
  if (u.length === 0) {
    return {
      canCompare: false, reason: 'no_series', latest: null, previous: null, delta: null, direction: 'unknown', groupKey
    };
  }
  if (u.length < 2) {
    return {
      canCompare: false,
      reason: 'single_session',
      latest: u[u.length - 1],
      previous: null,
      delta: null,
      direction: 'unknown',
      groupKey
    };
  }
  const latest = u[u.length - 1];
  const previous = u[u.length - 2];
  if (!normalizeText(latest.observedDate) || !normalizeText(previous.observedDate)) {
    return {
      canCompare: false,
      reason: 'undated_incomparable',
      latest,
      previous,
      delta: null,
      direction: 'unknown',
      groupKey
    };
  }
  const a = parseNum(latest.value);
  const b = parseNum(previous.value);
  if (Number.isFinite(a) && Number.isFinite(b)) {
    const delta = Math.round((a - b) * 1000) / 1000;
    const rel = Math.abs(b) > 1e-9 ? Math.abs(delta / b) : Math.abs(delta);
    let direction = 'flat';
    if (rel > EPS_RATIO) direction = delta > 0 ? 'up' : 'down';
    return {
      canCompare: true,
      reason: 'two_sessions',
      latest,
      previous,
      delta,
      direction,
      groupKey
    };
  }
  return {
    canCompare: true,
    reason: 'two_sessions',
    latest,
    previous,
    delta: null,
    direction: 'unknown',
    groupKey
  };
}

function parseNum(s) {
  if (s == null) return NaN;
  const t = String(s).replace(/[,，]/g, '').replace(/\s/g, '');
  const m = t.match(/-?(?:\d+)(?:\.\d+)?/);
  if (!m) return NaN;
  return Number(m[0]);
}

const PREFERRED_ALIASES = ['ldl', 'tg', 'hba1c', 'hdl', 'ast', 'alt', 'ggt', 'glu', 'wbc', 'ua', 'cr'];

/**
 * 複数セッション列から、全体要約用の比較結果配列
 */
function summarizeMultisessionComparisons(sessions) {
  const sorted = sortSessionsForHistory(sessions || []);
  const all = [];
  for (const s of sorted) {
    all.push(...flattenSessionItems(s));
  }
  const byG = buildSeriesByGroupKey(all);
  const out = [];
  for (const [gk, ser] of byG) {
    out.push(compareKeySeries(gk, ser));
  }
  return out;
}

/**
 * 優先キーで上位を選ぶ
 */
function pickOverallLines(comparisons) {
  const withAlias = (c) => (String(c.groupKey || '').startsWith('alias:') ? c.groupKey.replace(/^alias:/, '') : '');

  const byAlias = new Map();
  for (const c of comparisons) {
    const al = withAlias(c);
    if (al) byAlias.set(`alias:${al}`, c);
    else if (c.groupKey) byAlias.set(c.groupKey, c);
  }

  const ordered = [];
  for (const a of PREFERRED_ALIASES) {
    const c = byAlias.get(`alias:${a}`);
    if (c && c.canCompare) ordered.push(c);
  }
  for (const c of comparisons) {
    if (c.canCompare && !ordered.includes(c)) ordered.push(c);
  }
  return ordered.slice(0, 4);
}

/**
 * TG 系 series（alias:tg または中性脂肪名寄せ）を抽出
 */
function getTgSeries(sessions) {
  const all = [];
  for (const s of sortSessionsForHistory(sessions)) {
    all.push(...flattenSessionItems(s));
  }
  const byG = buildSeriesByGroupKey(all);
  if (byG.has('alias:tg')) {
    return byG.get('alias:tg') || [];
  }
  for (const [, ser] of byG) {
    for (const r of ser) {
      const a = labItemAliasService.normalizeLabCanonicalKey(
        r.normalizedKey
      );
      if (a === 'tg' || /中性脂肪|triglyceride|(^|[^a-z])tg([^a-z]|$)/i.test(
        String(r.displayName) + String(r.rawName) + String(r.normalizedKey)
      )) {
        return ser;
      }
    }
  }
  return [];
}

/**
 * 直近セッション1件分の H/L 行
 */
function listAbnormalRowsFromSession(sessionRow) {
  const out = [];
  const obs = representativeDateForSession(sessionRow);
  const sca = String(sessionRow?.created_at || '');
  for (const raw of Array.isArray(sessionRow?.parsed_items_json) ? sessionRow.parsed_items_json : []) {
    const row = normalizeParsedItemToCommon(sessionRow?.id, obs, raw, sca);
    if (!row) continue;
    if (row.flag === 'H' || row.flag === 'L') {
      out.push({
        displayName: row.displayName,
        value: row.value,
        unit: row.unit,
        flag: row.flag
      });
    }
  }
  return out;
}

/**
 * 前回は非 H か空で今回 H（可能な範囲で）
 */
function findWorseningToHigh(sortedSessionsNewestFirst) {
  if (!sortedSessionsNewestFirst || sortedSessionsNewestFirst.length < 2) return [];
  const sNew = sortSessionsForHistory(sortedSessionsNewestFirst);
  if (sNew.length < 2) return [];
  const latest = sNew[0];
  const previous = sNew[1];
  const prevMap = new Map();
  for (const r of flattenSessionItems(previous)) {
    const gk = stableGroupKeyFromCommon(r);
    if (!prevMap.has(gk)) prevMap.set(gk, r);
  }
  const out = [];
  for (const r of flattenSessionItems(latest)) {
    const gk = stableGroupKeyFromCommon(r);
    const p = prevMap.get(gk);
    const wasNormal = !p || (p.flag !== 'H' && p.flag !== 'L');
    if (r.flag === 'H' && wasNormal) {
      out.push({ displayName: r.displayName, previous: p, current: r });
    }
  }
  return out.slice(0, 4);
}

module.exports = {
  representativeDateForSession,
  normalizeParsedItemToCommon,
  stableGroupKeyFromCommon,
  flattenSessionItems,
  sortSessionsForHistory,
  buildSeriesByGroupKey,
  uniqueSeriesByDate,
  compareKeySeries,
  summarizeMultisessionComparisons,
  pickOverallLines,
  getTgSeries,
  listAbnormalRowsFromSession,
  findWorseningToHigh,
  parseNum
};
