'use strict';

/**
 * 食事ログの単一データソース（DB）。
 * 合計・件数・詳細は必ずこのモジュールの mealLogs[] から生成する。
 */

const { supabase } = require('./supabase_service');
const { ensureUser } = require('./user_service');

function normalizeText(value) {
  return String(value || '').trim();
}

function round1(value) {
  return Math.round((Number(value || 0) + Number.EPSILON) * 10) / 10;
}

async function resolveUser(lineUserId) {
  if (!supabase || !ensureUser) return null;
  const safe = normalizeText(lineUserId);
  if (!safe) return null;
  try {
    return await ensureUser(supabase, safe, 'Asia/Tokyo');
  } catch (_e) {
    return null;
  }
}

function addOneDayYmd(ymd) {
  const m = String(ymd || '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return '';
  const dt = new Date(`${m[1]}-${m[2]}-${m[3]}T12:00:00+09:00`);
  dt.setDate(dt.getDate() + 1);
  return new Intl.DateTimeFormat('sv-SE', {
    timeZone: 'Asia/Tokyo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).format(dt);
}

function tokyoRangeIso(fromYmd, toYmdExclusive) {
  const startIso = `${fromYmd}T00:00:00+09:00`;
  const endIso = `${toYmdExclusive}T00:00:00+09:00`;
  return { startIso, endIso };
}

async function safeRows(builder, fallback = []) {
  try {
    const { data, error } = await builder();
    if (error) throw error;
    return Array.isArray(data) ? data : fallback;
  } catch (_e) {
    return fallback;
  }
}

function normalizeDbRow(row) {
  const eatenAt = row?.eaten_at || '';
  const foodItems = Array.isArray(row?.food_items) ? row.food_items.map((x) => normalizeText(x)).filter(Boolean) : [];
  const raw = row?.raw_model_json && typeof row.raw_model_json === 'object' ? row.raw_model_json : {};
  return {
    id: row?.id,
    eatenAt,
    mealLabel: normalizeText(row?.meal_label || '食事'),
    foodItems,
    kcal: Number(row?.estimated_kcal || 0),
    protein: Number(row?.protein_g || 0),
    fat: Number(row?.fat_g || 0),
    carbs: Number(row?.carbs_g || 0),
    confidence: row?.confidence != null ? Number(row.confidence) : null,
    rawModelJson: raw,
    sourceLineMessageId: normalizeText(raw.sourceLineMessageId || raw.lineMessageId || ''),
    dedupeKey: normalizeText(raw.dedupeKey || ''),
    correctionType: normalizeText(raw.correction_type || raw.correctionType || raw.calorie_source || ''),
    parentMealId: normalizeText(raw.parent_meal_id || raw.parentMealId || ''),
    targetMealId: normalizeText(raw.target_meal_id || raw.targetMealId || '')
  };
}

function isCorrectionLikeMealLog(log = {}) {
  const label = normalizeText(log.mealLabel || '');
  const corr = normalizeText(log.correctionType || '').toLowerCase();
  if (/^食事量補正[:：]/.test(label)) return true;
  if (Number(log.kcal || 0) < 0) return true;
  if (/manual_correction_delta|correction_delta|meal_correction|adjustment/.test(corr)) return true;
  if (normalizeText(log.parentMealId || log.targetMealId)) return true;
  return false;
}

/**
 * Tokyo 暦日 fromYmd 〜 toYmd（両端含む）の食事。DBの eaten_at で絞る。
 */
async function getMealLogsByDateRange(lineUserId, fromYmd, toYmdInclusive) {
  const user = await resolveUser(lineUserId);
  if (!user || !supabase) return [];
  if (!/^\d{4}-\d{2}-\d{2}$/.test(fromYmd) || !/^\d{4}-\d{2}-\d{2}$/.test(toYmdInclusive)) return [];

  const endExclusive = addOneDayYmd(toYmdInclusive);
  if (!endExclusive) return [];
  const { startIso, endIso } = tokyoRangeIso(fromYmd, endExclusive);

  const rows = await safeRows(() => supabase
    .from('meal_logs')
    .select('id, eaten_at, meal_label, food_items, estimated_kcal, protein_g, fat_g, carbs_g, confidence, raw_model_json')
    .eq('user_id', user.id)
    .gte('eaten_at', startIso)
    .lt('eaten_at', endIso)
    .order('eaten_at', { ascending: false }));

  return rows.map(normalizeDbRow);
}

async function getLatestMealLog(lineUserId, daysBack = 3) {
  const user = await resolveUser(lineUserId);
  if (!user || !supabase) return null;
  const today = new Intl.DateTimeFormat('sv-SE', {
    timeZone: 'Asia/Tokyo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).format(new Date());
  let from = today;
  for (let i = 0; i < Math.max(0, Number(daysBack || 0)); i += 1) {
    const m = String(from).match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (!m) break;
    const dt = new Date(`${m[1]}-${m[2]}-${m[3]}T12:00:00+09:00`);
    dt.setDate(dt.getDate() - 1);
    from = new Intl.DateTimeFormat('sv-SE', {
      timeZone: 'Asia/Tokyo',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit'
    }).format(dt);
  }
  const logs = await getMealLogsByDateRange(lineUserId, from, today);
  const deduped = deduplicateMealLogs(logs);
  const baseOnly = deduped.filter((m) => !isCorrectionLikeMealLog(m));
  return baseOnly.length ? baseOnly[0] : (deduped.length ? deduped[0] : null);
}

async function getLatestBaseMealLogWithTrace(lineUserId, daysBack = 5) {
  const user = await resolveUser(lineUserId);
  if (!user || !supabase) return {
    meal: null,
    trace: { candidate_count: 0, excluded_correction_count: 0, selected_meal_id: '', selected_meal_label: '', selection_reason: 'missing_user_or_supabase', skipped_latest_correction: false }
  };
  const today = new Intl.DateTimeFormat('sv-SE', {
    timeZone: 'Asia/Tokyo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).format(new Date());
  let from = today;
  for (let i = 0; i < Math.max(0, Number(daysBack || 0)); i += 1) {
    const m = String(from).match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (!m) break;
    const dt = new Date(`${m[1]}-${m[2]}-${m[3]}T12:00:00+09:00`);
    dt.setDate(dt.getDate() - 1);
    from = new Intl.DateTimeFormat('sv-SE', {
      timeZone: 'Asia/Tokyo',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit'
    }).format(dt);
  }
  const logs = deduplicateMealLogs(await getMealLogsByDateRange(lineUserId, from, today));
  const candidateCount = logs.length;
  const base = logs.filter((m) => !isCorrectionLikeMealLog(m));
  const excludedCorrectionCount = Math.max(0, candidateCount - base.length);
  const selected = base[0] || null;
  const latest = logs[0] || null;
  const skippedLatestCorrection = Boolean(latest && isCorrectionLikeMealLog(latest) && selected && latest.id !== selected.id);
  return {
    meal: selected,
    trace: {
      candidate_count: candidateCount,
      excluded_correction_count: excludedCorrectionCount,
      selected_meal_id: String(selected?.id || ''),
      selected_meal_label: normalizeText(selected?.mealLabel || ''),
      selection_reason: selected ? 'latest_base_meal' : 'no_base_meal_found',
      skipped_latest_correction: skippedLatestCorrection
    }
  };
}

function dedupeFingerprint(log) {
  if (log.sourceLineMessageId) return `msg:${log.sourceLineMessageId}`;
  if (log.dedupeKey) return `key:${log.dedupeKey}`;
  const t = new Date(log.eatenAt).getTime();
  const bucket = Number.isFinite(t) ? Math.floor(t / 120000) : 0;
  const kcal = Math.round(Number(log.kcal || 0));
  const label = normalizeText(log.mealLabel).slice(0, 48).toLowerCase();
  return `rough:${bucket}:${kcal}:${label}`;
}

/**
 * 重複検知: 同一 sourceLineMessageId、または同一 dedupeKey、または
 * 2分以内・同ラベル・同kcal の組は新しい方を捨てる前提で「古い順」に残す。
 */
function deduplicateMealLogs(logs) {
  const list = Array.isArray(logs) ? [...logs] : [];
  list.sort((a, b) => String(a.eatenAt || '').localeCompare(String(b.eatenAt || '')));
  const seen = new Set();
  const out = [];
  for (const log of list) {
    const fp = dedupeFingerprint(log);
    if (seen.has(fp)) continue;
    seen.add(fp);
    out.push(log);
  }
  return out.sort((a, b) => String(b.eatenAt || '').localeCompare(String(a.eatenAt || '')));
}

function sumMealLogs(logs) {
  const list = Array.isArray(logs) ? logs : [];
  return list.reduce(
    (acc, m) => {
      acc.kcal += Number(m.kcal || 0);
      acc.protein += Number(m.protein || 0);
      acc.fat += Number(m.fat || 0);
      acc.carbs += Number(m.carbs || 0);
      acc.count += 1;
      return acc;
    },
    { kcal: 0, protein: 0, fat: 0, carbs: 0, count: 0 }
  );
}

/** DB行を重複排除したうえで kcal / PFC / 件数を集計（集計の唯一の入口） */
function aggregateMealLogs(logs) {
  const list = deduplicateMealLogs(Array.isArray(logs) ? logs : []);
  return sumMealLogs(list);
}

/**
 * オーケストレータの legacy meal オブジェクト配列をログ形に寄せて aggregate する。
 * DB の meal_logs と同じ dedupeFingerprint 規則で合算するため、日次・週次・admin の「件数・kcal」整合に使う。
 */
function aggregateLegacyMealRecords(meals) {
  const rows = (Array.isArray(meals) ? meals : []).map((m) => ({
    eatenAt: m.createdAt || m.eatenAt || '',
    mealLabel: normalizeText(m.summary || m.name || '食事'),
    foodItems: Array.isArray(m.food_items) ? m.food_items : (Array.isArray(m.items) ? m.items : []),
    kcal: Number(m.kcal || m.estimatedNutrition?.kcal || 0),
    protein: Number(m.protein || m.estimatedNutrition?.protein || 0),
    fat: Number(m.fat || m.estimatedNutrition?.fat || 0),
    carbs: Number(m.carbs || m.estimatedNutrition?.carbs || 0),
    confidence: m.confidence != null ? Number(m.confidence) : null,
    sourceLineMessageId: normalizeText(m.sourceLineMessageId || ''),
    dedupeKey: normalizeText(m.dedupeKey || '')
  }));
  return aggregateMealLogs(rows);
}

function tokyoYmdFromIso(iso) {
  if (!iso) return '';
  try {
    return new Intl.DateTimeFormat('sv-SE', {
      timeZone: 'Asia/Tokyo',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit'
    }).format(new Date(iso));
  } catch (_e) {
    return '';
  }
}

/** 東京日付ごとに dedupe 済みログを分類 */
function groupMealLogsByTokyoDay(logs) {
  const map = new Map();
  const list = deduplicateMealLogs(Array.isArray(logs) ? logs : []);
  for (const log of list) {
    const d = tokyoYmdFromIso(log.eatenAt);
    if (!d) continue;
    if (!map.has(d)) map.set(d, []);
    map.get(d).push(log);
  }
  return map;
}

/**
 * DB取得 → dedupe → 集計。ログは呼び出し元の scope 名で出す。
 */
async function fetchAggregateMealLogsFromDb(lineUserId, fromYmd, toYmdInclusive, logScope = 'range') {
  const raw = await getMealLogsByDateRange(lineUserId, fromYmd, toYmdInclusive);
  const deduped = deduplicateMealLogs(raw);
  const totals = sumMealLogs(deduped);
  const duplicateDetected = raw.length !== deduped.length;
  console.info('[meal] fetched_records_count', { scope: logScope, fromYmd, toYmdInclusive, rawRows: raw.length, dedupedRows: deduped.length });
  console.info('[meal] total_calculated', { scope: logScope, count: totals.count, kcal: round1(totals.kcal), protein: round1(totals.protein), fat: round1(totals.fat), carbs: round1(totals.carbs) });
  console.info('[meal_daily_total_integrity_check]', {
    user_id: normalizeText(lineUserId || ''),
    date: `${fromYmd}..${toYmdInclusive}`,
    meal_count: totals.count,
    unique_meal_ids: deduped.map((m) => m.id).filter(Boolean).length,
    total_calories: round1(totals.kcal),
    duplicate_detected: duplicateDetected
  });
  return { raw, deduped, totals };
}

function formatMealAggregateReply({ label, ymd, totals }) {
  const t = totals || { count: 0, kcal: 0, protein: 0, fat: 0, carbs: 0 };
  const head = label && ymd ? `【${label}（${ymd}）】` : label ? `【${label}】` : '【食事】';
  return [
    head,
    `件数: ${t.count} / 合計 約${round1(t.kcal)} kcal`,
    `PFC: たんぱく質 約${round1(t.protein)}g / 脂質 約${round1(t.fat)}g / 炭水化物 約${round1(t.carbs)}g`,
    '（DB meal_logs を再読込して集計しています）'
  ].join('\n');
}

/** 詳細一覧（formatMealLogDetails の別名） */
function formatMealDetailsReply(logs, options = {}) {
  return formatMealLogDetails(logs, options);
}

function formatTimeTokyo(iso) {
  if (!iso) return '—';
  try {
    return new Intl.DateTimeFormat('ja-JP', {
      timeZone: 'Asia/Tokyo',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false
    }).format(new Date(iso));
  } catch (_e) {
    return '—';
  }
}

function foodLine(log) {
  if (log.foodItems?.length) return log.foodItems.join('＋');
  return normalizeText(log.mealLabel) || '食事';
}

/**
 * 食事一覧（新しい順）。maxItems 件まで。
 */
function formatMealLogDetails(logs, options = {}) {
  const maxItems = Math.min(40, Math.max(1, Number(options.maxItems || 25)));
  const list = deduplicateMealLogs(logs).slice(0, maxItems);
  return list.map((log) => {
    const t = formatTimeTokyo(log.eatenAt);
    const food = foodLine(log);
    const kcal = round1(log.kcal || 0);
    const c = log.confidence;
    const conf = c != null && Number.isFinite(Number(c))
      ? (Number(c) <= 1 ? ` / 自信度${Math.round(Number(c) * 100)}%` : ` / 自信度${round1(c)}`)
      : '';
    return `・${t}  ${food}  約${kcal}kcal${conf}`;
  });
}

module.exports = {
  getMealLogsByDateRange,
  getLatestMealLog,
  getLatestBaseMealLogWithTrace,
  deduplicateMealLogs,
  dedupeFingerprint,
  sumMealLogs,
  aggregateMealLogs,
  aggregateLegacyMealRecords,
  groupMealLogsByTokyoDay,
  fetchAggregateMealLogsFromDb,
  formatMealAggregateReply,
  formatMealLogDetails,
  formatMealDetailsReply,
  tokyoYmdFromIso,
  normalizeDbRow,
  addOneDayYmd,
};
