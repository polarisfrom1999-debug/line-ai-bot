'use strict';

const assert = require('assert');
const path = require('path');
const fs = require('fs');

const fixtures = require('../tests/fixtures/lab_tentative_promotion_fixtures.json');
const labPipeline = require('../services/v2/pipelines/lab_image_pipeline_v2_service');
const imageKindClassifier = require('../services/v2/image_kind_classifier_service');
const labFollowup = require('../services/lab_followup_service');
const followupQuery = require('../services/v2/queries/followup_query_service');
const activeContextResolver = require('../services/v2/active_context_resolver_service');

function assertFixture(name, entry) {
  const panel = entry.panel;
  const got = labPipeline.shouldAcceptLabPanelFromGemini(panel);
  assert.strictEqual(got, entry.expectedAccept !== false, `${name}: shouldAcceptLabPanelFromGemini`);
  if (entry.expectedAccept !== false) {
    const route = imageKindClassifier.classifyImageKind({
      textHint: '',
      labPanel: panel,
      meal: { isMealImage: false },
    });
    assert.strictEqual(route, 'lab', `${name}: routeKind should be lab, got ${route}`);
  }
}

function assertInventoryNonEmpty(panel, label) {
  const reply = labFollowup.buildReadableInventoryReply(panel);
  assert(reply && reply.length > 40, `${label}: inventory reply too short`);
  assert(
    /断片|候補|氏名|施設|印刷日|項目|数値はまだ|テキストから/.test(reply),
    `${label}: expected readback hints, got: ${reply.slice(0, 160)}`
  );
}

async function runFollowupPhrases(panel, label) {
  const phrases = [
    '検査結果でわかるのある？',
    '他に読めたのは？',
    'この結果どう見える？',
  ];
  const input = { userId: 'fixture-user', messageType: 'text', rawText: '' };
  const shortMemory = { followUpContext: { labPanel: panel } };
  for (const p of phrases) {
    const out = await followupQuery.resolveFollowupV2({ input, text: p, shortMemory });
    assert(out && out.replyText, `${label} followup rejected: ${p}`);
    assert(out.replyText.length > 10, `${label} empty reply: ${p}`);
  }
}

async function runActiveContextFollowupPhrases(panel, label) {
  const phrases = [
    '検査結果でわかるのある？',
    '他に読めたのは？',
    'この結果どう見える？',
  ];
  const input = { userId: 'fixture-user-ac', messageType: 'text', rawText: '' };
  const shortMemory = {
    activeContext: {
      type: 'lab_image_session',
      expiresAt: new Date(Date.now() + 3600000).toISOString(),
      payload: { labPanel: panel },
    },
    followUpContext: { labPanel: panel },
  };
  for (const p of phrases) {
    const out = await activeContextResolver.resolveActiveContextFollowup({ input, text: p, shortMemory });
    assert(out && out.replyText, `${label} active followup rejected: ${p}`);
  }
}

async function main() {
  for (const [name, entry] of Object.entries(fixtures)) {
    if (!entry?.panel) continue;
    assertFixture(name, entry);
  }

  assert.strictEqual(
    imageKindClassifier.classifyImageKind({
      textHint: '',
      labPanel: { isLabImage: false, labLike: false, items: [], rawText: '' },
      meal: { isMealImage: true },
    }),
    'meal',
    'meal when lab panel has no promotion signals'
  );

  const printPanel = fixtures.print_date_only.panel;
  assertInventoryNonEmpty(printPanel, 'print_date_only');

  const rawPanel = fixtures.raw_text_only.panel;
  const rawReply = labFollowup.buildReadableInventoryReply(rawPanel);
  assert(/テキストから|読み取り|抜粋/.test(rawReply), `raw_text inventory: ${rawReply.slice(0, 80)}`);

  const namesPanel = fixtures.candidate_item_names_only.panel;
  const namesReply = labFollowup.buildReadableInventoryReply(namesPanel);
  assert(/LDL|HDL|数値はまだ/.test(namesReply), `name-only inventory: ${namesReply.slice(0, 120)}`);

  const fragPanel = fixtures.name_fragments_only.panel;
  assertInventoryNonEmpty(fragPanel, 'name_fragments');

  const allPanel = {
    isLabImage: true,
    labLike: true,
    items: [
      { itemName: 'LDL', value: '120', unit: 'mg/dL' },
      { itemName: 'HDL', value: '61', unit: 'mg/dL' },
    ],
    rawText: '',
  };
  const allReply = labFollowup.buildNaturalAllValuesReply(allPanel);
  assert(!/\{/.test(allReply), 'natural all values must not look like JSON');
  assert(/LDL|120|HDL|61/.test(allReply), `all values reply: ${allReply}`);

  await runFollowupPhrases(printPanel, 'print_date_only');
  await runFollowupPhrases(rawPanel, 'raw_text_only');
  await runFollowupPhrases(namesPanel, 'candidate_names');
  await runActiveContextFollowupPhrases(printPanel, 'active_print_date');

  const fixturePath = path.join(__dirname, '../tests/fixtures/lab_tentative_promotion_fixtures.json');
  assert(fs.existsSync(fixturePath), 'fixtures file must exist');

  console.log('lab_tentative_promotion_regression: ok');
}

main().catch((e) => {
  console.error(e?.stack || e);
  process.exit(1);
});
