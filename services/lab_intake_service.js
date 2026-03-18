'use strict';

const {
  AI_TYPE_VALUES,
  getAiTypeLabel,
  normalizeAiTypeInput,
} = require('../config/ai_type_config');

const INTAKE_STEPS = {
  CHOOSE_AI_TYPE: 'choose_ai_type',
  CURRENT_CONDITION: 'current_condition',
  EXERCISE_HISTORY: 'exercise_history',
  CURRENT_EXERCISE: 'current_exercise',
  GOAL_AND_PURPOSE: 'goal_and_purpose',
  DESIRED_FUTURE: 'desired_future',
  BARRIERS: 'barriers',
  CONFIRM_FINISH: 'confirm_finish',
};

const LAB_FIELD_LABELS = {
  hba1c: 'HbA1c',
  fasting_glucose: '空腹時血糖',
  ldl: 'LDL',
  hdl: 'HDL',
  triglycerides: '中性脂肪',
  ast: 'AST',
  alt: 'ALT',
  ggt: 'γ-GTP',
  uric_acid: '尿酸',
  creatinine: 'クレアチニン',
  measured_at: '日付',
};

function safeText(value, fallback = '') {
  return String(value || fallback).trim();
}

function normalizeLoose(text) {
  return String(text || '')
    .trim()
    .toLowerCase()
    .replace(/[！!？?。.,，、]/g, '')
    .replace(/\s+/g, '');
}

function createEmptyIntakeAnswers() {
  return {
    ai_type: AI_TYPE_VALUES.SOFT,
    current_condition: '',
    exercise_history: '',
    current_exercise: '',
    goal_and_purpose: '',
    desired_future: '',
    barriers: '',
  };
}

function buildQuickReplies(items = []) {
  return (items || [])
    .map((item) => safeText(item))
    .filter(Boolean)
    .slice(0, 8);
}

function renderIntakeStepMessage(session) {
  const step = safeText(session?.current_step || INTAKE_STEPS.CHOOSE_AI_TYPE);
  const answers = session?.answers_json || createEmptyIntakeAnswers();

  if (step === INTAKE_STEPS.CHOOSE_AI_TYPE) {
    return {
      text: [
        '最初に、話し方のタイプを選んでください。',
        '今後はこの雰囲気を基本にして伴走します。',
        '',
        `・${getAiTypeLabel(AI_TYPE_VALUES.SOFT)}`,
        `・${getAiTypeLabel(AI_TYPE_VALUES.BRIGHT)}`,
        `・${getAiTypeLabel(AI_TYPE_VALUES.RELIABLE)}`,
        `・${getAiTypeLabel(AI_TYPE_VALUES.STRONG)}`,
      ].join('\n'),
      quickReplies: buildQuickReplies([
        getAiTypeLabel(AI_TYPE_VALUES.SOFT),
        getAiTypeLabel(AI_TYPE_VALUES.BRIGHT),
        getAiTypeLabel(AI_TYPE_VALUES.RELIABLE),
        getAiTypeLabel(AI_TYPE_VALUES.STRONG),
      ]),
    };
  }

  if (step === INTAKE_STEPS.CURRENT_CONDITION) {
    return {
      text: '今の体調や生活の状態を教えてください。\n例: 疲れやすい / 夜に食べすぎやすい / 体が重い',
      quickReplies: [],
    };
  }

  if (step === INTAKE_STEPS.EXERCISE_HISTORY) {
    return {
      text: 'これまでの運動経験を教えてください。\n例: 昔は運動していた / ほとんどしていない / ジム経験あり',
      quickReplies: [],
    };
  }

  if (step === INTAKE_STEPS.CURRENT_EXERCISE) {
    return {
      text: '今の運動習慣を教えてください。\n例: 散歩を週2回 / 特になし / ストレッチだけしている',
      quickReplies: [],
    };
  }

  if (step === INTAKE_STEPS.GOAL_AND_PURPOSE) {
    return {
      text: '体重や見た目の目標だけでなく、何のために変わりたいかも教えてください。',
      quickReplies: [],
    };
  }

  if (step === INTAKE_STEPS.DESIRED_FUTURE) {
    return {
      text: 'この先どうなれたら嬉しいか教えてください。\n例: 旅行を楽しみたい / 元気に動ける体になりたい',
      quickReplies: [],
    };
  }

  if (step === INTAKE_STEPS.BARRIERS) {
    return {
      text: '今まで続かなかった理由や、心配なことがあれば教えてください。',
      quickReplies: [],
    };
  }

  const summary = buildIntakeProfileSummary(answers);

  return {
    text: [
      'この内容で初回設定を完了します。',
      '',
      `話し方: ${summary.conversation_style}`,
      `今の状態: ${summary.current_condition || '未入力'}`,
      `運動歴: ${summary.exercise_history || '未入力'}`,
      `現在の運動: ${summary.current_exercise || '未入力'}`,
      `目的: ${summary.goal_and_purpose || '未入力'}`,
      `なりたい姿: ${summary.desired_future || '未入力'}`,
      `気がかり: ${summary.current_barriers || '未入力'}`,
      '',
      'よければ「この内容で完了」と送ってください。',
    ].join('\n'),
    quickReplies: buildQuickReplies(['この内容で完了', '最初からやり直す']),
  };
}

function validateIntakeAnswer(step, text) {
  const value = safeText(text);

  if (step === INTAKE_STEPS.CHOOSE_AI_TYPE) {
    return {
      ok: true,
      nextStep: INTAKE_STEPS.CURRENT_CONDITION,
      patch: {
        ai_type: normalizeAiTypeInput(value, AI_TYPE_VALUES.SOFT),
      },
    };
  }

  if (!value) {
    return {
      ok: false,
      nextStep: step,
      patch: {},
    };
  }

  if (step === INTAKE_STEPS.CURRENT_CONDITION) {
    return {
      ok: true,
      nextStep: INTAKE_STEPS.EXERCISE_HISTORY,
      patch: { current_condition: value },
    };
  }

  if (step === INTAKE_STEPS.EXERCISE_HISTORY) {
    return {
      ok: true,
      nextStep: INTAKE_STEPS.CURRENT_EXERCISE,
      patch: { exercise_history: value },
    };
  }

  if (step === INTAKE_STEPS.CURRENT_EXERCISE) {
    return {
      ok: true,
      nextStep: INTAKE_STEPS.GOAL_AND_PURPOSE,
      patch: { current_exercise: value },
    };
  }

  if (step === INTAKE_STEPS.GOAL_AND_PURPOSE) {
    return {
      ok: true,
      nextStep: INTAKE_STEPS.DESIRED_FUTURE,
      patch: { goal_and_purpose: value },
    };
  }

  if (step === INTAKE_STEPS.DESIRED_FUTURE) {
    return {
      ok: true,
      nextStep: INTAKE_STEPS.BARRIERS,
      patch: { desired_future: value },
    };
  }

  if (step === INTAKE_STEPS.BARRIERS) {
    return {
      ok: true,
      nextStep: INTAKE_STEPS.CONFIRM_FINISH,
      patch: { barriers: value },
    };
  }

  return {
    ok: false,
    nextStep: step,
    patch: {},
  };
}

function buildIntakeProfilePatch(answers) {
  const a = answers || {};

  return {
    ai_type: normalizeAiTypeInput(a.ai_type, AI_TYPE_VALUES.SOFT),
  };
}

function buildIntakeProfileSummary(answers) {
  const a = answers || {};
  const aiType = normalizeAiTypeInput(a.ai_type, AI_TYPE_VALUES.SOFT);

  return {
    conversation_style: getAiTypeLabel(aiType),
    encouragement_style: getAiTypeLabel(aiType),
    current_condition: safeText(a.current_condition),
    exercise_history: safeText(a.exercise_history),
    current_exercise: safeText(a.current_exercise),
    goal_and_purpose: safeText(a.goal_and_purpose),
    desired_future: safeText(a.desired_future),
    current_barriers: safeText(a.barriers),
  };
}

function findPanelDateFromInput(openLabDraft, text) {
  const value = safeText(text);
  if (!value) return '';

  const candidates = Object.keys(openLabDraft?.working_data_json || {});
  if (!candidates.length) return '';

  const normalized = value.replace(/[年/.]/g, '-').replace(/月/g, '-').replace(/日/g, '').trim();

  const exact = candidates.find((date) => date === normalized);
  if (exact) return exact;

  const loose = candidates.find((date) => value.includes(date));
  return loose || '';
}

function mapCorrectionLabelToField(text) {
  const t = normalizeLoose(text);

  const pairs = [
    ['hba1c', ['hba1c', 'ヘモグロビンa1c', 'エイチビーエーワンシー']],
    ['fasting_glucose', ['空腹時血糖', '血糖', 'グルコース']],
    ['ldl', ['ldl', '悪玉コレステロール']],
    ['hdl', ['hdl', '善玉コレステロール']],
    ['triglycerides', ['中性脂肪', 'tg', 'トリグリセライド']],
    ['ast', ['ast', 'got']],
    ['alt', ['alt', 'gpt']],
    ['ggt', ['γgtp', 'γ-gtp', 'ggt', 'ガンマ']],
    ['uric_acid', ['尿酸']],
    ['creatinine', ['クレアチニン']],
    ['measured_at', ['日付', '測定日', '検査日']],
  ];

  for (const [field, labels] of pairs) {
    if (labels.some((label) => t.includes(normalizeLoose(label)))) {
      return field;
    }
  }

  return '';
}

function buildLabDraftSummaryMessage(session) {
  const selectedDate = safeText(session?.selected_date);
  const working = session?.working_data_json || {};
  const date = selectedDate || Object.keys(working).sort().pop() || '';
  const data = working[date] || {};

  const lines = [
    '読み取った内容です。',
    date ? `日付: ${date}` : null,
    data.hba1c != null ? `HbA1c: ${data.hba1c}` : null,
    data.fasting_glucose != null ? `空腹時血糖: ${data.fasting_glucose}` : null,
    data.ldl != null ? `LDL: ${data.ldl}` : null,
    data.hdl != null ? `HDL: ${data.hdl}` : null,
    data.triglycerides != null ? `中性脂肪: ${data.triglycerides}` : null,
    data.ast != null ? `AST: ${data.ast}` : null,
    data.alt != null ? `ALT: ${data.alt}` : null,
    data.ggt != null ? `γ-GTP: ${data.ggt}` : null,
    data.uric_acid != null ? `尿酸: ${data.uric_acid}` : null,
    data.creatinine != null ? `クレアチニン: ${data.creatinine}` : null,
  ].filter(Boolean);

  return {
    text: lines.join('\n'),
    quickReplies: buildQuickReplies([
      'この内容で保存',
      '日付を修正',
      'HbA1cを修正',
      'LDLを修正',
      '中性脂肪を修正',
      '全部保存',
    ]),
  };
}

function buildLabDateChoiceMessage(session) {
  const dates = Object.keys(session?.working_data_json || {}).sort();

  return {
    text: [
      '複数の日付を読み取りました。',
      '保存したい日付を送ってください。',
      ...dates.map((d) => `・${d}`),
    ].join('\n'),
    quickReplies: buildQuickReplies(dates.slice(0, 6)),
  };
}

function buildLabCorrectionGuide(field) {
  const label = LAB_FIELD_LABELS[field] || '項目';
  return `${label}の修正値を送ってください。`;
}

module.exports = {
  createEmptyIntakeAnswers,
  renderIntakeStepMessage,
  validateIntakeAnswer,
  buildIntakeProfilePatch,
  buildIntakeProfileSummary,
  findPanelDateFromInput,
  mapCorrectionLabelToField,
  buildLabDraftSummaryMessage,
  buildLabDateChoiceMessage,
  buildLabCorrectionGuide,
};
