'use strict';

const contextMemoryService = require('./context_memory_service');
const aiChatService = require('./ai_chat_service');
const onboardingService = require('./onboarding_service');
const weeklyReportService = require('./weekly_report_service');
const labImageAnalysisService = require('./lab_image_analysis_service');
const lineMediaService = require('./line_media_service');

function normalizeText(value) {
  return String(value || '').trim();
}

function clampScore(value) {
  return Math.min(10, Math.max(1, Number(value || 5)));
}

function getJapanNow() {
  const now = new Date();
  const parts = new Intl.DateTimeFormat('ja-JP', {
    timeZone: 'Asia/Tokyo',
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    hour12: false
  }).formatToParts(now);

  const obj = {};
  for (const part of parts) {
    obj[part.type] = part.value;
  }

  return {
    year: obj.year,
    month: obj.month,
    day: obj.day,
    hour: obj.hour,
    minute: obj.minute
  };
}

function simpleTimeAnswer() {
  const now = getJapanNow();
  return `今日は${now.month}月${now.day}日、今は${now.hour}時${now.minute}分くらいです。`;
}

function detectIntent(input) {
  const text = normalizeText(input?.rawText || '');

  if (/今何時|何時|何月何日|今日何日|何時何分/.test(text)) return 'time_question';
  if (/私の名前|何を覚えてる|覚えている|覚えてる|私の体重|私の体脂肪率/.test(text)) return 'memory_question';
  if (/週間報告|週刊報告|今週のまとめ/.test(text)) return 'weekly_report';
  if (/今日の食事記録|今日の記録|食事記録教えて/.test(text)) return 'today_records';
  if (/使い方教えて|使い方/.test(text)) return 'help';
  if (/無料体験開始|スタート|開始|プロフィール変更|プロフィール入力/.test(text)) return 'onboarding';
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

function buildTodayRecordsAnswer(records) {
  const lines = [];

  if (records.meals.length) {
    lines.push(`今日の食事記録: ${records.meals.length}件`);
    for (const meal of records.meals.slice(-5)) {
      const name = meal.name || meal.summary || '食事';
      const kcal = meal.kcal ? ` 約${meal.kcal}kcal` : '';
      lines.push(`- ${name}${kcal}`);
    }
  } else {
    lines.push('今日の食事記録はまだ見当たりません。');
  }

  if (records.exercises.length) {
    lines.push(`今日の運動記録: ${records.exercises.length}件`);
    for (const ex of records.exercises.slice(-5)) {
      lines.push(`- ${ex.summary || ex.name || '運動'}`);
    }
  }

  return lines.join('\n');
}

function buildHelpAnswer() {
  return [
    '使い方はこんな感じです。',
    '・食事は写真でも文字でも送れます',
    '・体重、体脂肪率、運動もそのまま送れます',
    '・血液検査画像を送ってから LDL などを聞けます',
    '・「今日の食事記録教えて」「週間報告して」でも確認できます'
  ].join('\n');
}

function parseProfileInline(text) {
  const safe = normalizeText(text);
  const patch = {};

  const nameMatch = safe.match(/名前[は：:]?\s*([^\n]+)/);
  const ageMatch = safe.match(/年齢[は：:]?\s*([0-9０-９]+)/);
  const weightMatch = safe.match(/体重[は：:]?\s*([^\n]+)/);
  const bodyFatMatch = safe.match(/体脂肪率[は：:]?\s*([^\n]+)/);

  if (nameMatch) patch.preferredName = nameMatch[1].trim();
  if (ageMatch) patch.age = ageMatch[1].trim();
  if (weightMatch) patch.weight = weightMatch[1].trim();
  if (bodyFatMatch) patch.bodyFat = bodyFatMatch[1].trim();

  return patch;
}

function detectExerciseRecord(text) {
  const safe = normalizeText(text);
  if (/スクワット/.test(safe)) return { type: 'exercise', summary: safe, name: 'スクワット' };
  if (/ジョギング|走りました|走った|ランニング/.test(safe)) return { type: 'exercise', summary: safe, name: 'ジョギング' };
  if (/歩いた|ウォーキング/.test(safe)) return { type: 'exercise', summary: safe, name: 'ウォーキング' };
  return null;
}

function detectMealRecord(text) {
  const safe = normalizeText(text);
  if (/朝ごはん|昼ごはん|夜ごはん|ラーメン|カレー|寿司|食べた/.test(safe)) {
    return { type: 'meal', summary: safe, name: safe };
  }
  return null;
}

function detectWeightRecord(text) {
  const safe = normalizeText(text);
  if (/体重/.test(safe) || /^[0-9０-９\.]+ ?(kg|キロ)/i.test(safe)) {
    return { type: 'weight', summary: safe };
  }
  return null;
}

async function maybeSaveSimpleRecord(userId, text) {
  const meal = detectMealRecord(text);
  if (meal) await contextMemoryService.addDailyRecord(userId, meal);

  const exercise = detectExerciseRecord(text);
  if (exercise) await contextMemoryService.addDailyRecord(userId, exercise);

  const weight = detectWeightRecord(text);
  if (weight) await contextMemoryService.addDailyRecord(userId, weight);
}

async function maybeHandleLabImage(input, shortMemory, saveShortMemory) {
  if (input?.messageType !== 'image') return null;

  const imagePayload = await lineMediaService.getImagePayload(input);
  if (!imagePayload) return null;

  const lab = await labImageAnalysisService.analyzeLabImage(imagePayload);
  if (!lab?.isLabImage || !Array.isArray(lab.items) || !lab.items.length) return null;

  await saveShortMemory(input.userId, {
    followUpContext: {
      source: 'image',
      imageType: 'lab',
      extractedItems: lab.items
    }
  });

  await contextMemoryService.addDailyRecord(input.userId, {
    type: 'lab',
    summary: '血液検査画像',
    items: lab.items
  });

  const preview = lab.items.slice(0, 5).map((item) => `${item.itemName} ${item.value}${item.unit ? ` ${item.unit}` : ''}`).join(' / ');
  return `血液検査画像を受け取りました。\n読み取れた主な項目: ${preview}`;
}

function maybeAnswerLabFollowUp(text, shortMemory) {
  const safe = normalizeText(text);
  if (!/LDL|HDL|中性脂肪|HbA1c|AST|ALT/i.test(safe)) return null;

  const items = shortMemory?.followUpContext?.imageType === 'lab'
    ? shortMemory.followUpContext.extractedItems || []
    : [];

  if (!items.length) return null;

  const target = items.find((item) => safe.toUpperCase().includes(String(item.itemName || '').toUpperCase()));
  if (!target) return null;

  return `${target.itemName} は ${target.value}${target.unit ? ` ${target.unit}` : ''} と読めました。`;
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
    const text = normalizeText(input.rawText || '');

    const nextState = {
      nagiScore: clampScore((userStateBefore?.nagiScore || 5) + (/安心|大丈夫/.test(text) ? 0.3 : 0)),
      gasolineScore: clampScore((userStateBefore?.gasolineScore || 5) + (/眠い|疲れ/.test(text) ? -0.5 : 0)),
      trustScore: clampScore((userStateBefore?.trustScore || 3) + 0.1),
      lastEmotionTone: /眠い|疲れ/.test(text) ? 'tired' : 'neutral',
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

    const labImageReply = await maybeHandleLabImage(input, shortMemory, contextMemoryService.saveShortMemory);
    if (labImageReply) {
      await appendTurn(input.userId, input.rawText || '[image]', labImageReply);
      return {
        ok: true,
        replyMessages: [{ type: 'text', text: labImageReply }],
        internal: { intentType: 'lab_image', responseMode: 'answer' }
      };
    }

    const labFollowUpReply = maybeAnswerLabFollowUp(text, await contextMemoryService.getShortMemory(input.userId));
    if (labFollowUpReply) {
      await appendTurn(input.userId, input.rawText || '', labFollowUpReply);
      return {
        ok: true,
        replyMessages: [{ type: 'text', text: labFollowUpReply }],
        internal: { intentType: 'lab_followup', responseMode: 'answer' }
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

    if (intent === 'weekly_report') {
      const records = await contextMemoryService.getTodayRecords(input.userId);
      const replyText = await weeklyReportService.buildWeeklyReport({
        longMemory: await contextMemoryService.getLongMemory(input.userId),
        recentMessages,
        todayRecords: records
      });
      await appendTurn(input.userId, input.rawText || '', replyText);
      return {
        ok: true,
        replyMessages: [{ type: 'text', text: replyText }],
        internal: { intentType: 'weekly_report', responseMode: 'answer' }
      };
    }

    if (intent === 'today_records') {
      const records = await contextMemoryService.getTodayRecords(input.userId);
      const replyText = buildTodayRecordsAnswer(records);
      await appendTurn(input.userId, input.rawText || '', replyText);
      return {
        ok: true,
        replyMessages: [{ type: 'text', text: replyText }],
        internal: { intentType: 'today_records', responseMode: 'answer' }
      };
    }

    if (intent === 'help') {
      const replyText = buildHelpAnswer();
      await appendTurn(input.userId, input.rawText || '', replyText);
      return {
        ok: true,
        replyMessages: [{ type: 'text', text: replyText }],
        internal: { intentType: 'help', responseMode: 'answer' }
      };
    }

    const profileInlinePatch = parseProfileInline(text);
    if (Object.keys(profileInlinePatch).length) {
      await contextMemoryService.mergeLongMemory(input.userId, profileInlinePatch);
      const longMemoryAfter = await contextMemoryService.getLongMemory(input.userId);
      const replyText = buildMemoryAnswer(longMemoryAfter);
      await appendTurn(input.userId, input.rawText || '', replyText);
      return {
        ok: true,
        replyMessages: [{ type: 'text', text: replyText }],
        internal: { intentType: 'profile_update', responseMode: 'answer' }
      };
    }

    if (/うっし〜って呼んで|うっし～って呼んで|うっし〜と呼んで|うっし～と呼んで/.test(text)) {
      await contextMemoryService.mergeLongMemory(input.userId, { preferredName: 'うっし〜' });
      const replyText = 'いいですね。これからは「うっし〜」って呼びますね。';
      await appendTurn(input.userId, input.rawText || '', replyText);
      return {
        ok: true,
        replyMessages: [{ type: 'text', text: replyText }],
        internal: { intentType: 'profile_update', responseMode: 'answer' }
      };
    }

    await maybeSaveSimpleRecord(input.userId, text);

    const longMemoryLatest = await contextMemoryService.getLongMemory(input.userId);
    const systemHint = [
      '[伴走OSルール]',
      '- 受け止めを先に置く',
      '- 提案は多くて1つ',
      '- 管理者のような言い方は禁止',
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
