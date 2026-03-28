services/conversation_orchestrator_service.js
'use strict';

const contextMemoryService = require('./context_memory_service');
const aiChatService = require('./ai_chat_service');
const onboardingService = require('./onboarding_service');
const weeklyReportService = require('./weekly_report_service');
const lineMediaService = require('./line_media_service');
const mealAnalysisService = require('./meal_analysis_service');
const labImageAnalysisService = require('./lab_image_analysis_service');

function normalizeText(value) {
  return String(value || '').trim();
}

function clampScore(value) {
  return Math.min(10, Math.max(1, Number(value || 5)));
}

function round1(value) {
  return Math.round((Number(value || 0) + Number.EPSILON) * 10) / 10;
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

  const result = {};
  for (const part of parts) {
    result[part.type] = part.value;
  }

  return {
    year: result.year,
    month: result.month,
    day: result.day,
    hour: result.hour,
    minute: result.minute
  };
}

function buildTimeAnswer() {
  const now = getJapanNow();
  return `今日は${now.month}月${now.day}日、今は${now.hour}時${now.minute}分くらいです。`;
}

function detectIntent(input) {
  const text = normalizeText(input?.rawText || '');

  if (/今何時|何時|何月何日|今日何日|何時何分/.test(text)) return 'time_question';
  if (/私の名前|私の体重|私の体脂肪率|何を覚えてる|覚えてる|覚えていますか/.test(text)) return 'memory_question';
  if (/週間報告|週刊報告|今週のまとめ/.test(text)) return 'weekly_report';
  if (/今日の食事記録|今日の記録|食事記録教えて/.test(text)) return 'today_records';
  if (/使い方教えて|使い方/.test(text)) return 'help';
  if (/無料体験開始|無料体験スタート|体験開始|プロフィール変更|プロフィール入力|プロフィール修正/.test(text)) return 'onboarding';
  return 'normal';
}

function buildMemoryAnswer(longMemory) {
  const lines = [];

  if (longMemory?.preferredName) lines.push(`名前は「${longMemory.preferredName}」として覚えています。`);
  if (longMemory?.weight) lines.push(`体重は ${longMemory.weight} として見ています。`);
  if (longMemory?.bodyFat) lines.push(`体脂肪率は ${longMemory.bodyFat} として見ています。`);
  if (longMemory?.age) lines.push(`年齢は ${longMemory.age} として見ています。`);
  if (longMemory?.goal) lines.push(`目標は「${longMemory.goal}」です。`);
  if (longMemory?.aiType) lines.push(`AIタイプは「${longMemory.aiType}」です。`);
  if (longMemory?.constitutionType) lines.push(`体質タイプは「${longMemory.constitutionType}」です。`);
  if (longMemory?.selectedPlan) lines.push(`プランは「${longMemory.selectedPlan}」です。`);

  if (!lines.length) {
    return '今はまだ強く残っていることは多くないので、これから少しずつ覚えていきますね。';
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

function buildTodayRecordsAnswer(records) {
  const lines = [];

  if (Array.isArray(records?.meals) && records.meals.length) {
    lines.push(`今日の食事記録: ${records.meals.length}件`);
    for (const meal of records.meals.slice(-5)) {
      const title = meal.summary || meal.name || '食事';
      const kcal = Number(meal.kcal || meal.estimatedNutrition?.kcal || 0);
      lines.push(`- ${title}${kcal ? ` 約${round1(kcal)}kcal` : ''}`);
    }
  } else {
    lines.push('今日の食事記録はまだ見当たりません。');
  }

  if (Array.isArray(records?.exercises) && records.exercises.length) {
    lines.push(`今日の運動記録: ${records.exercises.length}件`);
    for (const exercise of records.exercises.slice(-5)) {
      lines.push(`- ${exercise.summary || exercise.name || '運動'}`);
    }
  }

  if (Array.isArray(records?.weights) && records.weights.length) {
    lines.push(`今日の体重記録: ${records.weights.length}件`);
  }

  return lines.join('\n');
}

function parseInlineProfile(text) {
  const safe = normalizeText(text);
  const patch = {};

  const nameMatch = safe.match(/名前[は：:]\s*([^\n]+)/);
  const ageMatch = safe.match(/年齢[は：:]\s*([^\n]+)/);
  const weightMatch = safe.match(/体重[は：:]\s*([^\n]+)/);
  const bodyFatMatch = safe.match(/体脂肪率[は：:]\s*([^\n]+)/);
  const goalMatch = safe.match(/目標[は：:]\s*([^\n]+)/);

  if (nameMatch) patch.preferredName = nameMatch[1].trim();
  if (ageMatch) patch.age = ageMatch[1].trim();
  if (weightMatch) patch.weight = weightMatch[1].trim();
  if (bodyFatMatch) patch.bodyFat = bodyFatMatch[1].trim();
  if (goalMatch) patch.goal = goalMatch[1].trim();

  return patch;
}

function detectWeightRecord(text) {
  const safe = normalizeText(text);
  if (/体脂肪率/.test(safe)) {
    return { type: 'weight', summary: safe };
  }
  if (/体重/.test(safe) || /^[0-9０-９]+(\.[0-9０-９]+)?\s*(kg|ＫＧ|キロ)/i.test(safe)) {
    return { type: 'weight', summary: safe };
  }
  return null;
}

function detectExerciseRecord(text) {
  const safe = normalizeText(text);
  if (/スクワット/.test(safe)) return { type: 'exercise', summary: safe, name: 'スクワット' };
  if (/ジョギング|ランニング|走りました|走った/.test(safe)) return { type: 'exercise', summary: safe, name: 'ジョギング' };
  if (/歩いた|ウォーキング/.test(safe)) return { type: 'exercise', summary: safe, name: 'ウォーキング' };
  return null;
}

function looksLikeMealText(text) {
  return /朝ごはん|昼ごはん|夜ごはん|朝食|昼食|夕食|食べた|飲んだ|ラーメン|カレー|寿司|卵|味噌汁|サラダ|ごはん|パン|ヨーグルト|バナナ/.test(normalizeText(text));
}

function buildMealReply(parsedMeal) {
  const items = Array.isArray(parsedMeal?.items) && parsedMeal.items.length
    ? parsedMeal.items.join('、')
    : '食事';

  const kcal = round1(parsedMeal?.estimatedNutrition?.kcal || 0);
  const protein = round1(parsedMeal?.estimatedNutrition?.protein || 0);
  const fat = round1(parsedMeal?.estimatedNutrition?.fat || 0);
  const carbs = round1(parsedMeal?.estimatedNutrition?.carbs || 0);

  const amountText = parsedMeal?.amountNote
    ? `量の反映: ${parsedMeal.amountNote}`
    : parsedMeal?.amountRatio && parsedMeal.amountRatio !== 1
      ? `量の反映: ${parsedMeal.amountRatio}倍`
      : '量の反映: 標準';

  return [
    `受け取りました。今回は ${items} として見ています。`,
    amountText,
    `推定: 約${kcal}kcal`,
    `たんぱく質 ${protein}g / 脂質 ${fat}g / 糖質 ${carbs}g`,
    '必要なら、このまま今日の合計にもつなげていきます。'
  ].join('\n');
}

function buildMealRecordPayload(text, parsedMeal) {
  return {
    type: 'meal',
    name: Array.isArray(parsedMeal?.items) && parsedMeal.items.length ? parsedMeal.items.join('、') : normalizeText(text),
    summary: normalizeText(text) || '食事',
    estimatedNutrition: parsedMeal?.estimatedNutrition || { kcal: 0, protein: 0, fat: 0, carbs: 0 },
    kcal: Number(parsedMeal?.estimatedNutrition?.kcal || 0),
    protein: Number(parsedMeal?.estimatedNutrition?.protein || 0),
    fat: Number(parsedMeal?.estimatedNutrition?.fat || 0),
    carbs: Number(parsedMeal?.estimatedNutrition?.carbs || 0),
    amountRatio: Number(parsedMeal?.amountRatio || 1)
  };
}

function buildImageMealRecordPayload(parsedMeal) {
  const itemLabel = Array.isArray(parsedMeal?.items) && parsedMeal.items.length
    ? parsedMeal.items.join('、')
    : '食事写真';

  return {
    type: 'meal',
    name: itemLabel,
    summary: itemLabel,
    estimatedNutrition: parsedMeal?.estimatedNutrition || { kcal: 0, protein: 0, fat: 0, carbs: 0 },
    kcal: Number(parsedMeal?.estimatedNutrition?.kcal || 0),
    protein: Number(parsedMeal?.estimatedNutrition?.protein || 0),
    fat: Number(parsedMeal?.estimatedNutrition?.fat || 0),
    carbs: Number(parsedMeal?.estimatedNutrition?.carbs || 0),
    amountNote: parsedMeal?.amountNote || '標準'
  };
}

function buildLabImageReply(lab) {
  const items = Array.isArray(lab?.items) ? lab.items : [];
  const preview = items.slice(0, 5).map((item) => `${item.itemName} ${item.value}${item.unit ? ` ${item.unit}` : ''}`).join(' / ');
  return [
    '血液検査画像を受け取りました。',
    `読み取れた主な項目: ${preview}`
  ].join('\n');
}

function maybeAnswerLabFollowUp(text, shortMemory) {
  const safe = normalizeText(text);
  if (!/LDL|HDL|中性脂肪|HbA1c|AST|ALT|LDH|γ-GTP/i.test(safe)) return null;

  const items = shortMemory?.followUpContext?.imageType === 'lab'
    ? shortMemory.followUpContext.extractedItems || []
    : [];

  if (!items.length) return null;

  const target = items.find((item) => {
    const name = String(item?.itemName || '');
    return safe.toUpperCase().includes(name.toUpperCase());
  });

  if (!target) return null;

  return `${target.itemName} は ${target.value}${target.unit ? ` ${target.unit}` : ''} と読めました。`;
}

async function appendTurn(userId, userText, replyText) {
  await contextMemoryService.appendRecentMessage(userId, 'user', userText);
  await contextMemoryService.appendRecentMessage(userId, 'assistant', replyText);
}

async function maybeHandleOnboarding(input, shortMemory, longMemory) {
  return onboardingService.maybeHandleOnboarding({
    input,
    shortMemory,
    longMemory,
    saveShortMemory: contextMemoryService.saveShortMemory,
    mergeLongMemory: contextMemoryService.mergeLongMemory
  });
}

async function maybeHandleLabImage(input) {
  if (input?.messageType !== 'image') return null;

  const imagePayload = await lineMediaService.getImagePayload(input);
  if (!imagePayload) return null;

  const lab = await labImageAnalysisService.analyzeLabImage(imagePayload);
  if (!lab?.isLabImage || !Array.isArray(lab.items) || !lab.items.length) return null;

  await contextMemoryService.saveShortMemory(input.userId, {
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

  return buildLabImageReply(lab);
}

async function maybeHandleMealImage(input) {
  if (input?.messageType !== 'image') return null;

  const imagePayload = await lineMediaService.getImagePayload(input);
  if (!imagePayload) return null;

  const meal = await mealAnalysisService.analyzeMealImage(imagePayload);
  if (!meal?.isMealImage) return null;

  const replyText = buildMealReply(meal);

  await contextMemoryService.saveShortMemory(input.userId, {
    pendingRecordCandidate: {
      recordType: 'meal_record',
      extracted: meal
    }
  });

  return {
    replyText,
    meal
  };
}

async function maybeHandleMealText(input) {
  const text = normalizeText(input?.rawText || '');
  if (!looksLikeMealText(text)) return null;

  const parsedMeal = mealAnalysisService.parseMealText(text);
  if (Number(parsedMeal?.confidence || 0) < 0.4) return null;

  const replyText = buildMealReply(parsedMeal);

  await contextMemoryService.saveShortMemory(input.userId, {
    pendingRecordCandidate: {
      recordType: 'meal_record',
      extracted: parsedMeal
    }
  });

  return {
    replyText,
    parsedMeal
  };
}

async function maybeHandleMealFollowUp(input, shortMemory) {
  const text = normalizeText(input?.rawText || '');
  const pending = shortMemory?.pendingRecordCandidate;

  if (!pending || pending?.recordType !== 'meal_record') return null;
  if (!/半分|少し|全部|完食/.test(text)) return null;

  const meal = pending?.extracted || {};
  const base = meal?.estimatedNutrition || { kcal: 0, protein: 0, fat: 0, carbs: 0 };

  let ratio = 1;
  if (/半分/.test(text)) ratio = 0.5;
  else if (/少し/.test(text)) ratio = 0.7;
  else if (/全部|完食/.test(text)) ratio = 1;

  const adjusted = {
    ...meal,
    amountNote: text,
    estimatedNutrition: {
      kcal: round1(base.kcal * ratio),
      protein: round1(base.protein * ratio),
      fat: round1(base.fat * ratio),
      carbs: round1(base.carbs * ratio)
    }
  };

  await contextMemoryService.saveShortMemory(input.userId, {
    pendingRecordCandidate: {
      recordType: 'meal_record',
      extracted: adjusted
    }
  });

  return {
    replyText: [
      '了解です。量を反映しました。',
      `量の反映: ${text}`,
      `推定: 約${round1(adjusted.estimatedNutrition.kcal)}kcal`,
      `たんぱく質 ${round1(adjusted.estimatedNutrition.protein)}g / 脂質 ${round1(adjusted.estimatedNutrition.fat)}g / 糖質 ${round1(adjusted.estimatedNutrition.carbs)}g`,
      '必要なら、このまま今日の合計にもつなげていきます。'
    ].join('\n'),
    adjusted
  };
}

async function maybeStoreSimpleRecords(userId, text) {
  const mealParsed = looksLikeMealText(text) ? mealAnalysisService.parseMealText(text) : null;
  if (mealParsed && Number(mealParsed.confidence || 0) >= 0.4) {
    await contextMemoryService.addDailyRecord(userId, buildMealRecordPayload(text, mealParsed));
  }

  const exercise = detectExerciseRecord(text);
  if (exercise) await contextMemoryService.addDailyRecord(userId, exercise);

  const weight = detectWeightRecord(text);
  if (weight) await contextMemoryService.addDailyRecord(userId, weight);
}

async function buildNormalReply(input, recentMessages, recentSummary, longMemoryLatest) {
  const systemHint = [
    '[伴走OSルール]',
    '- 受け止めを先に置く',
    '- 提案は多くて1つ',
    '- 管理者のような言い方は禁止',
    '[プロフィール要約]',
    `- 名前: ${longMemoryLatest?.preferredName || '未設定'}`,
    `- 年齢: ${longMemoryLatest?.age || '未設定'}`,
    `- 体重: ${longMemoryLatest?.weight || '未設定'}`,
    `- 体脂肪率: ${longMemoryLatest?.bodyFat || '未設定'}`,
    `- AIタイプ: ${longMemoryLatest?.aiType || '未設定'}`,
    `- 体質タイプ: ${longMemoryLatest?.constitutionType || '未設定'}`,
    `- プラン: ${longMemoryLatest?.selectedPlan || '未設定'}`,
    recentSummary ? `- 最近の流れ: ${recentSummary}` : null
  ].filter(Boolean).join('\n');

  return aiChatService.generateReply({
    userId: input.userId,
    userMessage: input.rawText || '',
    recentMessages,
    intentType: 'normal',
    responseMode: 'empathy_plus_one_hint',
    hiddenContext: systemHint
  });
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

    const onboarding = await maybeHandleOnboarding(input, shortMemory, longMemory);
    if (onboarding?.handled) {
      await appendTurn(input.userId, input.rawText || '', onboarding.replyText);
      return {
        ok: true,
        replyMessages: [{ type: 'text', text: onboarding.replyText }],
        internal: { intentType: 'onboarding', responseMode: 'guided' }
      };
    }

    const labImageReply = await maybeHandleLabImage(input);
    if (labImageReply) {
      await appendTurn(input.userId, input.rawText || '[image]', labImageReply);
      return {
        ok: true,
        replyMessages: [{ type: 'text', text: labImageReply }],
        internal: { intentType: 'lab_image', responseMode: 'answer' }
      };
    }

    const mealImageHandled = await maybeHandleMealImage(input);
    if (mealImageHandled) {
      await contextMemoryService.addDailyRecord(input.userId, buildImageMealRecordPayload(mealImageHandled.meal));
      await appendTurn(input.userId, input.rawText || '[image]', mealImageHandled.replyText);
      return {
        ok: true,
        replyMessages: [{ type: 'text', text: mealImageHandled.replyText }],
        internal: { intentType: 'meal_image', responseMode: 'record' }
      };
    }

    const refreshedShortMemory = await contextMemoryService.getShortMemory(input.userId);
    const labFollowUpReply = maybeAnswerLabFollowUp(text, refreshedShortMemory);
    if (labFollowUpReply) {
      await appendTurn(input.userId, input.rawText || '', labFollowUpReply);
      return {
        ok: true,
        replyMessages: [{ type: 'text', text: labFollowUpReply }],
        internal: { intentType: 'lab_followup', responseMode: 'answer' }
      };
    }

    const mealFollowUpHandled = await maybeHandleMealFollowUp(input, refreshedShortMemory);
    if (mealFollowUpHandled) {
      await contextMemoryService.addDailyRecord(input.userId, {
        type: 'meal',
        name: '食事',
        summary: mealFollowUpHandled.adjusted?.amountNote || '食事量補正',
        estimatedNutrition: mealFollowUpHandled.adjusted?.estimatedNutrition || {},
        kcal: Number(mealFollowUpHandled.adjusted?.estimatedNutrition?.kcal || 0),
        protein: Number(mealFollowUpHandled.adjusted?.estimatedNutrition?.protein || 0),
        fat: Number(mealFollowUpHandled.adjusted?.estimatedNutrition?.fat || 0),
        carbs: Number(mealFollowUpHandled.adjusted?.estimatedNutrition?.carbs || 0)
      });
      await appendTurn(input.userId, input.rawText || '', mealFollowUpHandled.replyText);
      return {
        ok: true,
        replyMessages: [{ type: 'text', text: mealFollowUpHandled.replyText }],
        internal: { intentType: 'meal_followup', responseMode: 'record' }
      };
    }

    if (intent === 'time_question') {
      const replyText = buildTimeAnswer();
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

    const inlineProfile = parseInlineProfile(text);
    if (Object.keys(inlineProfile).length) {
      await contextMemoryService.mergeLongMemory(input.userId, inlineProfile);
      const replyText = buildMemoryAnswer(await contextMemoryService.getLongMemory(input.userId));
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

    const mealTextHandled = await maybeHandleMealText(input);
    if (mealTextHandled) {
      await contextMemoryService.addDailyRecord(input.userId, buildMealRecordPayload(text, mealTextHandled.parsedMeal));
      await appendTurn(input.userId, input.rawText || '', mealTextHandled.replyText);
      return {
        ok: true,
        replyMessages: [{ type: 'text', text: mealTextHandled.replyText }],
        internal: { intentType: 'meal_text', responseMode: 'record' }
      };
    }

    await maybeStoreSimpleRecords(input.userId, text);

    const longMemoryLatest = await contextMemoryService.getLongMemory(input.userId);
    const replyText = await buildNormalReply(input, recentMessages, recentSummary, longMemoryLatest);

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
