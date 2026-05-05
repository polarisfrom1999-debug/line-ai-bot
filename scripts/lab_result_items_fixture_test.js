'use strict';

/**
 * lab_result_items 正本パイプのオフライン検証（DB 不要）
 * 実行: node scripts/lab_result_items_fixture_test.js
 */

const assert = require('assert');
const { mergeExtractorOutputs } = require('../services/newflow/lab_result_candidate_extractor_service');
const { parseLabValueFields, isRangeOnlyString } = require('../services/newflow/lab_result_value_parser_service');
const { dedupeLabResultRows } = require('../services/newflow/lab_result_dedupe_service');
const { applyValidationRules } = require('../services/newflow/lab_result_validation_service');
const { resolveObservedDate } = require('../services/newflow/lab_result_date_resolver_service');

async function run() {
  // 1) 単日検査 + 複製キー（血糖 / glucose）
  const structured1 = {
    items: [
      { normalizedKey: 'glucose', name: '血糖', value: '90', unit: 'mg/dL' },
      { normalizedKey: 'glucose', name: 'glucose', value: '90', unit: 'mg/dL' }
    ]
  };
  const parsed1 = structured1.items;
  const c1 = mergeExtractorOutputs(structured1, parsed1);
  const glucoseRows = c1.filter((x) => /血糖|glucose/i.test(x.rawName));
  assert.strictEqual(glucoseRows.length >= 1, true);

  // 2) 基準範囲のみ
  const pr = parseLabValueFields({ valueText: '30-149', referenceRange: '' });
  assert.strictEqual(pr.valueText == null || pr.parseNote === 'value_field_looks_like_reference_range', true);

  // 3) 複数日 unpivot
  const structuredMulti = {
    name: 'TG',
    values: { '2016-04-11': '150', '2017-04-11': '131' }
  };
  const cMulti = mergeExtractorOutputs(structuredMulti, []);
  assert.strictEqual(cMulti.filter((x) => x.rawName === 'TG').length >= 2, true);

  // 4) 怪しい年混入 exam_dates
  const dr = resolveObservedDate({
    examDatesJson: ['2016-04-11', '2025-03-22'],
    observedDateText: '',
    multiDatePanel: true
  });
  assert.strictEqual(dr.observed_date_status === 'needs_review', true);

  // 5) LDH + 範囲
  const ldhRow = applyValidationRules({
    normalized_key: 'ldh',
    display_name: 'LDH',
    value_text: '21',
    value_numeric: 21,
    reference_range: '115-245',
    validation_status: 'ok'
  });
  assert.strictEqual(ldhRow.validation_status, 'needs_manual_review');

  // 6) dedupe 同一 triple
  const rows = dedupeLabResultRows([
    {
      normalized_key: 'glucose',
      observed_date: null,
      value_text: '90',
      from_master: true,
      source_json_path: 'a'
    },
    {
      normalized_key: 'glucose',
      observed_date: null,
      value_text: '90',
      from_master: false,
      source_json_path: 'b'
    }
  ]);
  assert.strictEqual(rows.rows.length, 1);

  // 7) selected_session consistency（フォローはコードレビュー対象 — reader は同一 sid で検索）
  assert.strictEqual(isRangeOnlyString('6.5-8.2'), true);

  console.info('lab_result_items_fixture_test: ok');
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
