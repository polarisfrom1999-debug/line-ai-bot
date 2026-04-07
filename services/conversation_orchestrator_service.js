'use strict';

const contextMemoryService = require('./context_memory_service');
const aiChatService = require('./ai_chat_service');
const onboardingService = require('./onboarding_service');
const weeklyReportService = require('./weekly_report_service');
const lineMediaService = require('./line_media_service');
const imageIngestService = require('./image_ingest_service');
const imageClassificationService = require('./image_classification_service');
const mealAnalysisService = require('./meal_analysis_service');
const labDocumentIngestService = require('./lab_document_ingest_service');
const labDocumentStoreService = require('./lab_document_store_service');
const labFollowupService = require('./lab_followup_service');
const sportsConsultationService = require('./sports_consultation_service');
const profileService = require('./profile_service');
const featureFlags = require('../config/feature_flags');
const { detectCaptureTypeFromImageAnalysis } = require('./capture_router_service');
const { getConversationState, setConversationState } = require('./conversation_state_service');
const { shouldCompressGuidance, compressGuidanceText } = require('./reply_fatigue_service');
const {
  detectGuideIntent,
  buildFirstGuideMessage,
  buildFoodGuideMessage,
  buildExerciseGuideMessage,
  buildWeightGuideMessage,
  buildConsultGuideMessage,
  buildHelpMenuMessage,
  buildFaqMessage,
} = require('./user_guide_service');
const { textMessageWithQuickReplies } = require('./line_service');
const { looksLikePainConsultation, detectPainArea, buildPainSupportResponse, buildAdminSymptomSummary, buildStretchSupportResponse } = require('./pain_support_service');
const { buildExerciseMenuResponse } = require('./video_support_service');
const webLinkCommandService = require('./web_link_command_service');
const conversationFactResolverService = require('./conversation_fact_resolver_service');
const labQueryService = require('./lab_query_service');
const activityCalorieService = require('./activity_calorie_service');
const metabolismService = require('./metabolism_service');

function normalizeText(value) {
  return String(value || '').trim();
}

function clampScore(value) {
  return Math.min(10, Math.max(1, Number(value || 5)));
}

function round1(value) {
  return Math.round((Number(value || 0) + Number.EPSILON) * 10) / 10;
}


function sanitizePreferredName(value) {
  const safe = normalizeText(value)
    .replace(/^(私の名前は|名前は|名前：|名前:)/u, '')
    .replace(/(です|だよ|ですよ|と呼んでください|って呼んで|と呼んで).*$/u, '')
    .replace(/\s+/g, '')
    .trim();

  if (!safe) return '';
  if (safe.length > 16) return '';
  if (/今日|昨日|明日|暖か|眠い|しんど|痛い|なりそう|です$|ます$/.test(safe)) return '';
  return safe;
}

function buildLabFollowUpFallback(targetName) {
  return `${targetName} はまだ安定して読めていません。血液検査の画像をもう一度送ってもらえれば、その画像を優先して見ます。`;
}

function summarizeMealItems(parsedMeal) {
  const items = Array.isArray(parsedMeal?.items) ? parsedMeal.items.filter(Boolean) : [];
  if (!items.length) return '食事';
  const joined = items.slice(0, 2).join('、');
  if (/カレー/.test(joined)) return 'カレー系の食事';
  if (/ラーメン|うどん|そば|パスタ/.test(joined)) return '麺系の食事';
  return joined;
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
  if (/私の名前は|名前なんだっけ|名前覚えてる/.test(text)) return 'name_question';
  if (/今日の体重.*(教えて|知りたい)|最新の体重|今日の体脂肪率.*(教えて|知りたい)|私の体重は|私の体脂肪率は/.test(text)) return 'weight_lookup';
  if (/プロフィール|プロフ/.test(text)) return 'profile_summary';
  if (/(消費カロリー|カロリー.*消費|運動.*カロリー|走.*カロリー|筋トレ.*カロリー|1日.*消費|今日.*消費)/.test(text)) return 'activity_calorie_question';
  if (/私の名前|何を覚えてる|覚えてる|覚えていますか/.test(text)) return 'memory_question';
  if (/週間報告|週刊報告|今週のまとめ/.test(text)) return 'weekly_report';
  if (/今日の食事記録|今日の記録|食事記録教えて/.test(text)) return 'today_records';
  if (/使い方教えて|使い方/.test(text)) return 'help';
  if (/無料体験開始|無料体験スタート|体験開始|プロフィール変更|プロフィール入力|プロフィール修正/.test(text)) return 'onboarding';
  return 'normal';
}

function buildMemoryAnswer(longMemory) {
  const lines = [];

  const preferredName = sanitizePreferredName(longMemory?.preferredName || '');
  if (preferredName) lines.push(`名前は「${preferredName}」として覚えています。`);
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


function normalizeLoose(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[！!？?。.,，、]/g, '')
    .replace(/\s+/g, '');
}

function includesAnyLoose(text, patterns) {
  const normalized = normalizeLoose(text);
  return patterns.some((pattern) => normalized.includes(normalizeLoose(pattern)));
}

function isLikelyRecordInput(text) {
  const raw = normalizeText(text);
  if (!raw) return false;
  if (/^\d{2,3}(\.\d)?\s?kg$/i.test(raw) || /^\d{2,3}(\.\d)?$/.test(raw)) return true;
  if (/^(朝|昼|夜)[:：]/.test(raw)) return true;
  if (/歩いた|走った|ジョギング|ランニング|ウォーキング|散歩|筋トレ|ストレッチ|スクワット/.test(raw)) return true;
  return false;
}

function isLikelySummaryExecutionRequest(text) {
  const raw = normalizeText(text);
  return ['グラフ出して', '今週の振り返り', '週間報告', '月間報告', '体重グラフ'].includes(raw);
}

function hasSpecificConsultationDetails(text) {
  const safe = normalizeText(text);
  if (!safe) return false;

  const hasBody = /腰|膝|股関節|首|肩|足首|ふくらはぎ|太もも|背中|かかと|足裏|アキレス/.test(safe);
  const hasSymptom = /痛い|痛み|しびれ|張る|違和感|固まり|重い|だるい|つらい/.test(safe);
  const hasMovement = /歩く|階段|立ち上がり|走る|曲げる|伸ばす|座る|寝返り/.test(safe);
  const hasTiming = /今日|昨日|一昨日|日前|週間|朝|夜|ずっと|から/.test(safe);

  return (hasBody && hasSymptom) || (hasBody && hasMovement) || (hasBody && hasTiming);
}

function detectStageEntryGuideIntent(text) {
  if (!featureFlags.ENABLE_STAGE_ENTRY_GUIDANCE) return null;

  const raw = normalizeText(text);
  const normalized = normalizeLoose(raw);
  if (!normalized) return null;

  if (isLikelyRecordInput(raw)) return null;
  if (isLikelySummaryExecutionRequest(raw)) return null;

  if (featureFlags.ENABLE_GUIDANCE_SYMPTOM_ENTRY && (
    includesAnyLoose(normalized, ['痛みの相談ってどう', 'しびれはどう送れば', '違和感がある時はどう伝えれば']) ||
    (normalized.includes('何を書けばいい') && includesAnyLoose(normalized, ['痛み', 'しびれ', '違和感', '相談']))
  )) {
    return 'symptom_entry_help';
  }

  if (featureFlags.ENABLE_GUIDANCE_HOMECARE_ENTRY && includesAnyLoose(normalized, ['家で何をしたらいいかわからない', '家で少しやりたい', '家メニュー'])) {
    return 'homecare_entry_help';
  }

  if (featureFlags.ENABLE_GUIDANCE_SPORTS_ENTRY && includesAnyLoose(normalized, ['練習の相談ってどう送れば', 'フォームを見直したい時どう送れば', 'スポーツ相談'])) {
    return 'sports_entry_help';
  }

  if (featureFlags.ENABLE_GUIDANCE_COMPETITION_ENTRY && includesAnyLoose(normalized, ['大会の日の食事ってどう相談すれば', '当日朝の食事どう相談', '補食ってどう相談'])) {
    return 'competition_entry_help';
  }

  if (featureFlags.ENABLE_GUIDANCE_GENERAL) {
    if (includesAnyLoose(normalized, ['どう使う', '何を送れば', '何をしたら'])) {
      return 'general_usage_help';
    }
    if (includesAnyLoose(normalized, ['体重ってどう送れば', '体重はどう送れば', '体重どう送る'])) {
      return 'weight_input_help';
    }
    if (includesAnyLoose(normalized, ['食事はどう送れば', '食事ってどう送れば', 'ごはんどう送る'])) {
      return 'meal_input_help';
    }
  }

  if (featureFlags.ENABLE_GUIDANCE_SUMMARY_VIEW && includesAnyLoose(normalized, ['振り返りってどう見る', 'グラフってどう見る', '振り返りどう見る'])) {
    return 'summary_view_help';
  }

  if (featureFlags.ENABLE_GUIDANCE_PERSONA && includesAnyLoose(normalized, ['タイプ変更', '人格変更', '話し方を変更'])) {
    return 'persona_change_help';
  }

  return null;
}

function buildGuideReplyMessage(guidanceType, options = {}) {
  const conversationState = options.conversationState || null;
  let quickReplies = {
    general_usage_help: ['56.8kg', '朝: トーストと卵', '今週の振り返り', '痛みの相談ってどう書く？'],
    symptom_entry_help: ['右膝です', '3日前から', '階段でつらい'],
    homecare_entry_help: ['腰です', '立ち上がりがつらい', '軽めで'],
    sports_entry_help: ['800mです', 'フォーム相談です', '横から送れます'],
    competition_entry_help: ['800mです', '10時です', 'おにぎりなら食べやすい'],
  };

  let text = '';

  switch (guidanceType) {
    case 'general_usage_help':
      text = buildFirstGuideMessage();
      break;
    case 'weight_input_help':
      text = buildWeightGuideMessage();
      break;
    case 'meal_input_help':
      text = buildFoodGuideMessage();
      break;
    case 'summary_view_help':
      text = buildFaqMessage();
      break;
    case 'persona_change_help':
      text = 'タイプ変更はそのまま「タイプ変更したい」や、希望のタイプ名を送ってもらえれば大丈夫です。';
      break;
    case 'symptom_entry_help':
      text = [
        '痛みやしびれの相談は、全部まとまっていなくても大丈夫です。',
        '',
        '例えば',
        '・どこが気になるか',
        '・いつからか',
        '・何をするとつらいか',
        'このどれか1つだけでも送ってもらえれば大丈夫です。',
      ].join('\n');
      break;
    case 'homecare_entry_help':
      text = [
        '家でのケア相談は、短くて大丈夫です。',
        '',
        '例えば',
        '・どこがつらいか',
        '・どんな動きで困るか',
        '・今日は軽めがいいか',
        'このあたりを一言でも送ってください。',
      ].join('\n');
      break;
    case 'sports_entry_help':
      text = [
        '練習やフォームの相談は、競技名と困りごとを一言でも大丈夫です。',
        '',
        '例えば',
        '・800mです',
        '・フォームを見直したい',
        '・横から動画を送れます',
      ].join('\n');
      break;
    case 'competition_entry_help':
      text = [
        '大会の日の食事相談は、種目と時間だけでも大丈夫です。',
        '',
        '例えば',
        '・800mです',
        '・10時です',
        '・おにぎりなら食べやすいです',
      ].join('\n');
      break;
    default:
      text = buildHelpMenuMessage();
      break;
  }

  if (featureFlags.ENABLE_GUIDE_FATIGUE_COMPRESSION && shouldCompressGuidance({ conversationState, guidanceType })) {
    text = compressGuidanceText(guidanceType, text);
    if (guidanceType === 'general_usage_help') {
      quickReplies = {
        ...quickReplies,
        general_usage_help: ['56.8kg', '朝: トーストと卵', '痛みの相談ってどう書く？'],
      };
    }
  }

  return textMessageWithQuickReplies(text, quickReplies[guidanceType] || []);
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
  const heightMatch = safe.match(/身長[は：:]\s*([^\n]+)/);
  const weightMatch = safe.match(/体重[は：:]\s*([^\n]+)/);
  const bodyFatMatch = safe.match(/体脂肪率[は：:]\s*([^\n]+)/);
  const goalMatch = safe.match(/目標[は：:]\s*([^\n]+)/);
  const casualNameMatch = !nameMatch && safe.match(/^(?:私は|ぼくは|僕は|俺は)?\s*([ぁ-んァ-ヶ一-龠A-Za-z0-9〜～ー\-]{1,16})(?:です|だよ|といいます)$/u);

  if (nameMatch) {
    const preferredName = sanitizePreferredName(nameMatch[1]);
    if (preferredName) patch.preferredName = preferredName;
  } else if (casualNameMatch) {
    const preferredName = sanitizePreferredName(casualNameMatch[1]);
    if (preferredName) patch.preferredName = preferredName;
  }
  if (ageMatch) patch.age = ageMatch[1].trim();
  if (heightMatch) patch.height = heightMatch[1].trim();
  if (weightMatch) patch.weight = weightMatch[1].trim();
  if (bodyFatMatch) patch.bodyFat = bodyFatMatch[1].trim();
  if (goalMatch) patch.goal = goalMatch[1].trim();

  return patch;
}

function containsQuestionTone(text) {
  return /教えて|知りたい|覚えてる|なんだっけ|ですか|ますか|かな|\?$|？$/.test(text);
}


function looksLikeMealCorrectionText(text) {
  const safe = normalizeText(text);
  if (!safe) return false;
  if (/疲れ|眠い|しんどい|だるい|痛い|不安/.test(safe)) return false;
  if (/半分|全部|完食|残した|食べてない|食べていない|飲んでない|飲んでいない/.test(safe)) return true;
  if (/(ご飯|ごはん|汁|スープ|納豆|卵|肉|魚|野菜|しらす|オキアミ|ブロッコリー|かぼちゃ).*(ではなく|じゃなく|ではない)/.test(safe)) return true;
  if (/少し/.test(safe) && /(食べた|残した|ご飯|ごはん|汁|スープ|おかず|納豆|卵|肉|魚|野菜)/.test(safe)) return true;
  return false;
}

function buildActivityCalorieReply(text, todayRecords = {}, longMemory = {}) {
  const safe = normalizeText(text);
  const exercises = Array.isArray(todayRecords?.exercises) ? todayRecords.exercises : [];
  if (!exercises.length) {
    return '今のところ今日の運動記録がまだ少ないので、走った時間や筋トレ内容が入るともう少し安定して見られます。';
  }

  const totalExerciseKcal = exercises.reduce((sum, item) => sum + Number(item?.estimatedCalories || item?.kcal || 0), 0);
  const runningKcal = exercises
    .filter((item) => /ジョギング|ランニング|走/.test(normalizeText(item?.name || item?.summary || '')))
    .reduce((sum, item) => sum + Number(item?.estimatedCalories || item?.kcal || 0), 0);
  const strengthKcal = exercises
    .filter((item) => /筋トレ|スクワット|腕立て|腹筋/.test(normalizeText(item?.name || item?.summary || '')))
    .reduce((sum, item) => sum + Number(item?.estimatedCalories || item?.kcal || 0), 0);
  const snapshot = metabolismService.estimateEnergyBalance({ longMemory, todayRecords });
  const totalDaily = Number(snapshot?.totalOutputEstimate || snapshot?.estimatedTdee || 0);

  if (/ランニング|ジョギング|走/.test(safe) && runningKcal > 0) {
    return `今日の走った分だけなら、ざっくり ${Math.round(runningKcal)}kcal 前後です。`;
  }
  if (/筋トレ|スクワット|腕立て|腹筋/.test(safe) && strengthKcal > 0) {
    return `今日の筋トレ分だけなら、ざっくり ${Math.round(strengthKcal)}kcal 前後です。`;
  }
  if (/1日|今日全体|総消費|一日/.test(safe) && totalDaily > 0) {
    return [
      `今日の運動分だけだと、ざっくり ${Math.round(totalExerciseKcal)}kcal 前後です。`,
      `基礎代謝なども含めた1日全体の消費目安は、ざっくり ${Math.round(totalDaily)}kcal 前後で見ています。`
    ].join('\n');
  }
  return `今日の運動分だけだと、ざっくり ${Math.round(totalExerciseKcal)}kcal 前後です。1日全体の消費を見る時は、基礎代謝を含めて別で整理します。`;
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
  if (/ジョギング|ランニング|走りました|走った|走ってきた|走ってる|走っている|歩走/.test(safe)) return { type: 'exercise', summary: safe, name: 'ジョギング' };
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
  const mealLabel = summarizeMealItems(parsedMeal);
  const kcal = round1(parsedMeal?.estimatedNutrition?.kcal || 0);
  const imageKind = parsedMeal?.imageKind || '';

  if ((imageKind === 'menu_text' || imageKind === 'food_package') && !kcal) {
    return [
      `受け取りました。今回は ${mealLabel} として見ています。`,
      parsedMeal?.ocrText ? `読めた文字: ${parsedMeal.ocrText.slice(0, 80)}` : null,
      '必要なら、どれを実際に食べたか教えてもらえればそこから整えます。'
    ].filter(Boolean).join('\n');
  }

  const kcalText = kcal ? `ざっくり 約${kcal}kcal くらいです。` : 'ざっくり見立てています。';
  return [
    `受け取りました。今回は ${mealLabel} として見ています。`,
    kcalText,
    parsedMeal?.comment || '必要なら、このまま今日の合計にもつなげていきます。'
  ].filter(Boolean).join('\n');
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
    amountNote: parsedMeal?.amountNote || ''
  };
}

function buildLabImageReply(lab) {
  return labFollowupService.buildLabImageReply(lab);
}

async function maybeAnswerLabFollowUp(userId, text, shortMemory) {
  const safe = normalizeText(text);
  const panel = shortMemory?.followUpContext?.labPanel || await labDocumentStoreService.getLatestPanelForUser(userId) || null;
  if (!panel) return null;
  if (shortMemory?.followUpContext?.labPanelReady === false) {
    const targetName = labFollowupService.normalizeTarget(safe);
    if (!targetName && !labFollowupService.shouldHandleTrendQuestion(safe)) return null;
    return '血液検査はまだ保存用の整理が終わっていないので、今は値を断定せず保持しています。保存が安定したら保存済みデータから返します。';
  }

  if (labFollowupService.shouldHandleTrendQuestion(safe)) {
    return labFollowupService.buildTrendReply(panel, safe);
  }

  const targetName = labFollowupService.normalizeTarget(safe);
  if (!targetName) return null;

  const selectedDate = shortMemory?.followUpContext?.selectedLabExamDate || panel?.latestExamDate || panel?.examDate || '';
  return labFollowupService.buildItemReply(panel, targetName, selectedDate);
}

async function maybeHandleLabDateSelection(input, shortMemory) {
  const safe = normalizeText(input?.rawText || '');
  const panel = shortMemory?.followUpContext?.labPanel || await labDocumentStoreService.getLatestPanelForUser(input?.userId) || null;
  if (!panel) return null;
  if (shortMemory?.followUpContext?.labPanelReady === false) return null;

  const selectedDate = labFollowupService.extractRequestedDate(safe);
  if (!selectedDate) return null;

  const availableDates = labFollowupService.collectAvailableDates(panel);
  if (!availableDates.includes(selectedDate)) {
    return labFollowupService.buildUnavailableDateReply(panel, selectedDate);
  }

  await contextMemoryService.saveShortMemory(input.userId, {
    followUpContext: {
      ...(shortMemory?.followUpContext || {}),
      selectedLabExamDate: selectedDate,
      availableLabDates: availableDates,
      labPanel: panel
    }
  });

  return labFollowupService.buildDateSelectionReply(selectedDate);
}

async function maybeHandleLabSaveAll(input, shortMemory) {
  const safe = normalizeText(input?.rawText || '');
  const panel = shortMemory?.followUpContext?.labPanel || await labDocumentStoreService.getLatestPanelForUser(input?.userId) || null;
  if (!panel) return null;
  if (shortMemory?.followUpContext?.labPanelReady === false) return null;
  if (!labFollowupService.shouldHandleSaveAll(safe)) return null;

  await contextMemoryService.upsertLabPanel(input.userId, panel);
  await contextMemoryService.saveShortMemory(input.userId, {
    followUpContext: {
      ...shortMemory.followUpContext,
      selectedLabExamDate: panel?.latestExamDate || panel?.examDate || '',
      labPanel: panel,
      availableLabDates: labFollowupService.collectAvailableDates(panel)
    }
  });

  return labFollowupService.buildSaveReply(panel);
}

async function maybeHandleSportsConsultation(input) {
  if (input?.messageType !== 'text') return null;
  const text = normalizeText(input?.rawText || '');
  const intent = sportsConsultationService.detectSportsIntent(text);
  if (!intent) return null;

  return {
    replyText: sportsConsultationService.buildSportsReply(intent),
    internal: {
      intentType: `sports_${intent}`,
      responseMode: 'guided'
    }
  };
}

function buildImageIngestFailureReply() {
  return '画像の受け取りがうまくいかなかったので、もう一度送ってもらえたら大丈夫です。';
}

function buildUnhandledImageReply(kind) {
  if (kind === 'lab_record') {
    return '血液検査の画像として見ていますが、読み取りがまだ安定していません。もう一度送ってもらえると助かります。';
  }
  if (kind === 'meal_record') {
    return '食事の画像は受け取りましたが、まだうまく整理し切れていません。もう一度送ってもらえると助かります。';
  }
  return '今ちょっとうまく受け取れなかったので、もう一度だけ送ってもらえたら大丈夫です。';
}

function looksLikeHomecareConsultation(text) {
  const safe = normalizeText(text);
  if (!safe) return false;
  if (/やった|できた|保存|記録/.test(safe)) return false;

  const hasHomecareWord = /家で|ケア|ほぐし|伸ばし|ストレッチ|メニュー|整え/.test(safe);
  const hasBodyOrMovement = /腰|膝|股関節|首|肩|足首|ふくらはぎ|立ち上がり|歩く|階段|固まり|動き/.test(safe);
  const hasLightNeed = /軽め|少し|やさしく|無理なく|1分/.test(safe);

  return (hasHomecareWord && hasBodyOrMovement) || (hasBodyOrMovement && hasLightNeed);
}

function maybeHandleHomecareCore(input) {
  if (!featureFlags.ENABLE_HOMECARE_CORE) return null;
  if (input?.messageType !== 'text') return null;

  const text = normalizeText(input?.rawText || '');
  if (!text) return null;
  if (!looksLikeHomecareConsultation(text)) return null;

  const area = detectPainArea(text) || '全身';
  const stretch = buildStretchSupportResponse(area);
  let menuText = '';
  try {
    const gentle = buildExerciseMenuResponse(area, 'gentle');
    menuText = gentle?.text || '';
  } catch (_error) {
    menuText = '';
  }

  const replyLines = [
    stretch?.message || `${area}まわりですね。今日は無理なくやさしく整える方向でいきましょう。`,
    menuText ? '' : null,
    menuText || '今日は小さく動かすだけでも十分です。無理に頑張らなくて大丈夫です。',
  ].filter(Boolean);

  const quickReplies = Array.isArray(stretch?.quickReplies) && stretch.quickReplies.length
    ? stretch.quickReplies
    : ['やさしい版', '1分メニュー', '動画で見たい', '今日はここまで'];

  return {
    replyText: replyLines.join('\n'),
    replyMessage: textMessageWithQuickReplies(replyLines.join('\n'), quickReplies),
    internal: {
      intentType: 'homecare_core',
      responseMode: 'guided',
      homecareArea: area,
    },
  };
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

function maybeHandleSymptomCore(input) {
  if (!featureFlags.ENABLE_SYMPTOM_CORE) return null;
  if (input?.messageType !== 'text') return null;

  const text = normalizeText(input?.rawText || '');
  if (!text) return null;
  if (!looksLikePainConsultation(text)) return null;

  const area = detectPainArea(text) || '全身';
  const symptom = buildPainSupportResponse(text, area);
  const replyText = symptom?.message || '';
  if (!replyText) return null;

  const quickReplies = Array.isArray(symptom?.quickReplies) ? symptom.quickReplies : [];
  const adminSummary = buildAdminSymptomSummary(text, area);

  return {
    replyText,
    replyMessage: textMessageWithQuickReplies(replyText, quickReplies),
    internal: {
      intentType: 'symptom_core',
      responseMode: 'guided',
      symptomArea: area,
      symptomAdminSummary: adminSummary,
    },
  };
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
    mergeLongMemory: contextMemoryService.mergeLongMemory,
    persistAuthoritativeProfile: conversationFactResolverService.persistInlineProfile
  });
}

async function maybeHandleSupportState(input) {
  const text = normalizeText(input?.rawText || '');
  if (!text) return null;
  if (featureFlags.ENABLE_SYMPTOM_CORE && looksLikePainConsultation(text)) return null;
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
  if (input?.messageType !== 'image' || !imagePayload?.ok) return { handled: false, analysis: null };

  try {
    const ingest = await labDocumentIngestService.ingestLabDocument({ userId: input.userId, imagePayload });
    const lab = ingest?.panel || null;
    const hasItems = Array.isArray(lab?.items) && lab.items.length > 0;
    if (!lab?.isLabImage && !lab?.labLike) {
      return { handled: false, analysis: lab || null };
    }

    if (!hasItems) {
      await contextMemoryService.saveShortMemory(input.userId, {
        lastImageType: 'lab_pending',
        followUpContext: {
          source: 'image',
          imageType: 'lab_pending',
          extractedItems: [],
          examDate: lab?.examDate || '',
          latestExamDate: lab?.latestExamDate || lab?.examDate || '',
          availableLabDates: Array.isArray(lab?.examDates) ? lab.examDates : [],
          labPanel: lab || null,
          labPanelReady: false
        }
      });

      return {
        handled: true,
        analysis: lab,
        replyText: '血液検査の画像は受け取りました。今回は検査画像として認識していますが、まだ構造化の途中です。まずは「TGは？」「HbA1cは？」「2025-03-22」のように1項目か1日付ずつ聞いてください。'
      };
    }

    await contextMemoryService.saveShortMemory(input.userId, {
      lastImageType: 'lab',
      followUpContext: {
        source: 'image',
        imageType: 'lab',
        extractedItems: lab.items,
        examDate: lab.examDate || '',
        latestExamDate: lab.latestExamDate || lab.examDate || '',
        selectedLabExamDate: lab.latestExamDate || lab.examDate || '',
        availableLabDates: Array.isArray(lab?.examDates) ? lab.examDates : [],
        labPanel: lab,
        labPanelReady: true
      }
    });

    await contextMemoryService.upsertLabPanel(input.userId, lab);
    await contextMemoryService.addDailyRecord(input.userId, {
      type: 'lab',
      summary: '血液検査画像',
      examDate: lab.examDate || '',
      items: lab.items
    });

    return {
      handled: true,
      analysis: lab,
      replyText: buildLabImageReply(lab)
    };
  } catch (error) {
    console.error('[conversation_orchestrator] lab image error:', error?.message || error);
    return { handled: false, analysis: { isLabImage: false, labLike: false }, error };
  }
}

async function maybeHandleMealImage(input, imagePayload) {
  if (input?.messageType !== 'image' || !imagePayload?.ok) return { handled: false, analysis: null };

  try {
    const meal = await mealAnalysisService.analyzeMealImage(imagePayload);
    if (!meal?.isMealImage) {
      return { handled: false, analysis: meal || null };
    }

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
      handled: true,
      analysis: meal,
      replyText,
      meal
    };
  } catch (error) {
    console.error('[conversation_orchestrator] meal image error:', error?.message || error);
    return { handled: false, analysis: { isMealImage: false }, error };
  }
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
  if (!looksLikeMealCorrectionText(text)) return null;

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
    replyText: `了解です。${text}として見直すと、ざっくり 約${round1(adjusted.estimatedNutrition.kcal)}kcal くらいです。`,
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

  const longMemory = await contextMemoryService.getLongMemory(userId);
  const exercise = activityCalorieService.parseActivity(text, Number(String(longMemory?.weight || '').replace(/[^\d.]/g, '')) || 60) || detectExerciseRecord(text);
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
    `- 名前: ${sanitizePreferredName(longMemoryLatest?.preferredName || '') || '未設定'}`,
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

    let imagePayload = null;
    if (input?.messageType === 'image') {
      const ingested = await imageIngestService.ingestLineImage(input);
      if (!ingested?.ok) {
        const replyText = buildImageIngestFailureReply();
        await appendTurn(input.userId, input.rawText || '[image]', replyText);
        return {
          ok: true,
          replyMessages: [{ type: 'text', text: replyText }],
          internal: { intentType: 'image_ingest_error', responseMode: 'retry' }
        };
      }
      imagePayload = ingested.payload;

      const labImageHandled = await maybeHandleLabImage(input, imagePayload);
      if (labImageHandled?.handled) {
        await appendTurn(input.userId, input.rawText || '[image]', labImageHandled.replyText);
        return { ok: true, replyMessages: [{ type: 'text', text: labImageHandled.replyText }], internal: { intentType: 'lab_image', responseMode: 'answer' } };
      }

      const mealImageHandled = await maybeHandleMealImage(input, imagePayload);
      if (mealImageHandled?.handled) {
        if (mealImageHandled.meal?.recordReady) {
          await contextMemoryService.addDailyRecord(input.userId, buildImageMealRecordPayload(mealImageHandled.meal));
        }
        await appendTurn(input.userId, input.rawText || '[image]', mealImageHandled.replyText);
        return { ok: true, replyMessages: [{ type: 'text', text: mealImageHandled.replyText }], internal: { intentType: 'meal_image', responseMode: 'record' } };
      }

      const imageKind = imageClassificationService.classifyImageByAnalysis({
        lab: labImageHandled?.analysis,
        meal: mealImageHandled?.analysis
      });
      const fallbackKind = detectCaptureTypeFromImageAnalysis({
        lab: labImageHandled?.analysis,
        meal: mealImageHandled?.analysis
      }, text);
      if (labImageHandled?.analysis?.labLike) {
        await contextMemoryService.saveShortMemory(input.userId, {
          lastImageType: 'lab_pending',
          followUpContext: {
            source: 'image',
            imageType: 'lab_pending',
            extractedItems: [],
            examDate: labImageHandled.analysis.examDate || '',
            latestExamDate: labImageHandled.analysis.latestExamDate || labImageHandled.analysis.examDate || '',
            availableLabDates: Array.isArray(labImageHandled.analysis?.examDates) ? labImageHandled.analysis.examDates : []
          }
        });
        const replyText = '血液検査の画像は受け取りました。今回は検査画像として見ていますが、まだ構造化の途中です。「TGは？」「HbA1cは？」「今までの傾向は？」「2025-03-22」のように聞いてもらえれば、この画像を優先して見ます。';
        await appendTurn(input.userId, input.rawText || '[image]', replyText);
        return {
          ok: true,
          replyMessages: [{ type: 'text', text: replyText }],
          internal: { intentType: 'lab_image_pending', responseMode: 'answer' }
        };
      }
      const replyText = buildUnhandledImageReply(imageKind === 'unknown' ? fallbackKind : `${imageKind}_record`);
      await appendTurn(input.userId, input.rawText || '[image]', replyText);
      return {
        ok: true,
        replyMessages: [{ type: 'text', text: replyText }],
        internal: { intentType: 'image_unclassified', responseMode: 'retry' }
      };
    }

    const refreshedShortMemory = await contextMemoryService.getShortMemory(input.userId);

    const labSaveReply = await maybeHandleLabSaveAll(input, refreshedShortMemory);
    if (labSaveReply) {
      await appendTurn(input.userId, input.rawText || '', labSaveReply);
      return { ok: true, replyMessages: [{ type: 'text', text: labSaveReply }], internal: { intentType: 'lab_save', responseMode: 'answer' } };
    }

    const labDateReply = await maybeHandleLabDateSelection(input, refreshedShortMemory);
    if (labDateReply) {
      await appendTurn(input.userId, input.rawText || '', labDateReply);
      return { ok: true, replyMessages: [{ type: 'text', text: labDateReply }], internal: { intentType: 'lab_date_select', responseMode: 'answer' } };
    }

    const labFollowUpReply = await labQueryService.answerLabQuery(input.userId, text, refreshedShortMemory) || await maybeAnswerLabFollowUp(input.userId, text, refreshedShortMemory);
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

    if (intent === 'name_question') {
      const replyText = await conversationFactResolverService.buildNameReply(input.userId);
      await appendTurn(input.userId, input.rawText || '', replyText);
      return { ok: true, replyMessages: [{ type: 'text', text: replyText }], internal: { intentType: 'name_question', responseMode: 'answer' } };
    }

    if (intent === 'weight_lookup') {
      const replyText = await conversationFactResolverService.buildWeightLookupReply(input.userId);
      await appendTurn(input.userId, input.rawText || '', replyText);
      return { ok: true, replyMessages: [{ type: 'text', text: replyText }], internal: { intentType: 'weight_lookup', responseMode: 'answer' } };
    }

    if (intent === 'activity_calorie_question') {
      const todayRecords = await contextMemoryService.getTodayRecords(input.userId);
      const replyText = buildActivityCalorieReply(text, todayRecords, longMemory);
      await appendTurn(input.userId, input.rawText || '', replyText);
      return { ok: true, replyMessages: [{ type: 'text', text: replyText }], internal: { intentType: 'activity_calorie_question', responseMode: 'answer' } };
    }

    if (intent === 'memory_question') {
      const replyText = await conversationFactResolverService.buildMemoryAnswer(input.userId);
      await appendTurn(input.userId, input.rawText || '', replyText);
      return { ok: true, replyMessages: [{ type: 'text', text: replyText }], internal: { intentType: 'memory_question', responseMode: 'answer' } };
    }

    if (intent === 'profile_summary') {
      const replyText = await conversationFactResolverService.buildProfileSummary(input.userId);
      await appendTurn(input.userId, input.rawText || '', replyText);
      return { ok: true, replyMessages: [{ type: 'text', text: replyText }], internal: { intentType: 'profile_summary', responseMode: 'answer' } };
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

    const stageGuideIntent = hasSpecificConsultationDetails(text)
      ? null
      : detectStageEntryGuideIntent(text);
    if (stageGuideIntent) {
      const replyMessage = buildGuideReplyMessage(stageGuideIntent, {
        conversationState: getConversationState(input.userId),
      });
      setConversationState(input.userId, { lastGuidanceType: stageGuideIntent, lastIntent: 'guided' });
      const replyText = replyMessage?.text || buildHelpAnswer();
      await appendTurn(input.userId, input.rawText || '', replyText);
      return {
        ok: true,
        replyMessages: [replyMessage],
        internal: { intentType: stageGuideIntent, responseMode: 'guided' }
      };
    }

    const sportsHandled = await maybeHandleSportsConsultation(input);
    if (sportsHandled) {
      await appendTurn(input.userId, input.rawText || '', sportsHandled.replyText);
      return {
        ok: true,
        replyMessages: [{ type: 'text', text: sportsHandled.replyText }],
        internal: sportsHandled.internal
      };
    }

    const symptomCoreHandled = maybeHandleSymptomCore(input);
    if (symptomCoreHandled) {
      await appendTurn(input.userId, input.rawText || '', symptomCoreHandled.replyText);
      return {
        ok: true,
        replyMessages: [symptomCoreHandled.replyMessage],
        internal: symptomCoreHandled.internal
      };
    }

    const homecareCoreHandled = maybeHandleHomecareCore(input);
    if (homecareCoreHandled) {
      await appendTurn(input.userId, input.rawText || '', homecareCoreHandled.replyText);
      return {
        ok: true,
        replyMessages: [homecareCoreHandled.replyMessage],
        internal: homecareCoreHandled.internal
      };
    }

    if (intent === 'help') {
      const replyText = buildHelpAnswer();
      await appendTurn(input.userId, input.rawText || '', replyText);
      return { ok: true, replyMessages: [{ type: 'text', text: replyText }], internal: { intentType: 'help', responseMode: 'answer' } };
    }

    const inlineProfile = parseInlineProfile(text);
    if (Object.keys(inlineProfile).length) {
      await contextMemoryService.mergeLongMemory(input.userId, inlineProfile);
      await conversationFactResolverService.persistInlineProfile(input.userId, inlineProfile);
      const replyText = await conversationFactResolverService.buildMemoryAnswer(input.userId);
      await appendTurn(input.userId, input.rawText || '', replyText);
      return { ok: true, replyMessages: [{ type: 'text', text: replyText }], internal: { intentType: 'profile_update', responseMode: 'answer' } };
    }

    if (/うっし〜って呼んで|うっし～って呼んで|うっし〜と呼んで|うっし～と呼んで/.test(text)) {
      await contextMemoryService.mergeLongMemory(input.userId, { preferredName: 'うっし〜' });
      await conversationFactResolverService.persistInlineProfile(input.userId, { preferredName: 'うっし〜' });
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
      replyMessages: [{ type: 'text', text: buildConversationFallbackReply(input) }],
      internal: { intentType: 'fallback', responseMode: 'empathy_only' }
    };
  }
}

module.exports = {
  orchestrateConversation
};
