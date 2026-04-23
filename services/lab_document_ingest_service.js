'use strict';

const labImageAnalysisService = require('./lab_image_analysis_service');
const labImageAnalysisV2Service = require('./lab_image_analysis_v2_service');
const labDocumentStoreService = require('./lab_document_store_service');
const labReportStoreService = require('./lab_report_store_service');
const labIngestTrace = require('./lab_ingest_trace_service');

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

async function ingestLabDocument({ userId, imagePayload } = {}) {
  const cached = await labDocumentStoreService.getCachedPanelByPayload(userId, imagePayload);
  if (cached) {
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
  console.info('[lab-pipeline] compare_v1_v2', { userId, mode, ...comparison });
  const panel = panelV2;
  labIngestTrace.logLabPanelCreated({
    userId,
    source: 'lab_document_ingest_fresh',
    stage: 'post_v2_before_cache_store',
    panel
  });
  if (mode !== 'v2') {
    panel.patientName = panel.patientName || panelV2.patientName || '';
    panel.facilityName = panel.facilityName || panelV2.facilityName || '';
    panel.printDate = panel.printDate || panelV2.printDate || '';
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
