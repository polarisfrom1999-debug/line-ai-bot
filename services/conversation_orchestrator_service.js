'use strict';

const contextMemoryService = require('./context_memory_service');
const aiChatService = require('./ai_chat_service');
const onboardingService = require('./onboarding_service');
const checkinSurveyService = require('./checkin_survey_service');
const lineMediaService = require('./line_media_service');
const mealAnalysisService = require('./meal_analysis_service');
const labImageAnalysisService = require('./lab_image_analysis_service');
const dailySummaryService = require('./daily_summary_service');
const weeklyReportService = require('./weekly_report_service');
const monthlyReportService = require('./monthly_report_service');
const recordPersistenceService = require('./record_persistence_service');
const profileService = require('./profile_service');

function normalizeText(value) { return String(value || '').trim(); }
function round1(n) { return Math.round((Number(n) || 0) * 10) / 10; }

function nowInTokyo() {
  const now = new Date();
  const date = new Intl.DateTimeFormat('ja-JP', { timeZone: 'Asia/Tokyo', year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
  const time = new Intl.DateTimeFormat('ja-JP', { timeZone: 'Asia/Tokyo', hour: '2-digit', minute: '2-digit', hour12: false }).format(now);
  return { date, time };
}

function formatNutritionBlock(nutrition, ratioText) {
  if (!nutrition) return '';
  return [
    ratioText ? `量の反映: ${ratioText}` : null,
    `推定: 約${round1(nutrition.kcal)}kcal`,
    `たんぱく質 ${round1(nutrition.protein)}g / 脂質 ${round1(nutrition.fat)}g / 糖質 ${round1(nutrition.carbs)}g`
  ].filter(Boolean).join('\n');
}

function buildMealReply(parsedMeal) {
  const items = Array.isArray(parsedMeal?.items) && parsedMeal.items.length ? parsedMeal.items.join('、') : '食事';
  const amountText = parsedMeal?.amountNote || (parsedMeal?.amountRatio && parsedMeal.amountRatio !== 1 ? `量補正 ${parsedMeal.amountRatio}倍` : '');
  return [
    `受け取りました。今回は ${items} として見ています。`,
    formatNutritionBlock(parsedMeal?.estimatedNutrition, amountText),
    '必要なら、このまま今日の合計にもつなげていきます。'
  ].filter(Boolean).join('\n');
}

function buildLabReply(lab) {
  const items = Array.isArray(lab?.items) ? lab.items : [];
  const top = items.slice(0, 5).map((item) => `${item.itemName} ${item.value}${item.unit ? ` ${item.unit}` : ''}`);
  if (!top.length) {
    return '血液検査画像は受け取りました。読み取りは試みましたが、今回は項目を十分に確定できませんでした。';
  }
  return [
    '血液検査画像を受け取りました。',
    `読み取れた主な項目: ${top.join(' / ')}`,
    '気になる項目があれば、そのまま聞いてください。'
  ].join('\n');
}

function detectIntent(text) {
  if (/今何時|何時|何月何日|今日何日/.test(text)) return 'time';
  if (/私の名前|何を覚えてる|覚えている|覚えてる/.test(text)) return 'memory';
  if (/^(無料体験開始|スタート|開始)$/.test(text)) return 'onboarding';
  if (checkinSurveyService.isWeeklyTrigger(text)) return 'weekly_survey';
  if (checkinSurveyService.isMonthlyTrigger(text)) return 'monthly_survey';
  if (/週間レポート|週報/.test(text)) return 'weekly_report';
  if (/月間レポート|月報/.test(text)) return 'monthly_report';
  if (/今日のまとめ|今日の合計|今日どうだった|今日の振り返り/.test(text)) return 'daily_summary';
  if (/LDLは[？?]?$/i.test(text) || /^LDL[？?]?$/i.test(text)) return 'ldl_query';
  return 'normal';
}

async function appendTurn(userId, userText, replyText) {
  await contextMemoryService.appendRecentMessage(userId, 'user', userText);
  await contextMemoryService.appendRecentMessage(userId, 'assistant', replyText);
}

async function persistAndAppend(userId, payloads) {
  if (!payloads.length) return;
  await recordPersistenceService.persistRecords({ userId, recordPayloads: payloads });
}

function buildMemoryReply(latest) {
  const parts = [];
  if (latest.preferredName) parts.push(`名前は「${latest.preferredName}」として覚えています。`);
  if (latest.weight) parts.push(`体重は ${latest.weight} として見ています。`);
  if (latest.bodyFat) parts.push(`体脂肪率は ${latest.bodyFat} として見ています。`);
  if (latest.aiType) parts.push(`AIタイプは「${latest.aiType}」です。`);
  if (latest.constitutionType) parts.push(`体質タイプは「${latest.constitutionType}」です。`);
  if (!parts.length) return '今はまだ強く残っていることは多くないので、これから少しずつ覚えていきますね。';
  return parts.join('\n');
}

async function handleSurveyFlow(input, shortMemory) {
  const session = shortMemory?.surveySession || { isActive: false, surveyType: null, currentIndex: 0, answers: [] };
  const text = normalizeText(input.rawText || '');

  if (session.isActive && checkinSurveyService.isAnswerLike(text) && !checkinSurveyService.isWeeklyTrigger(text) && !checkinSurveyService.isMonthlyTrigger(text)) {
    const nextAnswers = [...(session.answers || []), text];
    await contextMemoryService.saveSurveyAnswer(input.userId, session.surveyType, {
      index: session.currentIndex,
      answer: text
    });

    const questions = checkinSurveyService.getQuestionList(session.surveyType);
    const nextIndex = session.currentIndex + 1;
    if (nextIndex < questions.length) {
      await contextMemoryService.saveShortMemory(input.userId, {
        surveySession: {
          isActive: true,
          surveyType: session.surveyType,
          currentIndex: nextIndex,
          answers: nextAnswers
        }
      });
      return { handled: true, replyText: questions[nextIndex] };
    }

    await contextMemoryService.saveShortMemory(input.userId, {
      surveySession: {
        isActive: false,
        surveyType: null,
        currentIndex: 0,
        answers: []
      }
    });

    const completeText = session.surveyType === 'monthly'
      ? '1か月アンケートを受け取りました。月の流れも見ながら、次の一手につなげていきます。'
      : '1週間アンケートを受け取りました。今週の流れを見ながら、次の一手につなげていきます。';

    return { handled: true, replyText: completeText };
  }

  if (checkinSurveyService.isWeeklyTrigger(text)) {
    await contextMemoryService.saveShortMemory(input.userId, {
      surveySession: {
        isActive: true,
        surveyType: 'weekly',
        currentIndex: 0,
        answers: []
      }
    });
    return { handled: true, replyText: checkinSurveyService.buildWeeklyCheckinPrompt(0) };
  }

  if (checkinSurveyService.isMonthlyTrigger(text)) {
    await contextMemoryService.saveShortMemory(input.userId, {
      surveySession: {
        isActive: true,
        surveyType: 'monthly',
        currentIndex: 0,
        answers: []
      }
    });
    return { handled: true, replyText: checkinSurveyService.buildMonthlyCheckinPrompt(0) };
  }

  return { handled: false };
}

async function orchestrateConversation(input) {
  try {
    const text = normalizeText(input?.rawText || '');
    const shortMemory = await contextMemoryService.getShortMemory(input.userId);
    const longMemory = await contextMemoryService.getLongMemory(input.userId);
    const recentMessages = await contextMemoryService.getRecentMessages(input.userId, 20);
    const recentSummary = await contextMemoryService.buildRecentSummary(input.userId);
    const todayRecords = await contextMemoryService.getTodayRecords(input.userId);
    const weeklyRecords = await contextMemoryService.getRecordsForDays(input.userId, 7);
    const monthlyRecords = await contextMemoryService.getRecordsForDays(input.userId, 30);
    const points = await contextMemoryService.getPoints(input.userId);

    const onboarding = await onboardingService.maybeHandleOnboarding({
      input,
      shortMemory,
      longMemory,
      saveShortMemory: contextMemoryService.saveShortMemory,
      mergeLongMemory: contextMemoryService.mergeLongMemory
    });
    if (onboarding?.handled) {
      await appendTurn(input.userId, text, onboarding.replyText);
      return { ok: true, replyMessages: [{ type: 'text', text: onboarding.replyText }] };
    }

    const surveyFlow = await handleSurveyFlow(input, shortMemory);
    if (surveyFlow.handled) {
      await appendTurn(input.userId, text, surveyFlow.replyText);
      return { ok: true, replyMessages: [{ type: 'text', text: surveyFlow.replyText }] };
    }

    if (/^名前[:：]|^体重[:：]|^体脂肪率[:：]|^年齢[:：]|^目標[:：]/.test(text)) {
      const patch = profileService.extractProfilePatchFromText(text);
      if (Object.keys(patch).length) {
        await contextMemoryService.mergeLongMemory(input.userId, patch);
        const latest = await contextMemoryService.getLongMemory(input.userId);
        const reply = buildMemoryReply(latest);
        await appendTurn(input.userId, text, reply);
        return { ok: true, replyMessages: [{ type: 'text', text: reply }] };
      }
    }

    const intent = detectIntent(text);

    if (intent === 'time') {
      const now = nowInTokyo();
      const reply = `今日は ${now.date}、今は ${now.time} くらいです。`;
      await appendTurn(input.userId, text, reply);
      return { ok: true, replyMessages: [{ type: 'text', text: reply }] };
    }

    if (intent === 'memory') {
      const latest = await contextMemoryService.getLongMemory(input.userId);
      const reply = buildMemoryReply(latest);
      await appendTurn(input.userId, text, reply);
      return { ok: true, replyMessages: [{ type: 'text', text: reply }] };
    }

    if (intent === 'daily_summary') {
      const reply = await dailySummaryService.buildDailySummary({ todayRecords, points });
      await appendTurn(input.userId, text, reply);
      return { ok: true, replyMessages: [{ type: 'text', text: reply }] };
    }

    if (intent === 'weekly_report') {
      const weeklyAnswers = await contextMemoryService.getSurveyAnswers(input.userId, 'weekly');
      const reply = await weeklyReportService.buildWeeklyReport({ records: weeklyRecords, points, weeklyAnswers });
      await appendTurn(input.userId, text, reply);
      return { ok: true, replyMessages: [{ type: 'text', text: reply }] };
    }

    if (intent === 'monthly_report') {
      const monthlyAnswers = await contextMemoryService.getSurveyAnswers(input.userId, 'monthly');
      const reply = await monthlyReportService.buildMonthlyReport({ records: monthlyRecords, points, monthlyAnswers });
      await appendTurn(input.userId, text, reply);
      return { ok: true, replyMessages: [{ type: 'text', text: reply }] };
    }

    if (input.messageType === 'image') {
      const imagePayload = await lineMediaService.getImagePayload(input);
      let meal = null;
      let lab = null;
      if (imagePayload) {
        [meal, lab] = await Promise.all([
          mealAnalysisService.analyzeMealImage(imagePayload),
          labImageAnalysisService.analyzeLabImage(imagePayload)
        ]);
      }

      if (meal?.isMealImage) {
        await contextMemoryService.saveShortMemory(input.userId, {
          pendingRecordCandidate: { recordType: 'meal', extracted: meal },
          followUpContext: { source: 'image', imageType: 'meal' },
          lastImageType: 'meal'
        });
        await persistAndAppend(input.userId, [{ recordType: 'meal', ...meal }]);
        const reply = buildMealReply(meal);
        await appendTurn(input.userId, '画像', reply);
        return { ok: true, replyMessages: [{ type: 'text', text: reply }] };
      }

      if (lab?.isLabImage) {
        await contextMemoryService.saveShortMemory(input.userId, {
          pendingRecordCandidate: { recordType: 'lab', extracted: lab },
          followUpContext: { source: 'image', imageType: 'lab', extractedItems: (lab.items || []).map((i) => i.itemName) },
          lastImageType: 'lab'
        });
        await persistAndAppend(input.userId, [{ recordType: 'lab', ...lab }]);
        const reply = buildLabReply(lab);
        await appendTurn(input.userId, '画像', reply);
        return { ok: true, replyMessages: [{ type: 'text', text: reply }] };
      }
    }

    if (intent === 'ldl_query') {
      const pending = shortMemory?.pendingRecordCandidate || null;
      const items = Array.isArray(pending?.extracted?.items) ? pending.extracted.items : [];
      const ldl = items.find((item) => /LDL/i.test(String(item?.itemName || '')));
      const reply = ldl ? `直前の検査データでは LDL は ${ldl.value}${ldl.unit ? ` ${ldl.unit}` : ''} と見ています。` : '今持っている検査データでは LDL をまだ十分に確定できていません。';
      await appendTurn(input.userId, text, reply);
      return { ok: true, replyMessages: [{ type: 'text', text: reply }] };
    }

    if (/朝ごはん|昼ごはん|夜ごはん|食べた|飲んだ|ラーメン|カレー|卵|味噌汁|寿司/.test(text)) {
      const parsed = mealAnalysisService.parseMealText(text);
      if (parsed.confidence >= 0.4) {
        await contextMemoryService.saveShortMemory(input.userId, {
          pendingRecordCandidate: { recordType: 'meal', extracted: parsed },
          lastTopic: 'meal_text'
        });
        await persistAndAppend(input.userId, [{ recordType: 'meal', ...parsed }]);
        const reply = buildMealReply(parsed);
        await appendTurn(input.userId, text, reply);
        return { ok: true, replyMessages: [{ type: 'text', text: reply }] };
      }
    }

    if (/半分|少し|全部/.test(text) && shortMemory?.pendingRecordCandidate?.recordType === 'meal') {
      const base = shortMemory.pendingRecordCandidate.extracted || {};
      let ratio = 1;
      if (text.includes('半分')) ratio = 0.5;
      else if (text.includes('少し')) ratio = 0.7;
      const updated = {
        ...base,
        amountNote: text,
        estimatedNutrition: {
          kcal: round1((base?.estimatedNutrition?.kcal || 0) * ratio),
          protein: round1((base?.estimatedNutrition?.protein || 0) * ratio),
          fat: round1((base?.estimatedNutrition?.fat || 0) * ratio),
          carbs: round1((base?.estimatedNutrition?.carbs || 0) * ratio)
        }
      };
      await contextMemoryService.saveShortMemory(input.userId, { pendingRecordCandidate: { recordType: 'meal', extracted: updated } });
      await persistAndAppend(input.userId, [{ recordType: 'meal', _replaceLastOfType: true, ...updated }]);
      const reply = ['了解です。量を反映しました。', formatNutritionBlock(updated.estimatedNutrition, text), 'この内容で今日の記録に続けられます。'].join('\n');
      await appendTurn(input.userId, text, reply);
      return { ok: true, replyMessages: [{ type: 'text', text: reply }] };
    }

    if (/体重|kg|キロ|体脂肪/.test(text)) {
      await persistAndAppend(input.userId, [{ recordType: 'weight', rawText: text }]);
      const reply = '受け取りました。数字だけで決めつけず、流れも見ながら一緒に整えていきますね。';
      await appendTurn(input.userId, text, reply);
      return { ok: true, replyMessages: [{ type: 'text', text: reply }] };
    }

    if (/歩いた|ジョギング|ランニング|筋トレ|運動|スクワット/.test(text)) {
      await persistAndAppend(input.userId, [{ recordType: 'exercise', rawText: text }]);
      const reply = '受け取りました。動けたこと自体がちゃんと積み上がっています。今日はそこをまず大事に見ていきましょう。';
      await appendTurn(input.userId, text, reply);
      return { ok: true, replyMessages: [{ type: 'text', text: reply }] };
    }

    const hiddenContext = [
      '[プロフィール要約]',
      `- 名前: ${longMemory?.preferredName || '未設定'}`,
      `- 年齢: ${longMemory?.age || '未設定'}`,
      `- 体重: ${longMemory?.weight || '未設定'}`,
      `- 体脂肪率: ${longMemory?.bodyFat || '未設定'}`,
      `- AIタイプ: ${longMemory?.aiType || '未設定'}`,
      `- 体質タイプ: ${longMemory?.constitutionType || '未設定'}`,
      `- プラン: ${longMemory?.selectedPlan || '未設定'}`,
      recentSummary ? `- 最近の流れ: ${recentSummary}` : null
    ].filter(Boolean).join('\n');

    const reply = await aiChatService.generateReply({
      userId: input.userId,
      userMessage: text,
      recentMessages,
      intentType: 'normal',
      responseMode: 'empathy_plus_one_hint',
      hiddenContext
    });
    await appendTurn(input.userId, text, reply);
    return { ok: true, replyMessages: [{ type: 'text', text: reply }] };
  } catch (error) {
    console.error('[conversation_orchestrator] fatal error:', error?.message || error);
    return {
      ok: true,
      replyMessages: [{ type: 'text', text: '今ちょっとうまく受け取れなかったので、もう一度だけ送ってもらえたら大丈夫です。' }]
    };
  }
}

module.exports = { orchestrateConversation };
