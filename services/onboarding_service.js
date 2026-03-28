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

function buildProfileTemplateMessage() {
  return [
    '最初に、あなたに合う伴走にするための入力から進めます。',
    'この形で送ってください。',
    '名前：',
    '年齢：',
    '体重：',
    '体脂肪率：',
    '目標：'
  ].join('\n');
}

function buildProfileEditTemplateMessage() {
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

function pickFromNumeric(text, options) {
  const safe = String(text || '').trim();
  const index = Number(safe) - 1;
  if (Number.isInteger(index) && options[index]) return options[index];
  return options.find((item) => safe.includes(item)) || null;
}

function isStartTrigger(text) {
  return /無料体験開始|無料体験スタート|体験開始/.test(String(text || ''));
}

function isProfileEditTrigger(text) {
  return /プロフィール変更|プロフィール修正|プロフィール入力/.test(String(text || ''));
}

function looksLikeProfilePayload(text) {
  const safe = String(text || '');
  return /名前[:：]|年齢[:：]|体重[:：]|体脂肪率[:：]|目標[:：]/.test(safe);
}

function isOperationalMessage(text) {
  const safe = String(text || '').trim();
  return /痛い|つらい|しんどい|苦しい|疲れ|眠い|歩いた|走った|ジョギング|スクワット|運動|食べた|ごはん|朝ごはん|昼ごはん|夜ごはん|ラーメン|カレー|寿司|LDL|血液検査|写真|画像|記録|まとめ|週間報告|月間報告|使い方|覚えてる|何時|何月何日/.test(safe);
}

async function startOnboarding(input, saveShortMemory, templateMessage) {
  await saveShortMemory(input.userId, {
    onboardingState: {
      isActive: true,
      mode: 'start',
      currentStep: STEPS.PROFILE,
      completedSteps: [],
      answers: {}
    }
  });

  return {
    handled: true,
    replyText: [
      'ここから。の無料体験を始めますね。',
      templateMessage
    ].join('\n')
  };
}

async function startProfileEdit(input, shortMemory, saveShortMemory) {
  await saveShortMemory(input.userId, {
    onboardingState: {
      ...(shortMemory?.onboardingState || {}),
      isActive: true,
      mode: 'profile_edit',
      currentStep: STEPS.PROFILE,
      completedSteps: shortMemory?.onboardingState?.completedSteps || [],
      answers: shortMemory?.onboardingState?.answers || {}
    }
  });

  return {
    handled: true,
    replyText: buildProfileEditTemplateMessage()
  };
}

async function maybeHandleOnboarding({ input, shortMemory, longMemory, saveShortMemory, mergeLongMemory }) {
  const text = String(input?.rawText || '').trim();
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
    return startOnboarding(input, saveShortMemory, buildProfileTemplateMessage());
  }

  if (!onboardingState.isActive) {
    return { handled: false };
  }

  if (onboardingState.currentStep !== STEPS.PROFILE && isOperationalMessage(text)) {
    return { handled: false };
  }

  if (onboardingState.currentStep === STEPS.PROFILE) {
    if (!looksLikeProfilePayload(text)) {
      if (isOperationalMessage(text) && onboardingState.mode !== 'profile_edit') {
        return { handled: false };
      }
      return {
        handled: true,
        replyText: onboardingState.mode === 'profile_edit'
          ? buildProfileEditTemplateMessage()
          : buildProfileTemplateMessage()
      };
    }

    const patch = profileService.extractProfilePatchFromText(text);
    if (!Object.keys(patch).length) {
      return {
        handled: true,
        replyText: onboardingState.mode === 'profile_edit'
          ? buildProfileEditTemplateMessage()
          : buildProfileTemplateMessage()
      };
    }

    await mergeLongMemory(input.userId, {
      ...patch,
      onboardingCompleted: onboardingState.mode === 'profile_edit' ? Boolean(longMemory?.onboardingCompleted) : false,
      trialStartedAt: longMemory?.trialStartedAt || new Date().toISOString()
    });

    if (onboardingState.mode === 'profile_edit') {
      await saveShortMemory(input.userId, {
        onboardingState: {
          isActive: false,
          mode: null,
          currentStep: STEPS.COMPLETE,
          completedSteps: onboardingState.completedSteps || [],
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
        isActive: true,
        mode: onboardingState.mode || 'start',
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

  if (onboardingState.currentStep === STEPS.AI_TYPE) {
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

  if (onboardingState.currentStep === STEPS.CONSTITUTION) {
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

  if (onboardingState.currentStep === STEPS.PLAN) {
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
