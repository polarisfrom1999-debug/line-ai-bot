'use strict';

/**
 * 画像ドメインルータを経由せず、lab ingest → DB までのトレースログを出す（ダミー画像で可）
 * 手元で blood panel が取れない環境でも pipeline 追跡用
 */

const labDocumentIngestService = require('../services/lab_document_ingest_service');
const labSessionRepository = require('../repositories/lab_session_repository');

async function run() {
  const userId = `lab-pipe-${Date.now()}`;
  const imagePayload = { id: `e2e-${Date.now()}`, buffer: Buffer.from('lab-pipeline-direct-e2e'), mimeType: 'image/jpeg' };
  const lines = [];
  const oldInfo = console.info;
  console.info = (...args) => {
    lines.push(args.map((x) => (typeof x === 'string' ? x : JSON.stringify(x))).join(' '));
    oldInfo(...args);
  };
  try {
    const ing = await labDocumentIngestService.ingestLabDocument({ userId, imagePayload });
    const panel = ing?.panel;
    if (!panel) {
      console.log('e2e_lab_ingest_pipeline_direct: no panel', ing);
      return;
    }
    const persist = await labSessionRepository.createLabSession({
      userId,
      sourceImageId: String(imagePayload.id),
      sourceMessageId: 'm-direct-1',
      status: 'tentative',
      patientName: panel.patientName || '',
      facilityName: panel.facilityName || '',
      printDate: panel.printDate || '',
      examDates: panel.examDates || [],
      parsedItems: Array.isArray(panel.itemsStructured) ? panel.itemsStructured : (panel.items || []),
      rawText: panel.rawText || '',
      confidence: Number(panel?.analysisConfidence?.v2_confidence || 0),
      isLabImageStrict: Boolean(panel.isLabImage),
      isLabImageTentative: true,
      geminiRaw: panel.geminiRaw || null,
      structuredJson: panel.structuredJson ?? panel.rawPayload ?? null,
      expiresAt: new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString()
    });
    const onlyTrace = lines.filter((l) => l.includes('[lab-ingest-trace]'));
    console.log('e2e_lab_ingest_pipeline_direct: ok persist=', persist?.ok);
    console.log(JSON.stringify({ userId, trace_count: onlyTrace.length, first_tags: onlyTrace.slice(0, 6).map((x) => x.slice(0, 100)) }, null, 2));
  } finally {
    console.info = oldInfo;
  }
}

run().catch((e) => {
  console.error(e?.stack || e);
  process.exit(1);
});
