'use strict';

const assert = require('assert');
const followupQuery = require('../services/v2/queries/followup_query_service');
const mealFollowup = require('../services/v2/followups/meal_followup_resolver_service');

async function runLabBroadChecks() {
  const input = { userId: 'smoke-user', messageType: 'text', rawText: '' };
  const shortMemory = {
    followUpContext: {
      labPanel: {
        patientName: 'テスト太郎',
        facilityName: 'テストクリニック',
        printDate: '2025-03-24',
        examDates: ['2025-03-20'],
        latestExamDate: '2025-03-20',
        items: [{ itemName: 'TG', value: '150', unit: 'mg/dL' }]
      }
    }
  };
  const phrases = ['わかるのは？', '何の項目がありましたか？', '患者名は？', 'クリニック名は？', '日付は？', 'TGは？', 'LDLは？', 'HDLは？', 'HbA1cは？'];
  for (const p of phrases) {
    const out = await followupQuery.resolveFollowupV2({ input, text: p, shortMemory });
    assert(out && out.replyText, `lab broad followup rejected: ${p}`);
  }
}

function runMealIntentChecks() {
  const cases = [
    ['麺だけゼロ', 'set_component_zero'],
    ['ゼロカロリー麺として再計算', 'set_component_zero'],
    ['この麺は半分食べた', 'set_component_fraction'],
    ['これは食べてない', 'mark_component_not_eaten'],
    ['再計算してください', 'recalc_meal'],
    ['さっきの食事は削除して下さい', 'delete_entire_record'],
  ];
  for (const [text, expected] of cases) {
    const got = mealFollowup.detectMealCorrectionIntent(text);
    assert.strictEqual(got, expected, `meal intent mismatch for "${text}"`);
  }
}

async function main() {
  runMealIntentChecks();
  await runLabBroadChecks();
  console.log('smoke_phase2_followup_intents: ok');
}

main().catch((error) => {
  console.error(error?.stack || error?.message || error);
  process.exit(1);
});
