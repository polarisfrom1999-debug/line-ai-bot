'use strict';

/**
 * services/diagnosis_service.js
 *
 * 役割:
 * - 診断開始判定
 * - 診断7問定義
 * - 回答解析
 * - スコア計算
 * - AI牛込タイプ判定
 * - おすすめプラン判定
 * - 結果文面生成
 */

const AI_TYPE_LABELS = {
  soft: 'そっと寄り添う',
  bright: '明るく後押し',
  guide: '頼もしく導く',
  strong: '力強く支える',
};

const PLAN_LABELS = {
  light: 'ライト',
  basic: 'ベーシック',
  premium: 'プレミアム',
  special: '人数限定！絶対痩せたいスペシャル候補',
};

const DIAGNOSIS_START_KEYWORDS = [
  '診断',
  '無料診断',
  'ここから診断',
  '生活立て直し診断',
  '整え方診断',
  'タイプ診断',
];

const DIAGNOSIS_QUESTIONS = [
  {
    no: 1,
    title: '今いちばん近い気持ちはどれですか？',
    choices: [
      { key: 'A', shortLabel: '無理なく整えたい', submitText: '診断回答:1:A' },
      { key: 'B', shortLabel: '支えがほしい', submitText: '診断回答:1:B' },
      { key: 'C', shortLabel: '結果につなげたい', submitText: '診断回答:1:C' },
      { key: 'D', shortLabel: '本気で変えたい', submitText: '診断回答:1:D' },
    ],
  },
  {
    no: 2,
    title: '最近の自分に近い状態はどれですか？',
    choices: [
      { key: 'A', shortLabel: '生活リズムが乱れ気味', submitText: '診断回答:2:A' },
      { key: 'B', shortLabel: '気にしても続かない', submitText: '診断回答:2:B' },
      { key: 'C', shortLabel: '頑張っても止まりやすい', submitText: '診断回答:2:C' },
      { key: 'D', shortLabel: '体型や体調が不安', submitText: '診断回答:2:D' },
    ],
  },
  {
    no: 3,
    title: 'どんな支え方があると続けやすそうですか？',
    choices: [
      { key: 'A', shortLabel: 'やさしく寄り添ってほしい', submitText: '診断回答:3:A' },
      { key: 'B', shortLabel: '明るく励ましてほしい', submitText: '診断回答:3:B' },
      { key: 'C', shortLabel: '頼れる感じで導いてほしい', submitText: '診断回答:3:C' },
      { key: 'D', shortLabel: 'しっかり伴走してほしい', submitText: '診断回答:3:D' },
    ],
  },
  {
    no: 4,
    title: '1週間ごとの振り返りはほしいですか？',
    choices: [
      { key: 'A', shortLabel: 'まずは気軽に始めたい', submitText: '診断回答:4:A' },
      { key: 'B', shortLabel: 'あった方が続きそう', submitText: '診断回答:4:B' },
      { key: 'C', shortLabel: 'かなりほしい', submitText: '診断回答:4:C' },
      { key: 'D', shortLabel: '細かく見てもらいたい', submitText: '診断回答:4:D' },
    ],
  },
  {
    no: 5,
    title: '今のあなたが本当に取り戻したいものに近いのはどれですか？',
    choices: [
      { key: 'A', shortLabel: '無理しすぎない日常', submitText: '診断回答:5:A' },
      { key: 'B', shortLabel: '健康的な生活リズム', submitText: '診断回答:5:B' },
      { key: 'C', shortLabel: '自信を持てる体と気持ち', submitText: '診断回答:5:C' },
      { key: 'D', shortLabel: '変われた実感', submitText: '診断回答:5:D' },
    ],
  },
  {
    no: 6,
    title: 'これまで続かなかった理由に近いものはどれですか？',
    choices: [
      { key: 'A', shortLabel: '頑張りすぎて疲れる', submitText: '診断回答:6:A' },
      { key: 'B', shortLabel: '一人だと後回しになる', submitText: '診断回答:6:B' },
      { key: 'C', shortLabel: '合うやり方が分からない', submitText: '診断回答:6:C' },
      { key: 'D', shortLabel: '強い支えが足りなかった', submitText: '診断回答:6:D' },
    ],
  },
  {
    no: 7,
    title: 'もし今の自分に合う進め方があるなら、どうしたいですか？',
    choices: [
      { key: 'A', shortLabel: 'まずは気軽に試したい', submitText: '診断回答:7:A' },
      { key: 'B', shortLabel: '少し支えてもらいたい', submitText: '診断回答:7:B' },
      { key: 'C', shortLabel: 'しっかり伴走してほしい', submitText: '診断回答:7:C' },
      { key: 'D', shortLabel: '人生を変えるきっかけにしたい', submitText: '診断回答:7:D' },
    ],
  },
];

function safeText(value, fallback = '') {
  return String(value || fallback).trim();
}

function normalizeLoose(text) {
  return safeText(text)
    .toLowerCase()
    .replace(/[！!？?。.,，、\s]/g, '');
}

function buildQuickReplies(items = []) {
  return items
    .filter(Boolean)
    .map((item) => ({
      type: 'action',
      action: {
        type: 'message',
        label: safeText(item.label, '').slice(0, 20),
        text: safeText(item.text, '').slice(0, 300),
      },
    }));
}

function isDiagnosisStartText(text) {
  const normalized = normalizeLoose(text);
  return DIAGNOSIS_START_KEYWORDS.some((keyword) =>
    normalized.includes(normalizeLoose(keyword))
  );
}

function getDiagnosisStartMessage() {
  return {
    text:
      'ここから。生活立て直し診断\n' +
      '今のあなたに合う整え方や、続けやすい進め方を見つけるための診断です。\n\n' +
      '「ただ痩せる」だけでなく、無理なく健康的な生活を取り戻すヒントを一緒に見つけていきます。\n\n' +
      '全部で7問です。\n' +
      '気軽に進めてくださいね。',
    quickReply: {
      items: buildQuickReplies([{ label: '診断を始める', text: '診断開始' }]),
    },
  };
}

function getDiagnosisQuestion(questionNo) {
  const q = DIAGNOSIS_QUESTIONS.find((item) => item.no === Number(questionNo));
  if (!q) return null;

  return {
    no: q.no,
    title: q.title,
    text: `第${q.no}問\n${q.title}`,
    quickReply: {
      items: buildQuickReplies(
        q.choices.map((choice) => ({
          label: choice.shortLabel,
          text: choice.submitText,
        }))
      ),
    },
    choices: q.choices,
  };
}

function parseDiagnosisAnswer(text, currentQuestion) {
  const raw = safeText(text);
  if (!raw) return null;

  const fullMatch = raw.match(/^診断回答:(\d+):([ABCD])$/i);
  if (fullMatch) {
    return {
      questionNo: Number(fullMatch[1]),
      answer: fullMatch[2].toUpperCase(),
    };
  }

  const upper = raw.toUpperCase();
  if (['A', 'B', 'C', 'D'].includes(upper)) {
    return {
      questionNo: Number(currentQuestion || 0),
      answer: upper,
    };
  }

  const numMap = { '1': 'A', '2': 'B', '3': 'C', '4': 'D' };
  if (numMap[raw]) {
    return {
      questionNo: Number(currentQuestion || 0),
      answer: numMap[raw],
    };
  }

  return null;
}

function createEmptyScores() {
  return {
    ai: {
      soft: 0,
      bright: 0,
      guide: 0,
      strong: 0,
    },
    plan: {
      light: 0,
      basic: 0,
      premium: 0,
      special: 0,
    },
  };
}

function addBaseScore(scores, answer) {
  if (answer === 'A') {
    scores.ai.soft += 2;
    scores.plan.light += 2;
  } else if (answer === 'B') {
    scores.ai.bright += 2;
    scores.plan.basic += 2;
  } else if (answer === 'C') {
    scores.ai.guide += 2;
    scores.plan.premium += 2;
  } else if (answer === 'D') {
    scores.ai.strong += 2;
    scores.plan.special += 2;
  }
}

function applyQuestionBonus(scores, questionNo, answer) {
  if (Number(questionNo) === 3) {
    if (answer === 'A') {
      scores.ai.soft += 2;
      scores.plan.light += 1;
    } else if (answer === 'B') {
      scores.ai.bright += 2;
      scores.plan.basic += 1;
    } else if (answer === 'C') {
      scores.ai.guide += 2;
      scores.plan.premium += 1;
    } else if (answer === 'D') {
      scores.ai.strong += 2;
      scores.plan.special += 1;
    }
  }

  if (Number(questionNo) === 4) {
    if (answer === 'A') {
      scores.plan.light += 2;
    } else if (answer === 'B') {
      scores.plan.basic += 2;
    } else if (answer === 'C') {
      scores.plan.premium += 2;
    } else if (answer === 'D') {
      scores.plan.special += 2;
      scores.plan.premium += 1;
    }
  }

  if (Number(questionNo) === 7) {
    if (answer === 'A') {
      scores.plan.light += 2;
    } else if (answer === 'B') {
      scores.plan.basic += 2;
    } else if (answer === 'C') {
      scores.plan.premium += 2;
    } else if (answer === 'D') {
      scores.plan.special += 2;
      scores.ai.strong += 1;
    }
  }
}

function scoreDiagnosisAnswers(answers = []) {
  const scores = createEmptyScores();

  answers.forEach((answer, idx) => {
    const normalized = safeText(answer).toUpperCase();
    if (!['A', 'B', 'C', 'D'].includes(normalized)) return;

    const questionNo = idx + 1;
    addBaseScore(scores, normalized);
    applyQuestionBonus(scores, questionNo, normalized);
  });

  return scores;
}

function rankScores(scoreMap, priorityOrder = []) {
  const entries = Object.entries(scoreMap);

  entries.sort((a, b) => {
    if (b[1] !== a[1]) return b[1] - a[1];
    return priorityOrder.indexOf(a[0]) - priorityOrder.indexOf(b[0]);
  });

  return entries.map(([key, score]) => ({ key, score }));
}

function shouldRecommendSpecial(answers = [], rankedPlans = []) {
  const coreQuestions = [1, 6, 7];
  const dCount = coreQuestions.reduce((acc, questionNo) => {
    return acc + (safeText(answers[questionNo - 1]).toUpperCase() === 'D' ? 1 : 0);
  }, 0);

  const top = rankedPlans[0] || null;
  const second = rankedPlans[1] || null;
  const isTopSpecial = top && top.key === 'special';
  const isSingleTop = isTopSpecial && (!second || top.score > second.score);

  return Boolean(isSingleTop || dCount >= 2);
}

function buildDiagnosisResult(answers = []) {
  const scores = scoreDiagnosisAnswers(answers);

  const rankedAi = rankScores(scores.ai, ['soft', 'bright', 'guide', 'strong']);
  const rankedPlan = rankScores(scores.plan, ['light', 'basic', 'premium', 'special']);

  const specialCandidate = shouldRecommendSpecial(answers, rankedPlan);

  let primaryPlan = rankedPlan[0]?.key || 'light';
  let secondaryPlan = rankedPlan[1]?.key || 'basic';

  if (primaryPlan === 'special' && !specialCandidate) {
    primaryPlan = 'premium';
    secondaryPlan = 'special';
  }

  return {
    aiType: rankedAi[0]?.key || 'soft',
    primaryPlan,
    secondaryPlan,
    specialCandidate,
    scores,
  };
}

function mapAiTypeLabel(aiType) {
  return AI_TYPE_LABELS[aiType] || AI_TYPE_LABELS.soft;
}

function mapPlanLabel(planKey) {
  return PLAN_LABELS[planKey] || PLAN_LABELS.light;
}

function buildDiagnosisSummaryText(result = {}) {
  const aiLabel = mapAiTypeLabel(result.aiType);
  const planLabel = mapPlanLabel(result.primaryPlan);
  const secondLabel = mapPlanLabel(result.secondaryPlan);

  let reason = 'まずは気負わず、毎日のやり取りから少しずつ整えていく進め方が合いやすそうです。';

  if (result.primaryPlan === 'basic') {
    reason = '毎日のやり取りに加えて、1週間ごとの振り返りがある方が、無理なく整えやすそうです。';
  } else if (result.primaryPlan === 'premium') {
    reason = 'AIの毎日返信に加えて、より深い振り返りがある方が安心して続けやすそうです。';
  } else if (result.primaryPlan === 'special') {
    reason = 'しっかり伴走してもらえる環境の方が、力を発揮しやすい可能性があります。';
  }

  const specialNote = result.specialCandidate
    ? '\n\nスペシャルは人数限定の特別枠です。\nご希望の方には個別でご案内します。'
    : '';

  return (
    'ありがとうございます。\n' +
    '今のあなたは、頑張れないのではなく、今の自分に合う整え方がまだ見つかっていなかっただけかもしれません。\n\n' +
    'おすすめのAI牛込タイプ\n' +
    `${aiLabel}\n\n` +
    'おすすめプラン\n' +
    `${planLabel}\n` +
    `${reason}\n\n` +
    '第二候補\n' +
    `${secondLabel}` +
    specialNote +
    '\n\nまずは7日間無料で、ここから。のやり取りを気軽に試してみませんか？'
  );
}

function getDiagnosisResultMessage(result = {}) {
  return {
    text: buildDiagnosisSummaryText(result),
    quickReply: {
      items: buildQuickReplies([
        { label: '7日無料で始める', text: '7日無料で始める' },
        { label: 'プランを見る', text: 'プランを見る' },
        { label: 'スペシャルを知りたい', text: 'スペシャルを知りたい' },
      ]),
    },
  };
}

module.exports = {
  AI_TYPE_LABELS,
  PLAN_LABELS,
  DIAGNOSIS_QUESTIONS,
  isDiagnosisStartText,
  getDiagnosisStartMessage,
  getDiagnosisQuestion,
  parseDiagnosisAnswer,
  scoreDiagnosisAnswers,
  buildDiagnosisResult,
  buildDiagnosisSummaryText,
  getDiagnosisResultMessage,
  mapAiTypeLabel,
  mapPlanLabel,
};
