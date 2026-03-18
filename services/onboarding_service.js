'use strict';

const {
  AI_TYPE_VALUES,
  AI_TYPE_OPTIONS,
  getAiTypeLabel,
  normalizeAiTypeInput,
} = require('../config/ai_type_config');

const ONBOARDING_STEPS = {
  WELCOME: 'welcome',
  NAME: 'name',
  GENDER: 'gender',
  AGE: 'age',
  HEIGHT: 'height',
  WEIGHT: 'weight',
  GOAL_WEIGHT: 'goal_weight',
  GOAL_DATE: 'goal_date',
  AI_TYPE: 'ai_type',
  CONFIRM: 'confirm',
  EDIT_SELECT: 'edit_select',
  EDIT_PROMPT: 'edit_prompt',
  RESET_PROMPT: 'reset_prompt',
  DONE: 'done',
};

const EDITABLE_FIELDS = {
  display_name: 'お名前',
  gender: '性別',
  age: '年齢',
  height_cm: '身長',
  weight_kg: '体重',
  goal_weight_kg: '目標体重',
  goal_date_text: '目標時期',
  ai_type: '話し方',
};

function safeText(value, fallback = '') {
  return String(value || fallback).trim();
}

function safeNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function normalizeLoose(text) {
  return String(text || '')
    .trim()
    .toLowerCase()
    .replace(/[！!？?。.,，、]/g, '')
    .replace(/\s+/g, '');
}

function buildQuickReplies(items = []) {
  const cleaned = items
    .map((item) => safeText(item))
    .filter(Boolean)
    .slice(0, 8);

  return cleaned;
}

function parseJsonText(value, fallback = null) {
  if (!value) return fallback;
  if (typeof value === 'object') return value;
  try {
    return JSON.parse(value);
  } catch (_error) {
    return fallback;
  }
}

function createInitialOnboardingState(user = null) {
  return {
    current_flow: 'onboarding',
    onboarding_status: 'in_progress',
    current_step: ONBOARDING_STEPS.WELCOME,
    profile: {
      display_name: safeText(user?.display_name || ''),
      gender: safeText(user?.gender || ''),
      age: safeNumber(user?.age),
      height_cm: safeNumber(user?.height_cm),
      weight_kg: safeNumber(user?.weight_kg),
      goal_weight_kg: safeNumber(user?.goal_weight_kg),
      goal_date_text: safeText(user?.goal_date_text || ''),
      ai_type: normalizeAiTypeInput(user?.ai_type, AI_TYPE_VALUES.SOFT),
    },
    edit_target: null,
    last_input: '',
  };
}

function buildStateFromCompletedUser(user = {}) {
  return {
    current_flow: 'onboarding',
    onboarding_status: 'in_progress',
    current_step: ONBOARDING_STEPS.CONFIRM,
    profile: {
      display_name: safeText(user?.display_name || ''),
      gender: safeText(user?.gender || ''),
      age: safeNumber(user?.age),
      height_cm: safeNumber(user?.height_cm),
      weight_kg: safeNumber(user?.weight_kg),
      goal_weight_kg: safeNumber(user?.goal_weight_kg),
      goal_date_text: safeText(user?.goal_date_text || ''),
      ai_type: normalizeAiTypeInput(user?.ai_type, AI_TYPE_VALUES.SOFT),
    },
    edit_target: null,
    last_input: '',
  };
}

function resetProfileState(baseState = null) {
  const state = baseState || createInitialOnboardingState();
  return {
    ...state,
    current_step: ONBOARDING_STEPS.NAME,
    edit_target: null,
    profile: {
      display_name: '',
      gender: '',
      age: null,
      height_cm: null,
      weight_kg: null,
      goal_weight_kg: null,
      goal_date_text: '',
      ai_type: AI_TYPE_VALUES.SOFT,
    },
  };
}

function normalizeUserState(user) {
  const parsed = parseJsonText(user?.onboarding_state_json, null);

  if (!parsed || typeof parsed !== 'object') {
    return createInitialOnboardingState(user);
  }

  return {
    current_flow: parsed.current_flow || 'onboarding',
    onboarding_status: parsed.onboarding_status || user?.onboarding_status || 'in_progress',
    current_step: parsed.current_step || ONBOARDING_STEPS.WELCOME,
    profile: {
      display_name: safeText(parsed?.profile?.display_name || user?.display_name || ''),
      gender: safeText(parsed?.profile?.gender || user?.gender || ''),
      age: safeNumber(parsed?.profile?.age ?? user?.age),
      height_cm: safeNumber(parsed?.profile?.height_cm ?? user?.height_cm),
      weight_kg: safeNumber(parsed?.profile?.weight_kg ?? user?.weight_kg),
      goal_weight_kg: safeNumber(parsed?.profile?.goal_weight_kg ?? user?.goal_weight_kg),
      goal_date_text: safeText(parsed?.profile?.goal_date_text || user?.goal_date_text || ''),
      ai_type: normalizeAiTypeInput(parsed?.profile?.ai_type || user?.ai_type, AI_TYPE_VALUES.SOFT),
    },
    edit_target: parsed?.edit_target || null,
    last_input: safeText(parsed?.last_input || ''),
  };
}

function isOnboardingActive(user) {
  const status = safeText(user?.onboarding_status || '');
  if (status === 'in_progress') return true;

  const state = parseJsonText(user?.onboarding_state_json, null);
  if (!state || typeof state !== 'object') return false;

  return safeText(state.current_flow) === 'onboarding' && safeText(state.current_step) !== ONBOARDING_STEPS.DONE;
}

function buildProfileSummary(profile = {}) {
  return [
    `お名前: ${safeText(profile.display_name || '未設定')}`,
    `性別: ${safeText(profile.gender || '未設定')}`,
    `年齢: ${profile.age != null ? `${profile.age}歳` : '未設定'}`,
    `身長: ${profile.height_cm != null ? `${profile.height_cm}cm` : '未設定'}`,
    `体重: ${profile.weight_kg != null ? `${profile.weight_kg}kg` : '未設定'}`,
    `目標体重: ${profile.goal_weight_kg != null ? `${profile.goal_weight_kg}kg` : '未設定'}`,
    `目標時期: ${safeText(profile.goal_date_text || '未設定')}`,
    `話し方: ${getAiTypeLabel(profile.ai_type)}`,
  ].join('\n');
}

function buildReplyPayload(state) {
  const step = state?.current_step;

  if (step === ONBOARDING_STEPS.WELCOME) {
    return {
      text: [
        'ここから。の初回設定を始めます。',
        'まずはお名前を教えてください。',
        '例: 牛込',
      ].join('\n'),
      quickReplies: buildQuickReplies(['はじめる']),
    };
  }

  if (step === ONBOARDING_STEPS.NAME) {
    return {
      text: 'お名前を教えてください。\n例: 牛込',
      quickReplies: [],
    };
  }

  if (step === ONBOARDING_STEPS.GENDER) {
    return {
      text: '性別を教えてください。',
      quickReplies: buildQuickReplies(['女性', '男性', 'その他']),
    };
  }

  if (step === ONBOARDING_STEPS.AGE) {
    return {
      text: '年齢を教えてください。\n例: 55',
      quickReplies: [],
    };
  }

  if (step === ONBOARDING_STEPS.HEIGHT) {
    return {
      text: '身長を教えてください。\n例: 160',
      quickReplies: [],
    };
  }

  if (step === ONBOARDING_STEPS.WEIGHT) {
    return {
      text: '今の体重を教えてください。\n例: 63',
      quickReplies: [],
    };
  }

  if (step === ONBOARDING_STEPS.GOAL_WEIGHT) {
    return {
      text: '目標体重を教えてください。\n例: 58',
      quickReplies: [],
    };
  }

  if (step === ONBOARDING_STEPS.GOAL_DATE) {
    return {
      text: '目標時期を教えてください。\n例: 3か月後 / 6月末 / 夏まで',
      quickReplies: buildQuickReplies(['1か月後', '3か月後', '6か月後']),
    };
  }

  if (step === ONBOARDING_STEPS.AI_TYPE) {
    return {
      text: [
        '話し方のタイプを選んでください。',
        '・そっと寄り添う',
        '・明るく後押し',
        '・頼もしく導く',
        '・力強く支える',
      ].join('\n'),
      quickReplies: buildQuickReplies([
        'そっと寄り添う',
        '明るく後押し',
        '頼もしく導く',
        '力強く支える',
      ]),
    };
  }

  if (step === ONBOARDING_STEPS.CONFIRM) {
    return {
      text: [
        'この内容でよければ完了してください。',
        '',
        buildProfileSummary(state.profile),
      ].join('\n'),
      quickReplies: buildQuickReplies([
        'この内容で完了',
        'プロフィール変更',
        'プロフィール再設定',
      ]),
    };
  }

  if (step === ONBOARDING_STEPS.EDIT_SELECT) {
    return {
      text: '変更したい項目を選んでください。',
      quickReplies: buildQuickReplies([
        'お名前',
        '性別',
        '年齢',
        '身長',
        '体重',
        '目標体重',
        '目標時期',
        '話し方',
      ]),
    };
  }

  if (step === ONBOARDING_STEPS.EDIT_PROMPT) {
    const target = state?.edit_target;

    if (target === 'display_name') {
      return {
        text: '新しいお名前を教えてください。',
        quickReplies: [],
      };
    }

    if (target === 'gender') {
      return {
        text: '性別を教えてください。',
        quickReplies: buildQuickReplies(['女性', '男性', 'その他']),
      };
    }

    if (target === 'age') {
      return {
        text: '新しい年齢を教えてください。\n例: 55',
        quickReplies: [],
      };
    }

    if (target === 'height_cm') {
      return {
        text: '新しい身長を教えてください。\n例: 160',
        quickReplies: [],
      };
    }

    if (target === 'weight_kg') {
      return {
        text: '新しい体重を教えてください。\n例: 63',
        quickReplies: [],
      };
    }

    if (target === 'goal_weight_kg') {
      return {
        text: '新しい目標体重を教えてください。\n例: 58',
        quickReplies: [],
      };
    }

    if (target === 'goal_date_text') {
      return {
        text: '新しい目標時期を教えてください。\n例: 3か月後 / 6月末 / 夏まで',
        quickReplies: buildQuickReplies(['1か月後', '3か月後', '6か月後']),
      };
    }

    if (target === 'ai_type') {
      return {
        text: '新しい話し方タイプを選んでください。',
        quickReplies: buildQuickReplies([
          'そっと寄り添う',
          '明るく後押し',
          '頼もしく導く',
          '力強く支える',
        ]),
      };
    }

    return {
      text: '変更内容を教えてください。',
      quickReplies: [],
    };
  }

  if (step === ONBOARDING_STEPS.RESET_PROMPT) {
    return {
      text: 'プロフィールを最初から設定し直します。よければ「はい」と送ってください。',
      quickReplies: buildQuickReplies(['はい', 'やめる']),
    };
  }

  return {
    text: '設定を進めます。',
    quickReplies: [],
  };
}

function toEditTarget(text) {
  const t = normalizeLoose(text);

  if (t.includes(normalizeLoose('お名前')) || t.includes(normalizeLoose('名前'))) return 'display_name';
  if (t.includes(normalizeLoose('性別'))) return 'gender';
  if (t.includes(normalizeLoose('年齢'))) return 'age';
  if (t.includes(normalizeLoose('身長'))) return 'height_cm';
  if (t === normalizeLoose('体重')) return 'weight_kg';
  if (t.includes(normalizeLoose('目標体重'))) return 'goal_weight_kg';
  if (t.includes(normalizeLoose('目標時期')) || t.includes(normalizeLoose('目標期限'))) return 'goal_date_text';
  if (t.includes(normalizeLoose('話し方')) || t.includes(normalizeLoose('タイプ'))) return 'ai_type';

  return null;
}

function parseNumberField(text, min, max) {
  const m = String(text || '').match(/-?\d+(?:\.\d+)?/);
  if (!m) return null;

  const n = Number(m[0]);
  if (!Number.isFinite(n)) return null;
  if (n < min || n > max) return null;

  return n;
}

function nextStepFor(step) {
  if (step === ONBOARDING_STEPS.NAME) return ONBOARDING_STEPS.GENDER;
  if (step === ONBOARDING_STEPS.GENDER) return ONBOARDING_STEPS.AGE;
  if (step === ONBOARDING_STEPS.AGE) return ONBOARDING_STEPS.HEIGHT;
  if (step === ONBOARDING_STEPS.HEIGHT) return ONBOARDING_STEPS.WEIGHT;
  if (step === ONBOARDING_STEPS.WEIGHT) return ONBOARDING_STEPS.GOAL_WEIGHT;
  if (step === ONBOARDING_STEPS.GOAL_WEIGHT) return ONBOARDING_STEPS.GOAL_DATE;
  if (step === ONBOARDING_STEPS.GOAL_DATE) return ONBOARDING_STEPS.AI_TYPE;
  if (step === ONBOARDING_STEPS.AI_TYPE) return ONBOARDING_STEPS.CONFIRM;
  return ONBOARDING_STEPS.CONFIRM;
}

function applyStepAnswer(state, step, text) {
  const profile = { ...(state.profile || {}) };

  if (step === ONBOARDING_STEPS.NAME) {
    const value = safeText(text, '');
    if (!value) {
      return { ok: false, errorMessage: 'お名前をもう一度お願いします。' };
    }
    profile.display_name = value;
    return { ok: true, profile };
  }

  if (step === ONBOARDING_STEPS.GENDER) {
    const value = safeText(text, '');
    if (!value) {
      return { ok: false, errorMessage: '性別をもう一度お願いします。' };
    }
    profile.gender = value;
    return { ok: true, profile };
  }

  if (step === ONBOARDING_STEPS.AGE) {
    const value = parseNumberField(text, 1, 120);
    if (value == null) {
      return { ok: false, errorMessage: '年齢は数字でお願いします。例: 55' };
    }
    profile.age = value;
    return { ok: true, profile };
  }

  if (step === ONBOARDING_STEPS.HEIGHT) {
    const value = parseNumberField(text, 80, 250);
    if (value == null) {
      return { ok: false, errorMessage: '身長は数字でお願いします。例: 160' };
    }
    profile.height_cm = value;
    return { ok: true, profile };
  }

  if (step === ONBOARDING_STEPS.WEIGHT) {
    const value = parseNumberField(text, 20, 300);
    if (value == null) {
      return { ok: false, errorMessage: '体重は数字でお願いします。例: 63' };
    }
    profile.weight_kg = value;
    return { ok: true, profile };
  }

  if (step === ONBOARDING_STEPS.GOAL_WEIGHT) {
    const value = parseNumberField(text, 20, 300);
    if (value == null) {
      return { ok: false, errorMessage: '目標体重は数字でお願いします。例: 58' };
    }
    profile.goal_weight_kg = value;
    return { ok: true, profile };
  }

  if (step === ONBOARDING_STEPS.GOAL_DATE) {
    const value = safeText(text, '');
    if (!value) {
      return { ok: false, errorMessage: '目標時期をもう一度お願いします。例: 3か月後' };
    }
    profile.goal_date_text = value;
    return { ok: true, profile };
  }

  if (step === ONBOARDING_STEPS.AI_TYPE) {
    profile.ai_type = normalizeAiTypeInput(text, AI_TYPE_VALUES.SOFT);
    return { ok: true, profile };
  }

  return { ok: true, profile };
}

function advanceOnboardingState(user, text) {
  const state = normalizeUserState(user);
  const input = safeText(text, '');
  const step = state.current_step;

  if (step === ONBOARDING_STEPS.WELCOME) {
    const nextStep = input ? ONBOARDING_STEPS.NAME : ONBOARDING_STEPS.WELCOME;
    return {
      ok: true,
      state: {
        ...state,
        current_step: nextStep,
        last_input: input,
      },
    };
  }

  if (step === ONBOARDING_STEPS.RESET_PROMPT) {
    const t = normalizeLoose(input);
    if (t === normalizeLoose('はい')) {
      return {
        ok: true,
        state: resetProfileState(state),
      };
    }
    return {
      ok: true,
      state: {
        ...state,
        current_step: ONBOARDING_STEPS.CONFIRM,
        edit_target: null,
        last_input: input,
      },
    };
  }

  if (step === ONBOARDING_STEPS.EDIT_SELECT) {
    const editTarget = toEditTarget(input);
    if (!editTarget) {
      return {
        ok: false,
        errorMessage: '変更したい項目を選んでください。',
        state,
      };
    }

    return {
      ok: true,
      state: {
        ...state,
        current_step: ONBOARDING_STEPS.EDIT_PROMPT,
        edit_target: editTarget,
        last_input: input,
      },
    };
  }

  if (step === ONBOARDING_STEPS.EDIT_PROMPT) {
    const target = state.edit_target;
    if (!target) {
      return {
        ok: true,
        state: {
          ...state,
          current_step: ONBOARDING_STEPS.EDIT_SELECT,
          last_input: input,
        },
      };
    }

    let virtualStep = null;
    if (target === 'display_name') virtualStep = ONBOARDING_STEPS.NAME;
    if (target === 'gender') virtualStep = ONBOARDING_STEPS.GENDER;
    if (target === 'age') virtualStep = ONBOARDING_STEPS.AGE;
    if (target === 'height_cm') virtualStep = ONBOARDING_STEPS.HEIGHT;
    if (target === 'weight_kg') virtualStep = ONBOARDING_STEPS.WEIGHT;
    if (target === 'goal_weight_kg') virtualStep = ONBOARDING_STEPS.GOAL_WEIGHT;
    if (target === 'goal_date_text') virtualStep = ONBOARDING_STEPS.GOAL_DATE;
    if (target === 'ai_type') virtualStep = ONBOARDING_STEPS.AI_TYPE;

    const applied = applyStepAnswer(state, virtualStep, input);
    if (!applied.ok) {
      return {
        ok: false,
        errorMessage: applied.errorMessage,
        state,
      };
    }

    return {
      ok: true,
      state: {
        ...state,
        profile: applied.profile,
        current_step: ONBOARDING_STEPS.CONFIRM,
        edit_target: null,
        last_input: input,
      },
    };
  }

  if (step === ONBOARDING_STEPS.CONFIRM) {
    const t = normalizeLoose(input);

    if (t === normalizeLoose('この内容で完了')) {
      return {
        ok: true,
        state: {
          ...state,
          current_step: ONBOARDING_STEPS.DONE,
          onboarding_status: 'completed',
          last_input: input,
        },
      };
    }

    if (
      t === normalizeLoose('プロフィール変更') ||
      t === normalizeLoose('設定変更')
    ) {
      return {
        ok: true,
        state: {
          ...state,
          current_step: ONBOARDING_STEPS.EDIT_SELECT,
          edit_target: null,
          last_input: input,
        },
      };
    }

    if (
      t === normalizeLoose('プロフィール再設定') ||
      t === normalizeLoose('設定をやり直す')
    ) {
      return {
        ok: true,
        state: {
          ...state,
          current_step: ONBOARDING_STEPS.RESET_PROMPT,
          edit_target: null,
          last_input: input,
        },
      };
    }

    return {
      ok: true,
      state,
    };
  }

  const applied = applyStepAnswer(state, step, input);
  if (!applied.ok) {
    return {
      ok: false,
      errorMessage: applied.errorMessage,
      state,
    };
  }

  return {
    ok: true,
    state: {
      ...state,
      profile: applied.profile,
      current_step: nextStepFor(step),
      last_input: input,
    },
  };
}

function buildOnboardingStatePatch(state) {
  const profile = state?.profile || {};
  const done = safeText(state?.current_step || '') === ONBOARDING_STEPS.DONE;

  return {
    onboarding_status: done ? 'completed' : 'in_progress',
    onboarding_state_json: JSON.stringify(state),
    current_flow: done ? null : 'onboarding',
    display_name: safeText(profile.display_name || ''),
    gender: safeText(profile.gender || ''),
    age: profile.age ?? null,
    height_cm: profile.height_cm ?? null,
    weight_kg: profile.weight_kg ?? null,
    goal_weight_kg: profile.goal_weight_kg ?? null,
    goal_date_text: safeText(profile.goal_date_text || ''),
    ai_type: normalizeAiTypeInput(profile.ai_type, AI_TYPE_VALUES.SOFT),
  };
}

function startProfileEditFromUser(user, mode = 'confirm') {
  const base = buildStateFromCompletedUser(user);

  const editBase = {
    ...base,
    current_flow: 'onboarding',
    onboarding_status: 'in_progress',
    edit_target: null,
  };

  if (mode === 'reset') {
    return {
      ...resetProfileState(editBase),
      current_flow: 'onboarding',
      onboarding_status: 'in_progress',
    };
  }

  if (mode === 'edit') {
    return {
      ...editBase,
      current_step: ONBOARDING_STEPS.EDIT_SELECT,
    };
  }

  return {
    ...editBase,
    current_step: ONBOARDING_STEPS.CONFIRM,
  };
}

module.exports = {
  ONBOARDING_STEPS,
  EDITABLE_FIELDS,
  createInitialOnboardingState,
  normalizeUserState,
  isOnboardingActive,
  buildReplyPayload,
  advanceOnboardingState,
  buildOnboardingStatePatch,
  startProfileEditFromUser,
};
