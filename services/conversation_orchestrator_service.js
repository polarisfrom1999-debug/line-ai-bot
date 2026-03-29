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

function detectIntent(input) {
  const text = normalizeText(input?.rawText || '');

  if (/今何時|何時|何月何日|今日何日|何時何分/.test(text)) return 'time_question';
  if (/今日の体重.*(教えて|知りたい)|最新の体重|今日の体脂肪率.*(教えて|知りたい)|私の体重は|私の体脂肪率は/.test(text)) return 'weight_lookup';
  if (/私の名前|何を覚えてる|覚えてる|覚えていますか/.test(text)) return 'memory_question';
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
    '・血液検査画像を送ってから LDL や HbA1c を聞けます',
    '・メニュー表や袋、箱の文字も食事候補の参考にできます',
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
    const latest = records.weights.slice(-1)[0];
    const parts = [];
    if (latest?.weight != null) parts.push(`体重 ${latest.weight}`);
    if (latest?.bodyFat != null) parts.push(`体脂肪率 ${latest.bodyFat}`);
    lines.push(parts.length ? `今日の最新: ${parts.join(' / ')}` : `今日の体重記録: ${records.weights.length}件`);
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

function containsQuestionTone(text) {
  return /教えて|知りたい|覚えてる|なんだっけ|ですか|ますか|\?$|？$/.test(text);
}

function parseNumericValue(text, pattern) {
  const match = normalizeText(text).match(pattern);
  return match ? Number(String(match[1]).replace(/[０-９]/g, (s) => String.fromCharCode(s.charCodeAt(0) - 65248))) : null;
}

function detectWeightRecord(text) {
  const safe = normalizeText(text);
  if (!safe || containsQuestionTone(safe)) return null;

  const bodyFat = parseNumericValue(safe, /体脂肪率\s*([0-9０-９]+(?:\.[0-9０-９]+)?)\s*%?/i);
  const weight = parseNumericValue(safe, /(?:体重\s*)?([0-9０-９]+(?:\.[0-9０-９]+)?)\s*(?:kg|ＫＧ|キロ)/i);

  if (weight == null && bodyFat == null) return null;

  return {
    type: 'weight',
    summary: safe,
    weight,
    bodyFat
  };
}

function detectExerciseRecord(text) {
  const safe = normalizeText(text);
  if (!safe) return null;
  if (/痛|できない|出来ない|無理|休む|休みたい|限界|しんど/.test(safe) && !/した|やった|歩いた|走った|できた/.test(safe)) return null;
  if (containsQuestionTone(safe)) return null;

  if (/スクワット/.test(safe)) return { type: 'exercise', summary: safe, name: 'スクワット' };
  if (/ジョギング|ランニング|走りました|走った|歩走/.test(safe)) return { type: 'exercise', summary: safe, name: 'ジョギング' };
  if (/歩いた|ウォーキング|散歩/.test(safe)) return { type: 'exercise', summary: safe, name: 'ウォーキング' };
  if (/腕立て/.test(safe)) return { type: 'exercise', summary: safe, name: '腕立て' };
  return null;
}

function looksLikeMealText(text) {
  return /朝ごはん|昼ごはん|夜ごはん|朝食|昼食|夕食|食べた|飲んだ|ラーメン|カレー|寿司|卵|味噌汁|サラダ|ごはん|パン|ヨーグルト|バナナ|パスタ|おにぎり|弁当/.test(normalizeText(text));
}

function looksLikeDistress(text) {
  const safe = normalizeText(text);
  return /毎日心が苦しい|毎日心がしんどい|かなりしんどい|ちょっと限界|限界かも|消えたい|もう無理|やる気ない|やる気が出ない/.test(safe);
}

function looksLikePain(text) {
  return /首.*痛|腰.*痛|痛めた|痛い|骨折|しびれ|むくんでる|むくみ|便通がない|便通ない|寝れてない|睡眠不足/.test(normalizeText(text));
}

function buildMealReply(parsedMeal) {
  const items = Array.isArray(parsedMeal?.items) && parsedMeal.items.length
    ? parsedMeal.items.join('、')
    : '食事';

  const kcal = round1(parsedMeal?.estimatedNutrition?.kcal || 0);
  const protein = round1(parsedMeal?.estimatedNutrition?.protein || 0);
  const fat = round1(parsedMeal?.estimatedNutrition?.fat || 0);
  const carbs = round1(parsedMeal?.estimatedNutrition?.carbs || 0);
  const imageKind = parsedMeal?.imageKind || '';

  const amountText = parsedMeal?.amountNote
    ? `量の反映: ${parsedMeal.amountNote}`
    : parsedMeal?.amountRatio && parsedMeal.amountRatio !== 1
      ? `量の反映: ${parsedMeal.amountRatio}倍`
      : '量の反映: 標準';

  if ((imageKind === 'menu_text' || imageKind === 'food_package') && !kcal) {
    return [
      `食事の候補として ${items} を読み取りました。`,
      parsedMeal?.ocrText ? `読めた文字: ${parsedMeal.ocrText.slice(0, 80)}` : null,
      'どれを実際に食べたか分かれば、その分だけ栄養までつなげられます。'
    ].filter(Boolean).join('\n');
  }

  return [
    `受け取りました。今回は ${items} として見ています。`,
    amountText,
    `推定: 約${kcal}kcal`,
    `たんぱく質 ${protein}g / 脂質 ${fat}g / 糖質 ${carbs}g`,
    parsedMeal?.comment || '必要なら、このまま今日の合計にもつなげていきます。'
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
    amountRatio: Number(parsedMeal?.amountRatio || 1),
    amountNote: parsedMeal?.amountNote || ''
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
  const preview = items.slice(0, 5).map((item) => {
    const marker = item.flag ? ` ${item.flag}` : '';
    return `${item.itemName} ${item.value}${item.unit ? ` ${item.unit}` : ''}${marker}`;
  }).join(' / ');
  const trendInfo = items.some((item) => Array.isArray(item.history) && item.history.length >= 2)
    ? ' 過去の列も見えた項目は推移として持っておきます。'
    : '';
  return [
    '血液検査画像を受け取りました。',
    lab?.examDate ? `検査日: ${lab.examDate}` : null,
    preview ? `読み取れた主な項目: ${preview}` : null,
    `このまま「LDLは？」「HbA1cは？」のように聞いても大丈夫です。${trendInfo}`.trim()
  ].filter(Boolean).join('\n');
}

function normalizeLabTarget(text) {
  const safe = normalizeText(text).toUpperCase();
  if (safe.includes('LDL')) return 'LDL';
  if (safe.includes('HDL')) return 'HDL';
  if (safe.includes('HBA1C') || safe.includes('HB1AC')) return 'HbA1c';
  if (safe.includes('中性脂肪') || safe.includes('TG')) return '中性脂肪';
  if (safe.includes('AST') || safe.includes('GOT')) return 'AST';
  if (safe.includes('ALT') || safe.includes('GPT')) return 'ALT';
  if (safe.includes('GTP')) return 'γ-GTP';
  if (safe.includes('LDH')) return 'LDH';
  return '';
}

function buildLabTrendReply(itemName, trend) {
  if (!trend.length) return null;
  const latest = trend[trend.length - 1];
  const historyText = trend.slice(-4).map((row) => `${row.date} ${row.value}${row.unit ? ` ${row.unit}` : ''}${row.flag ? ` ${row.flag}` : ''}`).join(' / ');
  return [
    `${itemName} は最新で ${latest.value}${latest.unit ? ` ${latest.unit}` : ''}${latest.flag ? ` ${latest.flag}` : ''} です。`,
    trend.length >= 2 ? `見えている推移: ${historyText}` : null
  ].filter(Boolean).join('\n');
}

async function maybeAnswerLabFollowUp(userId, text, shortMemory) {
  const safe = normalizeText(text);
  const targetName = normalizeLabTarget(safe);
  if (!targetName) return null;

  const trend = await contextMemoryService.findLabItemTrend(userId, targetName);
  if (trend.length) return buildLabTrendReply(targetName, trend);

  const items = shortMemory?.followUpContext?.imageType === 'lab'
    ? shortMemory.followUpContext.extractedItems || []
    : [];
  const target = items.find((item) => normalizeLabTarget(item?.itemName || '') === targetName);
  if (!target) return null;

  return `${target.itemName} は ${target.value}${target.unit ? ` ${target.unit}` : ''}${target.flag ? ` ${target.flag}` : ''} と読めました。`;
}

function buildPainReply(text) {
  const safe = normalizeText(text);
  if (/毎日心が苦しい|毎日心がしんどい|限界|かなりしんどい/.test(safe)) {
    return 'そのしんどさ、かなり重いですね。今は整えることより、まず少しでも安全に休める形を優先しましょう。ひとりで抱え込みすぎている感じがあれば、近くの人や医療機関につなぐことも大事です。';
  }
  if (/首.*痛|首を痛め/.test(safe)) {
    return '首のつらさは無理しないのが一番です。今日は運動の話より、まず安静を優先して様子を見ましょう。しびれや強い痛みが続くなら早めに受診も考えてください。';
  }
  if (/腰.*痛/.test(safe)) {
    return '腰がつらいですね。今日は運動記録として進めず、まずは痛みを悪化させないことを優先しましょう。楽な姿勢で少し休めるか見ていきましょうか。';
  }
  if (/むくみ/.test(safe)) {
    return 'むくみが気になるんですね。今日は数字より体の重さを軽くする方を優先して、足を少し上げる、水分や塩分の偏りを見直すなど軽いケアからで大丈夫です。';
  }
  if (/便通/.test(safe)) {
    return '便通がないのはつらいですね。今日は食事制限より、水分や温かいものを少し増やせるかを優先して見ていきましょう。';
  }
  if (/寝れてない|睡眠不足/.test(safe)) {
    return '寝不足が続くと食欲や気分にも影響しやすいので、今日は整えることより回復寄りで見ていきましょう。今すぐできるなら、少しだけ横になる時間を確保できると違います。';
  }
  return null;
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

async function maybeHandleSupportState(input) {
  const text = normalizeText(input?.rawText || '');
  if (!text) return null;
  const replyText = buildPainReply(text);
  if (!replyText) return null;

  const bodySignals = [];
  if (/腰.*痛|首.*痛|痛めた|痛い/.test(text)) bodySignals.push('痛みがある');
  if (/むくみ/.test(text)) bodySignals.push('むくみが出やすい');
  if (/便通/.test(text)) bodySignals.push('便通の乱れが出やすい');
  if (/寝れてない|睡眠不足/.test(text)) bodySignals.push('睡眠不足が出やすい');
  if (/毎日心が苦しい|毎日心がしんどい|限界/.test(text)) bodySignals.push('メンタルのしんどさが出やすい');

  if (bodySignals.length) {
    await contextMemoryService.mergeLongMemory(input.userId, { bodySignals });
    await contextMemoryService.saveShortMemory(input.userId, { activeHealthTheme: bodySignals[0] });
  }

  return replyText;
}

async function maybeHandleLabImage(input, imagePayload) {
  if (input?.messageType !== 'image' || !imagePayload) return null;

  const lab = await labImageAnalysisService.analyzeLabImage(imagePayload);
  if (!lab?.isLabImage || !Array.isArray(lab.items) || !lab.items.length) return null;

  await contextMemoryService.saveShortMemory(input.userId, {
    lastImageType: 'lab',
    followUpContext: {
      source: 'image',
      imageType: 'lab',
      extractedItems: lab.items,
      examDate: lab.examDate || ''
    }
  });

  await contextMemoryService.upsertLabPanel(input.userId, lab);
  await contextMemoryService.addDailyRecord(input.userId, {
    type: 'lab',
    summary: '血液検査画像',
    examDate: lab.examDate || '',
    items: lab.items
  });

  return buildLabImageReply(lab);
}

async function maybeHandleMealImage(input, imagePayload) {
  if (input?.messageType !== 'image' || !imagePayload) return null;

  const meal = await mealAnalysisService.analyzeMealImage(imagePayload);
  if (!meal?.isMealImage) return null;

  const replyText = buildMealReply(meal);

  await contextMemoryService.saveShortMemory(input.userId, {
    lastImageType: 'meal',
    followUpContext: {
      source: 'image',
      imageType: 'meal',
      extractedMeal: meal
    },
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
  const mealParsed = looksLikeMealText(text) && !containsQuestionTone(text)
    ? mealAnalysisService.parseMealText(text)
    : null;
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
    '- 痛みやしんどさが出たら記録よりケアを優先する',
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

async function buildWeightLookupReply(userId) {
  const latest = await contextMemoryService.getLatestWeightEntry(userId);
  if (!latest) {
    const longMemory = await contextMemoryService.getLongMemory(userId);
    if (longMemory?.weight || longMemory?.bodyFat) {
      const parts = [];
      if (longMemory.weight) parts.push(`体重 ${longMemory.weight}`);
      if (longMemory.bodyFat) parts.push(`体脂肪率 ${longMemory.bodyFat}`);
      return `今は ${parts.join(' / ')} として見ています。`;
    }
    return 'まだ体重の記録がはっきり残っていないので、分かる数値を送ってもらえたらそこから見ていけます。';
  }

  const parts = [];
  if (latest.weight != null) parts.push(`体重 ${latest.weight}`);
  if (latest.bodyFat != null) parts.push(`体脂肪率 ${latest.bodyFat}`);
  return `${latest.date} の最新は ${parts.join(' / ')} です。`;
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
      gasolineScore: clampScore((userStateBefore?.gasolineScore || 5) + (/眠い|疲れ|限界/.test(text) ? -0.5 : 0)),
      trustScore: clampScore((userStateBefore?.trustScore || 3) + 0.1),
      lastEmotionTone: /眠い|疲れ|限界|しんど/.test(text) ? 'tired' : 'neutral',
      updatedAt: new Date().toISOString()
    };
    await contextMemoryService.updateUserState(input.userId, nextState);

    const onboarding = await maybeHandleOnboarding(input, shortMemory, longMemory);
    if (onboarding?.handled) {
      await appendTurn(input.userId, input.rawText || '', onboarding.replyText);
      return { ok: true, replyMessages: [{ type: 'text', text: onboarding.replyText }], internal: { intentType: 'onboarding', responseMode: 'guided' } };
    }

    if (input?.messageType === 'text' && (looksLikeDistress(text) || looksLikePain(text))) {
      const supportReply = await maybeHandleSupportState(input);
      if (supportReply) {
        await appendTurn(input.userId, input.rawText || '', supportReply);
        return { ok: true, replyMessages: [{ type: 'text', text: supportReply }], internal: { intentType: 'care_priority', responseMode: 'empathy_only' } };
      }
    }

    const imagePayload = input?.messageType === 'image'
      ? await lineMediaService.getImagePayload(input)
      : null;

    const labImageReply = await maybeHandleLabImage(input, imagePayload);
    if (labImageReply) {
      await appendTurn(input.userId, input.rawText || '[image]', labImageReply);
      return { ok: true, replyMessages: [{ type: 'text', text: labImageReply }], internal: { intentType: 'lab_image', responseMode: 'answer' } };
    }

    const mealImageHandled = await maybeHandleMealImage(input, imagePayload);
    if (mealImageHandled) {
      if (mealImageHandled.meal?.recordReady) {
        await contextMemoryService.addDailyRecord(input.userId, buildImageMealRecordPayload(mealImageHandled.meal));
      }
      await appendTurn(input.userId, input.rawText || '[image]', mealImageHandled.replyText);
      return { ok: true, replyMessages: [{ type: 'text', text: mealImageHandled.replyText }], internal: { intentType: 'meal_image', responseMode: 'record' } };
    }

    const refreshedShortMemory = await contextMemoryService.getShortMemory(input.userId);
    const labFollowUpReply = await maybeAnswerLabFollowUp(input.userId, text, refreshedShortMemory);
    if (labFollowUpReply) {
      await appendTurn(input.userId, input.rawText || '', labFollowUpReply);
      return { ok: true, replyMessages: [{ type: 'text', text: labFollowUpReply }], internal: { intentType: 'lab_followup', responseMode: 'answer' } };
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
      return { ok: true, replyMessages: [{ type: 'text', text: mealFollowUpHandled.replyText }], internal: { intentType: 'meal_followup', responseMode: 'record' } };
    }

    if (intent === 'time_question') {
      const replyText = buildTimeAnswer();
      await appendTurn(input.userId, input.rawText || '', replyText);
      return { ok: true, replyMessages: [{ type: 'text', text: replyText }], internal: { intentType: 'time_question', responseMode: 'answer' } };
    }

    if (intent === 'weight_lookup') {
      const replyText = await buildWeightLookupReply(input.userId);
      await appendTurn(input.userId, input.rawText || '', replyText);
      return { ok: true, replyMessages: [{ type: 'text', text: replyText }], internal: { intentType: 'weight_lookup', responseMode: 'answer' } };
    }

    if (intent === 'memory_question') {
      const replyText = buildMemoryAnswer(await contextMemoryService.getLongMemory(input.userId));
      await appendTurn(input.userId, input.rawText || '', replyText);
      return { ok: true, replyMessages: [{ type: 'text', text: replyText }], internal: { intentType: 'memory_question', responseMode: 'answer' } };
    }

    if (intent === 'weekly_report') {
      const records = await contextMemoryService.getTodayRecords(input.userId);
      const replyText = await weeklyReportService.buildWeeklyReport({
        longMemory: await contextMemoryService.getLongMemory(input.userId),
        recentMessages,
        todayRecords: records
      });
      await appendTurn(input.userId, input.rawText || '', replyText);
      return { ok: true, replyMessages: [{ type: 'text', text: replyText }], internal: { intentType: 'weekly_report', responseMode: 'answer' } };
    }

    if (intent === 'today_records') {
      const records = await contextMemoryService.getTodayRecords(input.userId);
      const replyText = buildTodayRecordsAnswer(records);
      await appendTurn(input.userId, input.rawText || '', replyText);
      return { ok: true, replyMessages: [{ type: 'text', text: replyText }], internal: { intentType: 'today_records', responseMode: 'answer' } };
    }

    if (intent === 'help') {
      const replyText = buildHelpAnswer();
      await appendTurn(input.userId, input.rawText || '', replyText);
      return { ok: true, replyMessages: [{ type: 'text', text: replyText }], internal: { intentType: 'help', responseMode: 'answer' } };
    }

    const inlineProfile = parseInlineProfile(text);
    if (Object.keys(inlineProfile).length) {
      await contextMemoryService.mergeLongMemory(input.userId, inlineProfile);
      const replyText = buildMemoryAnswer(await contextMemoryService.getLongMemory(input.userId));
      await appendTurn(input.userId, input.rawText || '', replyText);
      return { ok: true, replyMessages: [{ type: 'text', text: replyText }], internal: { intentType: 'profile_update', responseMode: 'answer' } };
    }

    if (/うっし〜って呼んで|うっし～って呼んで|うっし〜と呼んで|うっし～と呼んで/.test(text)) {
      await contextMemoryService.mergeLongMemory(input.userId, { preferredName: 'うっし〜' });
      const replyText = 'いいですね。これからは「うっし〜」って呼びますね。';
      await appendTurn(input.userId, input.rawText || '', replyText);
      return { ok: true, replyMessages: [{ type: 'text', text: replyText }], internal: { intentType: 'profile_update', responseMode: 'answer' } };
    }

    const mealTextHandled = await maybeHandleMealText(input);
    if (mealTextHandled) {
      await contextMemoryService.addDailyRecord(input.userId, buildMealRecordPayload(text, mealTextHandled.parsedMeal));
      await appendTurn(input.userId, input.rawText || '', mealTextHandled.replyText);
      return { ok: true, replyMessages: [{ type: 'text', text: mealTextHandled.replyText }], internal: { intentType: 'meal_text', responseMode: 'record' } };
    }

    await maybeStoreSimpleRecords(input.userId, text);

    const longMemoryLatest = await contextMemoryService.getLongMemory(input.userId);
    const replyText = await buildNormalReply(input, recentMessages, recentSummary, longMemoryLatest);

    await appendTurn(input.userId, input.rawText || '', replyText);

    return { ok: true, replyMessages: [{ type: 'text', text: replyText }], internal: { intentType: 'normal', responseMode: 'empathy_plus_one_hint' } };
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
