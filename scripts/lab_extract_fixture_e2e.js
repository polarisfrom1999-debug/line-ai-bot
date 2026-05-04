'use strict';

/**
 * 血液検査 structured 抽出の fixture 検証（API 呼び出しなし）。
 * - Gemini responseSchema 型表記（OBJECT 等）
 * - extractPrimaryGeminiMinItems + filterParsedMinItemsForDb（単日 unknown 保持）
 *
 * 実行: npm run smoke:lab-extract-fixtures
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const geminiItems = require('../services/lab_gemini_items_service');
const { buildLabExtractPrompt, toGeminiResponseSchema } = require('../services/lab_extract_prompt_builder_service');

function readJson(rel) {
  const p = path.join(__dirname, '..', 'fixtures', 'lab_extract', rel);
  return JSON.parse(fs.readFileSync(p, 'utf8'));
}

function walkSchemaTypes(node, bad) {
  if (node == null) return;
  if (Array.isArray(node)) {
    node.forEach((x) => walkSchemaTypes(x, bad));
    return;
  }
  if (typeof node !== 'object') return;
  if (typeof node.type === 'string') {
    const ok = ['OBJECT', 'ARRAY', 'STRING', 'NUMBER', 'INTEGER', 'BOOLEAN'].includes(node.type);
    if (!ok) bad.push(node.type);
  }
  for (const v of Object.values(node)) walkSchemaTypes(v, bad);
}

function assertGeminiResponseSchemaUppercase(schema, label) {
  const bad = [];
  walkSchemaTypes(schema, bad);
  assert.strictEqual(bad.length, 0, `${label}: lowercase or invalid schema types: ${bad.join(', ')}`);
}

function assertNoRangeLikeValuesInParsed(items) {
  for (const it of items) {
    const v = String(it?.value ?? '').trim();
    assert.ok(!geminiItems.isReferenceRangeLikeValue(v), `range-like value leaked into parsed: ${v}`);
  }
}

function main() {
  const built = buildLabExtractPrompt({ documentType: 'multi_date_timeseries', reportDate: '' });
  assertGeminiResponseSchemaUppercase(built.schema, 'buildLabExtractPrompt.schema');
  const raw = { type: 'object', properties: { x: { type: 'string' } } };
  assertGeminiResponseSchemaUppercase(toGeminiResponseSchema(raw), 'toGeminiResponseSchema smoke');

  const multi = readJson('multi_day_gemini_payload.json');
  const multiExpected = readJson('expected_multi_day.json');
  const multiItems = geminiItems.extractPrimaryGeminiMinItems(multi);
  assert.ok(multiItems.length > 0, 'multi_day: extractPrimaryGeminiMinItems empty');
  const printMulti = multi.printDate || '';
  const filteredMulti = geminiItems.filterParsedMinItemsForDb(multiItems, printMulti, new Set()).items;
  assertNoRangeLikeValuesInParsed(filteredMulti);
  const tg = filteredMulti.filter((x) => x.normalizedKey === 'triglycerides_tg');
  assert.ok(tg.length >= 1, 'multi_day: TG items missing');
  for (const sample of multiExpected.min_triglycerides_tg_values_sample) {
    assert.ok(
      filteredMulti.some((x) => String(x.value) === sample && x.normalizedKey === 'triglycerides_tg'),
      `multi_day: expected TG value ${sample}`
    );
  }
  const ldh = filteredMulti.find((x) => /ldh/i.test(x.normalizedKey || '') || String(x.rawName || '').toUpperCase() === 'LDH');
  assert.ok(ldh, 'multi_day: LDH row missing');
  assert.strictEqual(String(ldh.value), '213', 'multi_day: LDH fixture expects 213 (画像と照合で調整)');

  const single = readJson('single_day_gemini_payload.json');
  const singleExp = readJson('expected_single_day.json');
  const singleItems = geminiItems.extractPrimaryGeminiMinItems(single);
  assert.strictEqual(singleItems.length, 8, `single_day: expected 8 primary items, got ${singleItems.length}`);
  const filteredSingle = geminiItems.filterParsedMinItemsForDb(
    singleItems,
    single.printDate || '',
    new Set()
  ).items;
  assert.strictEqual(
    filteredSingle.length,
    8,
    `single_day: after filter expected 8 items, got ${filteredSingle.length}`
  );
  for (const nk of singleExp.expected_keys) {
    const row = filteredSingle.find((x) => x.normalizedKey === nk);
    assert.ok(row, `single_day: missing key ${nk}`);
    assert.strictEqual(String(row.value), singleExp.expected_values[nk], `single_day: value mismatch ${nk}`);
  }
  const distinct = geminiItems.distinctObservedDateStringsFromParsedItems(filteredSingle);
  assert.ok(distinct.length >= 0, 'single_day: distinct dates');

  console.log('lab_extract_fixture_e2e: OK');
}

main();
