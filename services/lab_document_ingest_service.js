'use strict';

const labImageAnalysisService = require('./lab_image_analysis_service');
const labDocumentStoreService = require('./lab_document_store_service');

async function ingestLabDocument({ userId, imagePayload } = {}) {
  const cached = labDocumentStoreService.getCachedPanelByPayload(userId, imagePayload);
  if (cached) {
    return {
      ok: true,
      source: 'cache',
      panel: cached
    };
  }

  const panel = await labImageAnalysisService.analyzeLabImage(imagePayload);
  if (panel?.isLabImage || panel?.labLike) {
    labDocumentStoreService.storePanelForPayload(userId, imagePayload, panel);
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
