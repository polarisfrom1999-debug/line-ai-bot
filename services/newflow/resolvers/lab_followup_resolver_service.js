'use strict';

const labFollowupService = require('../../lab_followup_service');
const responseBuilderService = require('../response_builder_service');
const { mergeLabPanels, isWeakLabPanel } = require('../lab_panel_merge_service');
const { countQualifiedPanelRecords, distinctObservedDateStringsFromParsedItems } = require('../../lab_gemini_items_service');
const labSessionRepository = require('../../../repositories/lab_session_repository');
const labHistoryCompare = require('../../lab_history_compare_service');
const activeContextStoreService = require('../active_context_store_service');
const labIngestTrace = require('../../lab_ingest_trace_service');

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

/**
 * 印刷日の有無（用紙メタ; item由来の採血日列とは別）
 */
function hasMetaPrintDate(panel) {
  return Boolean(normalizeText(panel?.meta?.printDate || panel?.printDate || panel?.print_date || ''));
}

function metaPresentPatientName(panel) {
  return Boolean(normalizeText(panel?.meta?.patientName || panel?.patientName || panel?.patient_name));
}

function metaPresentFacilityName(panel) {
  return Boolean(normalizeText(panel?.meta?.facilityName || panel?.facilityName || panel?.facility_name));
}

const DEFAULT_LOG_EX = {
  history_sessions_count: 0,
  comparison_available: false,
  comparison_target_key: null,
  comparison_mode: null,
  abnormal_rows_count: null,
  current_session_id: null,
  answer_source_session_id: null,
  current_session_observed_dates: [],
  returned_dates_list: [],
  correction_patch_applied: null
};

/**
 * 血液検査 follow 回答根拠の1行サマリ（新本流）
 */
function logLabFollowupContext({
  userId,
  questionId,
  sessionLabReached,
  canonicalLabReached,
  panel,
  logExtra = {}
} = {}) {
  const ex = { ...DEFAULT_LOG_EX, ...logExtra };
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
      meta_adopt_patient: null,
      meta_adopt_facility: null,
      meta_adopt_print_date: null,
      meta_adoption: null,
      meta_extraction: null,
      abnormal_items_count: 0,
      history_sessions_count: ex.history_sessions_count,
      comparison_available: ex.comparison_available,
      comparison_target_key: ex.comparison_target_key,
      comparison_mode: ex.comparison_mode,
      abnormal_rows_count: ex.abnormal_rows_count,
      current_session_id: ex.current_session_id,
      answer_source_session_id: ex.answer_source_session_id,
      current_session_observed_dates: ex.current_session_observed_dates,
      returned_dates_list: ex.returned_dates_list,
      correction_patch_applied: ex.correction_patch_applied
    });
    return;
  }
  const adoption = panel?.metaAdoption && typeof panel.metaAdoption === 'object' ? panel.metaAdoption : null;
  const metaExtraction = panel?.metaExtraction && typeof panel.metaExtraction === 'object' ? panel.metaExtraction : null;
  console.info('[phasee-new] lab_followup_context', {
    userId: normalizeText(userId),
    question_id: questionId,
    session_lab_reached: Boolean(sessionLabReached),
    canonical_lab_reached: Boolean(canonicalLabReached),
    records_count: countRecordsWithValue(panel),
    patient_name_present: metaPresentPatientName(panel),
    facility_name_present: metaPresentFacilityName(panel),
    print_date_present: hasMetaPrintDate(panel),
    meta_adopt_patient: adoption && adoption.patient_name != null ? adoption.patient_name : null,
    meta_adopt_facility: adoption && adoption.facility_name != null ? adoption.facility_name : null,
    meta_adopt_print_date: adoption && adoption.print_date != null ? adoption.print_date : null,
    meta_adoption: adoption,
    meta_extraction: metaExtraction,
    abnormal_items_count: countAbnormalItemRows(panel),
    history_sessions_count: ex.history_sessions_count,
    comparison_available: ex.comparison_available,
    comparison_target_key: ex.comparison_target_key,
    comparison_mode: ex.comparison_mode,
    abnormal_rows_count: ex.abnormal_rows_count,
    current_session_id: ex.current_session_id,
    answer_source_session_id: ex.answer_source_session_id,
    current_session_observed_dates: ex.current_session_observed_dates,
    returned_dates_list: ex.returned_dates_list,
    correction_patch_applied: ex.correction_patch_applied
  });
}

function buildScopePrefix(panel = {}) {
  const bits = [];
  const patient = normalizeText(panel?.meta?.patientName || panel?.patientName || '');
  const facility = normalizeText(panel?.meta?.facilityName || panel?.facilityName || '');
  const printDate = normalizeText(panel?.meta?.printDate || panel?.printDate || panel?.print_date || '');
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

function parseLabMetaCorrection(text) {
  const safe = normalizeText(text);
  if (!safe) return null;
  const patient = safe.match(/(?:患者名|氏名)\s*(?:は|:|：)?\s*([^\n。]+)/);
  const facilityThis = safe.match(
    /(?:この医療機関|この病院)\s*(?:は|:|：)\s*(.+?)(?:\s*だよ|\s*です|\s*だった)?[。．\s]*$/i
  );
  const facilityFromLead = safe.match(
    /(?:これは|これ|この医療機関は|この病院は|病院は|施設は|施設名は|病院名は|医療機関は)\s*([^\s。]{1,40}(?:クリニック|医院|病院|診療所|内科))/
  );
  const facility = safe.match(
    /(?:施設名|病院名|クリニック|医院|医療機関|この医療機関|この病院)\s*(?:は|:|：)?\s*([^\n。]+)/
  );
  const printDate = safe.match(/(?:印刷日|検査日|採血日)\s*(?:は|:|：)?\s*((?:20\d{2}[-\/\.年]\d{1,2}[-\/\.月]\d{1,2}日?)|(?:\d{2}[-\/]\d{1,2}[-\/]\d{1,2}))/);
  const out = {};
  const clean = (v) => normalizeText(v)
    .replace(/です$|だよ$|だった$|だ$/g, '')
    .replace(/^(これは|これ|この医療機関は|この病院は|病院は|施設は|医療機関は|施設名は|病院名は)\s*/g, '')
    .replace(/^[、,]\s*/g, '')
    .replace(/[。．]+$/g, '')
    .trim();
  const invalid = (v) => !v || /[?？]/.test(v) || v.length > 80;
  if (patient) {
    const v = clean(patient[1]);
    if (!invalid(v)) out.patientName = v;
  }
  if (facilityThis) {
    const v = clean(facilityThis[1]);
    if (!invalid(v)) out.facilityName = v;
  }
  if (!out.facilityName && facility) {
    const v = clean(facility[1]);
    if (!invalid(v)) out.facilityName = v;
  }
  if (!out.facilityName && facilityFromLead) {
    const v = clean(facilityFromLead[1]);
    if (!invalid(v)) out.facilityName = v;
  }
  if (printDate) {
    const v = normalizeText(printDate[1]);
    if (!invalid(v)) out.printDate = v;
  }
  return Object.keys(out).length ? out : null;
}

function normalizeDateToken(value) {
  const safe = normalizeText(value).replace(/\s+/g, '');
  if (!safe) return '';
  let m = safe.match(/(20\d{2})[\/\.\-年](\d{1,2})[\/\.\-月](\d{1,2})日?/);
  if (m) return `${m[1]}-${String(m[2]).padStart(2, '0')}-${String(m[3]).padStart(2, '0')}`;
  m = safe.match(/(20\d{2})-(\d{2})-(\d{2})/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  return '';
}

function extractDateCorrectionPatch(text) {
  const safe = normalizeText(text);
  if (!safe) return null;
  if (!/(日付|検査日|採血日|別の日|違う|ちがう)/.test(safe)) return null;
  const dateRegex = /(20\d{2}[\/\.\-年]\d{1,2}[\/\.\-月]\d{1,2}日?)/g;
  const dates = [];
  let m;
  while ((m = dateRegex.exec(safe)) !== null) {
    const d = normalizeDateToken(m[1]);
    if (d) dates.push(d);
  }
  return {
    rawText: safe,
    correctionHint: 'date',
    mentionedDates: Array.from(new Set(dates))
  };
}

function extractValueAssociationCorrectionPatch(text) {
  const safe = normalizeText(text);
  if (!safe) return null;
  if (!/(その値|この値|別の日|値.*違う|値.*ちがう|紐づけ|ひもづけ|対応が違う)/.test(safe)) return null;
  return {
    rawText: safe,
    correctionHint: 'value_association'
  };
}

/**
 * @param {object} [meta] session_lab_reached / canonical_lab_reached: 追跡用
 */
async function resolveLabFollowup(text, panel, meta = {}) {
  const safeText = normalizeText(text || '');
  if (!safeText) return null;

  const p = panel && typeof panel === 'object' ? panel : null;
  const {
    userId = '',
    sessionLabReached = false,
    canonicalLabReached = false,
    currentSessionId = null,
    answerSourceSessionId = null
  } = meta;

  if (!p) {
    logLabFollowupContext({ userId, questionId: 'no_panel', sessionLabReached, canonicalLabReached, panel: null, logExtra: {} });
    return { intentType: 'newflow_lab_followup', replyText: responseBuilderService.buildCanonicalInsufficientReply() };
  }

  const pre = buildScopePrefix(p);
  const tail = isWeakLabPanel(p) && !countRecordsWithValue(p)
    ? (labFollowupService.RESEND_PROMPT || 'もう一度鮮明に送り直すと、読み取れやすくなります。')
    : '';

  const currentObservedDates = distinctObservedDateStringsFromParsedItems(
    Array.isArray(p?.itemsStructured) ? p.itemsStructured : []
  );

  const record = (id, logExtra = {}) => {
    logLabFollowupContext({
      userId,
      questionId: id,
      sessionLabReached,
      canonicalLabReached,
      panel: p,
      logExtra: {
        current_session_id: currentSessionId,
        answer_source_session_id: answerSourceSessionId || currentSessionId,
        current_session_observed_dates: currentObservedDates,
        ...logExtra
      }
    });
  };

  const loadHistory = async () => {
    if (!normalizeText(userId)) return [];
    const rows = await labSessionRepository.getRecentLabSessions(userId, 10);
    return Array.isArray(rows) ? rows : [];
  };

  if (/((これは|これ|この医療機関は|この病院は|病院は|施設は|医療機関は|訂正|修正|違う|ちがう|にして|です|だった|だよ).*(クリニック|内科|病院|医療機関|患者名|氏名|印刷日|検査日|採血日))|((患者名|氏名|施設名|病院名).*(だよ|です|だった))/i.test(safeText)) {
    let patch = parseLabMetaCorrection(safeText);
    if (!patch && /(この医療機関は|この病院は|病院は|施設は|医療機関は)/.test(safeText) && /(クリニック|医院|病院|診療所|内科)/.test(safeText)) {
      patch = parseLabMetaCorrection(safeText.replace(/\u3000/g, ' '));
    }
    if (patch && normalizeText(userId)) {
      const upd = await labSessionRepository.updateLatestLabSessionMeta(userId, patch);
      await labSessionRepository.appendLatestLabSessionCorrectionAudit(userId, {
        correctionType: 'meta',
        patch
      }).catch(() => null);
      console.info('[phasee-new] lab_correction_intent', {
        userId: normalizeText(userId),
        correction_type: 'meta',
        patch,
        ok: Boolean(upd?.ok),
        reason: upd?.ok ? '' : normalizeText(upd?.reason || 'update_failed')
      });
      record('correction_intent_meta', {
        comparison_mode: 'correction_meta',
        comparison_available: false,
        current_session_id: currentSessionId,
        answer_source_session_id: answerSourceSessionId || currentSessionId,
        current_session_observed_dates: currentObservedDates,
        correction_patch_applied: patch
      });
      if (upd?.ok) {
        const row = upd.row || {};
        console.info('[phasee-new] lab_correction_post_readback', {
          session_id: row.id,
          facility_name: normalizeText(row.facility_name || ''),
          patient_name: normalizeText(row.patient_name || ''),
          print_date: normalizeText(row.print_date || ''),
          correction_type: 'meta',
          patch,
          post_correction_readback: {
            facility_name: normalizeText(row.facility_name || ''),
            patient_name: normalizeText(row.patient_name || ''),
            print_date: normalizeText(row.print_date || '')
          }
        });
        const { context } = await activeContextStoreService.getActiveContext(userId);
        const dom = normalizeText(context?.domain || context?.type || '');
        const lpSrc = context?.payload?.labPanel;
        if (lpSrc && typeof lpSrc === 'object' && (dom === 'lab_image_session' || dom === 'lab_followup_session')) {
          const lp = { ...lpSrc };
          if (Object.prototype.hasOwnProperty.call(patch, 'patientName')) {
            lp.patientName = normalizeText(row.patient_name || '');
          }
          if (Object.prototype.hasOwnProperty.call(patch, 'facilityName')) {
            lp.facilityName = normalizeText(row.facility_name || '');
          }
          if (Object.prototype.hasOwnProperty.call(patch, 'printDate')) {
            lp.printDate = normalizeText(row.print_date || '');
          }
          const prevMeta = lp.meta && typeof lp.meta === 'object' ? lp.meta : {};
          lp.meta = {
            ...prevMeta,
            patientName: normalizeText(lp.patientName || prevMeta.patientName || ''),
            facilityName: normalizeText(lp.facilityName || prevMeta.facilityName || ''),
            printDate: normalizeText(lp.printDate || prevMeta.printDate || '')
          };
          const expMs = Date.parse(context.expiresAt || '');
          const ttlMs = Number.isFinite(expMs) && expMs > Date.now()
            ? Math.max(expMs - Date.now(), 5 * 60 * 1000)
            : activeContextStoreService.DEFAULT_TTL_MS;
          await activeContextStoreService.setActiveContext(userId, {
            domain: dom,
            ttlMs,
            payload: { ...context.payload, labPanel: lp }
          }).catch(() => null);
          console.info('[phasee-new] lab_correction_active_context_patch', {
            userId: normalizeText(userId),
            domain: dom,
            facilityName: lp.facilityName,
            patientName: lp.patientName
          });
        }
        const fixed = [];
        if (patch.patientName) fixed.push(`患者名=${patch.patientName}`);
        if (patch.facilityName) fixed.push(`施設名=${patch.facilityName}`);
        if (patch.printDate) fixed.push(`日付=${patch.printDate}`);
        return { intentType: 'newflow_lab_followup', replyText: `訂正内容を保存データに反映しました（${fixed.join(' / ')}）。` };
      }
      return { intentType: 'newflow_lab_followup', replyText: '訂正として受け取りましたが、保存反映に失敗しました。もう一度同じ内容を短く送ってください。' };
    }
  }

  if (/(日付が違う|日付.*ちがう|検査日が違う|採血日が違う|検査日.*ちがう|採血日.*ちがう|別の日だよ|別の日です)/.test(safeText) && !/値/.test(safeText)) {
    const patch = extractDateCorrectionPatch(safeText);
    if (normalizeText(userId)) {
      const upd = await labSessionRepository.appendLatestLabSessionCorrectionAudit(userId, {
        correctionType: 'date',
        patch: patch || { rawText: safeText, correctionHint: 'date' }
      });
      console.info('[phasee-new] lab_correction_intent', {
        userId: normalizeText(userId),
        correction_type: 'date',
        patch: patch || { rawText: safeText, correctionHint: 'date' },
        ok: Boolean(upd?.ok),
        reason: upd?.ok ? '' : normalizeText(upd?.reason || 'update_failed')
      });
      record('correction_intent_date', {
        comparison_mode: 'correction_date',
        comparison_available: false,
        current_session_id: currentSessionId,
        answer_source_session_id: answerSourceSessionId || currentSessionId,
        current_session_observed_dates: currentObservedDates,
        correction_patch_applied: patch || { rawText: safeText, correctionHint: 'date' }
      });
      if (upd?.ok) {
        return { intentType: 'newflow_lab_followup', replyText: '日付訂正として受け取り、監査ログに反映しました。必要なら「2025-03-24のTGを2025-03-20へ」のように具体的に送ってください。' };
      }
      return { intentType: 'newflow_lab_followup', replyText: '日付訂正として受け取りましたが、保存反映に失敗しました。もう一度短く送ってください。' };
    }
  }

  if (/(その値は別の日だよ|その値は別の日|この値は別の日|値は別の日|値の紐づけ|値のひもづけ|値.*別の日)/.test(safeText)) {
    const patch = extractValueAssociationCorrectionPatch(safeText);
    if (normalizeText(userId)) {
      const upd = await labSessionRepository.appendLatestLabSessionCorrectionAudit(userId, {
        correctionType: 'value_association',
        patch: patch || { rawText: safeText, correctionHint: 'value_association' }
      });
      console.info('[phasee-new] lab_correction_intent', {
        userId: normalizeText(userId),
        correction_type: 'value_association',
        patch: patch || { rawText: safeText, correctionHint: 'value_association' },
        ok: Boolean(upd?.ok),
        reason: upd?.ok ? '' : normalizeText(upd?.reason || 'update_failed')
      });
      record('correction_intent_value_association', {
        comparison_mode: 'correction_value_association',
        comparison_available: false,
        current_session_id: currentSessionId,
        answer_source_session_id: answerSourceSessionId || currentSessionId,
        current_session_observed_dates: currentObservedDates,
        correction_patch_applied: patch || { rawText: safeText, correctionHint: 'value_association' }
      });
      if (upd?.ok) {
        return { intentType: 'newflow_lab_followup', replyText: '値の紐づけ訂正として受け取り、監査ログに反映しました。対象項目と正しい日付を1つずつ指定すると再紐づけしやすくなります。' };
      }
      return { intentType: 'newflow_lab_followup', replyText: '値の紐づけ訂正として受け取りましたが、保存反映に失敗しました。もう一度短く送ってください。' };
    }
  }

  if (
    /他の日付|他の日は|別の?日付|他の日に|他の検査日|何日分(\s*(ある|です|か|？|\?)|ある|です|か)|日付.*(いくつ|何件)|読めて(い)?る(\?|？|か).*(日付|検査日|保存)|保存.*(何件|いくつ|日付|データ|ある)|何件分(の)?(保存|検査|画像)|検査日.*(何種|何個|いくつ)/i.test(
      safeText
    )
  ) {
    const arr = await loadHistory();
    const panelDates = currentObservedDates;
    const panelDateLine = panelDates.length
      ? `この画像内で読み取れた日付候補は ${panelDates.join(' / ')} です。`
      : '';
    const savedCountLine = `保存済みセッション件数は ${(arr || []).length} 件です。`;
    const body = [panelDateLine, savedCountLine].filter(Boolean).join(' ');
    record('lab_saved_dates_inventory', {
      history_sessions_count: (arr || []).length,
      comparison_available: (arr || []).length >= 2,
      comparison_mode: 'saved_dates',
      current_session_id: currentSessionId,
      answer_source_session_id: answerSourceSessionId || currentSessionId,
      current_session_observed_dates: currentObservedDates,
      returned_dates_list: panelDates
    });
    const replyOtherDates = `${pre} ${body}${tail ? ` ${tail}` : ''}`.trim();
    console.info('[phasee-new] lab_followup_other_dates_reply', {
      renderGitCommit: labIngestTrace.getRenderGitCommitForLogs(),
      userId: normalizeText(userId),
      question_id: 'lab_saved_dates_inventory',
      current_session_observed_dates: currentObservedDates,
      returned_dates_list: panelDates,
      replyText: replyOtherDates
    });
    return { intentType: 'newflow_lab_followup', replyText: replyOtherDates };
  }

  if (/(バランスは\?|バランスどう|バランス|脂質系|肝機能系|糖代謝系|腎機能系)/.test(safeText)) {
    record('balance');
    return { intentType: 'newflow_lab_followup', replyText: `${pre} ${labFollowupService.buildBalanceReply(p)}`.trim() };
  }

  if (/(傾向は[?？]?|傾向どう|推移は[?？]?|推移どう|この検査の傾向は[?？]?|この検査の傾向)/.test(safeText)) {
    record('trend');
    return { intentType: 'newflow_lab_followup', replyText: buildTrendReply(p) };
  }

  if (
    /(この検査結果|検査結果).*(異常|高い数値|低い数値|傾向)|高い数値ある|低い数値ある|異常は\?|異常ある/.test(safeText)
  ) {
    if (/(高い数値ある|高め|高い値|高値)/.test(safeText)) {
      record('high_values');
      return { intentType: 'newflow_lab_followup', replyText: `${pre} ${labFollowupService.buildHighLowReply(p, 'high')}`.trim() };
    }
    if (/(低い数値ある|低め|低い値|低値)/.test(safeText)) {
      record('low_values');
      return { intentType: 'newflow_lab_followup', replyText: `${pre} ${labFollowupService.buildHighLowReply(p, 'low')}`.trim() };
    }
    if (/(傾向|推移|前回より|前回と比較|前回と比べ)/.test(safeText)) {
      record('trend');
      return { intentType: 'newflow_lab_followup', replyText: buildTrendReply(p) };
    }
    record('abnormal_summary');
    return { intentType: 'newflow_lab_followup', replyText: `${pre} ${labFollowupService.buildAbnormalSummaryReply(p)}`.trim() };
  }
  if (/(何が問題|問題ある|問題がある|どこが問題|何が悪い)/.test(safeText)) {
    record('abnormal_summary');
    return { intentType: 'newflow_lab_followup', replyText: `${pre} ${labFollowupService.buildAbnormalSummaryReply(p)}`.trim() };
  }

  if (
    /傾向(と|)(対策|対応|アドバイス|教え)|対策(を)?(教|聞)|気をつける(こと|点|べき)|今回の検査(で|から).*(傾向|わか|気)|検査結果から.*(傾向|対策)|どんな傾向(が|を|は|に)/i.test(
      safeText
    )
  ) {
    const arr = await loadHistory();
    const body = labFollowupService.buildTrendAndCountermeasuresReply(p, arr || []);
    record('lab_trend_guidance', {
      history_sessions_count: (arr || []).length,
      comparison_available: (arr || []).length >= 2,
      comparison_mode: 'trend_guidance'
    });
    return { intentType: 'newflow_lab_followup', replyText: `${pre} ${body}${tail ? ` ${tail}` : ''}`.trim() };
  }

  if (/前回(より|と(比(べ|較)|比較|比べ|くら(べ|い)))|前回(から|に)(は)?(どう|なっ)|比(べ|較)て(は)?(どう|の)(か)?|前回(は(どう|どんな)|から)/.test(safeText) && /前回|比(べ|較)/.test(safeText)) {
    const arr = await loadHistory();
    const comparisons = labHistoryCompare.summarizeMultisessionComparisons(arr);
    const picked = labHistoryCompare.pickOverallLines(comparisons);
    const hasComp = picked.some((c) => c && c.canCompare);
    let body = labFollowupService.buildOverallHistoryDeltaReply(picked, {
      historySessionsCount: arr.length,
      comparisonAvailable: hasComp
    });
    if (!hasComp) {
      const inSessionTrend = buildTrendReply(p);
      if (normalizeText(inSessionTrend)) {
        body = `${body} 同一画像内の時系列で見える範囲では、${inSessionTrend.replace(/^今確認できる範囲では、/, '')}`;
      }
    }
    record('history_overall', {
      history_sessions_count: arr.length,
      comparison_available: hasComp,
      comparison_target_key: hasComp && picked[0] ? String(picked[0].groupKey) : null,
      comparison_mode: 'overall',
      abnormal_rows_count: null
    });
    return { intentType: 'newflow_lab_followup', replyText: `${pre} ${body}${tail ? ` ${tail}` : ''}`.trim() };
  }

  if (
    /悪い値(は|って|の項目|はどこ|がどれ)[?？\s]*$/.test(safeText)
    || /悪い(値|点|のとこ|の箇所)(は)?[?？]/.test(safeText)
    || /(どの|どこ)の(値|行)が(悪|高|低|ヤバ)/.test(safeText)
  ) {
    const arr = await loadHistory();
    const latestS = arr[0] || null;
    const ab = latestS ? labHistoryCompare.listAbnormalRowsFromSession(latestS) : [];
    const abFinal = ab.length ? ab : extractAbnormalFromPanel(p);
    const w = arr.length >= 2 ? labHistoryCompare.findWorseningToHigh(arr) : [];
    const body = labFollowupService.buildAbnormalChangeReply(abFinal, w);
    record('bad_values_q', {
      history_sessions_count: arr.length,
      comparison_available: arr.length >= 2,
      comparison_target_key: null,
      comparison_mode: 'bad_with_history',
      abnormal_rows_count: abFinal.length
    });
    return { intentType: 'newflow_lab_followup', replyText: `${pre} ${body}${tail ? ` ${tail}` : ''}`.trim() };
  }

  if (/(中性脂肪|(^|[^A-Za-z])TG([^A-Za-z]|$))の(推移|傾向)/i.test(safeText) || (/(推移|傾向)/.test(safeText) && /(中性脂肪|\bTG\b)/i.test(safeText) && !/前回(より|と(比(べ|較)))/.test(safeText))) {
    const arr = await loadHistory();
    const ser = labHistoryCompare.getTgSeries(arr);
    const c = labHistoryCompare.compareKeySeries('alias:tg', ser);
    const hasC = c && c.canCompare;
    const body = labFollowupService.buildTgProgressReply(c);
    const uq = labHistoryCompare.uniqueSeriesByDate(ser);
    record('history_tg_trend', {
      history_sessions_count: arr.length,
      comparison_available: hasC,
      comparison_target_key: 'alias:tg',
      comparison_mode: 'tg_trend',
      abnormal_rows_count: uq && uq.length
    });
    return { intentType: 'newflow_lab_followup', replyText: `${pre} ${body}`.trim() };
  }

  if (/(悪い値|ヤバ|異常(っぽ)?い|H\/L|高すぎ|低すぎ|フラグ(付)?|マーク(付)?)/.test(safeText) && !/前回(より|と(比(べ|較)))/.test(safeText)) {
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
  if (
    /^(?!この)(病院名|施設名|医院|クリニック(名|は)|医療機関名|医療機関は)/.test(safeText)
    && !/患者/.test(safeText)
  ) {
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
  if (/(変化|推移|上がっ|下がっ|前回(と)?(比|くら))/.test(safeText) && !/前回(より|と(比(べ|較)))/.test(safeText) && !/(中性脂肪|TG)の(推移|傾向)/i.test(safeText)) {
    record('trend');
    return { intentType: 'newflow_lab_followup', replyText: buildTrendReply(p) };
  }
  if (/(私の検査の結果.*どう|この(検査)?結果.*どう|この結果.*どう|健康状態どう思う|総評して|全体としてどう|全体的にどう)/i.test(safeText)) {
    record('overall_assessment', {
      comparison_mode: 'overall_assessment'
    });
    const summary = [
      labFollowupService.buildAbnormalSummaryReply(p),
      labFollowupService.buildBalanceReply(p)
    ].filter(Boolean).join('\n');
    return {
      intentType: 'newflow_lab_followup',
      replyText: `${pre} ${summary}`.trim()
    };
  }
  if (/(他に)?(何の)?(項目|検査)|他に(何|読|わか|え)る?|他の(検査)?/i.test(safeText)) {
    record('other_values');
    return { intentType: 'newflow_lab_followup', replyText: `${pre} ${labFollowupService.buildGentleReadableSummaryReply(p)}${tail ? ` ${tail}` : ''}`.trim() };
  }
  if (/(何読み取れた|何を読み取った|全部教えて|どの項目が保存された|読み取れた項目を見せて|10件は何を読み取った|保存項目)/.test(safeText)) {
    record('item_inventory');
    return {
      intentType: 'newflow_lab_followup',
      replyText: `${pre} ${labFollowupService.buildNaturalAllValuesReply(p)}${tail ? ` ${tail}` : ''}`.trim()
    };
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

function extractAbnormalFromPanel(panel) {
  const out = [];
  for (const it of panel?.items || []) {
    if (['H', 'L'].includes(normalizeFlagValue(it?.flag)) && (it.value || it.currentValue)) {
      out.push({
        displayName: normalizeText(it?.itemName || it?.name || '項目'),
        value: normalizeText(it?.value || it?.currentValue || ''),
        unit: normalizeText(it?.unit || ''),
        flag: normalizeFlagValue(it?.flag) || (it?.flag || '')
      });
    }
  }
  return out;
}

module.exports = {
  resolveLabFollowup,
  logLabFollowupContext,
  mergeLabPanels,
  isWeakLabPanel
};
