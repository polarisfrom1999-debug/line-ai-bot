'use strict';

/**
 * config/onboarding_flow_config.js
 *
 * 目的:
 * - オンボーディングの進行順、各ステップの役割、スキップ可否を一元管理する
 * - onboarding_service.js 側で分岐を書き散らかさないための土台にする
 */

const STEP_KEYS = {
  TRIAL_ENTRY: 'trial_entry',
  PROFILE_NAME: 'profile_name',
  PROFILE_AGE: 'profile_age',
  PROFILE_WEIGHT: 'profile_weight',
  PROFILE_BODY_FAT: 'profile_body_fat',
  PROFILE_GOAL: 'profile_goal',
  AI_TYPE: 'ai_type',
  VOICE_STYLE: 'voice_style',
  CONSTITUTION_INTRO: 'constitution_intro',
  CONSTITUTION_QUESTION: 'constitution_question',
  CONSTITUTION_RESULT: 'constitution_result',
  PLAN_SELECT: 'plan_select',
  COMPLETE: 'complete',
  PERIODIC_CHECK_INTRO: 'periodic_check_intro',
  PERIODIC_CHECK_QUESTION: 'periodic_check_question',
  PERIODIC_CHECK_RESULT: 'periodic_check_result',
};

const ONBOARDING_TRIGGERS = {
  startTrial: ['無料体験開始', '体験開始', 'はじめる', '始めたい'],
  periodicCheck: ['体質チェック', '体調チェック', '今の調子チェック'],
};

const FLOW = {
  initial: {
    key: 'initial_onboarding',
    title: '初回オンボーディング',
    description: 'プロフィール、AIタイプ、声かけスタイル、初回体質アンケート、プラン選択まで進む導線。',
    entryTriggers: ONBOARDING_TRIGGERS.startTrial,
    steps: [
      STEP_KEYS.TRIAL_ENTRY,
      STEP_KEYS.PROFILE_NAME,
      STEP_KEYS.PROFILE_AGE,
      STEP_KEYS.PROFILE_WEIGHT,
      STEP_KEYS.PROFILE_BODY_FAT,
      STEP_KEYS.PROFILE_GOAL,
      STEP_KEYS.AI_TYPE,
      STEP_KEYS.VOICE_STYLE,
      STEP_KEYS.CONSTITUTION_INTRO,
      STEP_KEYS.CONSTITUTION_QUESTION,
      STEP_KEYS.CONSTITUTION_RESULT,
      STEP_KEYS.PLAN_SELECT,
      STEP_KEYS.COMPLETE,
    ],
  },
  periodic: {
    key: 'periodic_constitution_flow',
    title: '定期体質チェック',
    description: '今の整い具合を軽く確認し、前回差分を返す導線。',
    entryTriggers: ONBOARDING_TRIGGERS.periodicCheck,
    steps: [
      STEP_KEYS.PERIODIC_CHECK_INTRO,
      STEP_KEYS.PERIODIC_CHECK_QUESTION,
      STEP_KEYS.PERIODIC_CHECK_RESULT,
    ],
  },
};

const STEP_DEFINITIONS = {
  [STEP_KEYS.TRIAL_ENTRY]: {
    key: STEP_KEYS.TRIAL_ENTRY,
    title: '無料体験入口',
    prompt: '無料体験を始めます。まずは呼ばれたいお名前を教えてください。',
    skippable: false,
    saveKey: null,
  },
  [STEP_KEYS.PROFILE_NAME]: {
    key: STEP_KEYS.PROFILE_NAME,
    title: '名前',
    prompt: '呼ばれたいお名前を教えてください。',
    skippable: false,
    saveKey: 'preferredName',
  },
  [STEP_KEYS.PROFILE_AGE]: {
    key: STEP_KEYS.PROFILE_AGE,
    title: '年齢',
    prompt: '年齢を教えてください。数字だけでも大丈夫です。',
    skippable: false,
    saveKey: 'age',
  },
  [STEP_KEYS.PROFILE_WEIGHT]: {
    key: STEP_KEYS.PROFILE_WEIGHT,
    title: '体重',
    prompt: '今の体重を教えてください。例: 56.8kg',
    skippable: false,
    saveKey: 'weight',
  },
  [STEP_KEYS.PROFILE_BODY_FAT]: {
    key: STEP_KEYS.PROFILE_BODY_FAT,
    title: '体脂肪率',
    prompt: '体脂肪率が分かれば教えてください。分からなければ「わからない」でも大丈夫です。',
    skippable: true,
    saveKey: 'bodyFat',
  },
  [STEP_KEYS.PROFILE_GOAL]: {
    key: STEP_KEYS.PROFILE_GOAL,
    title: '目標',
    prompt: '今いちばん近い目標を教えてください。例: 体調を整えたい / 無理なく減量したい',
    skippable: false,
    saveKey: 'goal',
  },
  [STEP_KEYS.AI_TYPE]: {
    key: STEP_KEYS.AI_TYPE,
    title: 'AIタイプ選択',
    prompt: '伴走スタイルを選んでください。',
    skippable: false,
    saveKey: 'aiType',
    quickReplyMode: 'ai_type',
  },
  [STEP_KEYS.VOICE_STYLE]: {
    key: STEP_KEYS.VOICE_STYLE,
    title: '声かけスタイル選択',
    prompt: '声かけの雰囲気を選んでください。',
    skippable: false,
    saveKey: 'voiceStyle',
    quickReplyMode: 'voice_style',
  },
  [STEP_KEYS.CONSTITUTION_INTRO]: {
    key: STEP_KEYS.CONSTITUTION_INTRO,
    title: '体質アンケート導入',
    prompt: 'ここから、今の体と生活の傾向を確認します。全部ポチッと答えられます。',
    skippable: false,
    saveKey: null,
  },
  [STEP_KEYS.CONSTITUTION_QUESTION]: {
    key: STEP_KEYS.CONSTITUTION_QUESTION,
    title: '初回体質アンケート',
    prompt: '今のあなたに近いものを選んでください。',
    skippable: false,
    saveKey: 'constitutionSurveyAnswers',
  },
  [STEP_KEYS.CONSTITUTION_RESULT]: {
    key: STEP_KEYS.CONSTITUTION_RESULT,
    title: '初回アンケート結果',
    prompt: '今のあなたに出やすい傾向をまとめます。',
    skippable: false,
    saveKey: null,
  },
  [STEP_KEYS.PLAN_SELECT]: {
    key: STEP_KEYS.PLAN_SELECT,
    title: 'プラン選択',
    prompt: '最後に、試してみたいプランを選んでください。',
    skippable: false,
    saveKey: 'selectedPlan',
    quickReplyMode: 'plan_select',
  },
  [STEP_KEYS.COMPLETE]: {
    key: STEP_KEYS.COMPLETE,
    title: '完了',
    prompt: 'これで準備は完了です。ここから一緒に整えていきましょう。',
    skippable: false,
    saveKey: null,
  },
  [STEP_KEYS.PERIODIC_CHECK_INTRO]: {
    key: STEP_KEYS.PERIODIC_CHECK_INTRO,
    title: '定期チェック導入',
    prompt: '最近の整い具合を、かんたんに確認します。今の状態に近いものを選んでください。',
    skippable: false,
    saveKey: null,
  },
  [STEP_KEYS.PERIODIC_CHECK_QUESTION]: {
    key: STEP_KEYS.PERIODIC_CHECK_QUESTION,
    title: '定期チェック本体',
    prompt: '今の状態に近いものを選んでください。',
    skippable: false,
    saveKey: 'periodicConstitutionAnswers',
  },
  [STEP_KEYS.PERIODIC_CHECK_RESULT]: {
    key: STEP_KEYS.PERIODIC_CHECK_RESULT,
    title: '定期チェック結果',
    prompt: '前回からの変化もあわせて、今の様子をまとめます。',
    skippable: false,
    saveKey: null,
  },
};

const QUICK_REPLY_PRESETS = {
  ai_type: ['そっと寄り添う', '明るく後押し', '頼もしく導く', '力強く支える'],
  voice_style: ['いつも優しく', 'いつも明るく', '普段優しく、ときどき厳しく'],
  plan_select: ['まずはゆるく始める', '記録中心で続ける', '相談もしながら整える'],
};

function getStepDefinition(stepKey) {
  return STEP_DEFINITIONS[stepKey] || null;
}

function getFlowDefinition(flowKey) {
  return FLOW[flowKey] || null;
}

function findFlowByTrigger(text) {
  const normalized = String(text || '').trim();
  if (!normalized) return null;

  for (const flow of Object.values(FLOW)) {
    if ((flow.entryTriggers || []).includes(normalized)) return flow;
  }
  return null;
}

module.exports = {
  STEP_KEYS,
  ONBOARDING_TRIGGERS,
  FLOW,
  STEP_DEFINITIONS,
  QUICK_REPLY_PRESETS,
  getStepDefinition,
  getFlowDefinition,
  findFlowByTrigger,
};
