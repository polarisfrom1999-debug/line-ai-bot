'use strict';

/**
 * scripts/run_conversation_quality_check.js
 *
 * 使い方:
 *   node scripts/run_conversation_quality_check.js path/to/results.json
 *
 * results.json 形式:
 * {
 *   "results": [
 *     {
 *       "id": "profile_question_should_not_loop",
 *       "assistant_output": "..."
 *     }
 *   ]
 * }
 */

const fs = require('fs');
const path = require('path');

const ROOT = process.cwd();
const CASES_PATH = path.join(ROOT, 'tests', 'conversation_regression_cases.json');
const EXTRA_CASES_PATH = path.join(ROOT, 'tests', 'blood_test_regression_cases.json');

function normalize(text) {
  return String(text || '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

function includesAny(text, arr) {
  const n = normalize(text);
  return (Array.isArray(arr) ? arr : []).some((token) => n.includes(normalize(token)));
}

function countOccurrences(text, phrase) {
  const n = normalize(text);
  const p = normalize(phrase);
  if (!p) return 0;
  return n.split(p).length - 1;
}

function similarityByContainment(a, b) {
  const na = normalize(a);
  const nb = normalize(b);
  if (!na || !nb) return 0;
  if (na === nb) return 1;
  if (na.includes(nb) || nb.includes(na)) return 0.9;

  const wordsA = new Set(na.split(' '));
  const wordsB = new Set(nb.split(' '));
  const inter = [...wordsA].filter((w) => wordsB.has(w)).length;
  const union = new Set([...wordsA, ...wordsB]).size || 1;
  return inter / union;
}

function isShortQuestion(text) {
  const safe = String(text || '').trim();
  if (!safe) return false;
  return safe.length <= 20 || /[?？]$/.test(safe) || /できる|どう|なに|何|いつ|どこ|どれ/.test(safe);
}

function isGuideLike(text) {
  const safe = String(text || '').trim();
  return /入力|フォーム|登録|先に|お願いします|完了してください|接続コード/.test(safe);
}

function hasDirectAnswerTone(text) {
  const safe = String(text || '').trim();
  return /できます|です|あります|いまは|はい|いいえ|可能/.test(safe);
}

function startsWithGuide(text) {
  const safe = String(text || '').trim();
  return /^(プロフィール|入力|先に|まずは入力|無料体験プロフィール|登録)/.test(safe);
}

function hasDistressSignal(text) {
  return /困|失敗|できない|わからない|どうしよう|つらい|しんどい/.test(String(text || '').trim());
}

function hasExplanatoryTone(text) {
  const safe = String(text || '').trim();
  return /可能性|まず|次に|だめなら|ので|ため|すると|手順|試して/.test(safe);
}

function loadJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function loadCases() {
  const raw = loadJson(CASES_PATH);
  const list = Array.isArray(raw) ? raw : (Array.isArray(raw?.cases) ? raw.cases : []);
  if (!fs.existsSync(EXTRA_CASES_PATH)) return list;
  try {
    const extra = loadJson(EXTRA_CASES_PATH);
    const extraList = Array.isArray(extra) ? extra : (Array.isArray(extra?.cases) ? extra.cases : []);
    return list.concat(extraList);
  } catch (_error) {
    return list;
  }
}

function defaultAssistantOutputFromCase(testCase) {
  if (typeof testCase?.assistant_output === 'string') return testCase.assistant_output;
  if (typeof testCase?.assistant_message === 'string') return testCase.assistant_message;

  const turns = Array.isArray(testCase?.turns) ? testCase.turns : [];
  return turns
    .filter((turn) => turn && turn.role === 'assistant')
    .map((turn) => String(turn.text || '').trim())
    .filter(Boolean)
    .join('\n');
}

function scoreNaturalness(output) {
  const repeatedStarts = [
    'おはようございます',
    'ここから。',
    '夜は無理に詰め込まず',
    'まずは'
  ];
  const hit = repeatedStarts.some((s) => normalize(output).startsWith(normalize(s)));
  if (hit) return 1;
  if (output.length < 4) return 0;
  return 2;
}

function scoreDirectness(testCase, output) {
  if (testCase.must_prefer_direct_answer || testCase?.expect?.must_answer_short_question_first) {
    const firstSentence = String(output).split(/[。！？\n]/)[0] || '';
    const badStarts = [
      'ここから。',
      '無料体験を始めます',
      'まずは伴走の土台',
      'この形で分かる所だけ送ってください',
      'プロフィールを入力してください'
    ];
    if (badStarts.some((s) => normalize(firstSentence).includes(normalize(s)))) {
      return 0;
    }
    return 2;
  }
  return 1;
}

function scoreCompanionship(output) {
  const bad = [
    '入力してください',
    'この形で分かる所だけ',
    '途中です',
    '再読み込みできていません'
  ];
  if (includesAny(output, bad)) return 0;

  const good = [
    '受け取りました',
    '一緒に',
    '見ていきましょう',
    'そのまま返します',
    'まず答えると'
  ];
  if (includesAny(output, good)) return 2;

  return 1;
}

function scoreClarity(output) {
  if (output.length === 0) return 0;
  const vague = ['そのまま', 'いったん', '途中', '継続中'];
  if (includesAny(output, vague) && output.length < 40) return 0;
  if (output.length > 350) return 1;
  return 2;
}

function scoreConciseness(testCase, output) {
  const maxLength = testCase.max_length || 260;
  if (output.length > maxLength * 1.6) return 0;
  if (output.length > maxLength) return 1;
  return 2;
}

function scoreTone(output) {
  const robotic = [
    'この形で分かる所だけ送ってください',
    '構造化の途中です',
    '項目一覧を再読み込みできていません'
  ];
  if (includesAny(output, robotic)) return 0;

  const human = [
    '受け取りました',
    'まず答えると',
    '今日の一歩',
    '無理なく',
    'そのまま'
  ];
  if (includesAny(output, human)) return 2;
  return 1;
}

function evaluateCase(testCase, output, previousOutput = '') {
  const errors = [];
  const warnings = [];
  const expect = testCase.expect || {};
  const turns = Array.isArray(testCase.turns) ? testCase.turns : [];

  if (!output || !String(output).trim()) {
    return {
      id: testCase.id,
      title: testCase.title || testCase.description || testCase.id,
      passed: false,
      totalScore: 0,
      maxScore: 12,
      errors: ['assistant_output が空です'],
      warnings: [],
      detailScores: {}
    };
  }

  if (Array.isArray(testCase.must_not_contain)) {
    for (const bad of testCase.must_not_contain) {
      if (includesAny(output, [bad])) {
        errors.push(`禁止語句を含みます: ${bad}`);
      }
    }
  }

  if (Array.isArray(testCase.must_contain_any)) {
    for (const group of testCase.must_contain_any) {
      const tokens = Array.isArray(group) ? group : [group];
      if (!includesAny(output, tokens)) {
        errors.push(`必要語群のいずれも含みません: ${tokens.join(' / ')}`);
      }
    }
  }

  if (testCase.must_not_repeat_previous && previousOutput) {
    const sim = similarityByContainment(output, previousOutput);
    if (sim >= 0.75) {
      errors.push(`前回返答と類似しすぎています (similarity=${sim.toFixed(2)})`);
    }
  }

  if (expect.max_consecutive_same_guide != null) {
    let consecutiveSameGuide = 1;
    let previousAssistant = '';
    for (const turn of turns) {
      if (!turn || turn.role !== 'assistant') continue;
      const text = String(turn.text || '').trim();
      if (text && text === previousAssistant && isGuideLike(text)) {
        consecutiveSameGuide += 1;
      } else {
        consecutiveSameGuide = 1;
      }
      previousAssistant = text;
    }
    if (consecutiveSameGuide > Number(expect.max_consecutive_same_guide)) {
      errors.push(`同一案内が連続 (${consecutiveSameGuide})`);
    }
  }

  if (expect.max_similar_ratio != null) {
    const assistantTexts = turns
      .filter((turn) => turn && turn.role === 'assistant')
      .map((turn) => String(turn.text || '').trim())
      .filter(Boolean);
    let maxSimilar = 0;
    for (let i = 1; i < assistantTexts.length; i += 1) {
      maxSimilar = Math.max(maxSimilar, similarityByContainment(assistantTexts[i - 1], assistantTexts[i]));
    }
    if (maxSimilar > Number(expect.max_similar_ratio)) {
      errors.push(`類似返答率が高い (${maxSimilar.toFixed(2)})`);
    }
  }

  if (expect.max_same_closing_hits != null) {
    const assistantTexts = turns
      .filter((turn) => turn && turn.role === 'assistant')
      .map((turn) => String(turn.text || '').trim())
      .filter(Boolean);
    const sameClosingHits = assistantTexts.filter((text) => /また一緒に整えていきましょう。?$/.test(text)).length;
    if (sameClosingHits > Number(expect.max_same_closing_hits)) {
      errors.push(`同一締めが多い (${sameClosingHits})`);
    }
  }

  if (expect.must_answer_short_question_first) {
    for (let i = 0; i < turns.length - 1; i += 1) {
      const userTurn = turns[i];
      const assistantTurn = turns[i + 1];
      if (!userTurn || !assistantTurn) continue;
      if (userTurn.role !== 'user' || assistantTurn.role !== 'assistant') continue;
      if (!isShortQuestion(userTurn.text)) continue;
      const answer = String(assistantTurn.text || '').trim();
      if (startsWithGuide(answer) || (!hasDirectAnswerTone(answer) && isGuideLike(answer))) {
        errors.push('短い質問に先に答えていない');
        break;
      }
    }
  }

  if (expect.require_explanatory_tone_on_distress) {
    for (let i = 0; i < turns.length - 1; i += 1) {
      const userTurn = turns[i];
      const assistantTurn = turns[i + 1];
      if (!userTurn || !assistantTurn) continue;
      if (userTurn.role !== 'user' || assistantTurn.role !== 'assistant') continue;
      if (!hasDistressSignal(userTurn.text)) continue;
      const answer = String(assistantTurn.text || '').trim();
      if (!hasExplanatoryTone(answer)) {
        errors.push('困り時の説明トーン不足');
        break;
      }
    }
  }

  const repeatedPhrases = [
    '無料体験を始めます',
    'この形で分かる所だけ送ってください',
    'まずは伴走の土台',
    '無理のない範囲で'
  ];
  for (const phrase of repeatedPhrases) {
    if (countOccurrences(output, phrase) >= 2) {
      errors.push(`同一フレーズの繰り返し: ${phrase}`);
    }
  }

  const detailScores = {
    naturalness: scoreNaturalness(output),
    directness: scoreDirectness(testCase, output),
    companionship: scoreCompanionship(output),
    clarity: scoreClarity(output),
    conciseness: scoreConciseness(testCase, output),
    tone: scoreTone(output)
  };

  const totalScore = Object.values(detailScores).reduce((a, b) => a + b, 0);
  const passed = errors.length === 0 && totalScore >= 8;

  if (totalScore < 8) {
    warnings.push(`スコア不足: ${totalScore}/12`);
  }

  return {
    id: testCase.id,
    title: testCase.title || testCase.description || testCase.id,
    passed,
    totalScore,
    maxScore: 12,
    errors,
    warnings,
    detailScores
  };
}

function buildSummary(report) {
  const passedCount = report.filter((r) => r.passed).length;
  const failedCount = report.length - passedCount;
  const averageScore = report.length
    ? (report.reduce((sum, r) => sum + r.totalScore, 0) / report.length).toFixed(2)
    : '0.00';

  return {
    total: report.length,
    passed: passedCount,
    failed: failedCount,
    averageScore
  };
}

function evaluateFromResults(resultsPath) {
  if (!fs.existsSync(resultsPath)) {
    console.error(`結果ファイルがありません: ${resultsPath}`);
    process.exit(1);
  }

  const testCases = loadCases();
  const resultJson = loadJson(resultsPath);
  const actualResults = Array.isArray(resultJson?.results) ? resultJson.results : [];

  const actualMap = new Map(actualResults.map((r) => [r.id, r.assistant_output || '']));
  const report = [];
  let previousOutput = '';

  for (const testCase of testCases) {
    const output = actualMap.get(testCase.id) || '';
    const evaluated = evaluateCase(testCase, output, previousOutput);
    report.push(evaluated);
    previousOutput = output || previousOutput;
  }

  const summary = buildSummary(report);
  console.log(JSON.stringify({ summary, report }, null, 2));

  if (summary.failed > 0) {
    process.exit(2);
  }
}

function evaluateEmbeddedCases() {
  const testCases = loadCases();
  const report = [];
  let previousOutput = '';
  let okCount = 0;

  for (const testCase of testCases) {
    const output = defaultAssistantOutputFromCase(testCase);
    const evaluated = evaluateCase(testCase, output, previousOutput);
    const ok = testCase.expect_failure ? !evaluated.passed : evaluated.passed;
    report.push({ ...evaluated, ok, expectFailure: Boolean(testCase.expect_failure) });
    if (ok) okCount += 1;
    previousOutput = output || previousOutput;
  }

  console.log('=== Kokokara Conversation Quality Check ===');
  for (const item of report) {
    const mode = item.expectFailure ? 'EXPECT_FAIL' : 'EXPECT_PASS';
    console.log(`- [${item.ok ? 'OK' : 'NG'}] ${item.id} ${mode} score12=${item.totalScore}`);
    for (const error of item.errors) console.log(`    - ${error}`);
    for (const warning of item.warnings) console.log(`    - ${warning}`);
  }
  console.log('---');
  const averageScore = report.length
    ? (report.reduce((sum, r) => sum + r.totalScore, 0) / report.length).toFixed(2)
    : '0.00';
  const severe = report.filter((item) => !item.ok).length;
  console.log(`Status: ${severe > 0 ? 'FAIL' : 'PASS'}`);
  console.log(`Pass: ${okCount}/${report.length}`);
  console.log(`Avg Score12: ${averageScore}`);
  console.log(`Severe Cases: ${severe}`);

  if (severe > 0) {
    process.exitCode = 1;
  }
}

function main() {
  if (!fs.existsSync(CASES_PATH)) {
    console.error(`テストケースファイルがありません: ${CASES_PATH}`);
    process.exit(1);
  }

  const resultsPath = process.argv[2];
  if (resultsPath) {
    evaluateFromResults(resultsPath);
    return;
  }

  // 後方互換: 引数なしなら tests 内の assistant 文面を使って自己評価する。
  evaluateEmbeddedCases();
}

main();
