'use strict';

const profileService = require('./profile_service');
const planService = require('./plan_service');
const { textMessageWithQuickReplies } = require('./line_service');
const {
  AI_TYPE_VALUES,
  AI_TYPE_OPTIONS,
  getAiTypeLabel,
  normalizeAiTypeInput,
} = require('../config/ai_type_config');
const constitutionSurveyConfig = require('../config/constitution_survey_config');

const {
  INITIAL_SURVEY,
  PERIODIC_CHECK,
  buildInitialSurveyState,
  buildPeriodicCheckState,
  getCurrentQuestion,
  getSurveyByType,
  applySurveyAnswer,
  getQuickReplyLabels,
  getInitialSurveyAnswerOption,
  getPeriodicCheckAnswerOption,
  evaluateInitialSurvey,
  scorePeriodicCheck,
  buildPeriodicCheckSummary,
} = constitutionSurveyConfig;

const STEPS = {
  PROFILE: 'profile',
  AI_TYPE: 'ai_type',
  VOICE_STYLE: 'voice_style',
  CONSTITUTION_SURVEY: 'constitution_survey',
  PLAN: 'plan',
  PERIODIC_CHECK: 'periodic_check',
  COMPLETE: 'complete',
};

const VOICE_STYLE_VALUES = {
  SOFT: 'always_gentle',
  CHEERFUL: 'always_bright',
  MIXED: 'gentle_with_toughness',
};

const VOICE_STYLE_LABELS = {
  [VOICE_STYLE_VALUES.SOFT]: 'いつも優しく',
  [VOICE_STYLE_VALUES.CHEERFUL]: 'いつも明るく',
  [VOICE_STYLE_VALUES.MIXED]: '普段優しく、ときどき厳しく',
};

const VOICE_STYLE_OPTIONS = [
  VOICE_STYLE_VALUES.SOFT,
  VOICE_STYLE_VALUES.CHEERFUL,
  VOICE_STYLE_VALUES.MIXED,
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

function buildDefaultState(mode) {
  return {
    isActive: true,
    mode,
    currentStep: mode === 'periodic_check' ? STEPS.PERIODIC_CHECK : STEPS.PROFILE,
    completedSteps: [],
    answers: {},
    surveyState: null,
  };
}

function buildTextReply(text, quickReplies = []) {
  return textMessageWithQuickReplies(text, quickReplies);
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
    '目標：',
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
    '目標：',
  ].join('\n');
}

function buildAiTypeQuestionText() {
  return [
    '伴走スタイルを選んでください。',
    `1. ${getAiTypeLabel(AI_TYPE_VALUES.SOFT)}`,
    `2. ${getAiTypeLabel(AI_TYPE_VALUES.BRIGHT)}`,
    `3. ${getAiTypeLabel(AI_TYPE_VALUES.RELIABLE)}`,
    `4. ${getAiTypeLabel(AI_TYPE_VALUES.STRONG)}`,
  ].join('\n');
}

function buildAiTypeMessage() {
  return buildTextReply(
    buildAiTypeQuestionText(),
    AI_TYPE_OPTIONS.map((key) => getAiTypeLabel(key)),
  );
}

function buildVoiceStyleQuestionText() {
  return [
    '声かけスタイルを選んでください。',
    `1. ${VOICE_STYLE_LABELS[VOICE_STYLE_VALUES.SOFT]}`,
    `2. ${VOICE_STYLE_LABELS[VOICE_STYLE_VALUES.CHEERFUL]}`,
    `3. ${VOICE_STYLE_LABELS[VOICE_STYLE_VALUES.MIXED]}`,
  ].join('\n');
}

function buildVoiceStyleMessage() {
  return buildTextReply(
    buildVoiceStyleQuestionText(),
    VOICE_STYLE_OPTIONS.map((key) => VOICE_STYLE_LABELS[key]),
  );
}

function buildPlanQuestionText() {
  return [
    '次にプランを選べます。今の段階で近いものを選んでください。',
    '1. 無料体験',
    '2. ライト',
    '3. スタンダード',
    '4. プレミアム',
  ].join('\n');
}

function buildPlanMessage() {
  return buildTextReply(buildPlanQuestionText(), ['無料体験', 'ライト', 'スタンダード', 'プレミアム']);
}

function buildSurveyQuestionMessage(state, options = {}) {
  const survey = getSurveyByType(state?.surveyType);
  const question = getCurrentQuestion(state);
  if (!survey || !question) {
    return buildTextReply('質問の準備で少しずれてしまいました。もう一度最初から進めますね。');
  }

  const currentIndex = Number(state?.currentIndex || 0) + 1;
  const total = Array.isArray(survey.questions) ? survey.questions.length : 0;
  const labels = getQuickReplyLabels(survey.answerOptions);
  const lines = [];

  if (options.includeIntro && survey.introMessage) lines.push(survey.introMessage);
  lines.push(`【${survey.title} ${currentIndex}/${total}】`);
  lines.push(question.text);

  if (options.includeProgress && survey.progressMessage) {
    lines.push('');
    lines.push(survey.progressMessage);
  }

  return buildTextReply(lines.join('\n'), labels);
}

function buildCompleteMessage(onboardingState, selectedPlan) {
  const answers = onboardingState?.answers || {};
  const constitution = answers.constitutionResult || null;

  return [
    'ありがとうございます。開始準備が整いました。',
    `AIタイプ: ${answers.aiType || '未設定'}`,
    `声かけ: ${answers.voiceStyle || '未設定'}`,
    `体質タイプ: ${constitution?.mainTypeLabel || answers.constitutionType || '未設定'}`,
    constitution?.subTypeLabel ? `副タイプ: ${constitution.subTypeLabel}` : null,
    `プラン: ${selectedPlan || '未設定'}`,
    'ここからは、記録だけでなく今の生活やしんどさも含めて一緒に見ていきます。',
  ].filter(Boolean).join('\n');
}

function pickFromNumeric(text, options) {
  const safe = normalizeText(text);
  const index = Number(safe) - 1;
  if (Number.isInteger(index) && options[index]) return options[index];
  return options.find((item) => safe.includes(item)) || null;
}

function pickAiType(text) {
  const safe = normalizeText(text);
  if (!safe) return null;

  const numericMap = {
    '1': AI_TYPE_VALUES.SOFT,
    '2': AI_TYPE_VALUES.BRIGHT,
    '3': AI_TYPE_VALUES.RELIABLE,
    '4': AI_TYPE_VALUES.STRONG,
  };
  if (numericMap[safe]) return numericMap[safe];

  for (const key of AI_TYPE_OPTIONS) {
    const label = getAiTypeLabel(key);
    if (normalizeLoose(label) === normalizeLoose(safe) || normalizeLoose(safe).includes(normalizeLoose(label))) {
      return key;
    }
  }

  const normalized = normalizeAiTypeInput(safe, '');
  return AI_TYPE_OPTIONS.includes(normalized) ? normalized : null;
}

function pickVoiceStyle(text) {
  const safe = normalizeText(text);
  if (!safe) return null;

  const numericMap = {
    '1': VOICE_STYLE_VALUES.SOFT,
    '2': VOICE_STYLE_VALUES.CHEERFUL,
    '3': VOICE_STYLE_VALUES.MIXED,
  };
  if (numericMap[safe]) return numericMap[safe];

  for (const key of VOICE_STYLE_OPTIONS) {
    const label = VOICE_STYLE_LABELS[key];
    if (normalizeLoose(label) === normalizeLoose(safe) || normalizeLoose(safe).includes(normalizeLoose(label))) {
      return key;
    }
  }

  if (/優しく|やさしく/.test(safe)) return VOICE_STYLE_VALUES.SOFT;
  if (/明るく/.test(safe)) return VOICE_STYLE_VALUES.CHEERFUL;
  if (/ときどき厳しく|時折り厳しく|普段優しく/.test(safe)) return VOICE_STYLE_VALUES.MIXED;
  return null;
}

function isStartTrigger(text) {
  return /無料体験開始|無料体験スタート|体験開始/.test(normalizeText(text));
}

function isProfileEditTrigger(text) {
  return /プロフィール変更|プロフィール修正|プロフィール入力/.test(normalizeText(text));
}

function isPeriodicCheckTrigger(text) {
  return /体質チェック|体調チェック|今の調子チェック|最近の整い具合|最近の調子チェック/.test(normalizeText(text));
}

function looksLikeProfilePayload(text) {
  return /名前[:：]|年齢[:：]|体重[:：]|体脂肪率[:：]|目標[:：]/.test(normalizeText(text));
}

function isOperationalMessage(text) {
  const safe = normalizeText(text);
  return /痛い|つらい|しんどい|苦しい|疲れ|眠い|歩いた|走った|ジョギング|スクワット|運動|食べた|ごはん|朝ごはん|昼ごはん|夜ごはん|ラーメン|カレー|寿司|LDL|血液検査|写真|画像|記録|まとめ|週間報告|月間報告|使い方|覚えてる|何時|何月何日/.test(safe);
}

async function startOnboarding(input, saveShortMemory) {
  await saveShortMemory(input.userId, { onboardingState: buildDefaultState('start') });
  return {
    handled: true,
    replyText: buildStartProfileMessage(),
    replyMessages: [buildTextReply(buildStartProfileMessage())],
  };
}

async function startProfileEdit(input, shortMemory, saveShortMemory) {
  await saveShortMemory(input.userId, {
    onboardingState: {
      ...(shortMemory?.onboardingState || buildDefaultState('profile_edit')),
      isActive: true,
      mode: 'profile_edit',
      currentStep: STEPS.PROFILE,
      surveyState: null,
    },
  });
  return {
    handled: true,
    replyText: buildEditProfileMessage(),
    replyMessages: [buildTextReply(buildEditProfileMessage())],
  };
}

async function startPeriodicCheck(input, saveShortMemory) {
  const surveyState = buildPeriodicCheckState();
  await saveShortMemory(input.userId, {
    onboardingState: {
      ...buildDefaultState('periodic_check'),
      currentStep: STEPS.PERIODIC_CHECK,
      surveyState,
    },
  });

  return {
    handled: true,
    replyText: PERIODIC_CHECK.introMessage,
    replyMessages: [buildSurveyQuestionMessage(surveyState, { includeIntro: true })],
    internal: { intentType: 'periodic_constitution_check', responseMode: 'guided' },
  };
}

async function handleProfileStep({ input, text, onboardingState, longMemory, saveShortMemory, mergeLongMemory }) {
  if (!looksLikeProfilePayload(text)) {
    if (isOperationalMessage(text) && onboardingState.mode !== 'profile_edit') return { handled: false };
    const replyText = onboardingState.mode === 'profile_edit' ? buildEditProfileMessage() : buildStartProfileMessage();
    return { handled: true, replyText, replyMessages: [buildTextReply(replyText)] };
  }

  const patch = profileService.extractProfilePatchFromText(text);
  if (!Object.keys(patch).length) {
    const replyText = onboardingState.mode === 'profile_edit' ? buildEditProfileMessage() : buildStartProfileMessage();
    return { handled: true, replyText, replyMessages: [buildTextReply(replyText)] };
  }

  await mergeLongMemory(input.userId, {
    ...patch,
    onboardingCompleted: onboardingState.mode === 'profile_edit' ? Boolean(longMemory?.onboardingCompleted) : false,
    trialStartedAt: longMemory?.trialStartedAt || new Date().toISOString(),
  });

  if (onboardingState.mode === 'profile_edit') {
    await saveShortMemory(input.userId, {
      onboardingState: {
        ...onboardingState,
        isActive: false,
        mode: null,
        currentStep: STEPS.COMPLETE,
        surveyState: null,
        answers: { ...(onboardingState.answers || {}), profile: patch },
      },
    });
    const replyText = profileService.buildProfileUpdatedReply(patch);
    return { handled: true, replyText, replyMessages: [buildTextReply(replyText)] };
  }

  await saveShortMemory(input.userId, {
    onboardingState: {
      ...onboardingState,
      currentStep: STEPS.AI_TYPE,
      completedSteps: [...new Set([...(onboardingState.completedSteps || []), STEPS.PROFILE])],
      answers: { ...(onboardingState.answers || {}), profile: patch },
      surveyState: null,
    },
  });

  return {
    handled: true,
    replyText: buildAiTypeQuestionText(),
    replyMessages: [buildAiTypeMessage()],
  };
}

async function handleAiTypeStep({ input, text, onboardingState, saveShortMemory, mergeLongMemory }) {
  if (isOperationalMessage(text)) return { handled: false };

  const selectedKey = pickAiType(text);
  if (!selectedKey) {
    return { handled: true, replyText: buildAiTypeQuestionText(), replyMessages: [buildAiTypeMessage()] };
  }

  const selectedLabel = getAiTypeLabel(selectedKey);
  await mergeLongMemory(input.userId, { aiType: selectedLabel });
  await saveShortMemory(input.userId, {
    onboardingState: {
      ...onboardingState,
      currentStep: STEPS.VOICE_STYLE,
      completedSteps: [...new Set([...(onboardingState.completedSteps || []), STEPS.AI_TYPE])],
      answers: {
        ...(onboardingState.answers || {}),
        aiType: selectedLabel,
        aiTypeKey: selectedKey,
      },
    },
  });

  return {
    handled: true,
    replyText: buildVoiceStyleQuestionText(),
    replyMessages: [buildVoiceStyleMessage()],
  };
}

async function handleVoiceStyleStep({ input, text, onboardingState, saveShortMemory, mergeLongMemory }) {
  if (isOperationalMessage(text)) return { handled: false };

  const selectedKey = pickVoiceStyle(text);
  if (!selectedKey) {
    return { handled: true, replyText: buildVoiceStyleQuestionText(), replyMessages: [buildVoiceStyleMessage()] };
  }

  const selectedLabel = VOICE_STYLE_LABELS[selectedKey];
  await mergeLongMemory(input.userId, { voiceStyle: selectedLabel });

  const surveyState = buildInitialSurveyState();
  await saveShortMemory(input.userId, {
    onboardingState: {
      ...onboardingState,
      currentStep: STEPS.CONSTITUTION_SURVEY,
      completedSteps: [...new Set([...(onboardingState.completedSteps || []), STEPS.VOICE_STYLE])],
      answers: {
        ...(onboardingState.answers || {}),
        voiceStyle: selectedLabel,
        voiceStyleKey: selectedKey,
      },
      surveyState,
    },
  });

  return {
    handled: true,
    replyText: INITIAL_SURVEY.introMessage,
    replyMessages: [buildSurveyQuestionMessage(surveyState, { includeIntro: true })],
  };
}

async function handleInitialConstitutionSurveyStep({ input, text, onboardingState, longMemory, saveShortMemory, mergeLongMemory }) {
  if (isOperationalMessage(text)) return { handled: false };

  const currentState = onboardingState?.surveyState || buildInitialSurveyState();
  const selectedAnswer = getInitialSurveyAnswerOption(text);
  if (!selectedAnswer) {
    return {
      handled: true,
      replyText: getCurrentQuestion(currentState)?.text || INITIAL_SURVEY.introMessage,
      replyMessages: [buildSurveyQuestionMessage(currentState)],
    };
  }

  const nextSurveyState = applySurveyAnswer(currentState, selectedAnswer.label);

  if (nextSurveyState.isActive) {
    await saveShortMemory(input.userId, {
      onboardingState: {
        ...onboardingState,
        currentStep: STEPS.CONSTITUTION_SURVEY,
        surveyState: nextSurveyState,
      },
    });

    const includeProgress = Number(nextSurveyState.currentIndex || 0) === Math.ceil(INITIAL_SURVEY.questions.length / 2);
    return {
      handled: true,
      replyText: getCurrentQuestion(nextSurveyState)?.text || '',
      replyMessages: [buildSurveyQuestionMessage(nextSurveyState, { includeProgress })],
    };
  }

  const evaluation = evaluateInitialSurvey(nextSurveyState.answers);
  await mergeLongMemory(input.userId, {
    constitutionType: evaluation.result.mainTypeLabel,
    constitutionMainType: evaluation.result.mainTypeLabel,
    constitutionSubType: evaluation.result.subTypeLabel,
    constitutionSurveyScores: evaluation.scores,
    constitutionSurveyAnswers: nextSurveyState.answers,
    constitutionCheckedAt: new Date().toISOString(),
  });

  await saveShortMemory(input.userId, {
    onboardingState: {
      ...onboardingState,
      currentStep: STEPS.PLAN,
      completedSteps: [...new Set([...(onboardingState.completedSteps || []), STEPS.CONSTITUTION_SURVEY])],
      answers: {
        ...(onboardingState.answers || {}),
        constitutionType: evaluation.result.mainTypeLabel,
        constitutionSubType: evaluation.result.subTypeLabel,
        constitutionResult: evaluation.result,
      },
      surveyState: null,
    },
  });

  return {
    handled: true,
    replyText: evaluation.result.text,
    replyMessages: [
      buildTextReply(evaluation.result.text),
      buildPlanMessage(),
    ],
    internal: {
      intentType: 'constitution_initial_result',
      responseMode: 'guided',
      constitutionMainType: evaluation.result.mainTypeLabel,
      constitutionSubType: evaluation.result.subTypeLabel,
    },
  };
}

async function handlePeriodicCheckStep({ input, text, onboardingState, longMemory, saveShortMemory, mergeLongMemory }) {
  if (isOperationalMessage(text)) return { handled: false };

  const currentState = onboardingState?.surveyState || buildPeriodicCheckState();
  const selectedAnswer = getPeriodicCheckAnswerOption(text);
  if (!selectedAnswer) {
    return {
      handled: true,
      replyText: getCurrentQuestion(currentState)?.text || PERIODIC_CHECK.introMessage,
      replyMessages: [buildSurveyQuestionMessage(currentState)],
    };
  }

  const nextSurveyState = applySurveyAnswer(currentState, selectedAnswer.label);

  if (nextSurveyState.isActive) {
    await saveShortMemory(input.userId, {
      onboardingState: {
        ...onboardingState,
        currentStep: STEPS.PERIODIC_CHECK,
        surveyState: nextSurveyState,
      },
    });

    return {
      handled: true,
      replyText: getCurrentQuestion(nextSurveyState)?.text || '',
      replyMessages: [buildSurveyQuestionMessage(nextSurveyState)],
      internal: { intentType: 'periodic_constitution_check', responseMode: 'guided' },
    };
  }

  const previousDeltaMap = longMemory?.periodicConstitutionDeltaMap || {};
  const currentDeltaMap = scorePeriodicCheck(nextSurveyState.answers);
  const summary = buildPeriodicCheckSummary(previousDeltaMap, currentDeltaMap);

  await mergeLongMemory(input.userId, {
    periodicConstitutionAnswers: nextSurveyState.answers,
    periodicConstitutionDeltaMap: currentDeltaMap,
    periodicConstitutionCheckedAt: new Date().toISOString(),
  });

  await saveShortMemory(input.userId, {
    onboardingState: {
      ...onboardingState,
      isActive: false,
      mode: null,
      currentStep: STEPS.COMPLETE,
      surveyState: null,
      answers: { ...(onboardingState.answers || {}), periodicSummary: summary },
    },
  });

  return {
    handled: true,
    replyText: summary,
    replyMessages: [buildTextReply(summary)],
    internal: { intentType: 'periodic_constitution_result', responseMode: 'answer' },
  };
}

async function handlePlanStep({ input, text, onboardingState, saveShortMemory, mergeLongMemory }) {
  if (isOperationalMessage(text)) return { handled: false };

  const selected = planService.pickPlanFromText(text);
  if (!selected) {
    return { handled: true, replyText: buildPlanQuestionText(), replyMessages: [buildPlanMessage()] };
  }

  await mergeLongMemory(input.userId, {
    selectedPlan: selected,
    onboardingCompleted: true,
    planFeatures: planService.getPlanFeatures(selected),
  });

  const finalState = {
    ...onboardingState,
    isActive: false,
    mode: null,
    currentStep: STEPS.COMPLETE,
    completedSteps: [...new Set([...(onboardingState.completedSteps || []), STEPS.PLAN])],
    answers: { ...(onboardingState.answers || {}), plan: selected },
    surveyState: null,
  };

  await saveShortMemory(input.userId, { onboardingState: finalState });
  const replyText = buildCompleteMessage(finalState, selected);

  return {
    handled: true,
    replyText,
    replyMessages: [buildTextReply(replyText, ['どう使うの？', '56.8kg', '朝: トーストと卵', 'グラフ出して'])],
  };
}

async function maybeHandleOnboarding({ input, shortMemory, longMemory, saveShortMemory, mergeLongMemory }) {
  const text = normalizeText(input?.rawText || '');
  if (!text && input?.messageType !== 'text') return { handled: false };

  if (isStartTrigger(text)) return startOnboarding(input, saveShortMemory);
  if (isProfileEditTrigger(text)) return startProfileEdit(input, shortMemory, saveShortMemory);
  if (isPeriodicCheckTrigger(text)) return startPeriodicCheck(input, saveShortMemory);

  const onboardingState = shortMemory?.onboardingState || buildDefaultState('start');
  if (!onboardingState?.isActive) return { handled: false };

  if (onboardingState.currentStep === STEPS.PROFILE) {
    return handleProfileStep({ input, text, onboardingState, longMemory, saveShortMemory, mergeLongMemory });
  }
  if (onboardingState.currentStep === STEPS.AI_TYPE) {
    return handleAiTypeStep({ input, text, onboardingState, saveShortMemory, mergeLongMemory });
  }
  if (onboardingState.currentStep === STEPS.VOICE_STYLE) {
    return handleVoiceStyleStep({ input, text, onboardingState, saveShortMemory, mergeLongMemory });
  }
  if (onboardingState.currentStep === STEPS.CONSTITUTION_SURVEY) {
    return handleInitialConstitutionSurveyStep({ input, text, onboardingState, longMemory, saveShortMemory, mergeLongMemory });
  }
  if (onboardingState.currentStep === STEPS.PERIODIC_CHECK) {
    return handlePeriodicCheckStep({ input, text, onboardingState, longMemory, saveShortMemory, mergeLongMemory });
  }
  if (onboardingState.currentStep === STEPS.PLAN) {
    return handlePlanStep({ input, text, onboardingState, saveShortMemory, mergeLongMemory });
  }

  return { handled: false };
}

module.exports = {
  STEPS,
  VOICE_STYLE_VALUES,
  VOICE_STYLE_LABELS,
  buildStartProfileMessage,
  buildEditProfileMessage,
  buildAiTypeMessage,
  buildVoiceStyleMessage,
  buildPlanMessage,
  buildCompleteMessage,
  isStartTrigger,
  isProfileEditTrigger,
  isPeriodicCheckTrigger,
  looksLikeProfilePayload,
  maybeHandleOnboarding,
};
