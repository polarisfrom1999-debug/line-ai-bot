'use strict';

const labImageAnalysisService = require('./lab_image_analysis_service');
const labImageAnalysisV2Service = require('./lab_image_analysis_v2_service');
const labDocumentStoreService = require('./lab_document_store_service');
const labReportStoreService = require('./lab_report_store_service');
const labIngestTrace = require('./lab_ingest_trace_service');
const labSessionRepository = require('../repositories/lab_session_repository');
const labMetaExtractService = require('./lab_meta_extract_service');
const geminiItems = require('./lab_gemini_items_service');

function summarizeLabPanel(panel = {}) {
  const items = Array.isArray(panel?.items) ? panel.items : [];
  const structured = Array.isArray(panel?.itemsStructured) ? panel.itemsStructured : [];
  return {
    isLabImage: Boolean(panel?.isLabImage || panel?.labLike),
    examDate: panel?.latestExamDate || panel?.examDate || '',
    examDates: Array.isArray(panel?.examDates) ? panel.examDates.length : 0,
    itemCount: items.length,
    structuredItemCount: structured.length,
    patientName: panel?.patientName || '',
    facilityName: panel?.facilityName || '',
    printDate: panel?.printDate || ''
  };
}

async function applyMetaLayerToPanel({ userId, imagePayload, panel }) {
  if (!userId || !imagePayload || !panel || typeof panel !== 'object') return panel;
  let lastSession = null;
  try {
    lastSession = await labSessionRepository.getLatestLabSession(userId);
  } catch (_e) {
    lastSession = null;
  }
  const canonical = lastSession
    ? {
        patient_name: String(lastSession.patient_name || ''),
        facility_name: String(lastSession.facility_name || ''),
        print_date: String(lastSession.print_date || '').trim() || '',
      }
    : {};
  const documentType = panel.geminiRaw?.classifier?.documentType
    || panel.geminiClassification?.documentType
    || 'unknown';
  const reportDate = String(panel.printDate || panel.examDate || panel.latestExamDate || '').trim();
  const metaExtraction = await labMetaExtractService
    .extractMetaFromImage(imagePayload, { userId, documentType, reportDate })
    .catch(() => null);
  if (!metaExtraction?.mergedDraft) return panel;
  const merged = labMetaExtractService.mergeMetaWithCanonical({
    extracted: metaExtraction.mergedDraft,
    canonical,
  });
  panel.patientName = String(merged.patient_name || '');
  panel.facilityName = String(merged.facility_name || '');
  panel.printDate = String(merged.print_date || '');
  panel.meta = {
    patientName: panel.patientName,
    facilityName: panel.facilityName,
    printDate: panel.printDate,
  };
  panel.metaExtraction = {
    source: metaExtraction.source,
    promptVersion: metaExtraction.promptVersion,
  };
  panel.metaAdoption = merged.adoption;
  panel.metaConfidence = {
    patient_name: merged.patient_name_confidence,
    facility_name: merged.facility_name_confidence,
    print_date: merged.print_date_confidence,
  };
  console.info('[lab-ingest-trace] stage:lab_meta_persist', {
    userId: String(userId),
    ...panel.metaExtraction,
    adoption: panel.metaAdoption,
    patientName: panel.patientName,
    facilityName: panel.facilityName,
    printDate: panel.printDate
  });
  return panel;
}

function buildPipelineComparison(v1 = {}, v2 = {}) {
  const s1 = summarizeLabPanel(v1);
  const s2 = summarizeLabPanel(v2);
  return {
    v1: s1,
    v2: s2,
    delta: {
      examDates: Number(s2.examDates || 0) - Number(s1.examDates || 0),
      itemCount: Number(s2.itemCount || 0) - Number(s1.itemCount || 0),
      structuredItemCount: Number(s2.structuredItemCount || 0) - Number(s1.structuredItemCount || 0)
    }
  };
}

function payloadTopLevelKeys(obj) {
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return [];
  return Object.keys(obj).slice(0, 24);
}

/** DB 保存可能な行に近い「強さ」。pending v1（items 空・rawPayload のみ）や nested structured も数える。 */
function effectivePersistableStrength(panel = {}) {
  const fromPanel = geminiItems.countQualifiedPanelRecords(panel);
  const raw = panel?.structuredJson && typeof panel.structuredJson === 'object'
    ? panel.structuredJson
    : (panel?.rawPayload && typeof panel.rawPayload === 'object' ? panel.rawPayload : null);
  const recovered = raw ? geminiItems.extractPrimaryGeminiMinItems(raw) : [];
  const fromRaw = geminiItems.countPersistableParsedRecords(recovered);
  const qHint = Number(panel?.analysisConfidence?.qualified_records_count || 0) || 0;
  return Math.max(fromPanel, fromRaw, qHint);
}

function mergeRawPayloadsPreferData(a, b) {
  const base = (b && typeof b === 'object' && !Array.isArray(b)) ? { ...b } : {};
  const extra = (a && typeof a === 'object' && !Array.isArray(a)) ? { ...a } : {};
  const out = { ...base, ...extra };
  const da = Array.isArray(a?.data) ? a.data : [];
  const db = Array.isArray(b?.data) ? b.data : [];
  if (da.length || db.length) {
    const merged = [...db, ...da];
    const seen = new Set();
    out.data = merged.filter((row) => {
      if (!row || typeof row !== 'object') return false;
      const k = `${String(row.label_in_image || row.labelInImage || '')}|${String(row.value || '')}`;
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    });
  }
  return Object.keys(out).length ? out : null;
}

/**
 * items / itemsStructured が空でも rawPayload / structuredJson の data[] から最小 item を復元してパネルに載せる。
 */
function enrichPanelFromRecoverablePayload(panel = {}, label = '') {
  const p = panel && typeof panel === 'object' ? panel : {};
  if (geminiItems.countQualifiedPanelRecords(p) > 0) {
    return { panel: p, enriched: false, label: '' };
  }
  const raw = p.structuredJson && typeof p.structuredJson === 'object'
    ? p.structuredJson
    : (p.rawPayload && typeof p.rawPayload === 'object' ? p.rawPayload : null);
  if (!raw) return { panel: p, enriched: false, label: '' };
  const recovered = geminiItems.extractPrimaryGeminiMinItems(raw);
  const n = geminiItems.countPersistableParsedRecords(recovered);
  if (!n) return { panel: p, enriched: false, label: '' };
  const next = {
    ...p,
    itemsStructured: recovered,
    isLabImage: true,
    labLike: true,
    analysisConfidence: {
      ...(p.analysisConfidence && typeof p.analysisConfidence === 'object' ? p.analysisConfidence : {}),
      qualified_records_count: n,
      ingest_recovered_from_raw: true,
      ingest_recovery_label: label || 'raw_payload'
    }
  };
  return { panel: next, enriched: true, label: label || 'raw_payload' };
}

async function ingestLabDocument({ userId, imagePayload } = {}) {
  const cached = await labDocumentStoreService.getCachedPanelByPayload(userId, imagePayload);
  if (cached) {
    if (geminiItems.countQualifiedPanelRecords(cached) === 0) {
      const cacheEnrich = enrichPanelFromRecoverablePayload(cached, 'cache_raw_recovery');
      if (cacheEnrich.enriched) {
        console.info('[lab-ingest-trace] stage:lab_document_cache_enriched', {
          userId,
          qualified_after: geminiItems.countQualifiedPanelRecords(cacheEnrich.panel)
        });
        return { ok: true, source: 'cache_enriched', panel: cacheEnrich.panel };
      }
    }
    return {
      ok: true,
      source: 'cache',
      panel: cached
    };
  }

  const mode = String(process.env.KOKOKARA_LAB_PIPELINE_MODE || 'v2').trim();
  const [panelV1, panelV2] = await Promise.all([
    labImageAnalysisService.analyzeLabImage(imagePayload),
    labImageAnalysisV2Service.analyzeLabImageV2(imagePayload, { sourceImageId: imagePayload?.id || '', userId })
  ]);
  const comparison = buildPipelineComparison(panelV1, panelV2);
  const v2Strength = effectivePersistableStrength(panelV2);
  const v1Strength = effectivePersistableStrength(panelV1);
  const v2PanelCount = geminiItems.countQualifiedPanelRecords(panelV2);
  const v1PanelCount = geminiItems.countQualifiedPanelRecords(panelV1);
  const v2RawRecoverable = geminiItems.countPersistableParsedRecords(
    geminiItems.extractPrimaryGeminiMinItems(panelV2?.structuredJson || panelV2?.rawPayload || {})
  );
  const v1RawRecoverable = geminiItems.countPersistableParsedRecords(
    geminiItems.extractPrimaryGeminiMinItems(panelV1?.structuredJson || panelV1?.rawPayload || {})
  );
  let v1FallbackInvoked = false;
  let v1FallbackSkippedReason = '';
  console.info('[lab-pipeline] compare_v1_v2', { userId, mode, ...comparison });
  let panel = panelV2;
  if (v2Strength === 0 && v1Strength > 0) {
    v1FallbackInvoked = true;
    v1FallbackSkippedReason = '';
    panel = {
      ...panelV1,
      geminiRaw: panelV2?.geminiRaw || panelV1?.geminiRaw || null,
      structuredJson: panelV2?.structuredJson ?? panelV1?.structuredJson ?? null,
      rawPayload: panelV2?.rawPayload ?? panelV1?.rawPayload ?? null,
      analysisConfidence: panelV2?.analysisConfidence || panelV1?.analysisConfidence || {},
      examDateEntries: Array.isArray(panelV2?.examDateEntries) ? panelV2.examDateEntries : (panelV1?.examDateEntries || []),
      pageInfo: panelV2?.pageInfo || panelV1?.pageInfo || { current_page: null, total_pages: null }
    };
    console.info('[lab-pipeline] v2_empty_fallback_to_v1', {
      userId,
      v2_effective_strength: v2Strength,
      v1_effective_strength: v1Strength
    });
  } else {
    v1FallbackSkippedReason = v2Strength === 0 && v1Strength === 0
      ? 'v1_and_v2_effective_strength_zero'
      : 'v2_kept_v2_effective_strength_nonzero';
  }
  let ingestRecoveryChain = [];
  let enf = enrichPanelFromRecoverablePayload(panel, 'selected_panel_raw');
  if (enf.enriched) {
    panel = enf.panel;
    ingestRecoveryChain.push(enf.label);
  }
  if (geminiItems.countQualifiedPanelRecords(panel) === 0) {
    const mergedRaw = mergeRawPayloadsPreferData(panelV2?.rawPayload, panelV1?.rawPayload);
    if (mergedRaw) {
      const mergedMin = geminiItems.extractPrimaryGeminiMinItems(mergedRaw);
      const mn = geminiItems.countPersistableParsedRecords(mergedMin);
      if (mn) {
        panel = {
          ...panel,
          rawPayload: mergedRaw,
          structuredJson: mergedRaw,
          itemsStructured: mergedMin,
          isLabImage: true,
          labLike: true,
          analysisConfidence: {
            ...(panel.analysisConfidence && typeof panel.analysisConfidence === 'object' ? panel.analysisConfidence : {}),
            qualified_records_count: mn,
            ingest_recovered_from_raw: true,
            ingest_recovery_label: 'merged_v1_v2_raw_payload'
          }
        };
        ingestRecoveryChain.push('merged_v1_v2_raw_payload');
      }
    }
  }
  if (geminiItems.countQualifiedPanelRecords(panel) === 0 && v1Strength > 0 && !v1FallbackInvoked) {
    enf = enrichPanelFromRecoverablePayload(panelV1, 'v1_only_raw');
    if (enf.enriched) {
      panel = {
        ...panelV1,
        ...enf.panel,
        geminiRaw: panelV2?.geminiRaw || panelV1?.geminiRaw || null,
        examDateEntries: Array.isArray(panelV2?.examDateEntries) ? panelV2.examDateEntries : (panelV1?.examDateEntries || []),
        pageInfo: panelV2?.pageInfo || panelV1?.pageInfo || panelV1?.pageInfo
      };
      ingestRecoveryChain.push('v1_panel_raw_enrich_after_v2_empty');
    }
  }
  console.info('[lab-ingest-trace] stage:lab_document_ingest_pipeline', {
    userId,
    v2_top_keys: payloadTopLevelKeys(panelV2?.rawPayload),
    v1_top_keys: payloadTopLevelKeys(panelV1?.rawPayload),
    v2_items_len: Array.isArray(panelV2?.items) ? panelV2.items.length : 0,
    v2_items_structured_len: Array.isArray(panelV2?.itemsStructured) ? panelV2.itemsStructured.length : 0,
    v2_classifier_rows: Number(panelV2?.analysisConfidence?.rows || 0),
    v2_primary_gemini: Number(panelV2?.analysisConfidence?.primary_gemini_items || 0),
    v2_qualified_panel: v2PanelCount,
    v2_raw_recoverable_min: v2RawRecoverable,
    v2_effective_strength: v2Strength,
    v1_items_len: Array.isArray(panelV1?.items) ? panelV1.items.length : 0,
    v1_structured_rows_len: Array.isArray(panelV1?.structuredRows) ? panelV1.structuredRows.length : 0,
    v1_qualified_panel: v1PanelCount,
    v1_raw_recoverable_min: v1RawRecoverable,
    v1_effective_strength: v1Strength,
    v1_fallback_invoked: v1FallbackInvoked,
    v1_fallback_skipped_reason: v1FallbackInvoked ? '' : v1FallbackSkippedReason,
    ingest_recovery_chain: ingestRecoveryChain,
    final_qualified_panel: geminiItems.countQualifiedPanelRecords(panel),
    final_raw_recoverable: geminiItems.countPersistableParsedRecords(
      geminiItems.extractPrimaryGeminiMinItems(panel?.structuredJson || panel?.rawPayload || {})
    )
  });
  try {
    await applyMetaLayerToPanel({ userId, imagePayload, panel });
  } catch (err) {
    console.info('[lab-ingest-trace] stage:lab_meta_persist', {
      userId: String(userId),
      error: err?.message || 'lab_meta_layer_failed',
      skipped: true
    });
  }
  labIngestTrace.logLabPanelCreated({
    userId,
    source: 'lab_document_ingest_fresh',
    stage: 'post_v2_before_cache_store',
    panel
  });
  if (mode !== 'v2') {
    if (!panel.metaExtraction) {
      panel.patientName = panel.patientName || panelV2.patientName || '';
      panel.facilityName = panel.facilityName || panelV2.facilityName || '';
      panel.printDate = panel.printDate || panelV2.printDate || '';
    }
    panel.pageInfo = panel.pageInfo || panelV2.pageInfo || { current_page: null, total_pages: null };
    panel.examDateEntries = Array.isArray(panelV2.examDateEntries) ? panelV2.examDateEntries : [];
    panel.itemsStructured = Array.isArray(panelV2.itemsStructured) ? panelV2.itemsStructured : [];
  }
  panel.pipelineComparison = comparison;
  panel.pipelineMode = mode;
  await labDocumentStoreService.storePanelForPayload(userId, imagePayload, panel).catch(() => null);
  const geminiLabLike = Boolean(
    panel?.isLabImage
    || panel?.labLike
    || (Array.isArray(panel?.items) && panel.items.length > 0)
    || Number(panel?.analysisConfidence?.rows || 0) > 0
    || geminiItems.countQualifiedPanelRecords(panel) > 0
  );
  if (geminiLabLike) {
    await labReportStoreService.saveLabReport({
      userId,
      panel,
      imageUrl: imagePayload?.url || null
    }).catch(() => null);
  }

  return {
    ok: true,
    source: 'fresh',
    panel
  };
}

module.exports = {
  ingestLabDocument
};
