'use strict';

const profileService = require('./profile_service');
const planService = require('./plan_service');

const STEPS = {
  PROFILE: 'profile',
  AI_TYPE: 'ai_type',
  VOICE_STYLE: 'voice_style',
  CONSTITUTION: 'constitution',
  PLAN: 'plan',
  COMPLETE: 'complete'
};

const AI_TYPES = [
  'そっと寄り添う',
  '明るく後押し',
  '頼もしく導く',
  '力強く支える'
];

const VOICE_STYLES = [
  'いつも優しく',
  'いつも明るく',
  '普段優しく、ときどき厳しく'
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

function containsQuestionTone(text) {
  return /教えて|知りたい|できますか|できる|ですか|ますか|\?|？|何が|何を|どう/.test(normalizeText(text));
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
    '1. そっと寄り添う',
    '2. 明るく後押し',
    '3. 頼もしく導く',
    '4. 力強く支える'
  ].join('\n');
}

function buildVoiceStyleQuestion() {
  return [
    '話し方の雰囲気を選んでください。',
    '1. いつも優しく',
    '2. いつも明るく',
    '3. 普段優しく、ときどき厳しく'
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

function buildConstitutionInsightMessage(type, profile = {}, aiType = '') {
  const goal = normalizeText(profile?.goal || '');
  const aiTone = normalizeText(aiType || '');

  if (type === '糖質で太りやすい') {
    return [
      'なるほど、糖質で太りやすい感覚が近いんですね。',
      'このタイプは、パン・麺・ごはんが重なる日が続くと体重が動きやすい一方で、食べ方の波が整い始めると変化も見えやすいです。',
      '弱いところは「気づかないうちに糖質が重なりやすい」ところ。逆に強いところは、食べる順番や量の置き方が合うと流れを立て直しやすいところです。',
      goal ? `ここから。では、${goal}に向けて我慢で押し切るより、続けられる配分を一緒に作っていきます。` : 'ここから。では、我慢で押し切るより、続けられる配分を一緒に作っていきます。'
    ].join('\n');
  }

  if (type === '脂質で太りやすい') {
    return [
      '脂質で太りやすい感覚が近いんですね。',
      'このタイプは、揚げ物やチーズ系が続くと数字に出やすい一方で、選び方を少し変えるだけでも戻しやすいです。',
      '弱いところは、量が少なくても重なりやすいところ。強いところは、選択を少し変えただけでも差が出やすいところです。',
      'ここから。では、我慢だけでなく「何を残して何を軽くするか」を一緒に決めていきます。',
    ].join('\n');
  }

  if (type === 'むくみやすい') {
    return [
      'むくみやすいタイプの感覚が近いんですね。',
      'このタイプは体重の数字だけで落ち込みやすいけれど、水分や塩分、巡りで見え方がかなり変わります。',
      '弱いところは数字に振られやすいこと。強いところは、整った時の軽さが体感として分かりやすいことです。',
      'ここから。では、体重だけで責めずに、巡りや軽さの感覚も一緒に拾っていきます。',
    ].join('\n');
  }

  if (type === 'ストレス食いしやすい') {
    return [
      'ストレス食いしやすい感覚が近いんですね。',
      'このタイプは意思の弱さではなく、疲れや緊張が食べ方に出やすいだけという見方が大事です。',
      '弱いところは、しんどい日に崩れやすいこと。強いところは、安心できる流れができると一気に整いやすいことです。',
      'ここから。では、食事だけを責めずに、しんどさの波ごと一緒に見ていきます。',
    ].join('\n');
  }

  return aiTone.includes('理屈')
    ? '体質は途中で見直しても大丈夫です。まずは記録を増やしながら、どこで流れが崩れやすいかを一緒に見ていきましょう。'
    : '体質はあとから見直しても大丈夫です。まずは今の生活の流れを一緒に見ながら、合う整え方を探していきましょう。';
}

function buildCompleteMessage(onboardingState, selectedPlan) {
  const answers = onboardingState?.answers || {};
  const profile = answers.profile || {};
  return [
    'ここまでで伴走の土台はそろいました。',
    `AIタイプ: ${answers.aiType || '未設定'}`,
    `雰囲気: ${answers.voiceStyle || '未設定'}`,
    `体質タイプ: ${answers.constitutionType || '未設定'}`,
    `プラン: ${selectedPlan || '未設定'}`,
    buildConstitutionInsightMessage(answers.constitutionType || '', profile, answers.aiType || ''),
    'ここからは、食事・運動・体重を積み上げながら、今の生活やしんどさも一緒に見ていきます。'
  ].filter(Boolean).join('\n');
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
    return 'プロフィール変更はいったん終了しました。再開は「プロフィール変更」、通常相談はそのまま質問で大丈夫です。';
  }
  return '無料体験入力はいったん終了しました。再開は「無料体験開始」、通常相談はそのまま質問で大丈夫です。';
}

function looksLikeProfilePayload(text) {
  return Object.keys(profileService.extractProfilePatchFromText(text)).length > 0;
}

function isOperationalMessage(text) {
  const safe = normalizeText(text);
  return /痛い|つらい|しんどい|苦しい|疲れ|眠い|歩いた|走った|ジョギング|スクワット|運動|食べた|ごはん|朝ごはん|昼ごはん|夜ごはん|ラーメン|カレー|寿司|LDL|血液検査|写真|画像|記録|まとめ|週間報告|月間報告|使い方|覚えてる|何時|何月何日|無料体験|プラン|AIタイプ|コマンド|総カロリー|私の体重は|体重は\?|体脂肪率は\?|ストレッチ教えて/.test(safe);
}

function buildCurrentProfileSummary(longMemory = {}, localProfile = {}) {
  const merged = {
    preferredName: localProfile.preferredName || longMemory.preferredName || '',
    age: localProfile.age || longMemory.age || '',
    height: localProfile.height || longMemory.height || '',
    weight: localProfile.weight || longMemory.weight || '',
    bodyFat: localProfile.bodyFat || longMemory.bodyFat || '',
    goal: localProfile.goal || longMemory.goal || ''
  };
  const lines = [
    merged.preferredName ? `名前: ${merged.preferredName}` : null,
    merged.age ? `年齢: ${merged.age}` : null,
    merged.height ? `身長: ${merged.height}` : null,
    merged.weight ? `体重: ${merged.weight}` : null,
    merged.bodyFat ? `体脂肪率: ${merged.bodyFat}` : null,
    merged.goal ? `目標: ${merged.goal}` : null
  ].filter(Boolean);
  if (!lines.length) return 'いま見えているプロフィールはまだ少なめです。分かる項目だけ送ってもらえれば、その都度反映できます。';
  return ['今わかっているプロフィールはこんな感じです。', ...lines].join('\n');
}

function answerDuringOnboarding(text, onboardingState, longMemory) {
  const safe = normalizeText(text);
  const profile = onboardingState?.answers?.profile || {};
  if (!safe) return null;

  if (/質問できる|相談できる|何が質問|何を聞ける|使い方/.test(safe)) {
    return 'はい、できます。体調・食事・体重・血液検査のことはそのまま聞いて大丈夫です。入力はあとで続けられます。';
  }
  if (/私のプロフィール|プロフィールは|今のプロフィール/.test(safe)) {
    return buildCurrentProfileSummary(longMemory, profile);
  }
  if (/入力フォーム|抜けられない|終わらせたい/.test(safe)) {
    return 'いまは入力フローを止められます。「終わり」で終了、「無料体験開始」で再開できます。相談はそのまま続けられます。';
  }
  if (/無料体験|プロフィール入力/.test(safe) && /戻る|ループ|進めない|困/.test(safe)) {
    return '入力ループになっている時は、先に質問へ答えます。必要なら「終わり」で入力を閉じてから通常相談に切り替えてください。';
  }
  return null;
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
  if (containsQuestionTone(text)) {
    const direct = answerDuringOnboarding(text, onboardingState, longMemory);
    if (direct) return { handled: true, replyText: direct };
    return { handled: false };
  }

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
    return { handled: true, replyText: onboardingState.mode === 'profile_edit'
      ? '変更したい項目だけ送ってください。例: 体重62 / 目標55kg'
      : '分かる項目だけで大丈夫です。例: 名前〇〇 / 身長160 / 目標55kg' };
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

  const selected = pickFromNumeric(text, AI_TYPES)
    || (/やさしく伴走/.test(text) ? 'そっと寄り添う' : null)
    || (/背中を押す/.test(text) ? '明るく後押し' : null)
    || (/理屈で整理|バランス型/.test(text) ? '頼もしく導く' : null);
  if (!selected) {
    if (!looksLikeSelectionAttempt(text, AI_TYPES, 4)) return { handled: false };
    return { handled: true, replyText: buildAiTypeQuestion() };
  }

  await mergeLongMemory(input.userId, { aiType: selected });
  await saveShortMemory(input.userId, {
    onboardingState: {
      ...onboardingState,
      currentStep: STEPS.VOICE_STYLE,
      completedSteps: [...new Set([...(onboardingState.completedSteps || []), STEPS.AI_TYPE])],
      answers: { ...(onboardingState.answers || {}), aiType: selected }
    }
  });

  return { handled: true, replyText: buildVoiceStyleQuestion() };
}

async function handleVoiceStyleStep({ input, text, onboardingState, saveShortMemory, mergeLongMemory }) {
  if (isOperationalMessage(text)) return { handled: false };

  const selected = pickFromNumeric(text, VOICE_STYLES);
  if (!selected) {
    if (!looksLikeSelectionAttempt(text, VOICE_STYLES, 3)) return { handled: false };
    return { handled: true, replyText: buildVoiceStyleQuestion() };
  }

  await mergeLongMemory(input.userId, { voiceStyle: selected });
  await saveShortMemory(input.userId, {
    onboardingState: {
      ...onboardingState,
      currentStep: STEPS.CONSTITUTION,
      completedSteps: [...new Set([...(onboardingState.completedSteps || []), STEPS.VOICE_STYLE])],
      answers: { ...(onboardingState.answers || {}), voiceStyle: selected }
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

  const profile = onboardingState?.answers?.profile || {};
  return {
    handled: true,
    replyText: [
      buildConstitutionInsightMessage(selected, profile, onboardingState?.answers?.aiType || ''),
      '',
      buildPlanQuestion()
    ].join('\n')
  };
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

  if (onboardingState?.isActive && input?.messageType === 'text') {
    const direct = answerDuringOnboarding(text, onboardingState, longMemory);
    if (direct) return { handled: true, replyText: direct };
  }

  if (onboardingState.currentStep === STEPS.PROFILE) {
    return handleProfileStep({ input, text, onboardingState, longMemory, saveShortMemory, mergeLongMemory, persistAuthoritativeProfile });
  }
  if (onboardingState.currentStep === STEPS.AI_TYPE) {
    return handleAiTypeStep({ input, text, onboardingState, saveShortMemory, mergeLongMemory });
  }
  if (onboardingState.currentStep === STEPS.VOICE_STYLE) {
    return handleVoiceStyleStep({ input, text, onboardingState, saveShortMemory, mergeLongMemory });
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
  VOICE_STYLES,
  CONSTITUTION_TYPES,
  buildStartProfileMessage,
  buildEditProfileMessage,
  buildAiTypeQuestion,
  buildVoiceStyleQuestion,
  buildConstitutionQuestion,
  buildPlanQuestion,
  buildCompleteMessage,
  isStartTrigger,
  isProfileEditTrigger,
  isOnboardingExitTrigger,
  looksLikeProfilePayload,
  maybeHandleOnboarding
};