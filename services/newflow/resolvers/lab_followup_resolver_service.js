'use strict';

const labFollowupService = require('../../lab_followup_service');
const responseBuilderService = require('../response_builder_service');
const { mergeLabPanels, isWeakLabPanel } = require('../lab_panel_merge_service');
const { countQualifiedPanelRecords } = require('../../lab_gemini_items_service');

function normalizeText(value) {
  return String(value || '').trim();
}

function normalizeFlagValue(value) {
  const s = String(value || '').toUpperCase();
  if (s === 'H' || s === 'HIGH' || s === 'Ｈ') return 'H';
  if (s === 'L' || s === 'LOW' || s === 'Ｌ') return 'L';
  return '';
}

function countRecordsWithValue(panel) {
  return countQualifiedPanelRecords(panel);
}

function countAbnormalItemRows(panel) {
  let n = 0;
  for (const it of panel?.items || []) {
    if (['H', 'L'].includes(normalizeFlagValue(it?.flag))) n += 1;
  }
  return n;
}

function hasPrintDateHint(panel) {
  return Boolean(normalizeText(panel?.printDate || panel?.print_date || ''));
}

/**
 * 血液検査 follow 回答根拠の1行サマリ（新本流）
 */
function logLabFollowupContext({
  userId,
  questionId,
  sessionLabReached,
  canonicalLabReached,
  panel
}) {
  if (!panel || typeof panel !== 'object') {
    console.info('[phasee-new] lab_followup_context', {
      userId: normalizeText(userId),
      question_id: questionId,
      session_lab_reached: Boolean(sessionLabReached),
      canonical_lab_reached: Boolean(canonicalLabReached),
      records_count: 0,
      patient_name_present: false,
      facility_name_present: false,
      print_date_present: false,
      abnormal_items_count: 0
    });
    return;
  }
  console.info('[phasee-new] lab_followup_context', {
    userId: normalizeText(userId),
    question_id: questionId,
    session_lab_reached: Boolean(sessionLabReached),
    canonical_lab_reached: Boolean(canonicalLabReached),
    records_count: countRecordsWithValue(panel),
    patient_name_present: Boolean(normalizeText(panel.patientName || panel.patient_name)),
    facility_name_present: Boolean(normalizeText(panel.facilityName || panel.facility_name)),
    print_date_present: hasPrintDateHint(panel),
    abnormal_items_count: countAbnormalItemRows(panel)
  });
}

function buildScopePrefix(panel = {}) {
  const bits = [];
  const patient = normalizeText(panel?.patientName || '');
  const facility = normalizeText(panel?.facilityName || '');
  const printDate = normalizeText(panel?.printDate || panel?.print_date || '');
  if (patient) bits.push(`患者名: ${patient}`);
  if (facility) bits.push(`医療機関: ${facility}`);
  if (printDate) bits.push(`印刷日: ${printDate}`);
  if (bits.length) return `今確認できる範囲では、${bits.join(' / ')}です。`;
  return '今確認できる範囲でお答えします。';
}

function buildTrendReply(panel = {}) {
  const items = Array.isArray(panel?.items) ? panel.items : [];
  const trendLines = [];
  for (const it of items) {
    const history = Array.isArray(it?.history) ? it.history.filter((h) => normalizeText(h?.value || '')) : [];
    if (history.length < 2) continue;
    const latest = normalizeText(history[history.length - 1]?.value || '');
    const prev = normalizeText(history[history.length - 2]?.value || '');
    if (!latest || !prev || latest === prev) continue;
    const name = normalizeText(it?.itemName || '');
    if (!name) continue;
    trendLines.push(`${name}: ${prev} → ${latest}`);
    if (trendLines.length >= 3) break;
  }
  if (!trendLines.length) {
    return `${buildScopePrefix(panel)} 日付違いの2点が同じ枠に写っていると、変化を押さえやすいです。`;
  }
  return `${buildScopePrefix(panel)} 変化が分かる行は、${trendLines.join(' / ')} です。`;
}

/**
 * @param {object} [meta] session_lab_reached / canonical_lab_reached: 追跡用
 */
function resolveLabFollowup(text, panel, meta = {}) {
  const safeText = normalizeText(text || '');
  if (!safeText) return null;

  const p = panel && typeof panel === 'object' ? panel : null;
  const { userId = '', sessionLabReached = false, canonicalLabReached = false } = meta;

  if (!p) {
    logLabFollowupContext({ userId, questionId: 'no_panel', sessionLabReached, canonicalLabReached, panel: null });
    return { intentType: 'newflow_lab_followup', replyText: responseBuilderService.buildCanonicalInsufficientReply() };
  }

  const pre = buildScopePrefix(p);
  const tail = isWeakLabPanel(p) && !countRecordsWithValue(p)
    ? (labFollowupService.RESEND_PROMPT || 'もう一度鮮明に送り直すと、読み取れやすくなります。')
    : '';

  const record = (id) => {
    logLabFollowupContext({ userId, questionId: id, sessionLabReached, canonicalLabReached, panel: p });
  };

  if (/(悪い値|ヤバ|異常(っぽ)?い|H\/L|高すぎ|低すぎ|フラグ(付)?|マーク(付)?)/.test(safeText)) {
    record('bad_values');
    return { intentType: 'newflow_lab_followup', replyText: `${pre} ${labFollowupService.buildGentleAbnormalReply(p)}${tail ? ` ${tail}` : ''}`.trim() };
  }
  if (
    /何が読め|読めた(の|のか|のかな)|何を読み取(れ)?る?|分かる(範囲|こと)|掴め(る|て)/.test(safeText)
    || /(検査(結果)?で)?(分か|わか)る(範囲|の)は?/.test(safeText)
  ) {
    record('what_read');
    return { intentType: 'newflow_lab_followup', replyText: `${pre} ${labFollowupService.buildGentleReadableSummaryReply(p)}${tail ? ` ${tail}` : ''}`.trim() };
  }
  if (/患者(名|氏名)(や|と|とか)?(クリニック|病院|医療(機関)?|医院)\s*(\?|？|は)?|患者名やクリニック|氏名(や|と)(病院|医院|診療所)/.test(safeText)) {
    record('patient_and_clinic');
    return { intentType: 'newflow_lab_followup', replyText: labFollowupService.buildPatientAndClinicReply(p) };
  }
  if (/^患者(名|氏名)|氏名(は|わ)/.test(safeText) && !/クリニック|病院|医療(機関)?|医院/.test(safeText)) {
    record('patient');
    return { intentType: 'newflow_lab_followup', replyText: `${pre} ${labFollowupService.buildPatientNameReply(p)}`.trim() };
  }
  if (/^病院名|医院|クリニック(名|は)|医療(機関)?(名|は)/.test(safeText) && !/患者/.test(safeText)) {
    record('facility');
    return { intentType: 'newflow_lab_followup', replyText: `${pre} ${labFollowupService.buildFacilityNameReply(p)}`.trim() };
  }
  if (/印刷日|発行|出力(日|された)/.test(safeText)) {
    record('print_date');
    return { intentType: 'newflow_lab_followup', replyText: `${pre} ${labFollowupService.buildPrintDateReply(p)}`.trim() };
  }
  if (/(^日付(は)?[?？\s]*$|いつ(の|が)?(検査|採血)|採血日(は)?|検査日(は)?|最新(の)?(検査)?日|一番(新|あた)し)/.test(safeText) && !/悪い|何が/.test(safeText)) {
    record('date');
    return { intentType: 'newflow_lab_followup', replyText: `${pre} ${labFollowupService.buildDateFollowupNaturalReply(p)}`.trim() };
  }
  if (/日付|検査日|採血日|一番(新|あた)しい(検査)?日(付)?|最新(の)?(検査)?日(付)?/.test(safeText) && /何時|教えて|どれ/.test(safeText)) {
    record('date_alt');
    return { intentType: 'newflow_lab_followup', replyText: `${pre} ${labFollowupService.buildDateFollowupNaturalReply(p)}`.trim() };
  }
  if (/(異常|アブノーマル).*(つい(て)?いる?)?(の)?(値|項目|マーク|フラグ|付き)|H\/L|アブノーマル|高め|低め(の|な)?(値|とこ)/.test(safeText) && !/悪い値/.test(safeText)) {
    record('abnormal_wording');
    return { intentType: 'newflow_lab_followup', replyText: `${pre} ${labFollowupService.buildGentleAbnormalReply(p)}`.trim() };
  }
  if (/変化|推移|上がっ|下がっ|前回(と)?(比|くら)/.test(safeText)) {
    record('trend');
    return { intentType: 'newflow_lab_followup', replyText: buildTrendReply(p) };
  }
  if (/(他に)?(何の)?(項目|検査)|他に(何|読|わか|え)る?|他の(検査)?/i.test(safeText)) {
    record('other_values');
    return { intentType: 'newflow_lab_followup', replyText: `${pre} ${labFollowupService.buildGentleReadableSummaryReply(p)}`.trim() };
  }
  const target = labFollowupService.normalizeTarget(safeText);
  if (target) {
    record(`item_${target}`);
    const selectedDate = p?.latestExamDate || p?.examDate || '';
    const body = labFollowupService.buildItemReply(p, target, selectedDate);
    return { intentType: 'newflow_lab_followup', replyText: `${pre} ${body}`.trim() };
  }
  if (/削除(した|できた|できた?)|消え(た|た?)/.test(safeText)) {
    record('nudge');
    return { intentType: 'newflow_lab_followup', replyText: 'ここでは保存や削除操作は扱いません。検査で知りたい値を「TGの値は？」のように送ってください。' };
  }
  record('generic');
  return { intentType: 'newflow_lab_followup', replyText: `${pre} ${responseBuilderService.buildLabGenericReply()}${tail ? ` ${tail}` : ''}`.trim() };
}

module.exports = {
  resolveLabFollowup,
  logLabFollowupContext,
  mergeLabPanels,
  isWeakLabPanel
};
