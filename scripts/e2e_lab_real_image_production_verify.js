'use strict';

/**
 * 本番相当: 実画像ファイル1枚で lab 画像 ingest → DB insert/readback → follow-up までログ採取
 *
 * 使い方:
 *   node scripts/e2e_lab_real_image_production_verify.js path/to/blood_test.jpg
 *
 * 前提: .env に Supabase / Gemini 等が入っていること（本番と同様）
 *
 * LINE 画面上の返信文はこのプロセスからは取得できないため、
 * 同じバックエンド経路の follow-up 返信文を標準出力に出します（LINE に貼り付けて突き合わせ可能）。
 */

process.env.ENABLE_NEW_FLOW_ARCH = '1';
process.env.ENABLE_NEW_FLOW_IMAGE_INGEST = '1';

const fs = require('fs');
const path = require('path');
const imageIngestOrchestrator = require('../services/newflow/image_ingest_orchestrator_service');
const labSessionRepository = require('../repositories/lab_session_repository');
const followupRouterService = require('../services/newflow/followup_router_service');

function normalizeText(value) {
  return String(value || '').trim();
}

function mimeFromPath(filePath) {
  const lower = String(filePath || '').toLowerCase();
  if (lower.endsWith('.png')) return 'image/png';
  if (lower.endsWith('.webp')) return 'image/webp';
  return 'image/jpeg';
}

/** 本番の canonical 経路（gemini_raw.lab_meta から metaAdoption 等を復元）でパネルを組み立てる */

async function main() {
  const imgPath = process.argv[2];
  if (!imgPath) {
    console.error('Usage: node scripts/e2e_lab_real_image_production_verify.js <path-to-blood-test-image.jpg>');
    process.exit(1);
  }
  const abs = path.resolve(imgPath);
  if (!fs.existsSync(abs)) {
    console.error(`File not found: ${abs}`);
    process.exit(1);
  }
  const buffer = fs.readFileSync(abs);
  const userId = `lab-prod-verify-${Date.now()}`;
  const messageId = `msg-${Date.now()}`;

  const lines = [];
  const oldInfo = console.info;
  console.info = (...args) => {
    const line = args.map((x) => (typeof x === 'string' ? x : JSON.stringify(x))).join(' ');
    lines.push(line);
    oldInfo(...args);
  };

  const input = {
    userId,
    lineUserId: userId,
    messageType: 'image',
    messageId,
    rawText: '',
    webImagePayload: {
      buffer,
      mimeType: mimeFromPath(abs),
    },
  };

  try {
    const out = await imageIngestOrchestrator.handleImageIngest({ input, textHint: '' });
    console.info('\n=== e2e_lab_real_image_production_verify: ingest result ===');
    console.info(JSON.stringify({ intentType: out?.intentType, handled: out?.handled }, null, 2));

    const want = (sub) => lines.filter((l) => l.includes(sub));
    console.info('\n--- extract_prompt_info ---');
    for (const l of want('stage:extract_prompt_info')) console.info(l);
    console.info('\n--- classifier_vs_extraction ---');
    for (const l of want('stage:classifier_vs_extraction')) console.info(l);
    console.info('\n--- parsed_items_pre_insert (db_pre_insert 直前相当) ---');
    for (const l of want('parsed_items_pre_insert')) console.info(l);
    console.info('\n--- db_pre_insert ---');
    for (const l of want('stage:db_pre_insert')) console.info(l);
    console.info('\n--- db_post_insert_read ---');
    for (const l of want('stage:db_post_insert_read')) console.info(l);

    const row = await labSessionRepository.getLatestLabSession(userId);
    const parsedLen = Array.isArray(row?.parsed_items_json) ? row.parsed_items_json.length : -1;
    console.info('\n=== getLatestLabSession parsed_items_json length ===');
    console.info(JSON.stringify({ userId, sessionId: row?.id || null, parsed_items_json_length: parsedLen }, null, 2));
    if (parsedLen > 0) {
      console.info('parsed_items_json_sample=', JSON.stringify(row.parsed_items_json.slice(0, 5), null, 2));
    }

    if (row) {
      console.info('\n--- follow-up (same resolver as newflow; LINE 文面はここを実機と突き合わせ) ---');
      const questions = ['TGは？', '他の日付は？', '前回よりどう？', '異常ある？', '傾向は？', 'バランスは？', '患者名は？', '施設名は？', '印刷日は？'];
      for (const q of questions) {
        const r = await followupRouterService.resolveFollowup({
          input: {
            userId,
            lineUserId: userId,
            messageType: 'text',
            messageId: `msg-q-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
            rawText: q
          },
          text: q
        });
        console.info(`\nQ: ${q}`);
        console.info(`A: ${normalizeText(r?.replyText || '')}`);
      }
      console.info('\n--- lab_followup_context lines (last few) ---');
      for (const l of want('lab_followup_context').slice(-12)) console.info(l);
    } else {
      console.info('\n(No lab_sessions row — insert失敗 or Supabase 未設定)');
    }
  } finally {
    console.info = oldInfo;
  }
}

main().catch((e) => {
  console.error(e?.stack || e);
  process.exit(1);
});
