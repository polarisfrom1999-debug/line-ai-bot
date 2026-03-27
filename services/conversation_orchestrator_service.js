'use strict';

const contextMemoryService = require('./context_memory_service');
const aiChatService = require('./ai_chat_service');
const onboardingService = require('./onboarding_service');

function normalizeText(value) {
  return String(value || '').trim();
}

function clampScore(value) {
  return Math.min(10, Math.max(1, Number(value || 5)));
}

function simpleTimeAnswer() {
  const now = new Date();
  return `今は ${now.getHours()}時${String(now.getMinutes()).padStart(2, '0')}分くらいです。`;
}

function detectIntent(input) {
  const text = normalizeText(input?.rawText || '');

  if (/今何時|何時|何月何日|今日何日/.test(text)) return 'time_question';
  if (/私の名前|何を覚えてる|覚えている|覚えてる/.test(text)) return 'memory_question';
  if (/無料体験開始|スタート|開始|プロフィール変更|プロフィール入力|プロフィール/.test(text)) return 'onboarding';
  return 'normal';
}

function buildMemoryAnswer(longMemory) {
  const parts = [];
  if (longMemory?.preferredName) parts.push(`名前は「${longMemory.preferredName}」として覚えています。`);
  if (longMemory?.weight) parts.push(`体重は ${longMemory.weight} として見ています。`);
  if (longMemory?.bodyFat) parts.push(`体脂肪率は ${longMemory.bodyFat} として見ています。`);
  if (longMemory?.age) parts.push(`年齢は ${longMemory.age} として見ています。`);
  if (longMemory?.aiType) parts.push(`AIタイプは「${longMemory.aiType}」です。`);
  if (longMemory?.constitutionType) parts.push(`体質タイプは「${longMemory.constitutionType}」です。`);
  if (longMemory?.selectedPlan) parts.push(`プランは「${longMemory.selectedPlan}」です。`);

  if (!parts.length) {
    return '今はまだ強く残っていることは多くないので、これから少しずつ覚えていきますね。';
  }

  return parts.join('\n');
}

async function appendTurn(userId, userText, replyText) {
  await contextMemoryService.appendRecentMessage(userId, 'user', userText);
  await contextMemoryService.appendRecentMessage(userId, 'assistant', replyText);
}

async function orchestrateConversation(input) {
  try {
    const shortMemory = await contextMemoryService.getShortMemory(input.userId);
    const longMemory = await contextMemoryService.getLongMemory(input.userId);
    const userStateBefore = await contextMemoryService.getUserState(input.userId);
    const recentSummary = await contextMemoryService.buildRecentSummary(input.userId, 3);
    const recentMessages = await contextMemoryService.getRecentMessages(input.userId, 20);

    const intent = detectIntent(input);

    const nextState = {
      nagiScore: clampScore((userStateBefore?.nagiScore || 5) + (/安心|大丈夫/.test(input.rawText || '') ? 0.3 : 0)),
      gasolineScore: clampScore((userStateBefore?.gasolineScore || 5) + (/眠い|疲れ/.test(input.rawText || '') ? -0.5 : 0)),
      trustScore: clampScore((userStateBefore?.trustScore || 3) + 0.1),
      lastEmotionTone: /眠い|疲れ/.test(input.rawText || '') ? 'tired' : 'neutral',
      updatedAt: new Date().toISOString()
    };
    await contextMemoryService.updateUserState(input.userId, nextState);

    const onboarding = await onboardingService.maybeHandleOnboarding({
      input,
      shortMemory,
      longMemory,
      saveShortMemory: contextMemoryService.saveShortMemory,
      mergeLongMemory: contextMemoryService.mergeLongMemory
    });

    if (onboarding?.handled) {
      await appendTurn(input.userId, input.rawText || '', onboarding.replyText);
      return {
        ok: true,
        replyMessages: [{ type: 'text', text: onboarding.replyText }],
        internal: { intentType: 'onboarding', responseMode: 'guided' }
      };
    }

    if (intent === 'time_question') {
      const replyText = simpleTimeAnswer();
      await appendTurn(input.userId, input.rawText || '', replyText);
      return {
        ok: true,
        replyMessages: [{ type: 'text', text: replyText }],
        internal: { intentType: 'time_question', responseMode: 'answer' }
      };
    }

    if (intent === 'memory_question') {
      const replyText = buildMemoryAnswer(await contextMemoryService.getLongMemory(input.userId));
      await appendTurn(input.userId, input.rawText || '', replyText);
      return {
        ok: true,
        replyMessages: [{ type: 'text', text: replyText }],
        internal: { intentType: 'memory_question', responseMode: 'answer' }
      };
    }

    if (/^名前[:：]|^体重[:：]|^体脂肪率[:：]|^年齢[:：]|^目標[:：]/.test(normalizeText(input.rawText))) {
      const profileService = require('./profile_service');
      const patch = profileService.extractProfilePatchFromText(input.rawText);
      if (Object.keys(patch).length) {
        await contextMemoryService.mergeLongMemory(input.userId, patch);
        const longMemoryAfter = await contextMemoryService.getLongMemory(input.userId);
        const replyText = buildMemoryAnswer(longMemoryAfter);
        await appendTurn(input.userId, input.rawText || '', replyText);
        return {
          ok: true,
          replyMessages: [{ type: 'text', text: replyText }],
          internal: { intentType: 'profile_update', responseMode: 'answer' }
        };
      }
    }

    if (/覚えてくれましたか|覚えていたら|もう一度名前と体重と体脂肪率/.test(normalizeText(input.rawText))) {
      const longMemoryAfter = await contextMemoryService.getLongMemory(input.userId);
      const replyText = buildMemoryAnswer(longMemoryAfter);
      await appendTurn(input.userId, input.rawText || '', replyText);
      return {
        ok: true,
        replyMessages: [{ type: 'text', text: replyText }],
        internal: { intentType: 'memory_question', responseMode: 'answer' }
      };
    }

    if (/うっし〜って呼んで|うっし～って呼んで|うっし〜と呼んで|うっし～と呼んで/.test(normalizeText(input.rawText))) {
      await contextMemoryService.mergeLongMemory(input.userId, { preferredName: 'うっし〜' });
      const replyText = 'いいですね。これからは「うっし〜」って呼びますね。';
      await appendTurn(input.userId, input.rawText || '', replyText);
      return {
        ok: true,
        replyMessages: [{ type: 'text', text: replyText }],
        internal: { intentType: 'profile_update', responseMode: 'answer' }
      };
    }

    const longMemoryLatest = await contextMemoryService.getLongMemory(input.userId);
    const systemHint = [
      '[開始導線ルール]',
      '- まだ onboardingCompleted でない場合は、必要に応じて開始導線へ戻しやすくする',
      '- すでにプロフィールがあるなら自然に活かす',
      `[プロフィール要約]`,
      `- 名前: ${longMemoryLatest?.preferredName || '未設定'}`,
      `- 年齢: ${longMemoryLatest?.age || '未設定'}`,
      `- 体重: ${longMemoryLatest?.weight || '未設定'}`,
      `- 体脂肪率: ${longMemoryLatest?.bodyFat || '未設定'}`,
      `- AIタイプ: ${longMemoryLatest?.aiType || '未設定'}`,
      `- 体質タイプ: ${longMemoryLatest?.constitutionType || '未設定'}`,
      `- プラン: ${longMemoryLatest?.selectedPlan || '未設定'}`,
      recentSummary ? `- 最近の流れ: ${recentSummary}` : null
    ].filter(Boolean).join('\n');

    const replyText = await aiChatService.generateReply({
      userId: input.userId,
      userMessage: input.rawText || '',
      recentMessages,
      intentType: 'normal',
      responseMode: 'empathy_plus_one_hint',
      hiddenContext: systemHint
    });

    await appendTurn(input.userId, input.rawText || '', replyText);

    return {
      ok: true,
      replyMessages: [{ type: 'text', text: replyText }],
      internal: { intentType: 'normal', responseMode: 'empathy_plus_one_hint' }
    };
  } catch (error) {
    console.error('[conversation_orchestrator] fatal error:', error?.message || error);
    return {
      ok: true,
      replyMessages: [{ type: 'text', text: '今ちょっとうまく受け取れなかったので、もう一度だけ送ってもらえたら大丈夫です。' }],
      internal: { intentType: 'fallback', responseMode: 'empathy_only' }
    };
  }
}

module.exports = {
  orchestrateConversation
};
