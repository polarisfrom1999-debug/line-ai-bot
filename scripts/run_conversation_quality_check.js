'use strict';

const fs = require('fs');
const path = require('path');

function normalizeText(value) {
  return String(value || '').trim();
}

function normalizeLoose(value) {
  return normalizeText(value).toLowerCase().replace(/\s+/g, '').replace(/[。、,.!?！？]/g, '');
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function isShortQuestion(text) {
  const safe = normalizeText(text);
  if (!safe) return false;
  return safe.length <= 20 || /[?？]$/.test(safe) || /できる|どう|なに|何|いつ|どこ|どれ/.test(safe);
}

function isGuideLike(text) {
  const safe = normalizeText(text);
  return /入力|フォーム|登録|先に|お願いします|完了してください|接続コード/.test(safe);
}

function hasDirectAnswerTone(text) {
  const safe = normalizeText(text);
  return /できます|です|あります|いまは|はい|いいえ|可能/.test(safe);
}

function startsWithGuide(text) {
  const safe = normalizeText(text);
  return /^(プロフィール|入力|先に|まずは入力|無料体験プロフィール|登録)/.test(safe);
}

function hasDistressSignal(text) {
  return /困|失敗|できない|わからない|どうしよう|つらい|しんどい/.test(normalizeText(text));
}

function hasExplanatoryTone(text) {
  const safe = normalizeText(text);
  return /可能性|まず|次に|だめなら|ので|ため|すると|手順|試して/.test(safe);
}

function simpleSimilarity(a, b) {
  const x = normalizeLoose(a);
  const y = normalizeLoose(b);
  if (!x || !y) return 0;
  if (x === y) return 1;
  let hit = 0;
  for (const ch of new Set(x)) {
    if (y.includes(ch)) hit += 1;
  }
  return hit / Math.max(new Set(x).size, new Set(y).size, 1);
}

function evaluateCase(testCase) {
  const turns = Array.isArray(testCase.turns) ? testCase.turns : [];
  const expect = testCase.expect || {};
  const violations = [];
  let score = 100;

  // A: loop detection
  let consecutiveSameGuide = 1;
  let previousAssistant = '';
  for (const turn of turns) {
    if (turn.role !== 'assistant') continue;
    const text = normalizeText(turn.text);
    if (text && text === previousAssistant && isGuideLike(text)) {
      consecutiveSameGuide += 1;
    } else {
      consecutiveSameGuide = 1;
    }
    previousAssistant = text;
  }
  const maxAllowedGuide = Number(expect.max_consecutive_same_guide || 99);
  if (consecutiveSameGuide > maxAllowedGuide) {
    violations.push(`同一案内が連続 (${consecutiveSameGuide})`);
    score -= 30;
  }

  // B: repeated template
  const assistantTexts = turns.filter((t) => t.role === 'assistant').map((t) => normalizeText(t.text)).filter(Boolean);
  let maxSimilar = 0;
  for (let i = 1; i < assistantTexts.length; i += 1) {
    const sim = simpleSimilarity(assistantTexts[i - 1], assistantTexts[i]);
    maxSimilar = Math.max(maxSimilar, sim);
  }
  if (expect.max_similar_ratio != null && maxSimilar > expect.max_similar_ratio) {
    violations.push(`類似返答率が高い (${maxSimilar.toFixed(2)})`);
    score -= 10;
  }

  const sameClosingHits = assistantTexts.filter((text) => /また一緒に整えていきましょう。?$/.test(text)).length;
  if (expect.max_same_closing_hits != null && sameClosingHits > expect.max_same_closing_hits) {
    violations.push(`同一締めが多い (${sameClosingHits})`);
    score -= 10;
  }

  // C: direct answer first
  if (expect.must_answer_short_question_first) {
    for (let i = 0; i < turns.length - 1; i += 1) {
      const userTurn = turns[i];
      const assistantTurn = turns[i + 1];
      if (!userTurn || !assistantTurn) continue;
      if (userTurn.role !== 'user' || assistantTurn.role !== 'assistant') continue;
      if (!isShortQuestion(userTurn.text)) continue;
      const answer = normalizeText(assistantTurn.text);
      if (startsWithGuide(answer) || (!hasDirectAnswerTone(answer) && isGuideLike(answer))) {
        violations.push('短い質問に先に答えていない');
        score -= 10;
        break;
      }
    }
  }

  // D: kindness / explanatory on distress
  if (expect.require_explanatory_tone_on_distress) {
    for (let i = 0; i < turns.length - 1; i += 1) {
      const userTurn = turns[i];
      const assistantTurn = turns[i + 1];
      if (!userTurn || !assistantTurn) continue;
      if (userTurn.role !== 'user' || assistantTurn.role !== 'assistant') continue;
      if (!hasDistressSignal(userTurn.text)) continue;
      const answer = normalizeText(assistantTurn.text);
      if (!hasExplanatoryTone(answer)) {
        violations.push('困り時の説明トーン不足');
        score -= 5;
      }
    }
  }

  if (score < 0) score = 0;
  return {
    id: testCase.id,
    category: testCase.category || 'uncategorized',
    description: testCase.description || '',
    expectFailure: Boolean(testCase.expect_failure),
    score,
    pass: violations.length === 0,
    violations
  };
}

function summarize(results) {
  const judged = results.map((r) => {
    const ok = r.expectFailure ? !r.pass : r.pass;
    return { ...r, ok };
  });
  const total = judged.length;
  const passCount = judged.filter((r) => r.ok).length;
  const avgScore = total ? results.reduce((sum, r) => sum + r.score, 0) / total : 0;
  const severe = judged.filter((r) => r.ok === false && r.violations.some((v) => /同一案内|先に答えていない/.test(v))).length;
  const status = severe >= 2 || passCount < total ? 'FAIL' : (avgScore < 80 ? 'WARN' : 'PASS');
  return { total, passCount, avgScore, severe, status, judged };
}

function run() {
  const casesPath = path.resolve(__dirname, '..', 'tests', 'conversation_regression_cases.json');
  const cases = readJson(casesPath);
  const results = cases.map(evaluateCase);
  const summary = summarize(results);

  console.log('=== Kokokara Conversation Quality Check ===');
  for (const r of summary.judged) {
    const mode = r.expectFailure ? 'EXPECT_FAIL' : 'EXPECT_PASS';
    console.log(`- [${r.ok ? 'OK' : 'NG'}] ${r.id} (${r.category}) ${mode} score=${r.score}`);
    if (r.violations.length) {
      for (const v of r.violations) console.log(`    - ${v}`);
    }
  }
  console.log('---');
  console.log(`Status: ${summary.status}`);
  console.log(`Pass: ${summary.passCount}/${summary.total}`);
  console.log(`Avg Score: ${summary.avgScore.toFixed(1)}`);
  console.log(`Severe Cases: ${summary.severe}`);

  if (summary.status === 'FAIL') process.exitCode = 1;
}

run();
