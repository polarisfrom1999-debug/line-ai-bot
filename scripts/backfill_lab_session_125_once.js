'use strict';

/**
 * 本番一回実行用: lab_session_id = 125 の lab_result_items を delete→再生成。
 * 実行: node scripts/backfill_lab_session_125_once.js
 *
 * このスクリプトが出すログは start / delete / inserted / group summary のみ。
 * writeLabResultItemsFromSession 内部の既存ログは別途出る場合があります。
 */

const LAB_SESSION_ID = 125;

async function main() {
  let supabase = null;
  try {
    ({ supabase } = require('../services/supabase_service'));
  } catch (_e) {
    supabase = null;
  }
  const labResultItemRepository = require('../repositories/lab_result_item_repository');
  const { writeLabResultItemsFromSession } = require('../services/newflow/lab_result_items_writer_service');

  console.info('[backfill_125] backfill start', { lab_session_id: LAB_SESSION_ID });

  if (!supabase) {
    console.info('[backfill_125] delete ok', { ok: false, reason: 'no_supabase' });
    process.exit(1);
    return;
  }

  const del = await labResultItemRepository.deleteByLabSessionId(LAB_SESSION_ID);
  console.info('[backfill_125] delete ok', { ok: del?.ok !== false, reason: del?.reason || null });

  const q = await supabase
    .from('lab_sessions')
    .select('id,user_id,patient_name,facility_name,print_date,exam_dates_json,parsed_items_json,gemini_raw,structured_json')
    .eq('id', LAB_SESSION_ID)
    .maybeSingle();

  if (q?.error || !q?.data) {
    console.info('[backfill_125] inserted count', { inserted_count: 0, reason: 'session_not_found' });
    process.exit(1);
    return;
  }

  const row = q.data;
  const structuredJson = row.structured_json || (row.gemini_raw && typeof row.gemini_raw === 'object' ? row.gemini_raw : null);

  const res = await writeLabResultItemsFromSession({
    userId: row.user_id,
    labSessionId: row.id,
    parsedItemsJson: Array.isArray(row.parsed_items_json) ? row.parsed_items_json : [],
    structuredJson,
    patientName: row.patient_name,
    facilityName: row.facility_name,
    printDate: row.print_date,
    examDatesJson: Array.isArray(row.exam_dates_json) ? row.exam_dates_json : []
  });

  console.info('[backfill_125] inserted count', { inserted_count: res.inserted_count ?? 0, ok: res.ok });

  const gq = await supabase
    .from('lab_result_items')
    .select('normalized_key')
    .eq('lab_session_id', LAB_SESSION_ID);

  const summary = {};
  if (Array.isArray(gq?.data)) {
    for (const r of gq.data) {
      const k = String(r.normalized_key || '').trim() || '(empty)';
      summary[k] = (summary[k] || 0) + 1;
    }
  }
  const sorted = Object.entries(summary).sort((a, b) => a[0].localeCompare(b[0]));
  console.info('[backfill_125] normalized_key group summary', { rows: sorted, total_rows: sorted.reduce((s, [, n]) => s + n, 0) });
}

main().catch((e) => {
  console.error('[backfill_125] fatal', String(e?.message || e));
  process.exit(1);
});
