'use strict';

const {
  ONBOARDING_STEPS,
  ONBOARDING_MESSAGES,
  GOAL_TYPE_OPTIONS,
  GOAL_PERIOD_OPTIONS,
  CONCERN_OPTIONS,
  LIFESTYLE_OPTIONS,
  PAIN_RISK_OPTIONS,
  TONE_OPTIONS,
  buildProfileConfirmMessage,
} = require('../config/onboarding_messages');

function createEmptyProfile() {
  return {
    name: null,
    age: null,
    height_cm: null,
    weight_kg: null,
    body_fat_percent: null,
    goal_type: null,
    goal_weight_kg: null,
    goal_body_fat_percent: null,
    goal_period: null,
    main_concern: null,
    lifestyle: null,
    pain_or_risk: null,
    note: null,
    tone: null,
  };
}

function safeJsonParse(text, fallback) {
  try {
    return JSON.parse(text);
  } catch (_err) {
    return fallback;
  }
}

function normalizeText(text) {
  return String(text || '').trim();
}

function createInitialOnboardingState() {
  return {
    current_flow: 'onboarding',
    current_step: ONBOARDING_STEPS.WELCOME,
    onboarding_status: 'in_progress',
    trial_status: 'not_started',
    profile_data: createEmptyProfile(),
    edit_target: null,
    started_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };
}

function normalizeUserState(user) {
  const raw = user?.onboarding_state_json;
  const parsed = typeof raw === 'string'
    ? safeJsonParse(raw, null)
    : raw && typeof raw === 'object'
      ? raw
      : null;

  if (!parsed || typeof parsed !== 'object') {
    return createInitialOnboardingState();
  }

  return {
    current_flow: parsed.current_flow || 'onboarding',
    current_step: parsed.current_step || ONBOARDING_STEPS.WELCOME,
    onboarding_status: parsed.onboarding_status || 'in_progress',
    trial_status: parsed.trial_status || 'not_started',
    profile_data: {
      ...createEmptyProfile(),
      ...(parsed.profile_data || {}),
    },
    edit_target: parsed.edit_target || null,
    started_at: parsed.started_at || new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };
}

function isOnboardingActive(user) {
  const state = normalizeUserState(user);
  return state.onboarding_status !== 'completed' && state.current_flow === 'onboarding';
}

function isTrialActive(user) {
  const state = normalizeUserState(user);
  return state.current_flow === 'trial' && state.trial_status === 'active';
}

function buildQuickReplyPayload(labels = []) {
  return labels.map((label) => ({
    type: 'action',
    action: {
      type: 'message',
      label,
      text: label,
    },
  }));
}

function buildEditSelectMessage() {
  return {
    text: `変更したい項目を選んでください🌿
下の候補を押すか、そのまま文字で送ってください。
例: 目標体重 / 話し方 / 体重`,
    quickReplies: [
      '名前',
      '年齢',
      '身長',
      '体重',
      '体脂肪率',
      '目標',
      '目標体重',
      '目標体脂肪率',
      '目標時期',
      '悩み',
      '生活',
      '不安',
      '話し方',
    ],
  };
}

function buildStepMessage(step, profile) {
  if (step === ONBOARDING_STEPS.CONFIRM) {
    return {
      text: buildProfileConfirmMessage(profile),
      quickReplies: ['この内容で保存', '修正する', '最初からやり直す'],
    };
  }

  if (step === ONBOARDING_STEPS.EDIT_SELECT) {
    return buildEditSelectMessage();
  }

  return ONBOARDING_MESSAGES[step] || {
    text: 'もう一度お試しください。',
    quickReplies: [],
  };
}

function optionLabelToValue(options, label) {
  const found = options.find((item) => item.label === label);
  return found ? found.value : null;
}

function normalizeName(text) {
  const v = normalizeText(text);
  if (!v) {
    return { ok: false, errorMessage: 'お名前を入力してください。' };
  }
  return { ok: true, value: v.slice(0, 40) };
}

function normalizeInteger(text, { min, max, name }) {
  const cleaned = normalizeText(text).replace(/[^\d]/g, '');
  if (!cleaned) {
    return { ok: false, errorMessage: `${name}を数字で入力してください。` };
  }

  const n = Number(cleaned);
  if (!Number.isFinite(n) || n < min || n > max) {
    return { ok: false, errorMessage: `${name}は${min}〜${max}の範囲で入力してください。` };
  }

  return { ok: true, value: n };
}

function normalizeFloat(text, { min, max, name }) {
  const cleaned = normalizeText(text).replace(/[^\d.]/g, '');
  if (!cleaned) {
    return { ok: false, errorMessage: `${name}を数字で入力してください。` };
  }

  const n = Number(cleaned);
  if (!Number.isFinite(n) || n < min || n > max) {
    return { ok: false, errorMessage: `${name}は${min}〜${max}の範囲で入力してください。` };
  }

  return { ok: true, value: Math.round(n * 10) / 10 };
}

function normalizeAge(text) {
  return normalizeInteger(text, { min: 10, max: 120, name: '年齢' });
}

function normalizeHeight(text) {
  return normalizeInteger(text, { min: 100, max: 220, name: '身長' });
}

function normalizeWeight(text) {
  return normalizeFloat(text, { min: 20, max: 250, name: '体重' });
}

function normalizeBodyFat(text) {
  const v = normalizeText(text);
  if (v === '不明') {
    return { ok: true, value: null };
  }
  return normalizeFloat(v, { min: 1, max: 80, name: '体脂肪率' });
}

function normalizeGoalWeight(text) {
  const v = normalizeText(text);
  if (v === '相談したい') {
    return { ok: true, value: null };
  }
  return normalizeFloat(v, { min: 20, max: 250, name: '目標体重' });
}

function normalizeGoalBodyFat(text) {
  const v = normalizeText(text);
  if (v === '相談したい') {
    return { ok: true, value: null };
  }
  return normalizeFloat(v, { min: 1, max: 80, name: '目標体脂肪率' });
}

function normalizeByOptions(text, options, errorMessage) {
  const value = optionLabelToValue(options, normalizeText(text));
  if (!value) {
    return { ok: false, errorMessage };
  }
  return { ok: true, value };
}

function normalizeNote(text) {
  const v = normalizeText(text);
  if (!v || v === 'なし') {
    return { ok: true, value: 'なし' };
  }
  return { ok: true, value: v.slice(0, 300) };
}

const stepToFieldMap = {
  [ONBOARDING_STEPS.NAME]: 'name',
  [ONBOARDING_STEPS.AGE]: 'age',
  [ONBOARDING_STEPS.HEIGHT]: 'height_cm',
  [ONBOARDING_STEPS.WEIGHT]: 'weight_kg',
  [ONBOARDING_STEPS.BODY_FAT]: 'body_fat_percent',
  [ONBOARDING_STEPS.GOAL_TYPE]: 'goal_type',
  [ONBOARDING_STEPS.GOAL_WEIGHT]: 'goal_weight_kg',
  [ONBOARDING_STEPS.GOAL_BODY_FAT]: 'goal_body_fat_percent',
  [ONBOARDING_STEPS.GOAL_PERIOD]: 'goal_period',
  [ONBOARDING_STEPS.CONCERN]: 'main_concern',
  [ONBOARDING_STEPS.LIFESTYLE]: 'lifestyle',
  [ONBOARDING_STEPS.PAIN_RISK]: 'pain_or_risk',
  [ONBOARDING_STEPS.NOTE]: 'note',
  [ONBOARDING_STEPS.TONE]: 'tone',
};

const nextStepMap = {
  [ONBOARDING_STEPS.NAME]: ONBOARDING_STEPS.AGE,
  [ONBOARDING_STEPS.AGE]: ONBOARDING_STEPS.HEIGHT,
  [ONBOARDING_STEPS.HEIGHT]: ONBOARDING_STEPS.WEIGHT,
  [ONBOARDING_STEPS.WEIGHT]: ONBOARDING_STEPS.BODY_FAT,
  [ONBOARDING_STEPS.BODY_FAT]: ONBOARDING_STEPS.GOAL_TYPE,
  [ONBOARDING_STEPS.GOAL_TYPE]: ONBOARDING_STEPS.GOAL_WEIGHT,
  [ONBOARDING_STEPS.GOAL_WEIGHT]: ONBOARDING_STEPS.GOAL_BODY_FAT,
  [ONBOARDING_STEPS.GOAL_BODY_FAT]: ONBOARDING_STEPS.GOAL_PERIOD,
  [ONBOARDING_STEPS.GOAL_PERIOD]: ONBOARDING_STEPS.CONCERN,
  [ONBOARDING_STEPS.CONCERN]: ONBOARDING_STEPS.LIFESTYLE,
  [ONBOARDING_STEPS.LIFESTYLE]: ONBOARDING_STEPS.PAIN_RISK,
  [ONBOARDING_STEPS.PAIN_RISK]: ONBOARDING_STEPS.NOTE,
  [ONBOARDING_STEPS.NOTE]: ONBOARDING_STEPS.TONE,
  [ONBOARDING_STEPS.TONE]: ONBOARDING_STEPS.CONFIRM,
};

function normalizeInputByStep(step, text) {
  switch (step) {
    case ONBOARDING_STEPS.NAME:
      return normalizeName(text);
    case ONBOARDING_STEPS.AGE:
      return normalizeAge(text);
    case ONBOARDING_STEPS.HEIGHT:
      return normalizeHeight(text);
    case ONBOARDING_STEPS.WEIGHT:
      return normalizeWeight(text);
    case ONBOARDING_STEPS.BODY_FAT:
      return normalizeBodyFat(text);
    case ONBOARDING_STEPS.GOAL_TYPE:
      return normalizeByOptions(text, GOAL_TYPE_OPTIONS, '目標をボタンから選んでください。');
    case ONBOARDING_STEPS.GOAL_WEIGHT:
      return normalizeGoalWeight(text);
    case ONBOARDING_STEPS.GOAL_BODY_FAT:
      return normalizeGoalBodyFat(text);
    case ONBOARDING_STEPS.GOAL_PERIOD:
      return normalizeByOptions(text, GOAL_PERIOD_OPTIONS, '目標時期をボタンから選んでください。');
    case ONBOARDING_STEPS.CONCERN:
      return normalizeByOptions(text, CONCERN_OPTIONS, 'お悩みをボタンから選んでください。');
    case ONBOARDING_STEPS.LIFESTYLE:
      return normalizeByOptions(text, LIFESTYLE_OPTIONS, '生活スタイルをボタンから選んでください。');
    case ONBOARDING_STEPS.PAIN_RISK:
      return normalizeByOptions(text, PAIN_RISK_OPTIONS, '気になることをボタンから選んでください。');
    case ONBOARDING_STEPS.NOTE:
      return normalizeNote(text);
    case ONBOARDING_STEPS.TONE:
      return normalizeByOptions(text, TONE_OPTIONS, '話し方をボタンから選んでください。');
    default:
      return { ok: false, errorMessage: '入力を確認できませんでした。' };
  }
}

function completeOnboardingState(state) {
  return {
    ...state,
    onboarding_status: 'completed',
    trial_status: state.trial_status || 'active',
    current_flow: state.current_flow === 'onboarding' ? 'trial' : (state.current_flow || 'trial'),
    current_step: ONBOARDING_STEPS.SAVED,
    edit_target: null,
    updated_at: new Date().toISOString(),
  };
}

function resetProfileState(state) {
  return {
    ...state,
    current_flow: 'onboarding',
    onboarding_status: 'in_progress',
    trial_status: state.trial_status || 'active',
    profile_data: createEmptyProfile(),
    current_step: ONBOARDING_STEPS.NAME,
    edit_target: null,
    updated_at: new Date().toISOString(),
  };
}

function applyEditSelection(text) {
  const map = {
    名前: { step: ONBOARDING_STEPS.NAME, edit_target: 'name' },
    年齢: { step: ONBOARDING_STEPS.AGE, edit_target: 'age' },
    身長: { step: ONBOARDING_STEPS.HEIGHT, edit_target: 'height_cm' },
    体重: { step: ONBOARDING_STEPS.WEIGHT, edit_target: 'weight_kg' },
    体脂肪率: { step: ONBOARDING_STEPS.BODY_FAT, edit_target: 'body_fat_percent' },
    目標: { step: ONBOARDING_STEPS.GOAL_TYPE, edit_target: 'goal_type' },
    目標体重: { step: ONBOARDING_STEPS.GOAL_WEIGHT, edit_target: 'goal_weight_kg' },
    目標体脂肪率: { step: ONBOARDING_STEPS.GOAL_BODY_FAT, edit_target: 'goal_body_fat_percent' },
    目標時期: { step: ONBOARDING_STEPS.GOAL_PERIOD, edit_target: 'goal_period' },
    悩み: { step: ONBOARDING_STEPS.CONCERN, edit_target: 'main_concern' },
    生活: { step: ONBOARDING_STEPS.LIFESTYLE, edit_target: 'lifestyle' },
    不安: { step: ONBOARDING_STEPS.PAIN_RISK, edit_target: 'pain_or_risk' },
    話し方: { step: ONBOARDING_STEPS.TONE, edit_target: 'tone' },
  };

  return map[normalizeText(text)] || null;
}

function handleCommand(state, text) {
  const step = state.current_step;
  const command = normalizeText(text);

  if (step === ONBOARDING_STEPS.WELCOME) {
    if (command === 'はじめる') return { ok: true, state: { ...state, current_step: ONBOARDING_STEPS.TRIAL_INFO, updated_at: new Date().toISOString() } };
    if (command === '内容を見る') return { ok: true, state: { ...state, current_step: ONBOARDING_STEPS.SERVICE_INFO, updated_at: new Date().toISOString() } };
    if (command === 'あとで見る') return {
      ok: true,
      state: {
        ...state,
        onboarding_status: 'completed',
        current_flow: null,
        current_step: ONBOARDING_STEPS.WELCOME_END,
        updated_at: new Date().toISOString(),
      },
    };
  }

  if (step === ONBOARDING_STEPS.SERVICE_INFO) {
    if (command === '無料体験へ') return { ok: true, state: { ...state, current_step: ONBOARDING_STEPS.TRIAL_INFO, updated_at: new Date().toISOString() } };
    if (command === '戻る') return { ok: true, state: { ...state, current_step: ONBOARDING_STEPS.WELCOME, updated_at: new Date().toISOString() } };
  }

  if (step === ONBOARDING_STEPS.TRIAL_INFO) {
    if (command === '無料体験を始める') return { ok: true, state: { ...state, current_step: ONBOARDING_STEPS.NAME, updated_at: new Date().toISOString() } };
    if (command === '内容を見る') return { ok: true, state: { ...state, current_step: ONBOARDING_STEPS.TRIAL_DETAIL, updated_at: new Date().toISOString() } };
    if (command === '今回はやめる') {
      return {
        ok: true,
        state: {
          ...state,
          onboarding_status: 'completed',
          current_flow: null,
          current_step: ONBOARDING_STEPS.TRIAL_DECLINED,
          updated_at: new Date().toISOString(),
        },
      };
    }
  }

  if (step === ONBOARDING_STEPS.TRIAL_DETAIL) {
    if (command === '無料体験を始める') return { ok: true, state: { ...state, current_step: ONBOARDING_STEPS.NAME, updated_at: new Date().toISOString() } };
    if (command === 'あとで見る') {
      return {
        ok: true,
        state: {
          ...state,
          onboarding_status: 'completed',
          current_flow: null,
          current_step: ONBOARDING_STEPS.WELCOME_END,
          updated_at: new Date().toISOString(),
        },
      };
    }
  }

  if (step === ONBOARDING_STEPS.BODY_FAT && command === '不明') {
    const nextState = {
      ...state,
      profile_data: {
        ...state.profile_data,
        body_fat_percent: null,
      },
      current_step: state.edit_target ? ONBOARDING_STEPS.CONFIRM : ONBOARDING_STEPS.GOAL_TYPE,
      edit_target: state.edit_target ? null : state.edit_target,
      updated_at: new Date().toISOString(),
    };
    return { ok: true, state: nextState };
  }

  if (step === ONBOARDING_STEPS.GOAL_WEIGHT && command === '相談したい') {
    const nextState = {
      ...state,
      profile_data: {
        ...state.profile_data,
        goal_weight_kg: null,
      },
      current_step: state.edit_target ? ONBOARDING_STEPS.CONFIRM : ONBOARDING_STEPS.GOAL_BODY_FAT,
      edit_target: state.edit_target ? null : state.edit_target,
      updated_at: new Date().toISOString(),
    };
    return { ok: true, state: nextState };
  }

  if (step === ONBOARDING_STEPS.GOAL_BODY_FAT && command === '相談したい') {
    const nextState = {
      ...state,
      profile_data: {
        ...state.profile_data,
        goal_body_fat_percent: null,
      },
      current_step: state.edit_target ? ONBOARDING_STEPS.CONFIRM : ONBOARDING_STEPS.GOAL_PERIOD,
      edit_target: state.edit_target ? null : state.edit_target,
      updated_at: new Date().toISOString(),
    };
    return { ok: true, state: nextState };
  }

  if (step === ONBOARDING_STEPS.NOTE && command === 'なし') {
    const nextState = {
      ...state,
      profile_data: {
        ...state.profile_data,
        note: 'なし',
      },
      current_step: state.edit_target ? ONBOARDING_STEPS.CONFIRM : ONBOARDING_STEPS.TONE,
      edit_target: state.edit_target ? null : state.edit_target,
      updated_at: new Date().toISOString(),
    };
    return { ok: true, state: nextState };
  }

  if (step === ONBOARDING_STEPS.CONFIRM) {
    if (command === 'この内容で保存') {
      return { ok: true, state: completeOnboardingState(state) };
    }
    if (command === '修正する') {
      return {
        ok: true,
        state: {
          ...state,
          current_step: ONBOARDING_STEPS.EDIT_SELECT,
          edit_target: null,
          updated_at: new Date().toISOString(),
        },
      };
    }
    if (command === '最初からやり直す') {
      return { ok: true, state: resetProfileState(state) };
    }
  }

  if (step === ONBOARDING_STEPS.EDIT_SELECT) {
    const edit = applyEditSelection(command);
    if (edit) {
      return {
        ok: true,
        state: {
          ...state,
          current_step: edit.step,
          edit_target: edit.edit_target,
          updated_at: new Date().toISOString(),
        },
      };
    }
    return { ok: false, errorMessage: '変更したい項目をボタンから選ぶか、そのまま文字で送ってください。' };
  }

  return { ok: false, errorMessage: null };
}

function handleInput(state, text) {
  const step = state.current_step;
  const field = stepToFieldMap[step];

  if (!field) {
    return { ok: false, errorMessage: 'もう一度お試しください。' };
  }

  const normalized = normalizeInputByStep(step, text);
  if (!normalized.ok) {
    return normalized;
  }

  const nextState = {
    ...state,
    profile_data: {
      ...state.profile_data,
      [field]: normalized.value,
    },
    updated_at: new Date().toISOString(),
  };

  if (state.edit_target) {
    nextState.current_step = ONBOARDING_STEPS.CONFIRM;
    nextState.edit_target = null;
  } else {
    nextState.current_step = nextStepMap[step] || ONBOARDING_STEPS.CONFIRM;
  }

  return { ok: true, state: nextState };
}

function buildReplyPayload(state) {
  const step = state.current_step;
  const { text, quickReplies } = buildStepMessage(step, state.profile_data);

  return {
    text,
    quickReplies,
    quickReplyItems: buildQuickReplyPayload(quickReplies),
  };
}

function advanceOnboardingState(user, text) {
  const state = normalizeUserState(user);

  const commandResult = handleCommand(state, text);
  if (commandResult.ok) return commandResult;
  if (commandResult.errorMessage) return commandResult;

  if (
    state.current_step === ONBOARDING_STEPS.WELCOME_END ||
    state.current_step === ONBOARDING_STEPS.TRIAL_DECLINED ||
    state.current_step === ONBOARDING_STEPS.SAVED
  ) {
    return { ok: false, errorMessage: null, state };
  }

  return handleInput(state, text);
}

function buildOnboardingStatePatch(state) {
  const normalizedState = {
    current_flow: state.current_flow ?? null,
    current_step: state.current_step || ONBOARDING_STEPS.WELCOME,
    onboarding_status: state.onboarding_status || 'in_progress',
    trial_status: state.trial_status || 'not_started',
    profile_data: {
      ...createEmptyProfile(),
      ...(state.profile_data || {}),
    },
    edit_target: state.edit_target || null,
    started_at: state.started_at || new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };

  return {
    onboarding_state_json: JSON.stringify(normalizedState),
    onboarding_status: normalizedState.onboarding_status,
    trial_status: normalizedState.trial_status,
    current_flow: normalizedState.current_flow,
    current_step: normalizedState.current_step,
  };
}

function buildStateFromCompletedUser(user = {}) {
  const savedState = normalizeUserState(user);

  return {
    current_flow: 'onboarding',
    current_step: ONBOARDING_STEPS.CONFIRM,
    onboarding_status: 'in_progress',
    trial_status: user?.trial_status || savedState.trial_status || 'active',
    profile_data: {
      ...createEmptyProfile(),
      ...(savedState.profile_data || {}),
      name: user?.display_name ?? savedState.profile_data?.name ?? null,
      age: user?.age ?? savedState.profile_data?.age ?? null,
      height_cm: user?.height_cm ?? savedState.profile_data?.height_cm ?? null,
      weight_kg: user?.weight_kg ?? savedState.profile_data?.weight_kg ?? null,
      body_fat_percent: user?.body_fat_percent ?? savedState.profile_data?.body_fat_percent ?? null,
      goal_type: user?.goal_type ?? savedState.profile_data?.goal_type ?? null,
      goal_weight_kg: user?.goal_weight_kg ?? user?.target_weight_kg ?? savedState.profile_data?.goal_weight_kg ?? null,
      goal_body_fat_percent: user?.goal_body_fat_percent ?? savedState.profile_data?.goal_body_fat_percent ?? null,
      goal_period: user?.goal_period ?? savedState.profile_data?.goal_period ?? null,
      main_concern: user?.main_concern ?? savedState.profile_data?.main_concern ?? null,
      lifestyle: user?.lifestyle ?? savedState.profile_data?.lifestyle ?? null,
      pain_or_risk: user?.pain_or_risk ?? savedState.profile_data?.pain_or_risk ?? null,
      note: user?.note ?? savedState.profile_data?.note ?? null,
      tone: user?.ai_type ?? savedState.profile_data?.tone ?? null,
    },
    edit_target: null,
    started_at: savedState.started_at || new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };
}

function startProfileEditFromUser(user, mode = 'confirm') {
  const base = buildStateFromCompletedUser(user);

  if (mode === 'reset') {
    return {
      ...resetProfileState(base),
      current_flow: 'onboarding',
      onboarding_status: 'in_progress',
      trial_status: base.trial_status || 'active',
    };
  }

  if (mode === 'edit') {
    return {
      ...base,
      current_flow: 'onboarding',
      onboarding_status: 'in_progress',
      current_step: ONBOARDING_STEPS.EDIT_SELECT,
      edit_target: null,
      updated_at: new Date().toISOString(),
    };
  }

  return {
    ...base,
    current_flow: 'onboarding',
    onboarding_status: 'in_progress',
    current_step: ONBOARDING_STEPS.CONFIRM,
    edit_target: null,
    updated_at: new Date().toISOString(),
  };
}

module.exports = {
  ONBOARDING_STEPS,
  createInitialOnboardingState,
  createEmptyProfile,
  normalizeUserState,
  isOnboardingActive,
  isTrialActive,
  buildReplyPayload,
  advanceOnboardingState,
  buildOnboardingStatePatch,
  startProfileEditFromUser,
};
