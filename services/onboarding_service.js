'use strict';

/**
 * services/onboarding_service.js
 *
 * 目的:
 * - LINEの初回導線を軽く管理する
 * - index.js 側の beginProfileManagementFlow / handleOnboardingMessage と安全につなぐ
 * - 既存の記録・相談・初回診断フローとぶつかりにくくする
 */

const ONBOARDING_STEPS = {
  WELCOME: 'welcome',
  CONFIRM: 'confirm',
  EDIT_SELECT: 'edit_select',
  EDIT_PROMPT: 'edit_prompt',
  RESET_PROMPT: 'reset_prompt',
  DONE: 'done',
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

function buildQuickReplies(items = []) {
  return (items || []).filter(Boolean).slice(0, 13);
}

function buildProfileSummaryFromUser(user = {}) {
  const parts = [
    user.gender ? `性別: ${user.gender}` : null,
    user.age != null ? `年齢: ${user.age}` : null,
    user.height_cm != null ? `身長: ${user.height_cm}cm` : null,
    user.weight_kg != null ? `体重: ${user.weight_kg}kg` : null,
    user.target_weight_kg != null ? `目標体重: ${user.target_weight_kg}kg` : null,
    user.activity_level ? `活動量: ${user.activity_level}` : null,
    user.ai_type ? `AIタイプ: ${user.ai_type}` : null,
  ].filter(Boolean);

  return parts.length ? parts.join('\n') : 'プロフィールはまだ十分に登録されていません。';
}

function createInitialOnboardingState() {
  return {
    active: true,
    mode: 'start',
    step: ONBOARDING_STEPS.WELCOME,
    current_flow: 'onboarding',
    onboarding_status: 'in_progress',
    current_step: ONBOARDING_STEPS.WELCOME,
    started_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    collected: {},
    trial_status: 'active',
    edit_target: null,
  };
}

function parseStateJson(raw) {
  if (!raw) return null;
  if (typeof raw === 'object') return raw;
  try {
    return JSON.parse(raw);
  } catch (_error) {
    return null;
  }
}

function normalizeUserState(user = {}) {
  const parsed = parseStateJson(user.onboarding_state_json);

  if (parsed && typeof parsed === 'object') {
    const currentStep = safeText(parsed.current_step || parsed.step || ONBOARDING_STEPS.WELCOME) || ONBOARDING_STEPS.WELCOME;

    return {
      active: parsed.active !== false,
      mode: safeText(parsed.mode || 'start') || 'start',
      step: currentStep,
      current_step: currentStep,
      current_flow: safeText(parsed.current_flow || user.current_flow || 'onboarding') || 'onboarding',
      onboarding_status: safeText(parsed.onboarding_status || user.onboarding_status || 'in_progress') || 'in_progress',
      started_at: safeText(parsed.started_at || user.onboarding_started_at || ''),
      updated_at: new Date().toISOString(),
      collected: parsed.collected && typeof parsed.collected === 'object' ? parsed.collected : {},
      trial_status: safeText(parsed.trial_status || user.trial_status || 'active') || 'active',
      edit_target: parsed.edit_target || null,
    };
  }

  return createInitialOnboardingState();
}

function isOnboardingActive(user = {}) {
  const state = parseStateJson(user.onboarding_state_json);
  if (state && typeof state === 'object') {
    return state.active === true;
  }

  const status = safeText(user.onboarding_status || '');
  return status === 'active' || status === 'in_progress';
}

function buildOnboardingStatePatch(state = {}) {
  const active = state.active !== false;
  const mode = safeText(state.mode || 'start') || 'start';
  const currentStep = safeText(state.current_step || state.step || ONBOARDING_STEPS.WELCOME) || ONBOARDING_STEPS.WELCOME;
  const nowIso = new Date().toISOString();

  return {
    onboarding_status: active ? 'in_progress' : 'completed',
    current_flow: active ? 'onboarding' : null,
    onboarding_state_json: {
      active,
      mode,
      step: currentStep,
      current_step: currentStep,
      current_flow: active ? 'onboarding' : null,
      onboarding_status: active ? 'in_progress' : 'completed',
      started_at: safeText(state.started_at || nowIso),
      updated_at: nowIso,
      collected: state.collected && typeof state.collected === 'object' ? state.collected : {},
      trial_status: safeText(state.trial_status || 'active') || 'active',
      edit_target: state.edit_target || null,
    },
  };
}

function buildStateFromCompletedUser(user = {}) {
  return {
    active: true,
    mode: 'confirm',
    step: ONBOARDING_STEPS.CONFIRM,
    current_step: ONBOARDING_STEPS.CONFIRM,
    current_flow: 'onboarding',
    onboarding_status: 'in_progress',
    started_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    collected: {
      profile_summary: buildProfileSummaryFromUser(user),
    },
    trial_status: safeText(user.trial_status || 'active') || 'active',
    edit_target: null,
  };
}

function resetProfileState(base = {}) {
  return {
    ...base,
    mode: 'reset',
    step: ONBOARDING_STEPS.RESET_PROMPT,
    current_step: ONBOARDING_STEPS.RESET_PROMPT,
    collected: {
      ...(base.collected || {}),
      profile_summary: buildProfileSummaryFromUser({}),
    },
    edit_target: null,
    updated_at: new Date().toISOString(),
  };
}

function buildReplyPayload(state = {}) {
  const mode = safeText(state.mode || 'start');
  const currentStep = safeText(state.current_step || state.step || ONBOARDING_STEPS.WELCOME);
  const collected = state.collected && typeof state.collected === 'object' ? state.collected : {};

  if (mode === 'confirm' || currentStep === ONBOARDING_STEPS.CONFIRM) {
    const lines = [
      '現在のプロフィール確認です。',
      collected.profile_summary || '登録済みプロフィールを確認してください。',
      '',
      '変更したい時は「プロフィール変更」',
      '最初から入れ直す時は「プロフィール再設定」',
      'このままでよければ通常どおり記録を送って大丈夫です。',
    ];

    return {
      text: lines.join('\n'),
      quickReplies: buildQuickReplies(['プロフィール変更', 'プロフィール再設定', '体重グラフ', '食事活動グラフ']),
    };
  }

  if (mode === 'edit' || currentStep === ONBOARDING_STEPS.EDIT_SELECT || currentStep === ONBOARDING_STEPS.EDIT_PROMPT) {
    const lines = [
      'プロフィール変更モードです。',
      '変更したい内容をそのまま送ってください。',
      '例: プロフィール 年齢 56 体重 62 目標体重 58',
      '',
      '確認だけなら「プロフィール確認」',
    ];

    return {
      text: lines.join('\n'),
      quickReplies: buildQuickReplies(['プロフィール確認', 'プロフィール再設定', '初回診断']),
    };
  }

  if (mode === 'reset' || currentStep === ONBOARDING_STEPS.RESET_PROMPT) {
    const lines = [
      'プロフィール再設定モードです。',
      '最初から入れ直したい内容を送ってください。',
      '例: プロフィール 性別 女性 年齢 55 身長 160 体重 63 目標体重 58 活動量 ふつう',
      '',
      '初回診断から深く進めたい場合は「初回診断」でも大丈夫です。',
    ];

    return {
      text: lines.join('\n'),
      quickReplies: buildQuickReplies(['初回診断', 'プロフィール確認', 'プロフィール変更']),
    };
  }

  if (currentStep === ONBOARDING_STEPS.WELCOME) {
    const lines = [
      'ここから。へようこそ。',
      'このLINEでは、体重・食事・運動・体調を無理なく整えながら、一緒に流れを作っていきます。',
      '',
      '最初は次のどれか1つからで大丈夫です。',
      '・プロフィール確認',
      '・初回診断',
      '・体重 63.2',
      '・朝食 食パン1枚 コーヒー',
      '・膝が少し痛いです',
    ];

    return {
      text: lines.join('\n'),
      quickReplies: buildQuickReplies(['プロフィール確認', '初回診断', '体重グラフ', 'グラフ']),
    };
  }

  return {
    text: '必要な内容をそのまま送ってください。',
    quickReplies: buildQuickReplies(['プロフィール確認', '初回診断', 'グラフ']),
  };
}

function advanceOnboardingState(user = {}, text = '') {
  const current = normalizeUserState(user);
  const raw = safeText(text);
  const t = normalizeLoose(raw);

  if (!raw) {
    return {
      ok: false,
      state: current,
      errorMessage: 'メッセージが空でした。もう一度送ってください。',
    };
  }

  if (current.mode === 'confirm' || current.current_step === ONBOARDING_STEPS.CONFIRM) {
    if (t === normalizeLoose('プロフィール変更')) {
      const next = {
        ...current,
        mode: 'edit',
        step: ONBOARDING_STEPS.EDIT_SELECT,
        current_step: ONBOARDING_STEPS.EDIT_SELECT,
        updated_at: new Date().toISOString(),
      };
      return { ok: true, state: next };
    }

    if (t === normalizeLoose('プロフィール再設定')) {
      const next = {
        ...resetProfileState(current),
        current_flow: 'onboarding',
        onboarding_status: 'in_progress',
        trial_status: current.trial_status || 'active',
      };
      return { ok: true, state: next };
    }

    const next = {
      ...current,
      active: false,
      step: ONBOARDING_STEPS.DONE,
      current_step: ONBOARDING_STEPS.DONE,
      updated_at: new Date().toISOString(),
    };
    return { ok: true, state: next };
  }

  if (current.mode === 'edit' || current.mode === 'reset') {
    const next = {
      ...current,
      active: false,
      step: ONBOARDING_STEPS.DONE,
      current_step: ONBOARDING_STEPS.DONE,
      updated_at: new Date().toISOString(),
      collected: {
        ...(current.collected || {}),
        last_input_text: raw,
      },
    };
    return { ok: true, state: next };
  }

  if (current.current_step === ONBOARDING_STEPS.WELCOME) {
    const next = {
      ...current,
      active: false,
      step: ONBOARDING_STEPS.DONE,
      current_step: ONBOARDING_STEPS.DONE,
      updated_at: new Date().toISOString(),
      collected: {
        ...(current.collected || {}),
        first_message: raw,
      },
    };
    return { ok: true, state: next };
  }

  return { ok: true, state: current };
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
      trial_status: base.trial_status || 'active',
    };
  }

  if (mode === 'edit') {
    return {
      ...editBase,
      mode: 'edit',
      step: ONBOARDING_STEPS.EDIT_SELECT,
      current_step: ONBOARDING_STEPS.EDIT_SELECT,
    };
  }

  return {
    ...editBase,
    mode: 'confirm',
    step: ONBOARDING_STEPS.CONFIRM,
    current_step: ONBOARDING_STEPS.CONFIRM,
  };
}

module.exports = {
  createInitialOnboardingState,
  normalizeUserState,
  isOnboardingActive,
  buildReplyPayload,
  advanceOnboardingState,
  buildOnboardingStatePatch,
  startProfileEditFromUser,
};
