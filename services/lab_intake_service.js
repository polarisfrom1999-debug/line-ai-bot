'use strict';

function pad2(v) {
  return String(v).padStart(2, '0');
}

function normalizeDateString(value) {
  if (!value) return '';
  const s = String(value).trim()
    .replace(/[年/.]/g, '-')
    .replace(/月/g, '-')
    .replace(/日/g, '')
    .replace(/\s+/g, '');

  const m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (m) {
    return `${m[1]}-${pad2(m[2])}-${pad2(m[3])}`;
  }

  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return '';
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

function normalizeNumber(value) {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;

  const m = String(value).replace(/,/g, '').match(/-?\d+(?:\.\d+)?/);
  if (!m) return null;

  const num = Number(m[0]);
  return Number.isFinite(num) ? num : null;
}

function labelForField(field) {
  const map = {
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
    date: '日付',
  };
  return map[field] || field;
}

function buildPanelLines(items) {
  const defs = [
    ['hba1c', 'HbA1c'],
    ['fasting_glucose', '空腹時血糖'],
    ['ldl', 'LDL'],
    ['hdl', 'HDL'],
    ['triglycerides', '中性脂肪'],
    ['ast', 'AST'],
    ['alt', 'ALT'],
    ['ggt', 'γ-GTP'],
    ['uric_acid', '尿酸'],
    ['creatinine', 'クレアチニン'],
  ];

  return defs
    .map(([key, label]) => {
      const value = normalizeNumber(items?.[key]);
      return value === null ? null : `・${label}: ${value}`;
    })
    .filter(Boolean);
}

function buildDateQuickReplies(dates) {
  const list = Array.isArray(dates) ? dates.slice(0, 10) : [];
  return [...list, '読み取れた日付を全部保存'];
}

function findPanelDateFromInput(openLabDraft, text) {
  const normalized = normalizeDateString(text);
  if (!normalized) return null;

  const keys = Object.keys(openLabDraft?.working_data_json || {}).map(normalizeDateString);
  return keys.includes(normalized) ? normalized : null;
}

function mapCorrectionLabelToField(text) {
  const t = String(text || '').trim();

  const mappings = [
    ['日付を修正', 'date'],
    ['日付', 'date'],
    ['HbA1cを修正', 'hba1c'],
    ['HbA1c', 'hba1c'],
    ['血糖を修正', 'fasting_glucose'],
    ['空腹時血糖を修正', 'fasting_glucose'],
    ['空腹時血糖', 'fasting_glucose'],
    ['LDLを修正', 'ldl'],
    ['LDL', 'ldl'],
    ['HDLを修正', 'hdl'],
    ['HDL', 'hdl'],
    ['中性脂肪を修正', 'triglycerides'],
    ['中性脂肪', 'triglycerides'],
    ['ASTを修正', 'ast'],
    ['AST', 'ast'],
    ['ALTを修正', 'alt'],
    ['ALT', 'alt'],
    ['γ-GTPを修正', 'ggt'],
    ['GGTを修正', 'ggt'],
    ['γ-GTP', 'ggt'],
    ['GGT', 'ggt'],
    ['尿酸を修正', 'uric_acid'],
    ['尿酸', 'uric_acid'],
    ['クレアチニンを修正', 'creatinine'],
    ['クレアチニン', 'creatinine'],
  ];

  const hit = mappings.find(([label]) => t === label);
  return hit ? hit[1] : null;
}

function buildLabDraftSummaryMessage(session) {
  const workingData = session?.working_data_json || {};
  const dates = Object.keys(workingData).map(normalizeDateString).filter(Boolean).sort();

  if (!dates.length) {
    return {
      text: '血液検査の読み取り結果が見つかりませんでした。',
      quickReplies: [],
    };
  }

  const selectedDate = normalizeDateString(session?.selected_date) || dates[dates.length - 1];
  const items = workingData[selectedDate] || {};
  const lines = buildPanelLines(items);

  const text = [
    '血液検査の読み取り結果です。',
    `対象日: ${selectedDate}`,
    '',
    ...(lines.length ? lines : ['読めた項目がまだ少ないようです。必要なら修正してください。']),
    '',
    '保存してよければ「この内容で保存」、複数日をまとめて保存するなら「読み取れた日付を全部保存」です。',
    '修正したい場合は項目名を押してください。',
  ].join('\n');

  const quickReplies = [
    'この内容で保存',
    ...(dates.length > 1 ? ['読み取れた日付を全部保存'] : []),
    'HbA1c',
    '空腹時血糖',
    'LDL',
    'HDL',
    '中性脂肪',
    'AST',
    'ALT',
    'γ-GTP',
    '尿酸',
    'クレアチニン',
    '日付',
  ];

  return { text, quickReplies };
}

function buildLabDateChoiceMessage(session) {
  const workingData = session?.working_data_json || {};
  const dates = Object.keys(workingData).map(normalizeDateString).filter(Boolean).sort();

  return {
    text: [
      '複数の日付を読み取りました。',
      ...dates.map((d) => `・${d}`),
      '',
      '1日分を確認するなら日付をそのまま送ってください。',
      '全部まとめて保存するなら「読み取れた日付を全部保存」と送ってください。',
    ].join('\n'),
    quickReplies: buildDateQuickReplies(dates),
  };
}

function buildLabCorrectionGuide(field) {
  const label = labelForField(field);
  if (field === 'date') {
    return `${label}を修正します。YYYY/MM/DD の形で送ってください。例: 2025/03/12`;
  }
  return `${label}を修正します。数値だけ送ってください。例: 138`;
}

function createEmptyIntakeAnswers() {
  return {
    ai_type: null,
    age: null,
    sex: null,
    height_cm: null,
    weight_kg: null,
    target_weight_kg: null,
    activity_level: null,
    goal_text: '',
    current_barriers: '',
  };
}

function renderIntakeStepMessage(session) {
  const step = session?.current_step || 'choose_ai_type';
  const answers = session?.answers_json || createEmptyIntakeAnswers();

  if (step === 'choose_ai_type') {
    return {
      text: '最初に、AI牛込の話し方を選んでください。',
      quickReplies: ['やさしい', '前向き', '分析型', '親しみやすい'],
    };
  }

  if (step === 'age') {
    return {
      text: '年齢を教えてください。例: 55',
      quickReplies: [],
    };
  }

  if (step === 'sex') {
    return {
      text: '性別を教えてください。',
      quickReplies: ['女性', '男性', 'その他'],
    };
  }

  if (step === 'height_cm') {
    return {
      text: '身長を教えてください。例: 160',
      quickReplies: [],
    };
  }

  if (step === 'weight_kg') {
    return {
      text: '現在の体重を教えてください。例: 63',
      quickReplies: [],
    };
  }

  if (step === 'target_weight_kg') {
    return {
      text: '目標体重を教えてください。例: 58',
      quickReplies: [],
    };
  }

  if (step === 'activity_level') {
    return {
      text: '普段の活動量に近いものを選んでください。',
      quickReplies: ['低い', 'ふつう', '高い'],
    };
  }

  if (step === 'goal_text') {
    return {
      text: 'どんな未来を目指したいですか？自由に教えてください。',
      quickReplies: [],
    };
  }

  if (step === 'current_barriers') {
    return {
      text: '今うまくいきにくい理由や悩みがあれば教えてください。',
      quickReplies: ['食事が乱れやすい', '運動が続かない', '疲れやすい', '特になし'],
    };
  }

  if (step === 'confirm_finish') {
    const text = [
      '初回設定の確認です。',
      `・話し方: ${answers.ai_type || '未設定'}`,
      `・年齢: ${answers.age || '未設定'}`,
      `・性別: ${answers.sex || '未設定'}`,
      `・身長: ${answers.height_cm || '未設定'} cm`,
      `・体重: ${answers.weight_kg || '未設定'} kg`,
      `・目標体重: ${answers.target_weight_kg || '未設定'} kg`,
      `・活動量: ${answers.activity_level || '未設定'}`,
      `・目標: ${answers.goal_text || '未入力'}`,
      `・悩み: ${answers.current_barriers || '未入力'}`,
      '',
      'これでよければ「この内容で完了」を押してください。',
    ].join('\n');

    return {
      text,
      quickReplies: ['この内容で完了', '最初からやり直す'],
    };
  }

  return {
    text: '初回設定を続けます。',
    quickReplies: [],
  };
}

function validateIntakeAnswer(step, text) {
  const t = String(text || '').trim();

  if (step === 'choose_ai_type') {
    const map = {
      'やさしい': 'gentle',
      '前向き': 'energetic',
      '分析型': 'analytical',
      '親しみやすい': 'casual',
    };
    const v = map[t];
    if (!v) return { ok: false };
    return { ok: true, nextStep: 'age', patch: { ai_type: v } };
  }

  if (step === 'age') {
    const v = normalizeNumber(t);
    if (v === null) return { ok: false };
    return { ok: true, nextStep: 'sex', patch: { age: Math.round(v) } };
  }

  if (step === 'sex') {
    if (!['女性', '男性', 'その他'].includes(t)) return { ok: false };
    return { ok: true, nextStep: 'height_cm', patch: { sex: t } };
  }

  if (step === 'height_cm') {
    const v = normalizeNumber(t);
    if (v === null) return { ok: false };
    return { ok: true, nextStep: 'weight_kg', patch: { height_cm: v } };
  }

  if (step === 'weight_kg') {
    const v = normalizeNumber(t);
    if (v === null) return { ok: false };
    return { ok: true, nextStep: 'target_weight_kg', patch: { weight_kg: v } };
  }

  if (step === 'target_weight_kg') {
    const v = normalizeNumber(t);
    if (v === null) return { ok: false };
    return { ok: true, nextStep: 'activity_level', patch: { target_weight_kg: v } };
  }

  if (step === 'activity_level') {
    if (!['低い', 'ふつう', '高い'].includes(t)) return { ok: false };
    return { ok: true, nextStep: 'goal_text', patch: { activity_level: t } };
  }

  if (step === 'goal_text') {
    if (!t) return { ok: false };
    return { ok: true, nextStep: 'current_barriers', patch: { goal_text: t } };
  }

  if (step === 'current_barriers') {
    return { ok: true, nextStep: 'confirm_finish', patch: { current_barriers: t || '特になし' } };
  }

  return { ok: false };
}

function mapAiTypeToStoredValue(aiType) {
  const map = {
    gentle: 'gentle',
    energetic: 'energetic',
    analytical: 'analytical',
    casual: 'casual',
  };
  return map[aiType] || 'gentle';
}

function mapActivityLevelToStoredValue(level) {
  const map = {
    '低い': 'low',
    'ふつう': 'moderate',
    '高い': 'high',
  };
  return map[level] || 'moderate';
}

function mapSexToStoredValue(sex) {
  const map = {
    '女性': 'female',
    '男性': 'male',
    'その他': 'other',
    female: 'female',
    male: 'male',
    other: 'other',
  };
  return map[sex] || null;
}

function buildIntakeProfilePatch(answers) {
  return {
    ai_type: mapAiTypeToStoredValue(answers?.ai_type),
    age: answers?.age ?? null,
    sex: mapSexToStoredValue(answers?.sex),
    height_cm: answers?.height_cm ?? null,
    weight_kg: answers?.weight_kg ?? null,
    target_weight_kg: answers?.target_weight_kg ?? null,
    activity_level: mapActivityLevelToStoredValue(answers?.activity_level),
  };
}

function buildIntakeProfileSummary(answers) {
  const conversationStyleMap = {
    gentle: 'やさしく安心感のある対話',
    energetic: '明るく背中を押す対話',
    analytical: '理由を整理して伝える対話',
    casual: '親しみやすい対話',
  };

  const encouragementStyleMap = {
    gentle: '安心型',
    energetic: '前向き型',
    analytical: '整理型',
    casual: '親近感型',
  };

  return {
    conversation_style: conversationStyleMap[answers?.ai_type] || 'やさしく安心感のある対話',
    encouragement_style: encouragementStyleMap[answers?.ai_type] || '安心型',
    current_barriers: answers?.current_barriers || '',
  };
}

module.exports = {
  findPanelDateFromInput,
  mapCorrectionLabelToField,
  buildLabDraftSummaryMessage,
  buildLabDateChoiceMessage,
  buildLabCorrectionGuide,
  createEmptyIntakeAnswers,
  renderIntakeStepMessage,
  validateIntakeAnswer,
  buildIntakeProfilePatch,
  buildIntakeProfileSummary,
};
