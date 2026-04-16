'use strict';

const labImageAnalysisService = require('./lab_image_analysis_service');
const labDocumentStoreService = require('./lab_document_store_service');
const labReportStoreService = require('./lab_report_store_service');

async function ingestLabDocument({ userId, imagePayload } = {}) {
  const cached = await labDocumentStoreService.getCachedPanelByPayload(userId, imagePayload);
  if (cached) {
    return {
      ok: true,
      source: 'cache',
      panel: cached
    };
  }

  const panel = await labImageAnalysisService.analyzeLabImage(imagePayload);
  if (panel?.isLabImage || panel?.labLike) {
    await labDocumentStoreService.storePanelForPayload(userId, imagePayload, panel);
    // 1画像=1検査データとして、完璧でなくても exam_date と読めた値を保存する。
    await labReportStoreService.saveLabReport({
      userId,
      panel,
      imageUrl: imagePayload?.url || null
    });
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
