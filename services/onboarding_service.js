"use strict";

/**
 * services/onboarding_service.js
 *
 * 目的:
 * - 初回利用時の導線を軽く整える
 * - 4タイプ表示を共通化し、profile / intake とつなぎやすくする
 * - index.js 側の既存呼び出しと互換を保つ
 */

const PERSONA_OPTIONS = [
  "そっと寄り添う",
  "明るく後押し",
  "頼もしく導く",
  "力強く支える",
];

const ONBOARDING_STEPS = {
  WELCOME: "welcome",
  PERSONA_SELECT: "persona_select",
  GOAL_CAPTURE: "goal_capture",
  CONFIRM: "confirm",
  EDIT_SELECT: "edit_select",
  EDIT_PROMPT: "edit_prompt",
  RESET_PROMPT: "reset_prompt",
  DONE: "done",
};

function safeText(value, fallback = "") {
  return String(value || fallback).trim();
}

function safeJsonParse(value, fallback = null) {
  try {
    return JSON.parse(value);
  } catch (_error) {
    return fallback;
  }
}

function normalizeLoose(text = "") {
  return String(text || "")
    .trim()
    .toLowerCase()
    .replace(/[！!？?。.,，、]/g, "")
    .replace(/\s+/g, "");
}

function isValidPersona(value = "") {
  return PERSONA_OPTIONS.includes(safeText(value));
}

function buildQuickReplies(items = []) {
  return (Array.isArray(items) ? items : []).filter(Boolean).map((item) => safeText(item)).filter(Boolean);
}

function createInitialOnboardingState() {
  return {
    current_flow: "onboarding",
    onboarding_status: "in_progress",
    current_step: ONBOARDING_STEPS.WELCOME,
    selected_persona: null,
    onboarding_goal: "",
    edit_target: null,
    started_at: new Date().toISOString(),
  };
}

function normalizeUserState(user = {}) {
  const jsonState = safeJsonParse(user?.onboarding_state_json, null);
  const base = jsonState && typeof jsonState === "object"
    ? jsonState
    : {
        current_flow: user?.current_flow || "onboarding",
        onboarding_status: user?.onboarding_status || "in_progress",
        current_step: user?.current_step || ONBOARDING_STEPS.WELCOME,
        selected_persona: user?.selected_persona || null,
        onboarding_goal: user?.onboarding_goal || "",
        edit_target: user?.edit_target || null,
      };

  return {
    ...createInitialOnboardingState(),
    ...base,
    current_flow: base?.current_flow || "onboarding",
    onboarding_status: base?.onboarding_status || "in_progress",
    current_step: base?.current_step || ONBOARDING_STEPS.WELCOME,
    selected_persona: isValidPersona(base?.selected_persona) ? safeText(base.selected_persona) : null,
    onboarding_goal: safeText(base?.onboarding_goal || ""),
    edit_target: safeText(base?.edit_target || "") || null,
  };
}

function buildReplyPayload(state = {}) {
  const current = normalizeUserState({ onboarding_state_json: JSON.stringify(state) });

  if (current.current_step === ONBOARDING_STEPS.WELCOME) {
    return {
      text: [
        "はじめまして。ここから。へようこそ。",
        "まずは、話しかけやすい伴走の雰囲気を選んでみましょう。",
      ].join("\n"),
      quickReplies: buildQuickReplies(["はじめる", ...PERSONA_OPTIONS]),
    };
  }

  if (current.current_step === ONBOARDING_STEPS.PERSONA_SELECT) {
    return {
      text: "どんな雰囲気で寄り添ってほしいですか。",
      quickReplies: buildQuickReplies(PERSONA_OPTIONS),
    };
  }

  if (current.current_step === ONBOARDING_STEPS.GOAL_CAPTURE) {
    return {
      text: [
        `${safeText(current.selected_persona || "そっと寄り添う")} を選びました。`,
        "これから、どんなふうになりたいかを一言で教えてくださいね。",
      ].join("\n"),
      quickReplies: [],
    };
  }

  if (current.current_step === ONBOARDING_STEPS.CONFIRM) {
    return {
      text: [
        "いまの設定はこちらです。",
        `伴走タイプ: ${safeText(current.selected_persona || "未選択")}`,
        `目標: ${safeText(current.onboarding_goal || "未入力")}`,
        "このまま進めるか、直したいところを選んでください。",
      ].join("\n"),
      quickReplies: buildQuickReplies(["この内容で進める", "修正したい", "最初からやり直す"]),
    };
  }

  if (current.current_step === ONBOARDING_STEPS.EDIT_SELECT) {
    return {
      text: "どこを直しますか。",
      quickReplies: buildQuickReplies(["伴走タイプ", "目標", "戻る"]),
    };
  }

  if (current.current_step === ONBOARDING_STEPS.EDIT_PROMPT) {
    if (current.edit_target === "selected_persona") {
      return {
        text: "伴走タイプを選び直してください。",
        quickReplies: buildQuickReplies(PERSONA_OPTIONS),
      };
    }

    return {
      text: "新しい目標をそのまま送ってください。",
      quickReplies: buildQuickReplies(["戻る"]),
    };
  }

  if (current.current_step === ONBOARDING_STEPS.RESET_PROMPT) {
    return {
      text: "最初からやり直します。まずは伴走タイプを選んでください。",
      quickReplies: buildQuickReplies(PERSONA_OPTIONS),
    };
  }

  return {
    text: [
      "ありがとうございます。初回設定を受け取りました。",
      "このまま、食事・運動・体重・相談のどれからでも始められます。",
    ].join("\n"),
    quickReplies: buildQuickReplies(["食事を送る", "体重を送る", "使い方"]),
  };
}

function buildOnboardingStatePatch(state = {}) {
  const current = normalizeUserState({ onboarding_state_json: JSON.stringify(state) });
  const completed = current.current_step === ONBOARDING_STEPS.DONE || current.onboarding_status === "completed";

  return {
    current_flow: completed ? null : "onboarding",
    onboarding_status: completed ? "completed" : "in_progress",
    current_step: completed ? ONBOARDING_STEPS.DONE : current.current_step,
    selected_persona: current.selected_persona || null,
    onboarding_goal: current.onboarding_goal || null,
    onboarding_state_json: JSON.stringify({
      ...current,
      current_flow: completed ? null : "onboarding",
      onboarding_status: completed ? "completed" : "in_progress",
      current_step: completed ? ONBOARDING_STEPS.DONE : current.current_step,
    }),
  };
}

function advanceOnboardingState(user = {}, text = "") {
  const state = normalizeUserState(user);
  const raw = safeText(text);
  const normalized = normalizeLoose(raw);

  if (!raw && state.current_step !== ONBOARDING_STEPS.WELCOME) {
    return { ok: false, state, errorMessage: "空のままでは進められないので、一言だけ送ってくださいね。" };
  }

  if (state.current_step === ONBOARDING_STEPS.WELCOME) {
    return {
      ok: true,
      state: {
        ...state,
        current_step: ONBOARDING_STEPS.PERSONA_SELECT,
      },
    };
  }

  if (state.current_step === ONBOARDING_STEPS.PERSONA_SELECT) {
    if (!isValidPersona(raw)) {
      return { ok: false, state, errorMessage: "4つの中から選んでくださいね。" };
    }

    return {
      ok: true,
      state: {
        ...state,
        selected_persona: raw,
        current_step: ONBOARDING_STEPS.GOAL_CAPTURE,
      },
    };
  }

  if (state.current_step === ONBOARDING_STEPS.GOAL_CAPTURE) {
    return {
      ok: true,
      state: {
        ...state,
        onboarding_goal: raw,
        current_step: ONBOARDING_STEPS.CONFIRM,
      },
    };
  }

  if (state.current_step === ONBOARDING_STEPS.CONFIRM) {
    if (normalized === normalizeLoose("この内容で進める")) {
      return {
        ok: true,
        state: {
          ...state,
          current_flow: null,
          onboarding_status: "completed",
          current_step: ONBOARDING_STEPS.DONE,
        },
      };
    }

    if (normalized === normalizeLoose("修正したい")) {
      return {
        ok: true,
        state: {
          ...state,
          current_step: ONBOARDING_STEPS.EDIT_SELECT,
        },
      };
    }

    if (normalized === normalizeLoose("最初からやり直す")) {
      return {
        ok: true,
        state: {
          ...createInitialOnboardingState(),
          current_step: ONBOARDING_STEPS.RESET_PROMPT,
        },
      };
    }

    return { ok: false, state, errorMessage: "進める・修正・やり直し のどれかを選んでくださいね。" };
  }

  if (state.current_step === ONBOARDING_STEPS.EDIT_SELECT) {
    if (normalized === normalizeLoose("伴走タイプ")) {
      return {
        ok: true,
        state: {
          ...state,
          edit_target: "selected_persona",
          current_step: ONBOARDING_STEPS.EDIT_PROMPT,
        },
      };
    }

    if (normalized === normalizeLoose("目標")) {
      return {
        ok: true,
        state: {
          ...state,
          edit_target: "onboarding_goal",
          current_step: ONBOARDING_STEPS.EDIT_PROMPT,
        },
      };
    }

    if (normalized === normalizeLoose("戻る")) {
      return {
        ok: true,
        state: {
          ...state,
          current_step: ONBOARDING_STEPS.CONFIRM,
          edit_target: null,
        },
      };
    }

    return { ok: false, state, errorMessage: "伴走タイプ・目標・戻る のどれかを選んでくださいね。" };
  }

  if (state.current_step === ONBOARDING_STEPS.EDIT_PROMPT) {
    if (normalized === normalizeLoose("戻る")) {
      return {
        ok: true,
        state: {
          ...state,
          current_step: ONBOARDING_STEPS.EDIT_SELECT,
          edit_target: null,
        },
      };
    }

    if (state.edit_target === "selected_persona") {
      if (!isValidPersona(raw)) {
        return { ok: false, state, errorMessage: "4つの中から選んでくださいね。" };
      }
      return {
        ok: true,
        state: {
          ...state,
          selected_persona: raw,
          edit_target: null,
          current_step: ONBOARDING_STEPS.CONFIRM,
        },
      };
    }

    return {
      ok: true,
      state: {
        ...state,
        onboarding_goal: raw,
        edit_target: null,
        current_step: ONBOARDING_STEPS.CONFIRM,
      },
    };
  }

  if (state.current_step === ONBOARDING_STEPS.RESET_PROMPT) {
    if (!isValidPersona(raw)) {
      return { ok: false, state, errorMessage: "4つの中から選んでくださいね。" };
    }

    return {
      ok: true,
      state: {
        ...state,
        selected_persona: raw,
        current_step: ONBOARDING_STEPS.GOAL_CAPTURE,
        onboarding_status: "in_progress",
        current_flow: "onboarding",
      },
    };
  }

  return {
    ok: true,
    state: {
      ...state,
      current_flow: null,
      onboarding_status: "completed",
      current_step: ONBOARDING_STEPS.DONE,
    },
  };
}

function startProfileEditFromUser(user = {}, mode = "confirm") {
  const base = normalizeUserState(user);
  const editBase = {
    ...base,
    current_flow: "onboarding",
    onboarding_status: "in_progress",
    edit_target: null,
  };

  if (mode === "reset") {
    return {
      ...createInitialOnboardingState(),
      current_flow: "onboarding",
      onboarding_status: "in_progress",
      current_step: ONBOARDING_STEPS.RESET_PROMPT,
      trial_status: user?.trial_status || "active",
    };
  }

  if (mode === "edit") {
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
  PERSONA_OPTIONS,
  ONBOARDING_STEPS,
  buildQuickReplies,
  createInitialOnboardingState,
  normalizeUserState,
  buildReplyPayload,
  advanceOnboardingState,
  buildOnboardingStatePatch,
  startProfileEditFromUser,
  isValidPersona,
};
