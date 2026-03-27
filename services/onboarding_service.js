'use strict';

const profileService = require('./profile_service');

const STEPS = {
  PROFILE: 'profile',
  AI_TYPE: 'ai_type',
  CONSTITUTION: 'constitution',
  PLAN: 'plan',
  COMPLETE: 'complete'
};

const AI_TYPES = ['やさしく伴走', '理屈で整理', '背中を押す', 'バランス型'];
const CONSTITUTION_TYPES = ['糖質で太りやすい', '脂質で太りやすい', 'むくみやすい', 'ストレス食いしやすい', 'まだ分からない'];
const PLAN_TYPES = ['無料体験', 'ライト', 'スタンダード', 'プレミアム'];

function buildStartMessage() {
  return [
    'ここから。の無料体験を始めますね。',
    '最初に、あなたに合う伴走にするための入力から進めます。',
    'まずはこの形で送ってください。',
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

function pickFromNumeric(text, options) {
  const safe = String(text || '').trim();
  const index = Number(safe) - 1;
  if (Number.isInteger(index) && options[index]) return options[index];
  return options.find((item) => safe.includes(item)) || null;
}

function isStartTrigger(text) {
  return /無料体験開始|スタート|開始/.test(String(text || ''));
}

function isProfileStartTrigger(text) {
  return /プロフィール変更|プロフィール入力|プロフィール/.test(String(text || ''));
}

async function maybeHandleOnboarding({ input, shortMemory, longMemory, saveShortMemory, mergeLongMemory }) {
  const text = String(input?.rawText || '').trim();
  const onboardingState = shortMemory?.onboardingState || {
    isActive: false,
    currentStep: null,
    completedSteps: [],
    answers: {}
  };

  if (!longMemory?.onboardingCompleted && (isStartTrigger(text) || isProfileStartTrigger(text))) {
    await saveShortMemory(input.userId, {
      onboardingState: {
        isActive: true,
        currentStep: STEPS.PROFILE,
        completedSteps: [],
        answers: {}
      }
    });

    return {
      handled: true,
      replyText: buildStartMessage()
    };
  }

  if (!onboardingState.isActive) {
    return { handled: false };
  }

  if (onboardingState.currentStep === STEPS.PROFILE) {
    const patch = profileService.extractProfilePatchFromText(text);
    if (!Object.keys(patch).length) {
      return { handled: true, replyText: buildStartMessage() };
    }

    await mergeLongMemory(input.userId, {
      ...patch,
      onboardingCompleted: false,
      trialStartedAt: new Date().toISOString()
    });

    await saveShortMemory(input.userId, {
      onboardingState: {
        ...onboardingState,
        currentStep: STEPS.AI_TYPE,
        completedSteps: [...new Set([...(onboardingState.completedSteps || []), STEPS.PROFILE])],
        answers: { ...(onboardingState.answers || {}), profile: patch }
      }
    });

    return { handled: true, replyText: buildAiTypeQuestion() };
  }

  if (onboardingState.currentStep === STEPS.AI_TYPE) {
    const selected = pickFromNumeric(text, AI_TYPES);
    if (!selected) return { handled: true, replyText: buildAiTypeQuestion() };

    await mergeLongMemory(input.userId, { aiType: selected });
    await saveShortMemory(input.userId, {
      onboardingState: {
        ...onboardingState,
        currentStep: STEPS.CONSTITUTION,
        completedSteps: [...new Set([...(onboardingState.completedSteps || []), STEPS.AI_TYPE])],
        answers: { ...(onboardingState.answers || {}), aiType: selected }
      }
    });

    return { handled: true, replyText: buildConstitutionQuestion() };
  }

  if (onboardingState.currentStep === STEPS.CONSTITUTION) {
    const selected = pickFromNumeric(text, CONSTITUTION_TYPES);
    if (!selected) return { handled: true, replyText: buildConstitutionQuestion() };

    await mergeLongMemory(input.userId, { constitutionType: selected });
    await saveShortMemory(input.userId, {
      onboardingState: {
        ...onboardingState,
        currentStep: STEPS.PLAN,
        completedSteps: [...new Set([...(onboardingState.completedSteps || []), STEPS.CONSTITUTION])],
        answers: { ...(onboardingState.answers || {}), constitutionType: selected }
      }
    });

    return { handled: true, replyText: buildPlanQuestion() };
  }

  if (onboardingState.currentStep === STEPS.PLAN) {
    const selected = pickFromNumeric(text, PLAN_TYPES);
    if (!selected) return { handled: true, replyText: buildPlanQuestion() };

    await mergeLongMemory(input.userId, {
      selectedPlan: selected,
      onboardingCompleted: true
    });

    await saveShortMemory(input.userId, {
      onboardingState: {
        isActive: false,
        currentStep: STEPS.COMPLETE,
        completedSteps: [...new Set([...(onboardingState.completedSteps || []), STEPS.PLAN])],
        answers: { ...(onboardingState.answers || {}), plan: selected }
      }
    });

    return {
      handled: true,
      replyText: [
        'ありがとうございます。開始準備が整いました。',
        `AIタイプ: ${(onboardingState.answers || {}).aiType || '未設定'}`,
        `体質タイプ: ${(onboardingState.answers || {}).constitutionType || '未設定'}`,
        `プラン: ${selected}`,
        'ここから、一緒に進めていきましょう。'
      ].join('\n')
    };
  }

  return { handled: false };
}

module.exports = {
  maybeHandleOnboarding
};
