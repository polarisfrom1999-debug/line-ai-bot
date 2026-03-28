services/onboarding_service.js
'use strict';

const profileService = require('./profile_service');

const STEPS = {
  PROFILE: 'profile',
  AI_TYPE: 'ai_type',
  CONSTITUTION: 'constitution',
  PLAN: 'plan',
  COMPLETE: 'complete'
};

const AI_TYPES = [
  'やさしく伴走',
  '理屈で整理',
  '背中を押す',
  'バランス型'
];

const CONSTITUTION_TYPES = [
  '糖質で太りやすい',
  '脂質で太りやすい',
  'むくみやすい',
  'ストレス食いしやすい',
  'まだ分からない'
];

const PLAN_TYPES = [
  '無料体験',
  'ライト',
  'スタンダード',
  'プレミアム'
];

function normalizeText(value) {
  return String(value || '').trim();
}

function buildStartProfileMessage() {
  return [
    'ここから。の無料体験を始めますね。',
    '最初に、あなたに合う伴走にするための入力から進めます。',
    'この形で送ってください。',
    '名前：',
    '年齢：',
    '体重：',
    '体脂肪率：',
    '目標：'
  ].join('\n');
}

function buildEditProfileMessage() {
  return [
    'プロフィール変更ですね。更新したい項目だけで大丈夫です。',
    'この形で送ってください。',
    '名前：',
    '年齢：',
    '体重：',
    '体脂肪率：',
    '目標：'
  ].join('\n');
}

function buildAiTypeQuestion() {
  return [
    'AIの関わり方を選んでください。',
    '1. やさしく伴走',
    '2. 理屈で整理',
    '3. 背中を押す',
    '4. バランス型'
  ].join('\n');
}

function buildConstitutionQuestion() {
  return [
    '太りやすさの体質タイプを選んでください。',
    '1. 糖質で太りやすい',
    '2. 脂質で太りやすい',
    '3. むくみやすい',
    '4. ストレス食いしやすい',
    '5. まだ分からない'
  ].join('\n');
}

function buildPlanQuestion() {
  return [
    '次にプランを選べます。',
    '1. 無料体験',
    '2. ライト',
    '3. スタンダード',
    '4. プレミアム'
  ].join('\n');
}

function buildCompleteMessage(onboardingState, selectedPlan) {
  return [
    'ありがとうございます。開始準備が整いました。',
    `AIタイプ: ${(onboardingState.answers || {}).aiType || '未設定'}`,
    `体質タイプ: ${(onboardingState.answers || {}).constitutionType || '未設定'}`,
    `プラン: ${selectedPlan}`,
    'ここから、一緒に進めていきましょう。'
  ].join('\n');
}

function pickFromNumeric(text, options) {
  const safe = normalizeText(text);
  const index = Number(safe) - 1;
  if (Number.isInteger(index) && options[index]) return options[index];
  return options.find((item) => safe.includes(item)) || null;
}

function isStartTrigger(text) {
  return /無料体験開始|無料体験スタート|体験開始/.test(normalizeText(text));
}

function isProfileEditTrigger(text) {
  return /プロフィール変更|プロフィール修正|プロフィール入力/.test(normalizeText(text));
}

function looksLikeProfilePayload(text) {
  const safe = normalizeText(text);
  return /名前[:：]|年齢[:：]|体重[:：]|体脂肪率[:：]|目標[:：]/.test(safe);
}

function isOperationalMessage(text) {
  const safe = normalizeText(text);
  return /痛い|つらい|しんどい|苦しい|疲れ|眠い|歩いた|走った|ジョギング|スクワット|運動|食べた|ごはん|朝ごはん|昼ごはん|夜ごはん|ラーメン|カレー|寿司|LDL|血液検査|写真|画像|記録|まとめ|週間報告|月間報告|使い方|覚えてる|何時|何月何日/.test(safe);
}

function buildDefaultState(mode) {
  return {
    isActive: true,
    mode,
    currentStep: STEPS.PROFILE,
    completedSteps: [],
    answers: {}
  };
}

async function startOnboarding(input, saveShortMemory) {
  await saveShortMemory(input.userId, {
    onboardingState: buildDefaultState('start')
  });

  return {
    handled: true,
    replyText: buildStartProfileMessage()
  };
}

async function startProfileEdit(input, shortMemory, saveShortMemory) {
  await saveShortMemory(input.userId, {
    onboardingState: {
      ...(shortMemory?.onboardingState || buildDefaultState('profile_edit')),
      isActive: true,
      mode: 'profile_edit',
      currentStep: STEPS.PROFILE
    }
  });

  return {
    handled: true,
    replyText: buildEditProfileMessage()
  };
}

async function handleProfileStep({ input, text, onboardingState, longMemory, saveShortMemory, mergeLongMemory }) {
  if (!looksLikeProfilePayload(text)) {
    if (isOperationalMessage(text) && onboardingState.mode !== 'profile_edit') {
      return { handled: false };
    }

    return {
      handled: true,
      replyText: onboardingState.mode === 'profile_edit'
        ? buildEditProfileMessage()
        : buildStartProfileMessage()
    };
  }

  const patch = profileService.extractProfilePatchFromText(text);
  if (!Object.keys(patch).length) {
    return {
      handled: true,
      replyText: onboardingState.mode === 'profile_edit'
        ? buildEditProfileMessage()
        : buildStartProfileMessage()
    };
  }

  await mergeLongMemory(input.userId, {
    ...patch,
    onboardingCompleted: onboardingState.mode === 'profile_edit'
      ? Boolean(longMemory?.onboardingCompleted)
      : false,
    trialStartedAt: longMemory?.trialStartedAt || new Date().toISOString()
  });

  if (onboardingState.mode === 'profile_edit') {
    await saveShortMemory(input.userId, {
      onboardingState: {
        ...onboardingState,
        isActive: false,
        mode: null,
        currentStep: STEPS.COMPLETE,
        answers: {
          ...(onboardingState.answers || {}),
          profile: patch
        }
      }
    });

    return {
      handled: true,
      replyText: 'プロフィールを更新しました。必要なら、続けて他の項目も直せます。'
    };
  }

  await saveShortMemory(input.userId, {
    onboardingState: {
      ...onboardingState,
      currentStep: STEPS.AI_TYPE,
      completedSteps: [...new Set([...(onboardingState.completedSteps || []), STEPS.PROFILE])],
      answers: {
        ...(onboardingState.answers || {}),
        profile: patch
      }
    }
  });

  return {
    handled: true,
    replyText: buildAiTypeQuestion()
  };
}

async function handleAiTypeStep({ input, text, onboardingState, saveShortMemory, mergeLongMemory }) {
  if (isOperationalMessage(text)) return { handled: false };

  const selected = pickFromNumeric(text, AI_TYPES);
  if (!selected) {
    return {
      handled: true,
      replyText: buildAiTypeQuestion()
    };
  }

  await mergeLongMemory(input.userId, {
    aiType: selected
  });

  await saveShortMemory(input.userId, {
    onboardingState: {
      ...onboardingState,
      currentStep: STEPS.CONSTITUTION,
      completedSteps: [...new Set([...(onboardingState.completedSteps || []), STEPS.AI_TYPE])],
      answers: {
        ...(onboardingState.answers || {}),
        aiType: selected
      }
    }
  });

  return {
    handled: true,
    replyText: buildConstitutionQuestion()
  };
}

async function handleConstitutionStep({ input, text, onboardingState, saveShortMemory, mergeLongMemory }) {
  if (isOperationalMessage(text)) return { handled: false };

  const selected = pickFromNumeric(text, CONSTITUTION_TYPES);
  if (!selected) {
    return {
      handled: true,
      replyText: buildConstitutionQuestion()
    };
  }

  await mergeLongMemory(input.userId, {
    constitutionType: selected
  });

  await saveShortMemory(input.userId, {
    onboardingState: {
      ...onboardingState,
      currentStep: STEPS.PLAN,
      completedSteps: [...new Set([...(onboardingState.completedSteps || []), STEPS.CONSTITUTION])],
      answers: {
        ...(onboardingState.answers || {}),
        constitutionType: selected
      }
    }
  });

  return {
    handled: true,
    replyText: buildPlanQuestion()
  };
}

async function handlePlanStep({ input, text, onboardingState, saveShortMemory, mergeLongMemory }) {
  if (isOperationalMessage(text)) return { handled: false };

  const selected = pickFromNumeric(text, PLAN_TYPES);
  if (!selected) {
    return {
      handled: true,
      replyText: buildPlanQuestion()
    };
  }

  await mergeLongMemory(input.userId, {
    selectedPlan: selected,
    onboardingCompleted: true
  });

  await saveShortMemory(input.userId, {
    onboardingState: {
      ...onboardingState,
      isActive: false,
      mode: null,
      currentStep: STEPS.COMPLETE,
      completedSteps: [...new Set([...(onboardingState.completedSteps || []), STEPS.PLAN])],
      answers: {
        ...(onboardingState.answers || {}),
        plan: selected
      }
    }
  });

  return {
    handled: true,
    replyText: buildCompleteMessage(onboardingState, selected)
  };
}

async function maybeHandleOnboarding({ input, shortMemory, longMemory, saveShortMemory, mergeLongMemory }) {
  const text = normalizeText(input?.rawText || '');
  const onboardingState = shortMemory?.onboardingState || {
    isActive: false,
    mode: null,
    currentStep: null,
    completedSteps: [],
    answers: {}
  };

  if (isProfileEditTrigger(text)) {
    return startProfileEdit(input, shortMemory, saveShortMemory);
  }

  if (!longMemory?.onboardingCompleted && isStartTrigger(text)) {
    return startOnboarding(input, saveShortMemory);
  }

  if (!onboardingState.isActive) {
    return { handled: false };
  }

  if (onboardingState.currentStep === STEPS.PROFILE) {
    return handleProfileStep({
      input,
      text,
      onboardingState,
      longMemory,
      saveShortMemory,
      mergeLongMemory
    });
  }

  if (onboardingState.currentStep === STEPS.AI_TYPE) {
    return handleAiTypeStep({
      input,
      text,
      onboardingState,
      saveShortMemory,
      mergeLongMemory
    });
  }

  if (onboardingState.currentStep === STEPS.CONSTITUTION) {
    return handleConstitutionStep({
      input,
      text,
      onboardingState,
      saveShortMemory,
      mergeLongMemory
    });
  }

  if (onboardingState.currentStep === STEPS.PLAN) {
    return handlePlanStep({
      input,
      text,
      onboardingState,
      saveShortMemory,
      mergeLongMemory
    });
  }

  return { handled: false };
}

module.exports = {
  maybeHandleOnboarding
};
