'use strict';

const contextMemoryService = require('./context_memory_service');
const aiChatService = require('./ai_chat_service');
const onboardingService = require('./onboarding_service');
const weeklyReportService = require('./weekly_report_service');
const lineMediaService = require('./line_media_service');
const mealAnalysisService = require('./meal_analysis_service');
const labImageAnalysisService = require('./lab_image_analysis_service');
const dailySummaryService = require('./daily_summary_service');
const profileService = require('./profile_service');
const energyService = require('./energy_service');

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
  for (const part of parts) result[part.type] = part.value;

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

function detectIntent(input, shortMemory) {
  const text = normalizeText(input?.rawText || '');

  if (input?.messageType === 'image') return 'image';
  if (/今何時|何時|何月何日|今日何日|何時何分/.test(text)) return 'time_question';
  if (/私の名前|私の体重|私の体脂肪率|何を覚えてる|覚えてる|覚えていますか/.test(text)) return 'memory_question';
  if (/週間報告|週刊報告|今週のまとめ/.test(text)) return 'weekly_report';
  if (/今日の食事記録|今日の記録|食事記録教えて|今日の合計/.test(text)) return 'today_records';
  if (/使い方教えて|使い方/.test(text)) return 'help';
  if (/無料体験開始|無料体験スタート|体験開始|プロフィール変更|プロフィール入力|プロフィール修正/.test(text)) return 'onboarding';
  if (/今日のまとめ|日次まとめ/.test(text)) return 'daily_summary';
  if (/うっし〜って呼んで|うっし～って呼んで|うっし〜と呼んで|うっし～と呼んで/.test(text)) return 'rename_request';
  if (shortMemory?.pendingRecordCandidate?.recordType === 'meal_record' && /半分|少し|全部|完食|残した|汁は飲んでない/.test(text)) return 'meal_followup';
  if (/LDL|HDL|中性脂肪|HbA1c|AST|ALT|LDH|γ-GTP/i.test(text)) return 'lab_followup';
  if (looksLikeMealText(text)) return 'meal_text';
  if (looksLikeExerciseText(text)) return 'exercise_text';
  if (looksLikeWeightText(text)) return 'weight_text';
  return 'normal';
}

function looksLikeMealText(text) {
  return /朝ごはん|昼ごはん|夜ごはん|朝食|昼食|夕食|食べた|飲んだ|ラーメン|カレー|寿司|卵|味噌汁|サラダ|ごはん|パン|ヨーグルト|バナナ/.test(normalizeText(text));
}

function looksLikeExerciseText(text) {
  return /歩いた|ジョギング|ランニング|走った|走りました|スクワット|筋トレ|運動|ウォーキング/.test(normalizeText(text));
}

function looksLikeWeightText(text) {
  return /体重|体脂肪率|kg|キロ/.test(normalizeText(text));
}

function detectStateFlags(text) {
  const safe = normalizeText(text);
  const flags = [];
  if (/疲れ|眠い|寝不足|だるい/.test(safe)) flags.push('fatigue');
  if (/痛い|腰痛|首|肩|骨折|激痛/.test(safe)) flags.push('pain');
  if (/不安|焦る|つらい|しんどい|苦しい/.test(safe)) flags.push('emotional_distress');
  if (/水分|のど乾/.test(safe)) flags.push('hydration');
  if (/むくみ/.test(safe)) flags.push('swelling');
  if (/便通|便秘|お腹/.test(safe)) flags.push('bowel');
  if (/睡眠|眠い|寝不足/.test(safe)) flags.push('sleep');
  if (/心が苦しい|消えたい|激痛|骨折/.test(safe)) flags.push('safety_attention');
  return [...new Set(flags)];
}

function inferResponseMode(intent, stateFlags, longMemory) {
  if (stateFlags.includes('safety_attention')) return 'safety_guidance';
  if (stateFlags.includes('pain') || stateFlags.includes('fatigue')) return 'care_priority';
  if (intent === 'meal_text' || intent === 'exercise_text' || intent === 'weight_text' || intent === 'meal_followup') return 'record_with_gentle_feedback';
  if (/理屈|整理/.test(String(longMemory?.aiType || ''))) return 'light_structure';
  if (/やさしく|伴走/.test(String(longMemory?.aiType || ''))) return 'empathy_first';
  return 'empathy_plus_one_hint';
}

function buildMemoryAnswer(longMemory) {
  return profileService.buildMemoryAnswer(longMemory);
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
  return profileService.extractProfilePatchFromText(text);
}

function detectWeightRecord(text) {
  const safe = normalizeText(text);
  if (!looksLikeWeightText(safe)) return null;
  return { type: 'weight', summary: safe };
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
  await contextMemoryService.rememberFromConversation(userId);
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
    },
    lastImageType: 'lab',
    activeHealthTheme: 'lab'
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
    },
    lastImageType: 'meal',
    activeHealthTheme: 'meal'
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
    },
    activeHealthTheme: 'meal'
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
  if (!/半分|少し|全部|完食|残した|汁は飲んでない/.test(text)) return null;

  const meal = pending?.extracted || {};
  const base = meal?.estimatedNutrition || { kcal: 0, protein: 0, fat: 0, carbs: 0 };

  let ratio = 1;
  if (/半分/.test(text)) ratio = 0.5;
  else if (/少し/.test(text)) ratio = 0.7;
  else if (/残した|汁は飲んでない/.test(text)) ratio = 0.8;
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
    },
    activeHealthTheme: 'meal'
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

async function buildNormalReply(input, recentMessages, recentSummary, longMemoryLatest, stateFlags, responseMode) {
  const narrative = longMemoryLatest?.narrativeMemory || {};
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
    Array.isArray(narrative?.strugglePatterns) && narrative.strugglePatterns.length ? `- つまずき傾向: ${narrative.strugglePatterns.slice(0, 2).join(' / ')}` : null,
    Array.isArray(narrative?.supportStyleNotes) && narrative.supportStyleNotes.length ? `- 受け取りやすい支え方: ${narrative.supportStyleNotes.slice(0, 2).join(' / ')}` : null,
    recentSummary ? `- 最近の流れ: ${recentSummary}` : null,
    stateFlags.length ? `- 今回の状態フラグ: ${stateFlags.join(', ')}` : null
  ].filter(Boolean).join('\n');

  return aiChatService.generateReply({
    userId: input.userId,
    userMessage: input.rawText || '',
    recentMessages,
    intentType: 'normal',
    responseMode,
    stateFlags,
    longMemory: longMemoryLatest,
    hiddenContext: systemHint
  });
}

function inferTopicFromIntent(intent, text) {
  if (intent === 'meal_text' || intent === 'meal_followup') return 'meal';
  if (intent === 'exercise_text') return 'exercise';
  if (intent === 'weight_text') return 'weight';
  if (intent === 'lab_followup') return 'lab';
  if (/仕事/.test(text)) return 'work';
  if (/家族|子ども/.test(text)) return 'family';
  if (/睡眠|眠い|寝不足/.test(text)) return 'sleep';
  if (/痛い|腰痛|骨折/.test(text)) return 'pain';
  return intent;
}

async function orchestrateConversation(input) {
  try {
    const shortMemory = await contextMemoryService.getShortMemory(input.userId);
    const longMemory = await contextMemoryService.getLongMemory(input.userId);
    const userStateBefore = await contextMemoryService.getUserState(input.userId);
    const recentSummary = await contextMemoryService.buildRecentSummary(input.userId, 3);
    const recentMessages = await contextMemoryService.getRecentMessages(input.userId, 20);

    const text = normalizeText(input.rawText || '');
    const intent = detectIntent(input, shortMemory);
    const stateFlags = detectStateFlags(text);
    const responseMode = inferResponseMode(intent, stateFlags, longMemory);

    const nextState = {
      nagiScore: clampScore((userStateBefore?.nagiScore || 5) + (/安心|大丈夫|落ち着いた/.test(text) ? 0.3 : 0) + (stateFlags.includes('emotional_distress') ? -0.2 : 0)),
      gasolineScore: clampScore((userStateBefore?.gasolineScore || 5) + (stateFlags.includes('fatigue') ? -0.5 : 0) + (/休めた|寝れた/.test(text) ? 0.3 : 0)),
      trustScore: clampScore((userStateBefore?.trustScore || 3) + 0.1),
      lastEmotionTone: stateFlags.includes('emotional_distress') ? 'distressed' : stateFlags.includes('fatigue') ? 'tired' : 'neutral',
      updatedAt: new Date().toISOString()
    };
    await contextMemoryService.updateUserState(input.userId, nextState);

    await contextMemoryService.saveShortMemory(input.userId, {
      currentIntent: intent,
      currentStateFlags: stateFlags,
      companionshipMode: responseMode,
      lastUserNeed: responseMode,
      lastTopic: inferTopicFromIntent(intent, text),
      lastEmotionTone: nextState.lastEmotionTone,
      activeHealthTheme: inferTopicFromIntent(intent, text)
    });

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

    if (intent === 'daily_summary') {
      const todayRecords = await contextMemoryService.getTodayRecords(input.userId);
      const replyText = await dailySummaryService.buildDailySummary({
        recentMessages: await contextMemoryService.getRecentMessages(input.userId, 40),
        todayRecords,
        userState: await contextMemoryService.getUserState(input.userId),
        longMemory: await contextMemoryService.getLongMemory(input.userId)
      });
      await appendTurn(input.userId, input.rawText || '', replyText);
      return {
        ok: true,
        replyMessages: [{ type: 'text', text: replyText }],
        internal: { intentType: 'daily_summary', responseMode: 'answer' }
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
      const replyText = profileService.buildProfileUpdatedReply(inlineProfile);
      await appendTurn(input.userId, input.rawText || '', replyText);
      return {
        ok: true,
        replyMessages: [{ type: 'text', text: replyText }],
        internal: { intentType: 'profile_update', responseMode: 'answer' }
      };
    }

    if (intent === 'rename_request') {
      await contextMemoryService.mergeLongMemory(input.userId, { preferredName: 'うっし〜' });
      const replyText = 'いいですね。これからは「うっし〜」って呼びますね。';
      await appendTurn(input.userId, input.rawText || '', replyText);
      return {
        ok: true,
        replyMessages: [{ type: 'text', text: replyText }],
        internal: { intentType: 'profile_update', responseMode: 'answer' }
      };
    }

    if (intent === 'meal_text') {
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
    }

    if (intent === 'exercise_text') {
      const exercise = energyService.buildExerciseRecord(text);
      if (exercise) {
        await contextMemoryService.addDailyRecord(input.userId, exercise);
        const replyText = energyService.buildExerciseReply(exercise);
        await appendTurn(input.userId, input.rawText || '', replyText);
        return {
          ok: true,
          replyMessages: [{ type: 'text', text: replyText }],
          internal: { intentType: 'exercise_text', responseMode: 'record' }
        };
      }
    }

    if (intent === 'weight_text') {
      const weight = detectWeightRecord(text);
      if (weight) {
        await contextMemoryService.addDailyRecord(input.userId, weight);
        const replyText = '体重の記録として受け取りました。数字そのものだけでなく、流れで見ていきますね。';
        await appendTurn(input.userId, input.rawText || '', replyText);
        return {
          ok: true,
          replyMessages: [{ type: 'text', text: replyText }],
          internal: { intentType: 'weight_text', responseMode: 'record' }
        };
      }
    }

    const longMemoryLatest = await contextMemoryService.getLongMemory(input.userId);
    const replyText = await buildNormalReply(input, recentMessages, recentSummary, longMemoryLatest, stateFlags, responseMode);

    await appendTurn(input.userId, input.rawText || '', replyText);

    return {
      ok: true,
      replyMessages: [{ type: 'text', text: replyText }],
      internal: { intentType: 'normal', responseMode }
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
