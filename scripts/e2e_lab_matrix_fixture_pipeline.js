'use strict';

/**
 * 複数日付表型 fixture を本番同等経路で流し、matrix 4段ログと follow-up を検証する。
 * 実行: node scripts/e2e_lab_matrix_fixture_pipeline.js
 */

process.env.ENABLE_NEW_FLOW_ARCH = '1';
process.env.ENABLE_NEW_FLOW_IMAGE_INGEST = '1';

const fs = require('fs');
const path = require('path');
const newFlowImageIngestService = require('../services/newflow/image_ingest_orchestrator_service');
const followupRouterService = require('../services/newflow/followup_router_service');
const { supabase } = require('../services/supabase_service');

function normalizeText(v) {
  return String(v || '').trim();
}

async function loadFixture() {
  const fixtureName = 'lab_sample.JPG';
  const fixturePath = path.resolve(__dirname, '..', 'fixtures', fixtureName);
  const buffer = fs.readFileSync(fixturePath);
  return { fixtureName, fixturePath, buffer };
}

async function getLatestSessionForUser(userId) {
  const { data, error } = await supabase
    .from('lab_sessions')
    .select('id,created_at,parsed_items_json,exam_dates_json,patient_name,facility_name,print_date')
    .eq('user_id', String(userId))
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) return null;
  return data || null;
}

async function run() {
  const fixture = await loadFixture();
  const userId = `lab-matrix-fixture-${Date.now()}`;
  const imageMessageId = `msg-img-${Date.now()}`;
  const logs = [];
  const oldInfo = console.info;
  console.info = (...args) => {
    const line = args.map((x) => (typeof x === 'string' ? x : JSON.stringify(x))).join(' ');
    logs.push(line);
    oldInfo(...args);
  };
  try {
    const ingest = await newFlowImageIngestService.handleImageIngest({
      input: {
        userId,
        lineUserId: userId,
        messageType: 'image',
        messageId: imageMessageId,
        rawText: '',
        webImagePayload: {
          buffer: fixture.buffer,
          mimeType: 'image/jpeg'
        }
      },
      textHint: ''
    });

    const tgReply = await followupRouterService.resolveFollowup({
      input: {
        userId,
        lineUserId: userId,
        messageType: 'text',
        messageId: `msg-q-tg-${Date.now()}`,
        rawText: 'TGは？'
      },
      text: 'TGは？'
    });
    const datesReply = await followupRouterService.resolveFollowup({
      input: {
        userId,
        lineUserId: userId,
        messageType: 'text',
        messageId: `msg-q-date-${Date.now()}`,
        rawText: '他の日付の検査は？'
      },
      text: '他の日付の検査は？'
    });
    const trendReply = await followupRouterService.resolveFollowup({
      input: {
        userId,
        lineUserId: userId,
        messageType: 'text',
        messageId: `msg-q-trend-${Date.now()}`,
        rawText: 'TGの変化はどうかな？'
      },
      text: 'TGの変化はどうかな？'
    });

    const latest = await getLatestSessionForUser(userId);
    const parsed = Array.isArray(latest?.parsed_items_json) ? latest.parsed_items_json : [];
    const observedDates = Array.from(new Set(parsed.map((x) => normalizeText(x?.observedDate || x?.observed_date || '')).filter(Boolean)));
    const tgRow = parsed.find((x) => normalizeText(x?.normalizedKey).toLowerCase() === 'triglycerides_tg') || null;

    const stage = (tag) => logs.filter((l) => l.includes(tag));
    const matrixReasonLine = stage('lab_matrix_final_items').slice(-1)[0] || '';
    const reasonMatch = matrixReasonLine.match(/"reason":"([^"]*)"/);
    const matrixReason = reasonMatch ? reasonMatch[1] : '';

    const report = {
      fixture: fixture.fixtureName,
      ingest_intent: ingest?.intentType || '',
      parsed_items_len: parsed.length,
      records_count: parsed.filter((x) => normalizeText(x?.normalizedKey) && normalizeText(x?.value)).length,
      observed_dates: observedDates,
      tg_row: tgRow ? {
        normalizedKey: tgRow.normalizedKey,
        observedDate: tgRow.observedDate || tgRow.observed_date || '',
        value: tgRow.value,
        unit: tgRow.unit || ''
      } : null,
      tg_reply: normalizeText(tgReply?.replyText || ''),
      dates_reply: normalizeText(datesReply?.replyText || ''),
      tg_trend_reply: normalizeText(trendReply?.replyText || ''),
      logs: {
        header: stage('lab_matrix_header_extract'),
        row_label: stage('lab_matrix_row_label_extract'),
        cell_value: stage('lab_matrix_cell_value_extract'),
        mapping: stage('lab_matrix_mapping'),
        final_items: stage('lab_matrix_final_items'),
        followup: stage('[phasee-new] lab_followup_context')
      },
      matrix_reason: matrixReason,
      followup_flags: {
        tg_session_lab_reached: /"session_lab_reached":true/.test(stage('[phasee-new] lab_followup_context')[0] || ''),
        tg_canonical_lab_reached: /"canonical_lab_reached":true/.test(stage('[phasee-new] lab_followup_context')[0] || ''),
      }
    };

    console.log('e2e_lab_matrix_fixture_pipeline: done');
    console.log(JSON.stringify(report, null, 2));
  } finally {
    console.info = oldInfo;
  }
}

run().catch((e) => {
  console.error(e?.stack || e);
  process.exit(1);
});

