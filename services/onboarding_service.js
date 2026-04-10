'use strict';

const profileService = require('./profile_service');
const planService = require('./plan_service');

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

function normalizeText(value) {
  return String(value || '').trim();
}

function normalizeLoose(value) {
  return normalizeText(value)
    .toLowerCase()
    .replace(/[！!？?。.,，、]/g, '')
    .replace(/\s+/g, '');
}

function buildStartProfileMessage() {
  return [
    'ここから。の無料体験を始めますね。',
    'まずは伴走の土台を合わせたいので、この形で分かる所だけ送ってください。',
    '名前：',
    '年齢：',
    '身長：',
    '体重：',
    '体脂肪率：',
    '目標：'
  ].join('\n');
}

function buildEditProfileMessage() {
  return [
    'プロフィール変更ですね。直したい項目だけで大丈夫です。',
    'この形で送ってください。',
    '名前：',
    '年齢：',
    '身長：',
    '体重：',
    '体脂肪率：',
    '目標：'
  ].join('\n');
}

function buildGoalPrompt() {
  return 'ありがとうございます。目標が決まっていれば「目標55kg」のように送ってください。まだ未定なら「まだ決まっていない」でも大丈夫です。';
}

function buildAiTypeQuestion() {
  return [
    '関わり方の好みを選んでください。',
    '1. やさしく伴走',
    '2. 理屈で整理',
    '3. 背中を押す',
    '4. バランス型'
  ].join('\n');
}

function buildConstitutionQuestion() {
  return [
    '今の感覚に近い体質タイプを選んでください。',
    '1. 糖質で太りやすい',
    '2. 脂質で太りやすい',
    '3. むくみやすい',
    '4. ストレス食いしやすい',
    '5. まだ分からない'
  ].join('\n');
}

function buildPlanQuestion() {
  return [
    '次にプランを選べます。今の段階で近いものを選んでください。',
    '1. 無料体験',
    '2. ライト',
    '3. スタンダード',
    '4. プレミアム'
  ].join('\n');
}

function buildCompleteMessage(onboardingState, selectedPlan) {
  const answers = onboardingState?.answers || {};
  return [
    'ありがとうございます。開始準備が整いました。',
    `AIタイプ: ${answers.aiType || '未設定'}`,
    `体質タイプ: ${answers.constitutionType || '未設定'}`,
    `プラン: ${selectedPlan || '未設定'}`,
    'ここからは、記録だけでなく今の生活やしんどさも含めて一緒に見ていきます。'
  ].join('\n');
}

function pickFromNumeric(text, options) {
  const safe = normalizeText(text);
  const index = Number(safe) - 1;
  if (Number.isInteger(index) && options[index]) return options[index];
  return options.find((item) => safe.includes(item)) || null;
}

function looksLikeSelectionAttempt(text, options, maxNumber) {
  const safe = normalizeText(text);
  if (!safe) return false;
  if (new RegExp(`^[1-${maxNumber}]$`).test(safe)) return true;
  return options.some((item) => safe.includes(item));
}

function isStartTrigger(text) {
  return /無料体験開始|無料体験スタート|体験開始/.test(normalizeText(text));
}

function isProfileEditTrigger(text) {
  return /プロフィール変更|プロフィール修正|プロフィール入力/.test(normalizeText(text));
}

function isOnboardingExitTrigger(text) {
  const n = normalizeLoose(text);
  return [
    '終わり', '終了', 'やめる', 'いったん終了', 'いったん終わり',
    'プロフィール終了', 'プロフィール終わり', 'プロフィールやめる',
    'プロフィール終わりです', 'プロフィール終了です'
  ].includes(n);
}

function buildOnboardingExitMessage(mode = '') {
  if (mode === 'profile_edit') {
    return 'プロフィール変更はいったん終わりにしました。必要な時だけ、また「プロフィール変更」で大丈夫です。';
  }
  return '無料体験の入力はいったんここで止めました。続けたくなったら、また「無料体験開始」で再開できます。';
}

function looksLikeProfilePayload(text) {
  return Object.keys(profileService.extractProfilePatchFromText(text)).length > 0;
}

function isOperationalMessage(text) {
  const safe = normalizeText(text);
  return /痛い|つらい|しんどい|苦しい|疲れ|眠い|歩いた|走った|ジョギング|スクワット|運動|食べた|ごはん|朝ごはん|昼ごはん|夜ごはん|ラーメン|カレー|寿司|LDL|血液検査|写真|画像|記録|まとめ|週間報告|月間報告|使い方|覚えてる|何時|何月何日|無料体験|プラン|AIタイプ|コマンド|総カロリー|私の体重は|体重は\?|体脂肪率は\?|ストレッチ教えて/.test(safe);
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
  await saveShortMemory(input.userId, { onboardingState: buildDefaultState('start') });
  return { handled: true, replyText: buildStartProfileMessage() };
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
  return { handled: true, replyText: buildEditProfileMessage() };
}

async function handleProfileStep({ input, text, onboardingState, longMemory, saveShortMemory, mergeLongMemory, persistAuthoritativeProfile }) {
  const patch = profileService.extractProfilePatchFromText(text);

  if (!Object.keys(patch).length) {
    if (onboardingState.mode === 'profile_edit' && (input?.messageType !== 'text' || isOperationalMessage(text))) {
      await saveShortMemory(input.userId, {
        onboardingState: {
          ...onboardingState,
          isActive: false,
          mode: null,
          currentStep: STEPS.COMPLETE,
        }
      });
      return { handled: false };
    }
    if (onboardingState.mode === 'start' && isOperationalMessage(text)) return { handled: false };
    if (isOperationalMessage(text)) return { handled: false };
    return { handled: true, replyText: onboardingState.mode === 'profile_edit' ? buildEditProfileMessage() : buildStartProfileMessage() };
  }

  const nextProfile = {
    preferredName: patch.preferredName || longMemory?.preferredName || onboardingState?.answers?.profile?.preferredName || '',
    age: patch.age || longMemory?.age || onboardingState?.answers?.profile?.age || '',
    height: patch.height || longMemory?.height || onboardingState?.answers?.profile?.height || '',
    weight: patch.weight || longMemory?.weight || onboardingState?.answers?.profile?.weight || '',
    bodyFat: patch.bodyFat || longMemory?.bodyFat || onboardingState?.answers?.profile?.bodyFat || '',
    goal: patch.goal || longMemory?.goal || onboardingState?.answers?.profile?.goal || ''
  };

  await mergeLongMemory(input.userId, {
    ...patch,
    onboardingCompleted: onboardingState.mode === 'profile_edit' ? Boolean(longMemory?.onboardingCompleted) : Boolean(longMemory?.onboardingCompleted),
    trialStartedAt: longMemory?.trialStartedAt || new Date().toISOString()
  });

  if (typeof persistAuthoritativeProfile === 'function') {
    await persistAuthoritativeProfile(input.userId, patch);
  }

  if (onboardingState.mode === 'profile_edit') {
    await saveShortMemory(input.userId, {
      onboardingState: {
        ...onboardingState,
        isActive: false,
        mode: null,
        currentStep: STEPS.COMPLETE,
        answers: { ...(onboardingState.answers || {}), profile: nextProfile }
      }
    });
    return { handled: true, replyText: profileService.buildProfileUpdatedReply(patch) };
  }

  if (!nextProfile.goal) {
    await saveShortMemory(input.userId, {
      onboardingState: {
        ...onboardingState,
        currentStep: STEPS.PROFILE,
        completedSteps: [...new Set([...(onboardingState.completedSteps || []), STEPS.PROFILE])],
        answers: { ...(onboardingState.answers || {}), profile: nextProfile }
      }
    });
    const replyLines = [
      'ありがとうございます。プロフィールをいったんまとめると、',
      '',
      ...(nextProfile.preferredName ? [`名前: ${nextProfile.preferredName}`] : []),
      ...(nextProfile.age ? [`年齢: ${nextProfile.age}`] : []),
      ...(nextProfile.height ? [`身長: ${nextProfile.height}`] : []),
      ...(nextProfile.weight ? [`体重: ${nextProfile.weight}`] : []),
      ...(nextProfile.bodyFat ? [`体脂肪率: ${nextProfile.bodyFat}`] : []),
      '',
      buildGoalPrompt()
    ].filter(Boolean);
    return { handled: true, replyText: replyLines.join('\n') };
  }

  await saveShortMemory(input.userId, {
    onboardingState: {
      ...onboardingState,
      currentStep: STEPS.AI_TYPE,
      completedSteps: [...new Set([...(onboardingState.completedSteps || []), STEPS.PROFILE])],
      answers: { ...(onboardingState.answers || {}), profile: nextProfile }
    }
  });

  return { handled: true, replyText: buildAiTypeQuestion() };
}

async function handleAiTypeStep({ input, text, onboardingState, saveShortMemory, mergeLongMemory }) {
  if (isOperationalMessage(text)) return { handled: false };

  const selected = pickFromNumeric(text, AI_TYPES);
  if (!selected) {
    if (!looksLikeSelectionAttempt(text, AI_TYPES, 4)) return { handled: false };
    return { handled: true, replyText: buildAiTypeQuestion() };
  }

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

async function handleConstitutionStep({ input, text, onboardingState, saveShortMemory, mergeLongMemory }) {
  if (isOperationalMessage(text)) return { handled: false };

  const selected = pickFromNumeric(text, CONSTITUTION_TYPES);
  if (!selected) {
    if (!looksLikeSelectionAttempt(text, CONSTITUTION_TYPES, 5)) return { handled: false };
    return { handled: true, replyText: buildConstitutionQuestion() };
  }

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

async function handlePlanStep({ input, text, onboardingState, saveShortMemory, mergeLongMemory }) {
  if (isOperationalMessage(text)) return { handled: false };

  const selected = planService.pickPlanFromText(text);
  if (!selected) {
    if (!looksLikeSelectionAttempt(text, ['無料体験', 'ライト', 'スタンダード', 'プレミアム'], 4)) return { handled: false };
    return { handled: true, replyText: buildPlanQuestion() };
  }

  await mergeLongMemory(input.userId, {
    plan: selected,
    selectedPlan: selected,
    onboardingCompleted: true,
    planFeatures: planService.getPlanFeatures(selected)
  });

  await saveShortMemory(input.userId, {
    onboardingState: {
      ...onboardingState,
      isActive: false,
      mode: null,
      currentStep: STEPS.COMPLETE,
      completedSteps: [...new Set([...(onboardingState.completedSteps || []), STEPS.PLAN])],
      answers: { ...(onboardingState.answers || {}), plan: selected }
    }
  });

  return { handled: true, replyText: buildCompleteMessage({ ...onboardingState, answers: { ...(onboardingState.answers || {}), plan: selected } }, selected) };
}

async function maybeHandleOnboarding({ input, shortMemory, longMemory, saveShortMemory, mergeLongMemory, persistAuthoritativeProfile }) {
  const text = normalizeText(input?.rawText || '');
  const onboardingState = shortMemory?.onboardingState || buildDefaultState('start');

  if (!text && input?.messageType !== 'text') {
    if (onboardingState?.isActive && onboardingState.mode === 'profile_edit') {
      await saveShortMemory(input.userId, {
        onboardingState: {
          ...onboardingState,
          isActive: false,
          mode: null,
          currentStep: STEPS.COMPLETE,
        }
      });
    }
    return { handled: false };
  }

  if (isStartTrigger(text)) return startOnboarding(input, saveShortMemory);
  if (isProfileEditTrigger(text)) return startProfileEdit(input, shortMemory, saveShortMemory);

  if (!onboardingState?.isActive) return { handled: false };

  if (isOnboardingExitTrigger(text)) {
    await saveShortMemory(input.userId, {
      onboardingState: {
        ...onboardingState,
        isActive: false,
        mode: null,
        currentStep: STEPS.COMPLETE,
      }
    });
    return { handled: true, replyText: buildOnboardingExitMessage(onboardingState.mode) };
  }

  if (onboardingState.currentStep === STEPS.PROFILE) {
    return handleProfileStep({ input, text, onboardingState, longMemory, saveShortMemory, mergeLongMemory, persistAuthoritativeProfile });
  }
  if (onboardingState.currentStep === STEPS.AI_TYPE) {
    return handleAiTypeStep({ input, text, onboardingState, saveShortMemory, mergeLongMemory });
  }
  if (onboardingState.currentStep === STEPS.CONSTITUTION) {
    return handleConstitutionStep({ input, text, onboardingState, saveShortMemory, mergeLongMemory });
  }
  if (onboardingState.currentStep === STEPS.PLAN) {
    return handlePlanStep({ input, text, onboardingState, saveShortMemory, mergeLongMemory });
  }

  return { handled: false };
}

module.exports = {
  STEPS,
  AI_TYPES,
  CONSTITUTION_TYPES,
  buildStartProfileMessage,
  buildEditProfileMessage,
  buildAiTypeQuestion,
  buildConstitutionQuestion,
  buildPlanQuestion,
  buildCompleteMessage,
  isStartTrigger,
  isProfileEditTrigger,
  isOnboardingExitTrigger,
  looksLikeProfilePayload,
  maybeHandleOnboarding
};