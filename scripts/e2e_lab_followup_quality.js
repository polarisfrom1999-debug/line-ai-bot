'use strict';

/**
 * 血液検査 follow-up: ログと返信文の実機相当サンプル
 * 同一パネル（session 想定）で4問を解決
 */

const { resolveLabFollowup } = require('../services/newflow/resolvers/lab_followup_resolver_service');

const samplePanel = {
  patientName: 'テスト 花子',
  facilityName: 'さくらクリニック',
  printDate: '2025-02-10',
  latestExamDate: '2025-02-08',
  examDate: '2025-02-08',
  examDates: ['2025-02-08'],
  items: [
    { itemName: '中性脂肪', value: '165', unit: 'mg/dL', flag: 'H', history: [] },
    { itemName: 'HDL', value: '48', unit: 'mg/dL', flag: '', history: [] },
    { itemName: 'AST', value: '22', unit: 'U/L', flag: '', history: [] }
  ],
  rawText: '（サンプル用。実機は画像OCRのraw）'
};

const questions = [
  { q: 'TGは？', source: { session: true, canonical: false } },
  { q: '患者名やクリニック名は？', source: { session: true, canonical: false } },
  { q: '何が読めたの？', source: { session: true, canonical: false } },
  { q: '悪い値は？', source: { session: true, canonical: false } }
];

async function run() {
  const lines = [];
  const oldInfo = console.info;
  console.info = (...args) => {
    const line = args.map((x) => (typeof x === 'string' ? x : JSON.stringify(x))).join(' ');
    lines.push(line);
    oldInfo(...args);
  };
  const results = [];
  try {
    for (const row of questions) {
      const out = await resolveLabFollowup(row.q, samplePanel, {
        userId: 'e2e-lab-quality',
        sessionLabReached: row.source.session,
        canonicalLabReached: row.source.canonical
      });
      const ctx = lines.filter((l) => l.includes('lab_followup_context')).slice(-1)[0] || '';
      results.push({
        question: row.q,
        resolved_by: row.source.session && !row.source.canonical ? 'active_session (simulated)' : 'canonical (simulated)',
        reply: out?.replyText || '',
        context_log: ctx
      });
    }
    console.log('e2e_lab_followup_quality: ok');
    console.log(JSON.stringify({ samplePanel_summary: { items: samplePanel.items.length }, results }, null, 2));
  } finally {
    console.info = oldInfo;
  }
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
