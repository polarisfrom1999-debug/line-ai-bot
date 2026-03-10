const {
  renderPanelSummary,
  buildLabQuickReplyMain,
  LAB_ITEM_LABELS,
} = require('../blood_test_flow_helpers');

const INTAKE_STEPS = [
  'choose_ai_type',
  'choose_main_goal',
  'choose_main_concern',
  'choose_activity_level',
  'choose_sleep_level',
  'choose_support_style',
  'ideal_future_free',
  'confirm_finish',
];

const AI_TYPE_MAP = {
  'やさしい伴走': 'gentle',
  '元気応援': 'energetic',
  '分析サポート': 'analytical',
  '気軽トーク': 'casual',
};

const AI_TYPE_LABEL = {
  gentle: 'やさしい伴走',
  energetic: '元気応援',
  analytical: '分析サポート',
  casual: '気軽トーク',
};

const INTAKE_OPTIONS = {
  choose_ai_type: ['やさしい伴走', '元気応援', '分析サポート', '気軽トーク'],
  choose_main_goal: ['健康改善', '体重管理', '美容も整えたい', '生活習慣改善'],
  choose_main_concern: ['食事', '睡眠', 'むくみ', '姿勢', '血液検査'],
  choose_activity_level: ['ほぼ運動なし', 'たまに動く', '週1〜2回', '週3回以上'],
  choose_sleep_level: ['5時間未満', '5〜6時間', '6〜7時間', '7時間以上'],
  choose_support_style: ['優しく伴走', 'しっかり励ます', '理由も知りたい', '気軽に話したい'],
};

function normalizeLabQuickReplyInput(text) {
  const t = String(text || '').trim();
  if (/^\d{4}[/-]\d{1,2}[/-]\d{1,2}$/.test(t)) return t.replace(/\//g, '-');
  return t;
}

function getPanelDateKeys(session) {
  return Object.keys(session?.working_data_json || {}).sort((a, b) => (a < b ? 1 : -1));
}

function findPanelDateFromInput(session, text) {
  const normalized = normalizeLabQuickReplyInput(text);
  const keys = getPanelDateKeys(session);
  return keys.find((k) => k === normalized) || null;
}

function mapCorrectionLabelToField(text) {
  const t = String(text || '').trim();
  const pairs = {
    '日付を修正': 'measured_at',
    'HbA1cを修正': 'hba1c',
    'LDLを修正': 'ldl',
    'HDLを修正': 'hdl',
    'TGを修正': 'triglycerides',
    'ASTを修正': 'ast',
    'ALTを修正': 'alt',
    'γGTPを修正': 'ggt',
    '血糖を修正': 'fasting_glucose',
    '尿酸を修正': 'uric_acid',
    'クレアチニンを修正': 'creatinine',
  };
  return pairs[t] || null;
}

function buildLabFollowupQuickReplies(items = {}, hasMultipleDates = false) {
  const base = buildLabQuickReplyMain(items, hasMultipleDates) || [];
  const extra = hasMultipleDates ? ['読み取れた日付を全部保存'] : [];
  return [...new Set([...base, ...extra])];
}

function buildLabDraftSummaryMessage(session) {
  const dates = getPanelDateKeys(session);
  const selectedDate = session?.selected_date || dates[0];

  if (!selectedDate) {
    return {
      text: '血液検査の読み取り結果がまだありません。',
      quickReplies: [],
    };
  }

  const items = (session.working_data_json || {})[selectedDate] || {};
  const text = renderPanelSummary(selectedDate, items);

  return {
    text,
    quickReplies: buildLabFollowupQuickReplies(items, dates.length > 1),
  };
}

function buildLabDateChoiceMessage(session) {
  const dates = getPanelDateKeys(session);

  const text = [
    '血液検査の画像を読み取りました。',
    'この画像には複数回分の検査結果がありそうです。',
    'まず確認したい日付を選んでください。',
    '',
    ...dates.map((d, i) => `${i + 1}. ${String(d).replace(/-/g, '/')}`),
  ].join('\n');

  return {
    text,
    quickReplies: dates.map((d) => d.replace(/-/g, '/')),
  };
}

function buildLabCorrectionGuide(field) {
  const label = LAB_ITEM_LABELS[field] || field;
  if (field === 'measured_at') {
    return `${label}を修正します。\nYYYY/MM/DD の形で送ってください。\n例: 2025/03/12`;
  }
  return `${label}の値を修正します。\n正しい数値をそのまま送ってください。\n例: 138`;
}

function createEmptyIntakeAnswers() {
  return {
    ai_type: null,
    main_goal: null,
    main_concern: null,
    activity_level: null,
    sleep_level: null,
    support_style: null,
    ideal_future: null,
  };
}

function renderIntakeStepMessage(session) {
  const step = session?.current_step || 'choose_ai_type';

  if (step === 'choose_ai_type') {
    return {
      text: '初回インテークを始めますね。\nまずは、AI牛込の話し方タイプを選んでください。',
      quickReplies: INTAKE_OPTIONS.choose_ai_type,
    };
  }

  if (step === 'choose_main_goal') {
    return {
      text: '今いちばん近い目的を選んでください。',
      quickReplies: INTAKE_OPTIONS.choose_main_goal,
    };
  }

  if (step === 'choose_main_concern') {
    return {
      text: '今、特に気になっていることを1つ選んでください。',
      quickReplies: INTAKE_OPTIONS.choose_main_concern,
    };
  }

  if (step === 'choose_activity_level') {
    return {
      text: '普段の運動量にいちばん近いものを選んでください。',
      quickReplies: INTAKE_OPTIONS.choose_activity_level,
    };
  }

  if (step === 'choose_sleep_level') {
    return {
      text: '最近の睡眠時間にいちばん近いものを選んでください。',
      quickReplies: INTAKE_OPTIONS.choose_sleep_level,
    };
  }

  if (step === 'choose_support_style') {
    return {
      text: 'どんな関わり方がいちばん合いそうですか？',
      quickReplies: INTAKE_OPTIONS.choose_support_style,
    };
  }

  if (step === 'ideal_future_free') {
    return {
      text: '理想の未来や、こうなれたら嬉しいことがあれば自由に教えてください。\n思いつかなければ「スキップ」でも大丈夫です。',
      quickReplies: ['スキップ'],
    };
  }

  if (step === 'confirm_finish') {
    const a = session?.answers_json || {};
    const summary = [
      'ここまでありがとうございます。',
      '',
      `AIタイプ: ${AI_TYPE_LABEL[a.ai_type] || '未設定'}`,
      `目的: ${a.main_goal || '未設定'}`,
      `気になること: ${a.main_concern || '未設定'}`,
      `運動量: ${a.activity_level || '未設定'}`,
      `睡眠: ${a.sleep_level || '未設定'}`,
      `関わり方: ${a.support_style || '未設定'}`,
      a.ideal_future ? `理想の未来: ${a.ideal_future}` : null,
      '',
      'この内容で初回設定を完了しますか？',
    ].filter(Boolean).join('\n');

    return {
      text: summary,
      quickReplies: ['この内容で完了', '最初からやり直す'],
    };
  }

  return {
    text: '初回インテークを再開します。',
    quickReplies: ['初回診断を始める'],
  };
}

function validateIntakeAnswer(step, text) {
  const value = String(text || '').trim();

  if (step === 'choose_ai_type') {
    return INTAKE_OPTIONS.choose_ai_type.includes(value)
      ? { ok: true, patch: { ai_type: AI_TYPE_MAP[value] || 'gentle' }, nextStep: 'choose_main_goal' }
      : { ok: false };
  }

  if (step === 'choose_main_goal') {
    return INTAKE_OPTIONS.choose_main_goal.includes(value)
      ? { ok: true, patch: { main_goal: value }, nextStep: 'choose_main_concern' }
      : { ok: false };
  }

  if (step === 'choose_main_concern') {
    return INTAKE_OPTIONS.choose_main_concern.includes(value)
      ? { ok: true, patch: { main_concern: value }, nextStep: 'choose_activity_level' }
      : { ok: false };
  }

  if (step === 'choose_activity_level') {
    return INTAKE_OPTIONS.choose_activity_level.includes(value)
      ? { ok: true, patch: { activity_level: value }, nextStep: 'choose_sleep_level' }
      : { ok: false };
  }

  if (step === 'choose_sleep_level') {
    return INTAKE_OPTIONS.choose_sleep_level.includes(value)
      ? { ok: true, patch: { sleep_level: value }, nextStep: 'choose_support_style' }
      : { ok: false };
  }

  if (step === 'choose_support_style') {
    return INTAKE_OPTIONS.choose_support_style.includes(value)
      ? { ok: true, patch: { support_style: value }, nextStep: 'ideal_future_free' }
      : { ok: false };
  }

  if (step === 'ideal_future_free') {
    return {
      ok: true,
      patch: { ideal_future: value === 'スキップ' ? '' : value },
      nextStep: 'confirm_finish',
    };
  }

  return { ok: false };
}

function buildIntakeProfilePatch(answers = {}) {
  return {
    ai_type: answers.ai_type || null,
  };
}

function buildIntakeProfileSummary(answers = {}) {
  return {
    conversation_style: AI_TYPE_LABEL[answers.ai_type] || null,
    encouragement_style: answers.support_style || null,
    current_barriers: answers.main_concern || null,
  };
}

module.exports = {
  INTAKE_STEPS,
  AI_TYPE_MAP,
  AI_TYPE_LABEL,
  INTAKE_OPTIONS,
  normalizeLabQuickReplyInput,
  getPanelDateKeys,
  findPanelDateFromInput,
  mapCorrectionLabelToField,
  buildLabFollowupQuickReplies,
  buildLabDraftSummaryMessage,
  buildLabDateChoiceMessage,
  buildLabCorrectionGuide,
  createEmptyIntakeAnswers,
  renderIntakeStepMessage,
  validateIntakeAnswer,
  buildIntakeProfilePatch,
  buildIntakeProfileSummary,
};