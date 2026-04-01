'use strict';

/**
 * config/constitution_survey_config.js
 *
 * 目的:
 * - 体質アンケート（初回12問 / 定期チェック7問）の定義を一元管理する
 * - 主タイプ / 副タイプの採点ロジックをまとめる
 * - LINEで返す結果文の組み立てをここで完結できるようにする
 *
 * 方針:
 * - 1問1画面
 * - 横スライドなし
 * - ボタンだけで回答できる
 * - 初回は 3択（少ない / ときどきある / よくある）
 * - 定期チェックは 3択（整っている / いつも通り / 崩れ気味）
 * - 診断ではなく「今の反応傾向」を見る
 */

const SURVEY_UI = {
  oneQuestionPerScreen: true,
  allowHorizontalSlide: false,
  visibleButtonsPerScreen: 3,
  inputMode: 'button_only',
};

const SURVEY_TYPES = {
  INITIAL: 'initial_constitution_survey',
  PERIODIC: 'periodic_constitution_check',
};

const RESULT_TYPE_KEYS = {
  FLUID: 'fluid',
  SLOW: 'slow',
  OVERWORK: 'overwork',
  HOLD: 'hold',
  SWEET: 'sweet',
  FOGGY: 'foggy',
  STRESS: 'stress',
  OVERTHINK: 'overthink',
};

const RESULT_TYPES = {
  [RESULT_TYPE_KEYS.FLUID]: {
    key: RESULT_TYPE_KEYS.FLUID,
    label: 'むくみためこみ型',
    summary: '体の中にためこみやすく、重さやむくみが出ると動きづらくなりやすい時かもしれません。',
    body: '特に、冷え・重だるさ・朝のすっきりしにくさとして出やすいタイプです。',
    signs: ['夕方に重い', '靴下の跡がつきやすい', '朝すっきりしにくい', '雨の日にだるい'],
    relief: '少し温めること、同じ姿勢を減らすこと、軽く流すことを意識すると整いやすいです。',
    tips: ['朝に少し動く', '座りっぱなしを切る', '冷やしすぎない'],
    closing: 'この傾向は固定ではなく、巡りが戻ると軽さも出やすくなります。',
    recommendedAiTypes: ['そっと寄り添う', '頼もしく導く'],
    recommendedVoiceStyles: ['いつも優しく'],
  },

  [RESULT_TYPE_KEYS.SLOW]: {
    key: RESULT_TYPE_KEYS.SLOW,
    label: '省エネ停滞型',
    summary: '大きく崩れているというより、体も気持ちも立ち上がりにくく、エネルギーが回りにくい時かもしれません。',
    body: '朝の重さや、動き出すまでの鈍さとして出やすいタイプです。',
    signs: ['朝が重い', '動き出すまで時間がかかる', '食後に眠い', '体が鈍い感じが続く'],
    relief: 'いきなり頑張るより、短く動くこと、少し光を浴びること、食後に座りっぱなしを減らすことが合いやすいです。',
    tips: ['朝の光', '短い散歩', '食後に座りっぱなしを避ける'],
    closing: '止まっている感じがあっても、小さく動ける土台ができると変わりやすいタイプです。',
    recommendedAiTypes: ['頼もしく導く', '明るく後押し'],
    recommendedVoiceStyles: ['いつも優しく'],
  },

  [RESULT_TYPE_KEYS.OVERWORK]: {
    key: RESULT_TYPE_KEYS.OVERWORK,
    label: '消耗がんばり型',
    summary: '頑張れてしまうぶん、気づいた時にはかなり消耗していることがあるかもしれません。',
    body: '無理を重ねたあとに、疲れの抜けにくさや体調の落ちとして出やすいタイプです。',
    signs: ['休んでも回復しにくい', '数日ひびく', '頑張ってから崩れる', '気力で持たせがち'],
    relief: '今は、前に進むことより先に、休むこと、予定を少しゆるめること、回復しやすい余白を作ることが大切です。',
    tips: ['予定を詰め込みすぎない', '頑張れた日ほど整える', '睡眠を削らない'],
    closing: '頑張れることは強みです。でも、休めることも同じくらい大事です。',
    recommendedAiTypes: ['そっと寄り添う', '力強く支える'],
    recommendedVoiceStyles: ['普段優しく、ときどき厳しく', 'いつも優しく'],
  },

  [RESULT_TYPE_KEYS.HOLD]: {
    key: RESULT_TYPE_KEYS.HOLD,
    label: '我慢ためこみ型',
    summary: 'つらさや疲れをすぐ言葉にせず、自分の中で抱え込みやすい時かもしれません。',
    body: 'そのぶん、首・肩・腰の張りや固さとして出やすいタイプです。',
    signs: ['つらくても言わない', '後回しにしやすい', '首肩腰が固まりやすい', '我慢して動き続ける'],
    relief: '我慢して続けるより、違和感を小さいうちに気づくこと、少し言葉にすること、軽くほどくことが整えやすさにつながります。',
    tips: ['違和感を小さいうちに言う', '休む許可を出す', '深呼吸や軽いケアを挟む'],
    closing: '我慢強さは長所です。でも、早めに出せるともっと楽になりやすいです。',
    recommendedAiTypes: ['そっと寄り添う', '頼もしく導く'],
    recommendedVoiceStyles: ['いつも優しく'],
  },

  [RESULT_TYPE_KEYS.SWEET]: {
    key: RESULT_TYPE_KEYS.SWEET,
    label: '甘いもの波型',
    summary: '食欲の波が出やすく、特に甘いものや炭水化物に引っ張られやすい時かもしれません。',
    body: '意志の弱さというより、疲れやストレスの影響が食欲に出やすいタイプです。',
    signs: ['甘いものが止まりにくい', '疲れた時に食べたくなる', '夜に崩れやすい'],
    relief: '今は、我慢で抑え込むより、食事を抜きすぎないこと、安心できる軽い食べ方を作ること、反動を減らすことが大切です。',
    tips: ['食事を抜きすぎない', '安心できる軽食を用意する', '禁止しすぎない'],
    closing: '波があること自体は悪いことではありません。整え方で少しずつ変わっていけます。',
    recommendedAiTypes: ['明るく後押し', 'そっと寄り添う'],
    recommendedVoiceStyles: ['いつも明るく', 'いつも優しく'],
  },

  [RESULT_TYPE_KEYS.FOGGY]: {
    key: RESULT_TYPE_KEYS.FOGGY,
    label: '食後どんより型',
    summary: '食後に眠さ、重さ、頭のぼんやり感が出やすい時かもしれません。',
    body: '食事のあとに体がうまく切り替わらず、午後のだるさにつながりやすいタイプです。',
    signs: ['食後に眠い', '胃が重い', 'ぼんやりする', '午後に失速しやすい'],
    relief: '今日は、食べ方を少しやさしくすること、一気に食べすぎないこと、食後に少し立つことが整えやすさにつながります。',
    tips: ['一気に食べすぎない', '重い食事を続けない', '食後に少し立つ'],
    closing: '食後のどんより感は、工夫で変えやすいポイントです。少しずつ楽な形を見つけていきましょう。',
    recommendedAiTypes: ['頼もしく導く', '明るく後押し'],
    recommendedVoiceStyles: ['いつも優しく', 'いつも明るく'],
  },

  [RESULT_TYPE_KEYS.STRESS]: {
    key: RESULT_TYPE_KEYS.STRESS,
    label: '気疲れゆらぎ型',
    summary: '人や空気に気をつかいやすく、その負荷が体調や食欲、生活の乱れにつながりやすい時かもしれません。',
    body: '気づかないうちに消耗していることがあるタイプです。',
    signs: ['気をつかうと疲れる', '忙しい時に乱れる', '気持ちで食欲や行動がぶれやすい'],
    relief: '今は、がんばって整えるより、安心できる時間を増やすこと、刺激を減らすこと、自分のペースに戻ることが大切です。',
    tips: ['予定を詰めすぎない', '切り替え時間を作る', '1人で整う時間を持つ'],
    closing: '揺れやすさは弱さではなく、反応が繊細なだけです。整え方はちゃんとあります。',
    recommendedAiTypes: ['そっと寄り添う', '明るく後押し'],
    recommendedVoiceStyles: ['いつも優しく'],
  },

  [RESULT_TYPE_KEYS.OVERTHINK]: {
    key: RESULT_TYPE_KEYS.OVERTHINK,
    label: '考えすぎ停止型',
    summary: 'いろいろ考えられるぶん、整理しきれず、動き出しにくくなっている時かもしれません。',
    body: '怠けているというより、頭の中が詰まりやすいタイプです。',
    signs: ['考えすぎて動けない', '迷いが増える', '決められない', '先延ばしになりやすい'],
    relief: '今は、全部を何とかしようとするより、やることを1つに絞ること、次の一歩だけ決めること、考えを少し減らすことが合いやすいです。',
    tips: ['選択肢を減らす', '次の1歩だけ決める', '完璧を目指しすぎない'],
    closing: '止まっているように見えても、整理されると動きやすくなるタイプです。まずは小さく進めば大丈夫です。',
    recommendedAiTypes: ['頼もしく導く', '力強く支える'],
    recommendedVoiceStyles: ['普段優しく、ときどき厳しく', 'いつも優しく'],
  },
};

const SUB_TYPE_SHORT_MESSAGES = {
  [RESULT_TYPE_KEYS.FLUID]: 'ためこみやすさに加えて、巡りの重さも少し出やすい時かもしれません。',
  [RESULT_TYPE_KEYS.SLOW]: 'エネルギーが回りにくく、立ち上がりに時間がかかりやすい面もありそうです。',
  [RESULT_TYPE_KEYS.OVERWORK]: 'がんばりが続いたあとの消耗も、少し重なっていそうです。',
  [RESULT_TYPE_KEYS.HOLD]: 'つらさを言葉にせず抱え込みやすい面も少しありそうです。',
  [RESULT_TYPE_KEYS.SWEET]: '食欲の波も少し重なりやすい時かもしれません。',
  [RESULT_TYPE_KEYS.FOGGY]: '食後の重さやぼんやり感も出やすいかもしれません。',
  [RESULT_TYPE_KEYS.STRESS]: '気疲れや気持ちの揺れも、少し影響していそうです。',
  [RESULT_TYPE_KEYS.OVERTHINK]: '考えすぎて止まりやすい面も、少し重なっていそうです。',
};

const RESULT_TEMPLATES = {
  header: '今のあなたは、「{mainTypeLabel}」の傾向が中心で、あわせて「{subTypeLabel}」の傾向も少しあります。',
  footer: '今の傾向は固定ではなく、整ってくると少しずつ変わっていきます。ここから一緒に、今のあなたに合う整え方を見つけていきましょう。',
};

const INITIAL_SURVEY_ANSWER_OPTIONS = [
  { key: 'low', label: '少ない', scorePrimary: 0, scoreSecondary: 0 },
  { key: 'medium', label: 'ときどきある', scorePrimary: 1, scoreSecondary: 0 },
  { key: 'high', label: 'よくある', scorePrimary: 2, scoreSecondary: 1 },
];

const PERIODIC_CHECK_ANSWER_OPTIONS = [
  { key: 'good', label: '整っている', deltaScore: -1 },
  { key: 'same', label: 'いつも通り', deltaScore: 0 },
  { key: 'rough', label: '崩れ気味', deltaScore: 1 },
];

const INITIAL_SURVEY = {
  key: SURVEY_TYPES.INITIAL,
  title: '体と生活の傾向チェック',
  introMessage: 'あなたの体と生活の傾向を、かんたんに確認します。全部ポチッと答えられます。今のあなたに近いものを選んでください。',
  progressMessage: 'あと少しです。今のあなたに近いものを、そのまま選んでくださいね。',
  completeMessage: 'ありがとうございます。今のあなたに出やすい傾向をまとめます。',
  answerOptions: INITIAL_SURVEY_ANSWER_OPTIONS,
  questions: [
    {
      id: 'q1',
      text: '冷えやむくみを感じやすいですか？',
      primaryType: RESULT_TYPE_KEYS.FLUID,
      secondaryType: RESULT_TYPE_KEYS.SLOW,
    },
    {
      id: 'q2',
      text: '朝、体が重いと感じやすいですか？',
      primaryType: RESULT_TYPE_KEYS.SLOW,
      secondaryType: RESULT_TYPE_KEYS.FLUID,
    },
    {
      id: 'q3',
      text: '疲れが抜けにくいと感じますか？',
      primaryType: RESULT_TYPE_KEYS.OVERWORK,
      secondaryType: RESULT_TYPE_KEYS.SLOW,
    },
    {
      id: 'q4',
      text: '無理すると数日ひびきやすいですか？',
      primaryType: RESULT_TYPE_KEYS.OVERWORK,
      secondaryType: RESULT_TYPE_KEYS.HOLD,
    },
    {
      id: 'q5',
      text: '食後に眠い・重いと感じやすいですか？',
      primaryType: RESULT_TYPE_KEYS.FOGGY,
      secondaryType: RESULT_TYPE_KEYS.SLOW,
    },
    {
      id: 'q6',
      text: '甘いものがやめにくいと感じますか？',
      primaryType: RESULT_TYPE_KEYS.SWEET,
      secondaryType: RESULT_TYPE_KEYS.FOGGY,
    },
    {
      id: 'q7',
      text: 'ストレスで食欲が乱れやすいですか？',
      primaryType: RESULT_TYPE_KEYS.SWEET,
      secondaryType: RESULT_TYPE_KEYS.STRESS,
    },
    {
      id: 'q8',
      text: 'つらくても我慢しやすいですか？',
      primaryType: RESULT_TYPE_KEYS.HOLD,
      secondaryType: RESULT_TYPE_KEYS.OVERTHINK,
    },
    {
      id: 'q9',
      text: '人に気をつかいすぎて疲れますか？',
      primaryType: RESULT_TYPE_KEYS.STRESS,
      secondaryType: RESULT_TYPE_KEYS.HOLD,
    },
    {
      id: 'q10',
      text: '考えすぎて動けなくなることはありますか？',
      primaryType: RESULT_TYPE_KEYS.OVERTHINK,
      secondaryType: RESULT_TYPE_KEYS.STRESS,
    },
    {
      id: 'q11',
      text: '首・肩・腰が固まりやすいですか？',
      primaryType: RESULT_TYPE_KEYS.HOLD,
      secondaryType: RESULT_TYPE_KEYS.FLUID,
    },
    {
      id: 'q12',
      text: '忙しいと生活が乱れやすいですか？',
      primaryType: RESULT_TYPE_KEYS.STRESS,
      secondaryType: RESULT_TYPE_KEYS.OVERWORK,
    },
  ],
};

const PERIODIC_CHECK = {
  key: SURVEY_TYPES.PERIODIC,
  title: '最近の整い具合チェック',
  introMessage: '最近の整い具合を、かんたんに確認します。今の状態に近いものを選んでください。',
  completeMessage: 'ありがとうございます。前回からの変化もあわせて、今の様子をまとめます。',
  answerOptions: PERIODIC_CHECK_ANSWER_OPTIONS,
  questions: [
    { id: 'c1', text: '最近、朝の体の軽さはどうですか？', linkedTypes: [RESULT_TYPE_KEYS.SLOW, RESULT_TYPE_KEYS.FLUID] },
    { id: 'c2', text: '最近、疲れの抜けやすさはどうですか？', linkedTypes: [RESULT_TYPE_KEYS.OVERWORK, RESULT_TYPE_KEYS.SLOW] },
    { id: 'c3', text: '最近、食後の楽さはどうですか？', linkedTypes: [RESULT_TYPE_KEYS.FOGGY] },
    { id: 'c4', text: '最近、食欲の安定感はどうですか？', linkedTypes: [RESULT_TYPE_KEYS.SWEET, RESULT_TYPE_KEYS.STRESS] },
    { id: 'c5', text: '最近、体のこわばりはどうですか？', linkedTypes: [RESULT_TYPE_KEYS.HOLD, RESULT_TYPE_KEYS.FLUID] },
    { id: 'c6', text: '最近、気持ちや生活リズムはどうですか？', linkedTypes: [RESULT_TYPE_KEYS.STRESS, RESULT_TYPE_KEYS.OVERTHINK] },
    { id: 'c7', text: '最近、頑張りすぎている感じはどうですか？', linkedTypes: [RESULT_TYPE_KEYS.OVERWORK, RESULT_TYPE_KEYS.HOLD] },
  ],
};

function normalizeLoose(text) {
  return String(text || '')
    .trim()
    .toLowerCase()
    .replace(/[！!？?。.,，、]/g, '')
    .replace(/\s+/g, '');
}

function findAnswerOptionByLabel(options, text) {
  const normalized = normalizeLoose(text);
  return options.find((option) => normalizeLoose(option.label) === normalized) || null;
}

function buildEmptyTypeScoreMap() {
  return Object.values(RESULT_TYPE_KEYS).reduce((acc, key) => {
    acc[key] = 0;
    return acc;
  }, {});
}

function buildEmptyAnswerMap(questions = []) {
  return questions.reduce((acc, question) => {
    acc[question.id] = null;
    return acc;
  }, {});
}

function getInitialSurveyAnswerOption(input) {
  if (!input) return null;
  if (typeof input === 'object' && input.key) return INITIAL_SURVEY_ANSWER_OPTIONS.find((option) => option.key === input.key) || null;
  return findAnswerOptionByLabel(INITIAL_SURVEY_ANSWER_OPTIONS, input);
}

function getPeriodicCheckAnswerOption(input) {
  if (!input) return null;
  if (typeof input === 'object' && input.key) return PERIODIC_CHECK_ANSWER_OPTIONS.find((option) => option.key === input.key) || null;
  return findAnswerOptionByLabel(PERIODIC_CHECK_ANSWER_OPTIONS, input);
}

function scoreInitialSurveyAnswers(answerMap = {}) {
  const scores = buildEmptyTypeScoreMap();

  for (const question of INITIAL_SURVEY.questions) {
    const answer = getInitialSurveyAnswerOption(answerMap[question.id]);
    if (!answer) continue;

    scores[question.primaryType] += Number(answer.scorePrimary || 0);
    scores[question.secondaryType] += Number(answer.scoreSecondary || 0);
  }

  return scores;
}

function getSortedTypeEntries(scoreMap = {}) {
  return Object.entries(scoreMap)
    .map(([typeKey, score]) => ({ typeKey, score: Number(score || 0) }))
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      return a.typeKey.localeCompare(b.typeKey);
    });
}

function resolveMainAndSubType(scoreMap = {}) {
  const sorted = getSortedTypeEntries(scoreMap);
  const main = sorted[0] || { typeKey: RESULT_TYPE_KEYS.STRESS, score: 0 };
  const sub = sorted.find((entry) => entry.typeKey !== main.typeKey) || main;

  return {
    mainTypeKey: main.typeKey,
    mainScore: main.score,
    subTypeKey: sub.typeKey,
    subScore: sub.score,
    sorted,
  };
}

function buildResultHeader(mainTypeKey, subTypeKey) {
  const mainType = RESULT_TYPES[mainTypeKey] || RESULT_TYPES[RESULT_TYPE_KEYS.STRESS];
  const subType = RESULT_TYPES[subTypeKey] || RESULT_TYPES[RESULT_TYPE_KEYS.HOLD];

  return RESULT_TEMPLATES.header
    .replace('{mainTypeLabel}', mainType.label)
    .replace('{subTypeLabel}', subType.label);
}

function buildConstitutionResultText(mainTypeKey, subTypeKey) {
  const mainType = RESULT_TYPES[mainTypeKey] || RESULT_TYPES[RESULT_TYPE_KEYS.STRESS];
  const subMessage = SUB_TYPE_SHORT_MESSAGES[subTypeKey] || '';

  return [
    buildResultHeader(mainTypeKey, subTypeKey),
    '',
    mainType.summary,
    mainType.body,
    '',
    mainType.relief,
    subMessage ? `\n${subMessage}` : '',
    '',
    RESULT_TEMPLATES.footer,
  ]
    .filter(Boolean)
    .join('\n');
}

function buildConstitutionResultPayload(mainTypeKey, subTypeKey) {
  const mainType = RESULT_TYPES[mainTypeKey] || RESULT_TYPES[RESULT_TYPE_KEYS.STRESS];
  const subType = RESULT_TYPES[subTypeKey] || RESULT_TYPES[RESULT_TYPE_KEYS.HOLD];

  return {
    mainTypeKey: mainType.key,
    subTypeKey: subType.key,
    mainTypeLabel: mainType.label,
    subTypeLabel: subType.label,
    header: buildResultHeader(mainTypeKey, subTypeKey),
    summary: mainType.summary,
    body: mainType.body,
    relief: mainType.relief,
    signs: mainType.signs || [],
    tips: mainType.tips || [],
    subTypeShortMessage: SUB_TYPE_SHORT_MESSAGES[subTypeKey] || '',
    closing: RESULT_TEMPLATES.footer,
    recommendedAiTypes: mainType.recommendedAiTypes || [],
    recommendedVoiceStyles: mainType.recommendedVoiceStyles || [],
    text: buildConstitutionResultText(mainTypeKey, subTypeKey),
  };
}

function evaluateInitialSurvey(answerMap = {}) {
  const scores = scoreInitialSurveyAnswers(answerMap);
  const resolved = resolveMainAndSubType(scores);

  return {
    scores,
    ...resolved,
    result: buildConstitutionResultPayload(resolved.mainTypeKey, resolved.subTypeKey),
  };
}

function scorePeriodicCheck(answerMap = {}) {
  const deltas = buildEmptyTypeScoreMap();

  for (const question of PERIODIC_CHECK.questions) {
    const answer = getPeriodicCheckAnswerOption(answerMap[question.id]);
    if (!answer) continue;

    for (const linkedType of question.linkedTypes || []) {
      deltas[linkedType] += Number(answer.deltaScore || 0);
    }
  }

  return deltas;
}

function buildPeriodicDiffComments(previousDeltaMap = {}, currentDeltaMap = {}) {
  const comments = [];

  const currentStress = Number(currentDeltaMap[RESULT_TYPE_KEYS.STRESS] || 0);
  const prevStress = Number(previousDeltaMap[RESULT_TYPE_KEYS.STRESS] || 0);
  if (currentStress < prevStress) {
    comments.push('前回より、気持ちや生活リズムの揺れは少し落ち着いています。');
  } else if (currentStress > prevStress) {
    comments.push('前回より、気持ちや生活リズムの揺れが少し強めかもしれません。');
  }

  const currentOverwork = Number(currentDeltaMap[RESULT_TYPE_KEYS.OVERWORK] || 0);
  const prevOverwork = Number(previousDeltaMap[RESULT_TYPE_KEYS.OVERWORK] || 0);
  if (currentOverwork < prevOverwork) {
    comments.push('前回より、頑張りすぎの傾向は少しやわらいでいます。');
  } else if (currentOverwork > prevOverwork) {
    comments.push('今週は、頑張りすぎの傾向が少し強めです。減速を優先してもよさそうです。');
  }

  const currentFoggy = Number(currentDeltaMap[RESULT_TYPE_KEYS.FOGGY] || 0);
  const prevFoggy = Number(previousDeltaMap[RESULT_TYPE_KEYS.FOGGY] || 0);
  if (currentFoggy < prevFoggy) {
    comments.push('前回より、食後の重さやどんより感は少し落ち着いています。');
  } else if (currentFoggy > prevFoggy) {
    comments.push('食後の重さやぼんやり感が少し出やすいかもしれません。食べ方をやさしめにすると整いやすいです。');
  }

  const currentFluid = Number(currentDeltaMap[RESULT_TYPE_KEYS.FLUID] || 0);
  const prevFluid = Number(previousDeltaMap[RESULT_TYPE_KEYS.FLUID] || 0);
  if (currentFluid < prevFluid) {
    comments.push('前回より、朝の重さやためこみ感は少しやわらいでいるかもしれません。');
  } else if (currentFluid > prevFluid) {
    comments.push('むくみや重さが少し出やすい時かもしれません。座りっぱなしを減らして、軽く流すと合いやすいです。');
  }

  if (!comments.length) {
    comments.push('大きく崩れている感じではなさそうです。今の整い方を続けていきましょう。');
  }

  return comments;
}

function buildPeriodicCheckSummary(previousDeltaMap = {}, currentDeltaMap = {}) {
  return buildPeriodicDiffComments(previousDeltaMap, currentDeltaMap).join('\n');
}

function buildInitialSurveyState() {
  return {
    surveyType: SURVEY_TYPES.INITIAL,
    currentIndex: 0,
    isActive: true,
    answers: buildEmptyAnswerMap(INITIAL_SURVEY.questions),
    startedAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}

function buildPeriodicCheckState() {
  return {
    surveyType: SURVEY_TYPES.PERIODIC,
    currentIndex: 0,
    isActive: true,
    answers: buildEmptyAnswerMap(PERIODIC_CHECK.questions),
    startedAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}

function getSurveyByType(surveyType) {
  if (surveyType === SURVEY_TYPES.PERIODIC) return PERIODIC_CHECK;
  return INITIAL_SURVEY;
}

function getCurrentQuestion(state) {
  const survey = getSurveyByType(state?.surveyType);
  const index = Number(state?.currentIndex || 0);
  return survey.questions[index] || null;
}

function isSurveyComplete(state) {
  const survey = getSurveyByType(state?.surveyType);
  return Number(state?.currentIndex || 0) >= survey.questions.length;
}

function applySurveyAnswer(state, answerText) {
  const survey = getSurveyByType(state?.surveyType);
  const question = getCurrentQuestion(state);
  if (!question) return state;

  const nextAnswers = {
    ...(state?.answers || {}),
    [question.id]: String(answerText || '').trim(),
  };

  const nextIndex = Number(state?.currentIndex || 0) + 1;

  return {
    ...state,
    answers: nextAnswers,
    currentIndex: nextIndex,
    isActive: nextIndex < survey.questions.length,
    updatedAt: new Date().toISOString(),
  };
}

function getQuickReplyLabels(options = []) {
  return options.map((option) => option.label);
}

module.exports = {
  SURVEY_UI,
  SURVEY_TYPES,
  RESULT_TYPE_KEYS,
  RESULT_TYPES,
  SUB_TYPE_SHORT_MESSAGES,
  RESULT_TEMPLATES,
  INITIAL_SURVEY_ANSWER_OPTIONS,
  PERIODIC_CHECK_ANSWER_OPTIONS,
  INITIAL_SURVEY,
  PERIODIC_CHECK,
  normalizeLoose,
  findAnswerOptionByLabel,
  getInitialSurveyAnswerOption,
  getPeriodicCheckAnswerOption,
  buildEmptyTypeScoreMap,
  buildEmptyAnswerMap,
  scoreInitialSurveyAnswers,
  getSortedTypeEntries,
  resolveMainAndSubType,
  buildResultHeader,
  buildConstitutionResultText,
  buildConstitutionResultPayload,
  evaluateInitialSurvey,
  scorePeriodicCheck,
  buildPeriodicDiffComments,
  buildPeriodicCheckSummary,
  buildInitialSurveyState,
  buildPeriodicCheckState,
  getSurveyByType,
  getCurrentQuestion,
  isSurveyComplete,
  applySurveyAnswer,
  getQuickReplyLabels,
};
