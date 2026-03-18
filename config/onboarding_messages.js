'use strict';

const ONBOARDING_STEPS = {
  WELCOME: 'SCREEN_01',
  SERVICE_INFO: 'SCREEN_02',
  TRIAL_INFO: 'SCREEN_03',
  TRIAL_DETAIL: 'SCREEN_04',
  NAME: 'SCREEN_05',
  AGE: 'SCREEN_06',
  HEIGHT: 'SCREEN_07',
  WEIGHT: 'SCREEN_08',
  BODY_FAT: 'SCREEN_09',
  GOAL_TYPE: 'SCREEN_10',
  GOAL_WEIGHT: 'SCREEN_11',
  GOAL_BODY_FAT: 'SCREEN_12',
  GOAL_PERIOD: 'SCREEN_13',
  CONCERN: 'SCREEN_14',
  LIFESTYLE: 'SCREEN_15',
  PAIN_RISK: 'SCREEN_16',
  NOTE: 'SCREEN_17',
  TONE: 'SCREEN_18',
  CONFIRM: 'SCREEN_19',
  EDIT_SELECT: 'SCREEN_20',
  SAVED: 'SCREEN_21',

  WELCOME_END: 'SCREEN_01_END',
  TRIAL_DECLINED: 'SCREEN_03_END',
};

const GOAL_TYPE_OPTIONS = [
  { label: '減量したい', value: 'weight_loss' },
  { label: '健康改善', value: 'health_improvement' },
  { label: '体力アップ', value: 'fitness_up' },
  { label: '痛み軽減', value: 'pain_relief' },
  { label: '見た目改善', value: 'appearance_improvement' },
];

const GOAL_PERIOD_OPTIONS = [
  { label: '1か月', value: '1_month' },
  { label: '3か月', value: '3_months' },
  { label: '半年', value: '6_months' },
  { label: 'まずは1週間', value: '1_week' },
  { label: '相談しながら決めたい', value: 'consult' },
];

const CONCERN_OPTIONS = [
  { label: '食べすぎ', value: 'overeating' },
  { label: '間食が多い', value: 'snacking' },
  { label: '続かない', value: 'cannot_continue' },
  { label: '運動不足', value: 'lack_of_exercise' },
  { label: '痛みがある', value: 'pain' },
  { label: '数値が気になる', value: 'lab_values' },
];

const LIFESTYLE_OPTIONS = [
  { label: '朝型', value: 'morning_type' },
  { label: '夜型', value: 'night_type' },
  { label: 'デスクワーク', value: 'desk_work' },
  { label: '立ち仕事', value: 'standing_work' },
  { label: '家事中心', value: 'housework_centered' },
  { label: '運動ほぼなし', value: 'little_exercise' },
  { label: '軽い運動あり', value: 'light_exercise' },
  { label: '運動習慣あり', value: 'regular_exercise' },
];

const PAIN_RISK_OPTIONS = [
  { label: '膝が気になる', value: 'knee_issue' },
  { label: '腰が気になる', value: 'low_back_issue' },
  { label: '肩首がつらい', value: 'neck_shoulder_issue' },
  { label: '足が痛い', value: 'foot_issue' },
  { label: '数値が気になる', value: 'lab_values' },
  { label: '特になし', value: 'none' },
];

const TONE_OPTIONS = [
  { label: 'やさしく', value: 'gentle' },
  { label: '明るめ', value: 'bright' },
  { label: '落ち着いた感じ', value: 'calm' },
  { label: 'しっかり伴走', value: 'supportive' },
  { label: '厳しすぎない感じ', value: 'not_too_strict' },
];

function optionValueToLabel(options, value, fallback = '未入力') {
  if (value === null || value === undefined || value === '') return fallback;
  const found = options.find((item) => item.value === value);
  return found ? found.label : String(value);
}

function formatDisplayValue(value, fallback = '未入力') {
  if (value === null || value === undefined || value === '') return fallback;
  return String(value);
}

function buildProfileConfirmMessage(profile = {}) {
  const bodyFatText =
    profile.body_fat_percent === null || profile.body_fat_percent === undefined || profile.body_fat_percent === ''
      ? '不明'
      : `${profile.body_fat_percent}%`;

  const goalWeightText =
    profile.goal_weight_kg === null || profile.goal_weight_kg === undefined || profile.goal_weight_kg === ''
      ? '相談したい'
      : `${profile.goal_weight_kg}kg`;

  const goalBodyFatText =
    profile.goal_body_fat_percent === null || profile.goal_body_fat_percent === undefined || profile.goal_body_fat_percent === ''
      ? '相談したい'
      : `${profile.goal_body_fat_percent}%`;

  return `プロフィールはこの内容でよろしいですか？

【プロフィール確認】
お名前：${formatDisplayValue(profile.name)}
年齢：${formatDisplayValue(profile.age)}歳
身長：${formatDisplayValue(profile.height_cm)}cm
現在体重：${formatDisplayValue(profile.weight_kg)}kg
現在体脂肪率：${bodyFatText}
目標：${optionValueToLabel(GOAL_TYPE_OPTIONS, profile.goal_type)}
目標体重：${goalWeightText}
目標体脂肪率：${goalBodyFatText}
目標時期：${optionValueToLabel(GOAL_PERIOD_OPTIONS, profile.goal_period)}
お悩み：${optionValueToLabel(CONCERN_OPTIONS, profile.main_concern)}
生活スタイル：${optionValueToLabel(LIFESTYLE_OPTIONS, profile.lifestyle)}
気になること：${optionValueToLabel(PAIN_RISK_OPTIONS, profile.pain_or_risk)}
補足：${formatDisplayValue(profile.note, 'なし')}
AIの話し方：${optionValueToLabel(TONE_OPTIONS, profile.tone)}

よろしければ保存してください。
修正したい場合は、直したい項目を選べます。`;
}

const ONBOARDING_MESSAGES = {
  [ONBOARDING_STEPS.WELCOME]: {
    text: `ようこそ、ここから。へ🌿

これから、あなたに合ったサポートをするために
まずは簡単な初期設定を行います。

むずかしい入力はありません。
選ぶだけの項目も多いので、1〜2分ほどで進められます✨`,
    quickReplies: ['はじめる', '内容を見る', 'あとで見る'],
  },

  [ONBOARDING_STEPS.SERVICE_INFO]: {
    text: `ここから。では、
食事・体重・体脂肪率・運動・体調などを
あなたに合ったペースで整えていけるように、
やさしく伴走していきます🌿

まずは1週間の無料体験から始められます。
気負わず、今の状態を知るところから始めていきましょう。`,
    quickReplies: ['無料体験へ', '戻る'],
  },

  [ONBOARDING_STEPS.TRIAL_INFO]: {
    text: `ここから。では、まず
1週間無料体験から始めていただけます🌿

この1週間では、
・食事
・体重
・体脂肪率
・運動や活動
・体の気になること

などを、無理のない形で一緒に整理していきます。

「続けられるかな…」という方でも大丈夫です。
できるところからでOKです✨`,
    quickReplies: ['無料体験を始める', '内容を見る', '今回はやめる'],
  },

  [ONBOARDING_STEPS.TRIAL_DETAIL]: {
    text: `1週間無料体験では、こんなことができます🌿

【無料体験でできること】
・食事記録とやさしいフィードバック
・体重、体脂肪率の記録
・運動や活動の記録
・体調や不安への一言サポート
・あなたに合う続け方の整理

完璧にできなくても大丈夫です。
まずは今の自分を知る時間として使ってみてください✨`,
    quickReplies: ['無料体験を始める', 'あとで見る'],
  },

  [ONBOARDING_STEPS.NAME]: {
    text: `まずは、呼ばれたいお名前を教えてください🌿
ニックネームでも大丈夫です。`,
    quickReplies: [],
  },

  [ONBOARDING_STEPS.AGE]: {
    text: `年齢を教えてください。
例：55`,
    quickReplies: [],
  },

  [ONBOARDING_STEPS.HEIGHT]: {
    text: `身長を教えてください。
例：160`,
    quickReplies: [],
  },

  [ONBOARDING_STEPS.WEIGHT]: {
    text: `現在の体重を教えてください。
例：58.5`,
    quickReplies: [],
  },

  [ONBOARDING_STEPS.BODY_FAT]: {
    text: `現在の体脂肪率が分かれば教えてください。
分からない場合は「不明」でも大丈夫です。
例：28.5`,
    quickReplies: ['不明'],
  },

  [ONBOARDING_STEPS.GOAL_TYPE]: {
    text: `今回いちばん近い目標を選んでください🌿`,
    quickReplies: GOAL_TYPE_OPTIONS.map((item) => item.label),
  },

  [ONBOARDING_STEPS.GOAL_WEIGHT]: {
    text: `目標体重があれば教えてください。
まだ決まっていなければ「相談したい」でも大丈夫です。
例：53`,
    quickReplies: ['相談したい'],
  },

  [ONBOARDING_STEPS.GOAL_BODY_FAT]: {
    text: `目標の体脂肪率があれば教えてください。
まだ決まっていなければ「相談したい」でも大丈夫です。
例：25`,
    quickReplies: ['相談したい'],
  },

  [ONBOARDING_STEPS.GOAL_PERIOD]: {
    text: `どのくらいの期間で変えていきたいですか？`,
    quickReplies: GOAL_PERIOD_OPTIONS.map((item) => item.label),
  },

  [ONBOARDING_STEPS.CONCERN]: {
    text: `今のお悩みに近いものを選んでください。
複数ある場合は、まず一番近いものを1つ選んで大丈夫です🌿`,
    quickReplies: CONCERN_OPTIONS.map((item) => item.label),
  },

  [ONBOARDING_STEPS.LIFESTYLE]: {
    text: `今の生活スタイルに近いものを選んでください🌿`,
    quickReplies: LIFESTYLE_OPTIONS.map((item) => item.label),
  },

  [ONBOARDING_STEPS.PAIN_RISK]: {
    text: `体のことで気になることがあれば教えてください。
無理のない提案をするための参考にします🌿`,
    quickReplies: PAIN_RISK_OPTIONS.map((item) => item.label),
  },

  [ONBOARDING_STEPS.NOTE]: {
    text: `必要があれば、気になることを一言で教えてください。
例：膝が痛くて長く歩けない

特になければ「なし」で大丈夫です。`,
    quickReplies: ['なし'],
  },

  [ONBOARDING_STEPS.TONE]: {
    text: `AIの話し方の希望があれば選んでください🌿
あなたに合う雰囲気に近づけていきます。`,
    quickReplies: TONE_OPTIONS.map((item) => item.label),
  },

  [ONBOARDING_STEPS.EDIT_SELECT]: {
    text: `修正したい項目を選んでください🌿`,
    quickReplies: ['名前', '年齢', '身長', '体重', '体脂肪率', '目標', '悩み', '生活', '不安', '話し方'],
  },

  [ONBOARDING_STEPS.SAVED]: {
    text: `ありがとうございます🌿
プロフィールを保存しました。

それでは、ここから。の
1週間無料体験をスタートします✨

この1週間は、
完璧を目指すより
「少し意識してみる」「少し続けてみる」
その感覚を大切にしていきましょう。`,
    quickReplies: ['体重を記録', '食事を記録', '運動を記録', '体調を伝える'],
  },

  [ONBOARDING_STEPS.WELCOME_END]: {
    text: `ありがとうございます🌿
また始めたくなった時に、いつでも「はじめる」と送ってください。`,
    quickReplies: ['はじめる'],
  },

  [ONBOARDING_STEPS.TRIAL_DECLINED]: {
    text: `ありがとうございます🌿
また気になった時に、いつでも始められます。
必要になったら「はじめる」と送ってください。`,
    quickReplies: ['はじめる'],
  },
};

module.exports = {
  ONBOARDING_STEPS,
  ONBOARDING_MESSAGES,
  GOAL_TYPE_OPTIONS,
  GOAL_PERIOD_OPTIONS,
  CONCERN_OPTIONS,
  LIFESTYLE_OPTIONS,
  PAIN_RISK_OPTIONS,
  TONE_OPTIONS,
  buildProfileConfirmMessage,
};
