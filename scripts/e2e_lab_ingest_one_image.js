'use strict';

/**
 * 同一血液検査画像1枚で lab ingest 全段階ログを確認する（実機相当）
 * 実行: node scripts/e2e_lab_ingest_one_image.js
 */

process.env.ENABLE_NEW_FLOW_ARCH = '1';
process.env.ENABLE_NEW_FLOW_IMAGE_INGEST = '1';

const newFlowImageIngestService = require('../services/newflow/image_ingest_orchestrator_service');

function mkInput(userId, messageId) {
  return {
    userId,
    lineUserId: userId,
    messageType: 'image',
    messageId,
    rawText: '',
    webImagePayload: {
      buffer: Buffer.from(`lab-ingest-e2e-${messageId}`),
      mimeType: 'image/jpeg'
    }
  };
}

async function run() {
  const userId = `lab-ingest-${Date.now()}`;
  const lines = [];
  const oldInfo = console.info;
  console.info = (...args) => {
    const line = args.map((x) => (typeof x === 'string' ? x : JSON.stringify(x))).join(' ');
    lines.push(line);
    oldInfo(...args);
  };
  try {
    await newFlowImageIngestService.handleImageIngest({ input: mkInput(userId, `img-${Date.now()}`), textHint: '' });
    const trace = lines.filter((l) => l.includes('[lab-ingest-trace]') || l.includes('lab_followup') || l.includes('[v2-image]'));
    console.log('e2e_lab_ingest_one_image: done (see logs above). trace_line_count=', trace.length);
    console.log(JSON.stringify({ userId, trace_tags: trace.map((l) => l.slice(0, 80)) }, null, 2));
  } finally {
    console.info = oldInfo;
  }
}

run().catch((e) => {
  console.error(e?.stack || e);
  process.exit(1);
});
