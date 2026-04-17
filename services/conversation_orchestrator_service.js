'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const contextMemoryService = require('./context_memory_service');
const aiChatService = require('./ai_chat_service');
const onboardingService = require('./onboarding_service');
const weeklyReportService = require('./weekly_report_service');
const monthlyReportService = require('./monthly_report_service');
const pointsService = require('./points_service');
const energyService = require('./energy_service');
const activityCalorieService = require('./activity_calorie_service');
const lineMediaService = require('./line_media_service');
const imageIngestService = require('./image_ingest_service');
const imageClassificationService = require('./image_classification_service');
const mealAnalysisService = require('./meal_analysis_service');
const labDocumentIngestService = require('./lab_document_ingest_service');
const labDocumentStoreService = require('./lab_document_store_service');
const labFollowupService = require('./lab_followup_service');
const labItemAliasService = require('./lab_item_alias_service');
const sportsConsultationService = require('./sports_consultation_service');
const motionAnalysisService = require('./motion_analysis_service');
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
const {
  looksLikePainConsultation,
  detectPainArea,
  buildPainSupportResponse,
  buildAdminSymptomSummary,
  buildStretchSupportResponse,
} = require('./pain_support_service');
const { buildExerciseMenuResponse } = require('./video_support_service');
const webLinkCommandService = require('./web_link_command_service');
const conversationFactResolverService = require('./conversation_fact_resolver_service');
const labQueryService = require('./lab_query_service');
const constitutionSurveyConfig = require('../config/constitution_survey_config');
const aiPersonaConfig = require('../config/ai_persona_config');

const pendingImageClarificationStore = new Map();
const PENDING_IMAGE_TTL_MS = 15 * 60 * 1000;
/** shortMemory に退避する最大バイト（スナップショット肥大化を抑える） */
const MAX_PENDING_IMAGE_PERSIST_BYTES = 900 * 1024;

function normalizeText(value) {
  return String(value || '').trim();
}

function clampScore(value) {
  return Math.min(10, Math.max(1, Number(value || 5)));
}

function round1(value) {
  return Math.round((Number(value || 0) + Number.EPSILON) * 10) / 10;
}

function hashText(value) {
  const safe = normalizeText(value);
  let h = 0;
  for (let i = 0; i < safe.length; i += 1) h = ((h << 5) - h) + safe.charCodeAt(i);
  return Math.abs(h || 0);
}

function pickVariant(seed, variants) {
  const rows = Array.isArray(variants) ? variants.filter(Boolean) : [];
  if (!rows.length) return '';
  return rows[seed % rows.length];
}

function sanitizePreferredName(value) {
  const safe = normalizeText(value)
    .replace(/^(私の名前は|名前は|名前：|名前:)/u, '')
    .replace(/(です|だよ|ですよ|と呼んでください|って呼んで|と呼んで).*$/u, '')
    .trim();

  if (!safe) return '';
  if (safe.length > 12) return '';
  if (/今日|昨日|明日|暖か|眠い|しんど|痛い|なりそう|です$|ます$/.test(safe)) return '';
  if (/\s/.test(safe)) return '';
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

function detectIntent(input, _shortMemory = {}) {
  const text = normalizeText(input?.rawText || '');

  if (/今何時|何時|何月何日|今日何日|何時何分/.test(text)) return 'time_question';
  if (/今日の体重.*(教えて|知りたい)|最新の体重|今日の体脂肪率.*(教えて|知りたい)|私の体重は|私の体脂肪率は/.test(text)) return 'weight_lookup';
  if (/プロフィール|プロフ/.test(text)) return 'profile_summary';
  if (/私の名前|何を覚えてる|覚えてる|覚えていますか/.test(text)) return 'memory_question';
  if (/週間報告|週刊報告|今週のまとめ/.test(text)) return 'weekly_report';
  if (/月間報告|月刊報告|今月のまとめ/.test(text)) return 'monthly_report';
  if (/今日の食事記録|今日の記録|食事記録教えて/.test(text)) return 'today_records';
  if (/今日の食事の総カロリー|今日の総カロリー|1日の総カロリー|今日の食事の合計|今日の食事の総計/.test(text)) return 'today_meal_totals';
  if (/積算|今日ここまで|ここまでの合計/.test(text)) return 'today_meal_totals';
  if (/栄養バランス|1日の食事の総括|今日の食事の総括|今日の栄養/.test(text)) return 'today_meal_balance';
  if (/最近の食事バランス|2週間の食事バランス|二週間の食事バランス|直近2週間/.test(text)) return 'biweekly_meal_balance';
  if (/今何ポイント|今ポイント|ポイント教えて|ポイントは\??/.test(text)) return 'point_summary';
  if (/管理確認|管理メモ|管理用まとめ/.test(text)) return 'admin_check';

  if (/使い方教えて|使い方|ヘルプ|メニュー|コマンド|無料体験|プラン案内|AIタイプ/.test(text)) return 'help';
  if (/無料体験開始|無料体験スタート|体験開始|プロフィール変更|プロフィール入力|プロフィール修正/.test(text)) return 'onboarding';
  return 'normal';
}

function adjustIntentForFollowupContext(intent, text, shortMemory = {}) {
  if (intent !== 'help') return intent;
  const safe = normalizeText(text);
  const explicit =
    /^使い方$/u.test(safe) ||
    /^ヘルプ$/u.test(safe) ||
    /^メニュー$/u.test(safe) ||
    /^コマンド$/u.test(safe) ||
    /使い方教えて|コマンド一覧|プラン案内|無料体験開始/.test(safe);
  if (explicit) return intent;

  const fu = shortMemory?.followUpContext || {};
  const img = normalizeText(fu?.imageType || shortMemory?.lastImageType || '');
  const inLab = img === 'lab' || img === 'lab_pending' || Boolean(fu?.labPanel);
  const inMeal = img === 'meal' || fu?.lastRecordType === 'meal' || fu?.source === 'meal';
  const inMotion = img === 'motion' || img === 'shoe_wear';
  if (shortMemory?.painSupportState?.active) return 'normal';
  if (inLab || inMeal || inMotion) return 'normal';
  return intent;
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
  if (longMemory?.voiceStyle) lines.push(`雰囲気は「${longMemory.voiceStyle}」です。`);
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
    trial: ['無料体験開始', 'プラン案内', '使い方'],
    plan: ['ライト', 'スタンダード', 'プレミアム'],
    type: ['そっと寄り添う', '明るく後押し', '頼もしく導く', '力強く支える'],
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
    case 'type':
      text = [
        '【AIタイプ】',
        '・そっと寄り添う',
        '・明るく後押し',
        '・頼もしく導く',
        '・力強く支える',
        '',
        '変えたい時は「AIタイプ変更」やタイプ名をそのまま送ってください。',
      ].join('\n');
      break;
    case 'trial':
      text = [
        '【無料体験】',
        '無料体験では、プロフィールを整えて、食事・運動・体重・相談・血液検査の流れを試せます。',
        '',
        '始める時は「無料体験開始」で大丈夫です。',
        '使い方だけ見たい時は「使い方」でも確認できます。',
      ].join('\n');
      break;
    case 'plan':
      text = [
        '【プラン案内】',
        'ここから。では、無料体験のあとに合うプランを選べる流れです。',
        '',
        '・無料体験',
        '・ライト',
        '・スタンダード',
        '・プレミアム',
        '',
        '詳しく見たい時は「プラン案内」と送ってください。',
      ].join('\n');
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

function buildTodayMealTotalsAnswer(records) {
  const totals = sumMealNutrition(records);
  const mealCount = Array.isArray(records?.meals) ? records.meals.length : 0;
  if (!mealCount) {
    return '今日はまだ食事記録が見当たらないので、食べたものや写真を送ってもらえればそこから合計を見ていけます。';
  }

  return [
    '📈 本日の合計（積算）',
    '━━━━━━━━━━━━━',
    `🍽️ 食事件数: ${mealCount}件`,
    `🔥 エネルギー: 約${round1(totals.kcal)} kcal`,
    buildMealNutritionLine(totals),
    '━━━━━━━━━━━━━',
    'このまま次の食事も足していけば、1日の流れを見やすく追えます。'
  ].join('\n');
}

function buildTodayMealBalanceAnswer(records) {
  const mealCount = Array.isArray(records?.meals) ? records.meals.length : 0;
  if (!mealCount) {
    return '今日はまだ食事記録が見当たらないので、食べたものや写真を送ってもらえれば栄養バランスも見ていけます。';
  }
  const totals = sumMealNutrition(records);
  const lines = [
    '🥗 今日ここまでの栄養バランス',
    '━━━━━━━━━━━━━',
    `🍽️ 食事件数: ${mealCount}件`,
    `🔥 エネルギー: 約${round1(totals.kcal)} kcal`,
    buildMealNutritionLine(totals),
    '━━━━━━━━━━━━━'
  ];

  if (totals.protein < 20) {
    lines.push('💡 たんぱく質は少なめなので、卵・肉・魚・ヨーグルトなどを少し足せると整えやすいです。');
  } else if (totals.fat > totals.protein * 2) {
    lines.push('💡 脂質がやや多めなので、次はあっさりしたものを選べるとバランスを戻しやすいです。');
  } else {
    lines.push('💡 大きく崩れすぎてはいないので、このまま次の食事で軽く整えれば大丈夫です。');
  }

  return lines.join('\n');
}

function sumNutritionFromDailyRecords(recentDailyRecords = []) {
  const totals = { kcal: 0, protein: 0, fat: 0, carbs: 0, mealCount: 0 };
  for (const day of recentDailyRecords) {
    const records = day?.records || {};
    const dayTotals = sumMealNutrition(records);
    totals.kcal += Number(dayTotals.kcal || 0);
    totals.protein += Number(dayTotals.protein || 0);
    totals.fat += Number(dayTotals.fat || 0);
    totals.carbs += Number(dayTotals.carbs || 0);
    totals.mealCount += Array.isArray(records?.meals) ? records.meals.length : 0;
  }
  return totals;
}

function buildBiweeklyMealBalanceAnswer(recentDailyRecords = []) {
  const safeRows = Array.isArray(recentDailyRecords) ? recentDailyRecords : [];
  if (!safeRows.length) {
    return '比較できる食事記録がまだ少ないので、まずは食事記録を少し増やしてから一緒に見ていきましょう。';
  }

  const current = safeRows.slice(-14);
  const previous = safeRows.slice(-28, -14);
  if (!current.length) {
    return '直近2週間の食事記録がまだ不足しています。食事を送ってもらえれば比較を返せます。';
  }

  const currentTotals = sumNutritionFromDailyRecords(current);
  const previousTotals = sumNutritionFromDailyRecords(previous);
  const currentDays = Math.max(current.length, 1);
  const previousDays = Math.max(previous.length, 1);
  const kcalDiff = round1(currentTotals.kcal - previousTotals.kcal);
  const proteinDiff = round1(currentTotals.protein - previousTotals.protein);
  const fatDiff = round1(currentTotals.fat - previousTotals.fat);
  const carbsDiff = round1(currentTotals.carbs - previousTotals.carbs);

  const lines = [
    '📊 食事バランス比較（直近2週間 vs その前2週間）',
    '━━━━━━━━━━━━━',
    `🍽️ 直近2週間: ${currentTotals.mealCount}件`,
    `🔥 kcal: ${round1(currentTotals.kcal)}（差分 ${kcalDiff >= 0 ? '+' : ''}${kcalDiff}）`,
    `💪 たんぱく質: ${round1(currentTotals.protein)}g（差分 ${proteinDiff >= 0 ? '+' : ''}${proteinDiff}）`,
    `🍳 脂質: ${round1(currentTotals.fat)}g（差分 ${fatDiff >= 0 ? '+' : ''}${fatDiff}）`,
    `🍞 糖質: ${round1(currentTotals.carbs)}g（差分 ${carbsDiff >= 0 ? '+' : ''}${carbsDiff}）`,
    `📉 1日平均kcal: ${round1(currentTotals.kcal / currentDays)}（前期 ${round1(previousTotals.kcal / previousDays)}）`,
    '━━━━━━━━━━━━━',
  ];

  if (!previousTotals.mealCount) {
    lines.push('💬 比較元の記録がまだ少ないため、今回は直近2週間の基準値として見ていきましょう。');
  } else if (proteinDiff > 10) {
    lines.push('💬 たんぱく質は前期より積めています。良い流れなので、このまま続けて大丈夫です。');
  } else if (proteinDiff < -10) {
    lines.push('💬 たんぱく質がやや下がっているので、卵・魚・肉・大豆を1品足せると戻しやすいです。');
  } else if (fatDiff > 20) {
    lines.push('💬 脂質が上がり気味なので、次の1〜2食を軽めにして整えるのが合いやすいです。');
  } else {
    lines.push('💬 大きく崩れすぎてはいないので、次の食事で1点だけ整える進め方で十分です。');
  }

  return lines.join('\n');
}

function buildPersonaTypeQuickReplyMessage() {
  const labels = Object.values(aiPersonaConfig.AI_TYPES || {}).map((item) => item?.label).filter(Boolean);
  const text = [
    'AIタイプを選べます。今の自分に合うものを選んでください。',
    '',
    ...labels.map((label) => `・${label}`),
  ].join('\n');
  return textMessageWithQuickReplies(text, labels);
}

function buildVoiceStyleQuickReplyMessage() {
  const labels = Object.values(aiPersonaConfig.VOICE_STYLES || {}).map((item) => item?.label).filter(Boolean);
  const text = [
    '雰囲気を選べます。話しやすい温度を選んでください。',
    '',
    ...labels.map((label) => `・${label}`),
  ].join('\n');
  return textMessageWithQuickReplies(text, labels);
}

function maybeParsePersonaType(text) {
  const safe = normalizeText(text);
  if (!safe) return null;
  const configMatch = aiPersonaConfig.findAiTypeByLabel(safe);
  if (configMatch?.label) return configMatch.label;

  if (/やさしく伴走/.test(safe)) return 'そっと寄り添う';
  if (/理屈で整理|バランス型/.test(safe)) return '頼もしく導く';
  if (/背中を押す/.test(safe)) return '明るく後押し';
  if (/力強く支える/.test(safe)) return '力強く支える';
  return null;
}

function maybeParseVoiceStyle(text) {
  const safe = normalizeText(text);
  if (!safe) return null;
  const configMatch = aiPersonaConfig.findVoiceStyleByLabel(safe);
  return configMatch?.label || null;
}

function parseInlineProfile(text) {
  const safe = normalizeText(text);
  const patch = {};

  const nameMatch = safe.match(/名前[は：:]\s*([^\n]+)/);
  const ageMatch = safe.match(/年齢[は：:]\s*([^\n]+)/);
  const weightMatch = safe.match(/体重[は：:]\s*([^\n]+)/);
  const bodyFatMatch = safe.match(/体脂肪率[は：:]\s*([^\n]+)/);
  const goalMatch = safe.match(/目標[は：:]\s*([^\n]+)/);

  if (nameMatch) {
    const preferredName = sanitizePreferredName(nameMatch[1]);
    if (preferredName) patch.preferredName = preferredName;
  }
  if (ageMatch) patch.age = ageMatch[1].trim();
  if (weightMatch) patch.weight = weightMatch[1].trim();
  if (bodyFatMatch) patch.bodyFat = bodyFatMatch[1].trim();
  if (goalMatch) patch.goal = goalMatch[1].trim();

  return patch;
}

function containsQuestionTone(text) {
  const safe = normalizeText(text);
  return /教えて|知りたい|考えて|つくって|組んで|覚えてる|なんだっけ|ですか|ますか|かな\??|どう\??|\?$|？$/.test(safe);
}

/** 練習メニュー・指導方針など「記録」ではなく相談・設計の文脈 */
function looksLikeCoachingOrConsultationText(text) {
  const safe = normalizeText(text);
  if (!safe) return false;
  if (/練習メニュー|メニュー.*(考え|教え|一緒)|プラン|プログラム|立てて|組んで|アドバイス|相談|ヒント|おすすめ|どうすれば|なぜ|理由|上達|強化|中学生|部活|選手|タイム.*(出|伸)|記録.*(出|伸)/.test(safe)) {
    return true;
  }
  if (safe.length >= 28 && /(走る|走れ|800m|400m|1500m|中距離|長距離)/.test(safe) && /(メニュー|練習|週間|スピード|持久)/.test(safe)) {
    return true;
  }
  return false;
}

/** 会話（生成）を先にし、運動・食事の自動記録は後回しにする */
function shouldAnswerWithChatFirst(text) {
  const safe = normalizeText(text);
  if (!safe) return false;
  if (/記録して|ログ|つけといて|入れといて|保存して|カロリーで記録/.test(safe)) return false;
  if (looksLikeCoachingOrConsultationText(safe)) return true;
  if (containsQuestionTone(safe)) return true;
  if (
    safe.length >= 40
    && mealAnalysisService.looksLikeMealText(safe)
    && !mealAnalysisService.isMealNegationOrNonRecordText(safe)
  ) {
    return false;
  }
  if (safe.length >= 40) return true;
  return false;
}

function parseNumericValue(text, pattern) {
  const match = normalizeText(text).match(pattern);
  return match ? Number(String(match[1]).replace(/[０-９]/g, (s) => String.fromCharCode(s.charCodeAt(0) - 65248))) : null;
}

function looksLikeExerciseDistanceKilo(text) {
  const safe = normalizeText(text);
  if (!safe) return false;
  if (/km|ｋｍ/i.test(safe)) return true;
  if (!/[0-9０-９]+/.test(safe)) return false;
  const exerciseCue =
    /走っ|走る|歩い|歩く|ジョギング|ランニング|漕い|漕ぐ|自転車|サイクリング|スイム|泳い|登山|トレイル|運動した|マラソン|距離/.test(safe);
  if (!exerciseCue) return false;
  return /[0-9０-９]+(?:\.[0-9０-９]+)?\s*(?:km|キロ|ｋｍ)/i.test(safe);
}

function detectWeightRecord(text) {
  const safe = normalizeText(text);
  if (!safe || containsQuestionTone(safe)) return null;
  if (looksLikeExerciseDistanceKilo(safe)) return null;

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
  const safe = normalizeText(text);
  if (!safe || containsQuestionTone(safe)) return false;
  if (mealAnalysisService.isMealNegationOrNonRecordText(safe)) return false;
  if (isMealAnnouncementText(safe)) return false;
  if (/使い方|送り方|メニュー|コマンド/.test(safe)) return false;
  if (/^(朝|昼|夜|夕)(ごはん|ご飯|食)(です|でした)?$/.test(safe)) return false;
  if (/^(ごはん|ご飯)(です|でした)?$/.test(safe)) return false;
  return /朝ごはん|昼ごはん|夜ごはん|朝食|昼食|夕食|食べた|飲んだ|ラーメン|カレー|寿司|卵|味噌汁|サラダ|ごはん|ご飯|パン|ヨーグルト|バナナ|パスタ|おにぎり|弁当/.test(safe);
}

function isMealAnnouncementText(text) {
  const safe = normalizeText(text);
  if (!safe) return false;
  if (/何キロカロリー|カロリー|たんぱく質|脂質|糖質/.test(safe)) return false;
  return /(朝ごはん|昼ごはん|夜ごはん|朝食|昼食|夕食).*(送る|送ります|あとで|これから)/.test(safe);
}

function buildMealAnnouncementReply(text) {
  const safe = normalizeText(text);
  const mealType = /朝/.test(safe) ? '朝ごはん' : /昼/.test(safe) ? '昼ごはん' : /夜|夕/.test(safe) ? '夜ごはん' : '食事';
  return `${mealType}ですね。写真が来たらすぐ見ます。`;
}

function sumMealNutrition(records) {
  const meals = Array.isArray(records?.meals) ? records.meals : [];
  return meals.reduce((acc, meal) => {
    acc.kcal += Number(meal?.kcal || meal?.estimatedNutrition?.kcal || 0);
    acc.protein += Number(meal?.protein || meal?.estimatedNutrition?.protein || 0);
    acc.fat += Number(meal?.fat || meal?.estimatedNutrition?.fat || 0);
    acc.carbs += Number(meal?.carbs || meal?.estimatedNutrition?.carbs || 0);
    return acc;
  }, { kcal: 0, protein: 0, fat: 0, carbs: 0 });
}

function buildMealNutritionLine(nutrition) {
  return [
    `💪 タンパク質: ${round1(nutrition?.protein || 0)} g`,
    `🍳 脂質: ${round1(nutrition?.fat || 0)} g`,
    `🍞 糖質: ${round1(nutrition?.carbs || 0)} g`,
  ].join('\n');
}

function buildMealDraftFollowUpReply(meal, todayTotals, questionText) {
  const kcal = round1(meal?.estimatedNutrition?.kcal || 0);
  const mealType = meal?.mealType || 'unknown';
  const lines = [];

  if (/たんぱく質|脂質|糖質/.test(questionText)) {
    lines.push(buildMealNutritionLine(meal?.estimatedNutrition || {}));
  } else {
    lines.push(`この食事はざっくり ${kcal}kcal くらいです。`);
    lines.push(buildMealNutritionLine(meal?.estimatedNutrition || {}));
  }

  if (/今日ここまで|今日の合計|総カロリー|積算/.test(questionText) || mealType === 'lunch' || mealType === 'dinner') {
    lines.push('');
    lines.push('📈 本日の合計（積算）');
    lines.push('━━━━━━━━━━━━━');
    lines.push(`🔥 エネルギー: 約${round1(todayTotals?.kcal || 0)} kcal`);
    lines.push(buildMealNutritionLine(todayTotals || {}));
    lines.push('━━━━━━━━━━━━━');
  }

  return lines.join('\n');
}

async function maybeHandleMealDraftQuestion(input, shortMemory) {
  if (input?.messageType !== 'text') return null;
  const text = normalizeText(input?.rawText || '');
  if (!/何キロカロリー|カロリー|たんぱく質|脂質|糖質|今日ここまで|今日の合計|総カロリー/.test(text)) return null;
  if (!/たんぱく質|脂質|糖質|今日ここまで|今日の合計|総カロリー|食事|朝ごはん|昼ごはん|夜ごはん/.test(text) && /運動|歩いた|ジョギング|ランニング|ウォーキング|スクワット|腕立て/.test((shortMemory?.recentSmallTalkTopic || '') + '\n' + text)) return null;

  const meal = shortMemory?.followUpContext?.imageType === 'meal'
    ? shortMemory?.followUpContext?.extractedMeal
    : shortMemory?.pendingRecordCandidate?.recordType === 'meal_record'
      ? shortMemory?.pendingRecordCandidate?.extracted
      : null;
  if (!meal) return null;

  const todayRecords = await contextMemoryService.getTodayRecords(input.userId);
  const todayTotals = sumMealNutrition(todayRecords);
  return {
    replyText: buildMealDraftFollowUpReply(meal, todayTotals, text),
    meal,
    todayTotals
  };
}

function looksLikeDistress(text) {
  const safe = normalizeText(text);
  return /毎日心が苦しい|毎日心がしんどい|かなりしんどい|ちょっと限界|限界かも|消えたい|もう無理|やる気ない|やる気が出ない/.test(safe);
}

function looksLikeAnnyui(text) {
  const safe = normalizeText(text);
  if (!safe) return false;
  return /なんか今日はだめ|最近ちょっと微妙|やる気が出ない|まあいいかってなっちゃう|頑張れない|今日はむり|なんかしんどい/.test(safe);
}

function buildAnnyuiReply(text) {
  const safe = normalizeText(text);
  if (/やる気が出ない|頑張れない/.test(safe)) {
    return [
      '今は気力を使い切っている感じがありそうですね。',
      '今日は整える日にして、記録だけにするか、今の体調だけ一緒に見ましょう。'
    ].join('\n');
  }
  if (/なんか今日はだめ|今日はむり/.test(safe)) {
    return [
      '今日はそんな日なんですね。ここで止まっても大丈夫です。',
      'いまは原因を広げずに、体調だけ確認するか、食事1件だけ記録して終わりにしましょう。'
    ].join('\n');
  }
  return [
    '少しエネルギーが落ちている日かもしれませんね。',
    '今日は正解を下げて、できることを1つだけ選ぶ進め方でいきましょう。'
  ].join('\n');
}

function looksLikePain(text) {
  return /首.*痛|腰.*痛|痛めた|痛い|骨折|しびれ|むくんでる|むくみ|便通がない|便通ない|寝れてない|睡眠不足/.test(normalizeText(text));
}

function buildMealReply(parsedMeal, options = {}) {
  const items = Array.isArray(parsedMeal?.items) ? parsedMeal.items.filter(Boolean) : [];
  const nut = parsedMeal?.estimatedNutrition || parsedMeal?.estimated_nutrition || {};
  const todayTotals = options?.todayTotals || null;

  const mealLabel = items.length ? items.join('、') : '内容を確認中';
  const kcal = round1(nut.kcal || 0);
  const protein = round1(nut.protein || 0);
  const fat = round1(nut.fat || 0);
  const carbs = round1(nut.carbs || 0);
  const comment = normalizeText(parsedMeal?.comment || '') || '今日もひとつ整っていますね😊';

  const lines = [
    '📸 お食事の解析が終わりました！✨',
    '━━━━━━━━━━━━━',
    `🍽️ 【メニュー 🥗】: ${mealLabel}`,
    `🔥 エネルギー: ${kcal} kcal`,
    `💪 タンパク質: ${protein} g`,
    `🍳 脂質: ${fat} g`,
    `🍞 糖質: ${carbs} g`,
    '━━━━━━━━━━━━━',
    `💬 アドバイス: ${comment}`,
  ];

  if (todayTotals && Number(todayTotals.kcal || 0) > 0) {
    lines.push('');
    lines.push('📈 本日の合計（積算）');
    lines.push('┈┈┈┈┈┈┈┈┈┈┈┈┈');
    lines.push(`🔥 エネルギー: ${round1(todayTotals.kcal)} kcal`);
    lines.push(`💪 タンパク質: ${round1(todayTotals.protein)} g`);
    lines.push(`🍳 脂質: ${round1(todayTotals.fat)} g`);
    lines.push(`🍞 糖質: ${round1(todayTotals.carbs)} g`);
    lines.push('━━━━━━━━━━━━━');
  }

  return lines.join('\n');
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

function buildVideoIngestFailureReply() {
  return '動画の受け取りがうまくいかなかったので、もう一度送ってもらえたら大丈夫です。';
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

function getImageProcessorOptional() {
  try {
    return require('./image_processor');
  } catch (_error) {
    return null;
  }
}

async function analyzeMotionFromFrames({ input, shortMemory, textHint, frames, sourceType }) {
  const motionResult = await motionAnalysisService.analyzeMotionFrames({
    frames,
    context: { note: normalizeText(textHint || shortMemory?.recentSmallTalkTopic || '') },
    userId: input.userId,
  });
  const replyText = normalizeText(motionResult?.replyText || '')
    || '動きは受け取れています。まずは今の良いところから一緒に整理していきましょう。';

  await contextMemoryService.saveShortMemory(input.userId, {
    lastImageType: 'motion',
    followUpContext: {
      ...(shortMemory?.followUpContext || {}),
      source: sourceType,
      imageType: 'motion',
      lastMotionAnalysis: motionResult || null,
    }
  });

  return { motionResult, replyText };
}

async function analyzeMotionFromVideo({ input, shortMemory, mediaPayload, textHint }) {
  const imageProcessor = getImageProcessorOptional();
  if (!imageProcessor || typeof imageProcessor.extractKeyframesFromVideo !== 'function') {
    return {
      ok: false,
      replyText: '動画は受け取れています。いまは静止画解析が先に動く設定なので、横からの静止画を1枚送ってもらえればすぐ見られます。',
      reason: 'image_processor_unavailable',
    };
  }

  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'kokokara-video-'));
  const ext = /quicktime|mov/i.test(mediaPayload?.mimeType || '') ? '.mov' : '.mp4';
  const tempVideoPath = path.join(tempDir, `input${ext}`);
  fs.writeFileSync(tempVideoPath, mediaPayload.buffer);

  try {
    const frames = await imageProcessor.extractKeyframesFromVideo({
      videoPath: tempVideoPath,
      frameCount: 5,
    });
    if (!Array.isArray(frames) || !frames.length) {
      return {
        ok: false,
        replyText: '動画を受け取りましたが、解析に使えるフレームを取り出せませんでした。まずは静止画1枚でも大丈夫です。',
        reason: 'frame_extract_empty',
      };
    }

    const { motionResult, replyText } = await analyzeMotionFromFrames({
      input,
      shortMemory,
      textHint,
      frames,
      sourceType: 'video',
    });
    return { ok: true, motionResult, replyText };
  } catch (error) {
    return {
      ok: false,
      replyText: '動画の解析中に処理が止まってしまいました。静止画1枚からでも丁寧に見られるので、まずは1枚送ってください。',
      reason: normalizeText(error?.message || 'video_motion_error'),
    };
  } finally {
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch (_e) {
      // no-op
    }
  }
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

function looksLikeMotionContext(shortMemory, recentMessages, currentText = '') {
  const followUpType = normalizeText(shortMemory?.lastImageType || shortMemory?.followUpContext?.imageType || '');
  if (followUpType === 'motion') return true;
  if (followUpType === 'meal' || followUpType === 'lab' || followUpType === 'lab_pending') return false;

  const safeCurrent = normalizeText(currentText);
  if (/食べた|ごはん|ご飯|朝食|昼食|夕食|おかず|ラーメン|カレー|寿司|弁当|間食/.test(safeCurrent)) return false;
  if (/動作解析|フォーム|ランニングフォーム|姿勢|投球|スイング|歩き方/.test(safeCurrent)) return true;

  const recentUserText = (Array.isArray(recentMessages) ? recentMessages : [])
    .filter((m) => m?.role === 'user')
    .slice(-4)
    .map((m) => normalizeText(m?.content || ''))
    .join('\n');

  const topicText = normalizeText(shortMemory?.recentSmallTalkTopic || '');
  const merged = [safeCurrent, topicText, recentUserText].join('\n');

  if (/食べた|ごはん|ご飯|朝食|昼食|夕食|おかず|ラーメン|カレー|寿司|弁当|間食/.test(merged)) return false;
  // 血液検査・帳票まわりの文脈では動作解析に寄せない（選択肢の「動作・フォーム」などが混ざっても誤爆しない）
  if (/血液検査|検査結果|検査所見|採血|採血日|中性脂肪|トリグリ|hb\s*a1c|hba1c|ldl|hdl|gpt|got|γ\s*gtp|白血球|赤血球|血小板|e\s*gfr|クレアチニン|尿酸/i.test(merged)) {
    return false;
  }

  return /動作解析|フォーム|走り|ランニングフォーム|ランフォーム|歩き方|姿勢|投球|ピッチング|サーブ|スイング|スクワット|片脚立ち|立ち姿|正面|側面|後面/.test(merged);
}

function looksLikeShoeContext(shortMemory, recentMessages, currentText = '') {
  const followUpType = normalizeText(shortMemory?.lastImageType || shortMemory?.followUpContext?.imageType || '');
  if (followUpType === 'shoe_wear') return true;
  const recentUserText = (Array.isArray(recentMessages) ? recentMessages : [])
    .filter((m) => m?.role === 'user')
    .slice(-4)
    .map((m) => normalizeText(m?.content || ''))
    .join('\n');
  const merged = [normalizeText(currentText), normalizeText(shortMemory?.recentSmallTalkTopic || ''), recentUserText].join('\n');
  return /靴|靴底|ソール|摩耗|削れ|シューズ/.test(merged);
}

function buildImageRouteClarifyMessage() {
  return textMessageWithQuickReplies(
    [
      '画像の種類をもう一度だけ合わせたいです。',
      'この画像はどれに近いですか？',
      '（下から選ぶだけで大丈夫です。こちらで画像を保持して、そのまま解析に進みます）'
    ].join('\n'),
    ['食事の写真', '血液検査の画像', '動作・フォーム解析', '靴底の摩耗確認']
  );
}

function resolveImageRouteSelection(text) {
  const safe = normalizeText(text);
  if (/食事/.test(safe)) return 'meal';
  if (/血液|検査/.test(safe)) return 'lab';
  if (/動作|フォーム|歩き方|走り/.test(safe)) return 'motion';
  if (/靴|靴底|摩耗|ソール/.test(safe)) return 'shoe_wear';
  return '';
}

function setPendingImageForClarification(userId, imagePayload, textHint = '') {
  if (!userId || !imagePayload?.buffer) return;
  pendingImageClarificationStore.set(userId, {
    imagePayload,
    textHint: normalizeText(textHint),
    expiresAt: Date.now() + PENDING_IMAGE_TTL_MS
  });
}

function consumePendingImageForClarification(userId) {
  if (!userId) return null;
  const row = pendingImageClarificationStore.get(userId);
  if (!row) return null;
  pendingImageClarificationStore.delete(userId);
  if (Number(row.expiresAt || 0) < Date.now()) return null;
  return row;
}

function buildPendingImagePersistFields(imagePayload) {
  const buf = imagePayload?.buffer;
  const mimeType = normalizeText(imagePayload?.mimeType) || 'image/jpeg';
  if (!Buffer.isBuffer(buf) || !buf.length) {
    return { imageBase64: null, imageMimeType: mimeType, imagePersistNote: 'no_buffer' };
  }
  if (buf.length > MAX_PENDING_IMAGE_PERSIST_BYTES) {
    return { imageBase64: null, imageMimeType: mimeType, imagePersistNote: 'too_large' };
  }
  return { imageBase64: buf.toString('base64'), imageMimeType: mimeType, imagePersistNote: '' };
}

/** メモリ Map が空でも shortMemory に退避した画像で続行できるようにする */
async function resolvePendingImagePayload(userId) {
  if (!userId) return null;

  const memRow = pendingImageClarificationStore.get(userId);
  if (memRow) {
    pendingImageClarificationStore.delete(userId);
    if (Number(memRow.expiresAt || 0) >= Date.now() && memRow.imagePayload?.buffer) {
      return { imagePayload: memRow.imagePayload, textHint: memRow.textHint || '' };
    }
  }

  const sm = await contextMemoryService.getShortMemory(userId);
  const pc = sm?.pendingClarification;
  if (!pc || pc.type !== 'image_route' || !pc.imageBase64) return null;

  const exp = Number(pc.pendingImageExpiresAt || 0);
  if (exp && Date.now() > exp) return null;

  let buf;
  try {
    buf = Buffer.from(String(pc.imageBase64), 'base64');
  } catch (_err) {
    return null;
  }
  if (!buf?.length) return null;

  return {
    imagePayload: {
      ok: true,
      buffer: buf,
      mimeType: normalizeText(pc.imageMimeType) || 'image/jpeg'
    },
    textHint: normalizeText(pc.textHint || '')
  };
}

async function handleImageByExplicitRoute({ route, input, shortMemory, textHint, imagePayload }) {
  if (route === 'meal') {
    const mealImageHandled = await maybeHandleMealImage(input, imagePayload);
    if (mealImageHandled?.handled) {
      if (mealImageHandled.meal?.recordReady) {
        await contextMemoryService.addDailyRecord(input.userId, buildImageMealRecordPayload(mealImageHandled.meal));
      }
      return {
        ok: true,
        replyText: mealImageHandled.replyText,
        internal: { intentType: 'meal_image', responseMode: 'record' }
      };
    }
    return {
      ok: true,
      replyText: [
        '食事の写真として受け取りましたが、いまの画像だけでは料理の輪郭がはっきりしませんでした。',
        'もう一度同じ写真を送るか、少し明るい場所で全体が写る1枚だと助かります。'
      ].join('\n'),
      internal: { intentType: 'meal_image_retry', responseMode: 'guided' }
    };
  }

  if (route === 'lab') {
    const labImageHandled = await maybeHandleLabImage(input, imagePayload);
    if (labImageHandled?.handled) {
      return {
        ok: true,
        replyText: labImageHandled.replyText,
        internal: { intentType: 'lab_image', responseMode: 'answer' }
      };
    }
    return {
      ok: true,
      replyText: [
        '血液検査の画像として受け取りました。いまの1枚だけでは帳票としての判定が少し不安定でした。',
        '同じ画像でもう一度送るか、検査日や項目名が読めるように寄せた写真だと、TGやHbA1cなど項目ごとのお答えがしやすくなります。'
      ].join('\n'),
      internal: { intentType: 'lab_image_retry', responseMode: 'guided' }
    };
  }

  const motionHint = route === 'shoe_wear'
    ? `${textHint}\n靴底・ソール摩耗の観点で、歩き方や走り方の癖につながる所見を優先してください。`
    : textHint;
  const { motionResult, replyText } = await analyzeMotionFromFrames({
    input,
    shortMemory,
    textHint: motionHint,
    frames: [{
      buffer: imagePayload.buffer,
      mimeType: imagePayload.mimeType || 'image/jpeg',
    }],
    sourceType: 'image',
  });
  return {
    ok: true,
    replyText,
    internal: {
      intentType: route === 'shoe_wear' ? 'shoe_motion_image' : 'motion_image',
      responseMode: 'answer',
      motionModel: motionResult?.usedModel || ''
    }
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

function maybeHandlePainConversationFollowUp(input, shortMemory) {
  if (input?.messageType !== 'text') return null;
  const st = shortMemory?.painSupportState;
  if (!st?.active) return null;
  const text = normalizeText(input.rawText || '');

  if (/しびれ|痺れ|ビリビリ|ピリピリ|針で刺す|電気が走る/.test(text)) {
    return {
      replyText: [
        'しびれが出ているなら、まず神経症状として慎重にみます。',
        '足の力が入りにくい、両足に広がる、排尿や便通の異常、会陰まわりのしびれなどがあるときは、今日は無理せず医療機関の受診を優先してください。',
        '差し支えなければ、いつから・どこからどこまで・歩くと増えるか、もう少し教えてください。',
      ].join('\n'),
      nextState: {
        ...st,
        stage: 'numbness_safety',
        adviceGiven: [...(st.adviceGiven || []), 'numbness_safety'],
      },
    };
  }

  if (/同じ(こと|の)|繰り返|いうこと|言ってる/.test(text)) {
    return {
      replyText:
        '同じ言い方になりすぎましたね。いま一番大事なのは、痛みを増やさない動き方だけです。無理のない範囲で休めたら十分です。',
      nextState: { ...st, stage: 'ack_duplicate' },
    };
  }

  if (/楽な姿勢|楽になる姿勢|楽な体位|楽な寝方|どの姿勢/.test(text)) {
    const region = st.region || '腰';
    const body =
      region === '腰' || /腰/.test(String(st.symptomHint || ''))
        ? [
            '仰向けで膝を立て、足の裏を床につけたままが負担が少なめのことが多いです。',
            '横向きなら、膝の間に薄いクッションを挟むと腰まわりが休みやすいです。',
          ].join('\n')
        : '痛みが増えない範囲で「楽だな」と感じる位置を優先し、長く固めないで大丈夫です。';
    return {
      replyText: body,
      nextState: {
        ...st,
        stage: 'confirm_change',
        adviceGiven: [...(st.adviceGiven || []), 'safe_posture'],
      },
    };
  }

  if (/どうす(る|れば)|どうしたら|次(に|は)?|やること|対処/.test(text)) {
    return {
      replyText: [
        'まずは「動くと増えるか」「静かにしていると楽になるか」だけ見るのが安全です。',
        '増え方がはっきりするなら、その動きはいったん止めて、様子を見ましょう。',
        '悪化やしびれが強くなるときは、無理せず医療側の相談も視野に入れて大丈夫です。',
      ].join('\n'),
      nextState: {
        ...st,
        stage: 'gentle_next',
        adviceGiven: [...(st.adviceGiven || []), 'next_step'],
      },
    };
  }

  return null;
}

async function maybeHandleSupportState(input, shortMemory) {
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

  if (/腰.*痛|腰痛/.test(text)) {
    await contextMemoryService.saveShortMemory(input.userId, {
      painSupportState: {
        active: true,
        region: '腰',
        stage: 'intro',
        adviceGiven: [],
        symptomHint: '腰痛',
        startedAt: new Date().toISOString(),
      },
    });
  } else if (/首.*痛|首を痛め/.test(text)) {
    await contextMemoryService.saveShortMemory(input.userId, {
      painSupportState: {
        active: true,
        region: '首',
        stage: 'intro',
        adviceGiven: [],
        symptomHint: '首',
        startedAt: new Date().toISOString(),
      },
    });
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
      const cachedItemMap = labItemAliasService.buildLabItemMapFromPanel(lab || {});
      const latestLabCache = {
        examDate: lab?.latestExamDate || lab?.examDate || '',
        items: cachedItemMap,
        rawText: normalizeText(lab?.rawText || ''),
        updatedAt: new Date().toISOString()
      };
      console.info('[lab-cache] save pending', {
        userId: input.userId,
        examDate: latestLabCache.examDate || '',
        itemKeys: Object.keys(cachedItemMap)
      });
      await contextMemoryService.saveShortMemory(input.userId, {
        lastImageType: 'lab_pending',
        followUpContext: {
          source: 'image',
          imageType: 'lab_pending',
          extractedItems: [],
          examDate: lab?.examDate || '',
          latestExamDate: lab?.latestExamDate || lab?.examDate || '',
          selectedLabExamDate: lab?.latestExamDate || lab?.examDate || '',
          availableLabDates: Array.isArray(lab?.examDates) ? lab.examDates : [],
          labPanel: lab || null,
          latestLabCache
        }
      });
      try {
        if (lab) await contextMemoryService.upsertLabPanel(input.userId, lab);
      } catch (error) {
        console.error('[conversation_orchestrator] pending lab panel save error:', error?.message || error);
      }

      return {
        handled: true,
        analysis: lab,
        replyText: [
          '血液検査の画像を受け取りました。',
          lab?.latestExamDate || lab?.examDate ? `検査日候補: ${lab?.latestExamDate || lab?.examDate}` : null,
          '抽出は進行中ですが、読めた項目は先に返せます。「TGは？」「HbA1cは？」「LDLは？」のように聞いてください。'
        ].filter(Boolean).join('\n')
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
        latestLabCache: {
          examDate: lab.latestExamDate || lab.examDate || '',
          items: labItemAliasService.buildLabItemMapFromPanel(lab),
          rawText: normalizeText(lab?.rawText || ''),
          updatedAt: new Date().toISOString()
        }
      }
    });
    console.info('[lab-cache] save parsed', {
      userId: input.userId,
      examDate: lab?.latestExamDate || lab?.examDate || '',
      itemKeys: Object.keys(labItemAliasService.buildLabItemMapFromPanel(lab))
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

    const todayRecords = await contextMemoryService.getTodayRecords(input.userId);
    const todayTotals = sumMealNutrition(todayRecords);
    todayTotals.kcal += Number(meal?.estimatedNutrition?.kcal || 0);
    todayTotals.protein += Number(meal?.estimatedNutrition?.protein || 0);
    todayTotals.fat += Number(meal?.estimatedNutrition?.fat || 0);
    todayTotals.carbs += Number(meal?.estimatedNutrition?.carbs || 0);
    const replyText = buildMealReply(meal, { todayTotals });

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

  const todayRecords = await contextMemoryService.getTodayRecords(input.userId);
  const todayTotals = sumMealNutrition(todayRecords);
  todayTotals.kcal += Number(parsedMeal?.estimatedNutrition?.kcal || 0);
  todayTotals.protein += Number(parsedMeal?.estimatedNutrition?.protein || 0);
  todayTotals.fat += Number(parsedMeal?.estimatedNutrition?.fat || 0);
  todayTotals.carbs += Number(parsedMeal?.estimatedNutrition?.carbs || 0);
  const replyText = buildMealReply(parsedMeal, { todayTotals });

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

  const adjustedNutrition = {
    kcal: round1(base.kcal * ratio),
    protein: round1(base.protein * ratio),
    fat: round1(base.fat * ratio),
    carbs: round1(base.carbs * ratio)
  };

  const adjusted = {
    ...meal,
    amountNote: text,
    estimatedNutrition: adjustedNutrition
  };

  const deltaNutrition = {
    kcal: round1(adjustedNutrition.kcal - Number(base.kcal || 0)),
    protein: round1(adjustedNutrition.protein - Number(base.protein || 0)),
    fat: round1(adjustedNutrition.fat - Number(base.fat || 0)),
    carbs: round1(adjustedNutrition.carbs - Number(base.carbs || 0))
  };

  const todayRecords = await contextMemoryService.getTodayRecords(input.userId);
  const todayTotals = sumMealNutrition(todayRecords);
  const correctedTotals = {
    kcal: round1((todayTotals?.kcal || 0) + deltaNutrition.kcal),
    protein: round1((todayTotals?.protein || 0) + deltaNutrition.protein),
    fat: round1((todayTotals?.fat || 0) + deltaNutrition.fat),
    carbs: round1((todayTotals?.carbs || 0) + deltaNutrition.carbs)
  };

  await contextMemoryService.saveShortMemory(input.userId, {
    pendingRecordCandidate: {
      recordType: 'meal_record',
      extracted: adjusted
    }
  });

  return {
    replyText: [
      `了解です。${text}として見直しました。`,
      `🍽️ この食事は ざっくり 約${round1(adjustedNutrition.kcal)}kcal くらいです。`,
      buildMealNutritionLine(adjustedNutrition || {}),
      '',
      '📈 修正後の本日の合計（積算）',
      '━━━━━━━━━━━━━',
      `🔥 エネルギー: 約${round1(correctedTotals.kcal)} kcal`,
      buildMealNutritionLine(correctedTotals || {}),
      '━━━━━━━━━━━━━'
    ].join('\n'),
    adjusted,
    correctionRecord: {
      type: 'meal',
      name: '食事量補正',
      summary: `食事量補正: ${text}`,
      estimatedNutrition: deltaNutrition,
      kcal: Number(deltaNutrition.kcal || 0),
      protein: Number(deltaNutrition.protein || 0),
      fat: Number(deltaNutrition.fat || 0),
      carbs: Number(deltaNutrition.carbs || 0),
      amountNote: text
    }
  };
}

function maybeHandleMealAnnouncement(input) {
  if (input?.messageType !== 'text') return null;
  const text = normalizeText(input?.rawText || '');
  if (!isMealAnnouncementText(text)) return null;
  return {
    replyText: buildMealAnnouncementReply(text),
    internal: { intentType: 'meal_announcement', responseMode: 'guided' }
  };
}

async function maybeHandleSimpleWeightRecord(input, text) {
  const record = detectWeightRecord(text);
  if (!record) return null;

  await contextMemoryService.addDailyRecord(input.userId, record);
  if (record.weight != null || record.bodyFat != null) {
    await contextMemoryService.mergeLongMemory(input.userId, {
      ...(record.weight != null ? { weight: String(record.weight) } : {}),
      ...(record.bodyFat != null ? { bodyFat: String(record.bodyFat) } : {}),
    });
    await conversationFactResolverService.persistInlineProfile(input.userId, {
      ...(record.weight != null ? { weight: String(record.weight) } : {}),
      ...(record.bodyFat != null ? { bodyFat: String(record.bodyFat) } : {}),
    });
  }

  const parts = [];
  if (record.weight != null) parts.push(`体重 ${record.weight}kg`);
  if (record.bodyFat != null) parts.push(`体脂肪率 ${record.bodyFat}%`);
  const seed = hashText(text);
  const replyText = [
    pickVariant(seed, [
      `${parts.join(' / ')}で更新しておきました。`,
      `${parts.join(' / ')}として受け取っています。`,
      `いまの数値は ${parts.join(' / ')} で見ていきます。`
    ]),
    pickVariant(seed + 1, [
      'また変わった時も、そのまま一言で大丈夫です。',
      'このまま日々の流れの中で見ていきますね。',
      'ここから先の記録にもつなげて見ていきます。',
    ])
  ].join('\n');

  return { replyText, record };
}

async function maybeHandleSimpleExerciseRecord(input, text, longMemoryLatest) {
  if (looksLikeCoachingOrConsultationText(text) || shouldAnswerWithChatFirst(text)) return null;
  const record = energyService.buildExerciseRecord(text, { weightKg: Number(longMemoryLatest?.weight || 60) || 60 });
  if (!record || record.exerciseType === 'unknown' || containsQuestionTone(text)) return null;

  await contextMemoryService.addDailyRecord(input.userId, record);
  await contextMemoryService.saveShortMemory(input.userId, { recentSmallTalkTopic: text, followUpContext: { source: 'text', imageType: '', lastRecordType: 'exercise' } });
  return { replyText: energyService.buildExerciseReply(record), record };
}

async function maybeHandleExerciseCalorieQuestion(input, text, longMemoryLatest) {
  if (!/何キロカロリー|カロリー|消費/.test(text)) return null;
  if (/食事|朝ごはん|昼ごはん|夜ごはん|たんぱく質|脂質|糖質/.test(text)) return null;

  const records = await contextMemoryService.getTodayRecords(input.userId);
  const exercises = Array.isArray(records?.exercises) ? records.exercises : [];
  if (!exercises.length) return null;

  const latest = exercises[exercises.length - 1];
  const summaryText = activityCalorieService.buildActivityReply({
    text,
    exercises: [latest],
    weightKg: activityCalorieService.extractProfileWeightKg(longMemoryLatest || {}),
    totalDaily: 0
  });

  return { replyText: summaryText, latest };
}

function buildAdminCheckReply({ longMemory, records, points }) {
  const latestWeight = Array.isArray(records?.weights) && records.weights.length ? records.weights[records.weights.length - 1] : null;
  const lines = [
    '管理確認メモです。',
    `ユーザー: ${sanitizePreferredName(longMemory?.preferredName || '') || '未設定'}`,
    latestWeight ? `最新体組成: 体重 ${latestWeight.weight || '-'}kg${latestWeight.bodyFat != null ? ` / 体脂肪率 ${latestWeight.bodyFat}%` : ''}` : null,
    longMemory?.goal ? `目標: ${longMemory.goal}` : null,
    `最新日の内訳: 食事 ${(records?.meals || []).length}件 / 運動 ${(records?.exercises || []).length}件 / 体重 ${(records?.weights || []).length}件`,
    `現在ポイント: ${points}pt`,
    '継続・特典判定の土台としてこのまま見ていけます。',
  ];
  return lines.filter(Boolean).join('\n');
}

async function maybeStoreSimpleRecords(userId, text) {
  if (shouldAnswerWithChatFirst(text) || looksLikeCoachingOrConsultationText(text)) return;
  if (looksLikeDistress(text) || looksLikePain(text) || looksLikeAnnyui(text)) {
    // 人の状態ケアを優先し、低余力時は自動記録を急がない
    return;
  }
  if (mealAnalysisService.isMealNegationOrNonRecordText(text)) return;
  const mealParsed = looksLikeMealText(text) && !containsQuestionTone(text) && !isMealAnnouncementText(text)
    ? mealAnalysisService.parseMealText(text)
    : null;
  if (mealParsed && Number(mealParsed.confidence || 0) >= 0.4) {
    await contextMemoryService.addDailyRecord(userId, buildMealRecordPayload(text, mealParsed));
  }
}

function inferEnergyLevelForNormalReply(inputText, shortMemory) {
  const safe = normalizeText(inputText);
  const tone = normalizeText(shortMemory?.lastEmotionTone || '');
  if (/眠い|寝不足|疲れ|しんどい|だるい|限界|無理/.test(safe)) return 'low';
  if (/元気|いけそう|調子いい/.test(safe)) return 'high';
  if (tone === 'tired' || tone === 'heavy_negative' || tone === 'anxious') return 'low';
  return 'middle';
}

async function buildNormalReply(input, recentMessages, recentSummary, longMemoryLatest, shortMemory) {
  const energyLevel = inferEnergyLevelForNormalReply(input?.rawText || '', shortMemory);
  const systemHint = [
    '[会話の姿勢]',
    '- まず自然な短文の会話として返す（カロリー確定・記録処理の口調にしない）',
    '- 練習メニューやタイムの相談では、共感と一緒に組む方向だけ。数値記録として締めない',
    '- 短い相手には短く。まず質問に答える',
    '- 提案は多くて1つ。毎回同じ締めを使わない',
    '- 上から言わない。痛みやしんどさが出たら記録よりケアを優先',
    '[プロフィール要約]',
    `- 名前: ${sanitizePreferredName(longMemoryLatest?.preferredName || '') || '未設定'}`,
    `- 年齢: ${longMemoryLatest?.age || '未設定'}`,
    `- 体重: ${longMemoryLatest?.weight || '未設定'}`,
    `- 体脂肪率: ${longMemoryLatest?.bodyFat || '未設定'}`,
    `- AIタイプ: ${longMemoryLatest?.aiType || '未設定'}`,
    `- 雰囲気: ${longMemoryLatest?.voiceStyle || '未設定'}`,
    `- energy_level推定: ${energyLevel}`,
    `- 体質タイプ: ${longMemoryLatest?.constitutionType || '未設定'}`,
    `- プラン: ${longMemoryLatest?.selectedPlan || '未設定'}`,
    Array.isArray(longMemoryLatest?.supportPreference) && longMemoryLatest.supportPreference.length
      ? `- 支え方の好み: ${longMemoryLatest.supportPreference.slice(0, 4).join(' / ')}`
      : null,
    recentSummary ? `- 最近の流れ: ${recentSummary}` : null,
    recentMessages.filter((m) => m.role === 'assistant').slice(-4).length ? `- 直近で避けたい言い回し: ${recentMessages.filter((m) => m.role === 'assistant').slice(-4).map((m) => m.content).join(' / ')}` : null
  ].filter(Boolean).join('\n');

  return aiChatService.generateReply({
    userId: input.userId,
    userMessage: input.rawText || '',
    recentMessages,
    intentType: 'normal',
    responseMode: 'empathy_plus_one_hint',
    energyLevel,
    hiddenContext: systemHint,
    longMemory: longMemoryLatest
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

function resolveImageRouteDecision({ shortMemory, recentMessages, imageAnalysis, textHint }) {
  // ユーザーが直前に選んだ画像用途（lastImageType）を優先し、古い followUp の imageType に負けない
  const followUpType = shortMemory?.lastImageType || shortMemory?.followUpContext?.imageType || '';
  const recent = [...(Array.isArray(recentMessages) ? recentMessages : [])].reverse();
  const recentUser = recent.find((item) => item?.role === 'user' && normalizeText(item?.content || ''));
  const recentAssistant = recent.find((item) => item?.role === 'assistant' && normalizeText(item?.content || ''));
  const mergedHint = [textHint, recentUser?.content || '', recentAssistant?.content || ''].filter(Boolean).join('\n');
  const scores = imageClassificationService.scoreImageRoutes({
    lab: imageAnalysis?.lab || null,
    meal: imageAnalysis?.meal || null,
    shoeWear: imageAnalysis?.shoeWear || null,
    movement: imageAnalysis?.movement || null,
    hintText: mergedHint,
    followUpType
  });
  return { ...imageClassificationService.resolveImageRouteByScore(scores), scores };
}

function buildConversationFallbackReply(input) {
  const text = normalizeText(input?.rawText || '');
  if (/画像|写真/.test(text)) {
    return '今ちょっとうまく受け取れなかったので、同じ画像をもう一度送ってもらえたら大丈夫です。';
  }
  if (/無料体験|AIタイプ|使い方|プラン/.test(text)) {
    return '今ちょっとうまく案内がつながらなかったので、もう一度同じ言葉を送ってもらえれば続きから整えます。';
  }
  return '今ちょっとうまく受け取れなかったので、もう一度だけ送ってもらえたら大丈夫です。';
}

function isInitialConstitutionSurveyTrigger(text) {
  const safe = normalizeText(text);
  return /体質アンケート開始|初回体質アンケート|体質アンケート/.test(safe);
}

function isPeriodicConstitutionSurveyTrigger(text) {
  const safe = normalizeText(text);
  return /体質チェック|定期体質チェック|今の調子チェック/.test(safe);
}

function buildConstitutionQuestionMessage(state) {
  const survey = constitutionSurveyConfig.getSurveyByType(state?.surveyType);
  const question = constitutionSurveyConfig.getCurrentQuestion(state);
  if (!survey || !question) return null;
  const progress = `${Number(state.currentIndex || 0) + 1}/${survey.questions.length}`;
  const lines = [
    `【${survey.title} ${progress}】`,
    question.text,
  ];
  const quickReplies = constitutionSurveyConfig.getQuickReplyLabels(survey.answerOptions || []);
  return textMessageWithQuickReplies(lines.join('\n'), quickReplies);
}

function buildSupportPreferenceFromInitialResult(result = {}) {
  const prefs = [];
  const main = normalizeText(result?.mainTypeLabel || '');
  const sub = normalizeText(result?.subTypeLabel || '');
  const append = (value) => {
    const safe = normalizeText(value);
    if (!safe) return;
    if (!prefs.includes(safe)) prefs.push(safe);
  };

  append('提案は1つまで');
  if (/消耗|我慢|気疲れ|むくみ/.test(main) || /消耗|我慢|気疲れ|むくみ/.test(sub)) append('安心感優先');
  if (/消耗|食後どんより|省エネ/.test(main)) append('短く返す');
  if (/考えすぎ|頼もしく導く|省エネ/.test(main) || /考えすぎ/.test(sub)) append('根拠を添えて返す');
  if (/甘いもの波|気疲れ/.test(main)) append('明るめの温度で返す');
  return prefs;
}

function buildSupportPreferenceFromPeriodicDelta(delta = {}) {
  const prefs = [];
  const append = (value) => {
    const safe = normalizeText(value);
    if (!safe) return;
    if (!prefs.includes(safe)) prefs.push(safe);
  };
  const overwork = Number(delta?.overwork || 0);
  const stress = Number(delta?.stress || 0);
  const overthink = Number(delta?.overthink || 0);
  const slow = Number(delta?.slow || 0);

  append('提案は1つまで');
  if (overwork > 0 || stress > 0 || slow > 0) append('安心感優先');
  if (overwork > 1 || slow > 1) append('短く返す');
  if (overthink > 0) append('根拠を添えて返す');
  return prefs;
}

async function maybeHandleConstitutionSurvey(input, shortMemory, longMemory, mergeLongMemory, saveShortMemory, saveWeeklySurvey, saveMonthlySurvey) {
  if (input?.messageType !== 'text') return null;
  const text = normalizeText(input?.rawText || '');
  if (!text) return null;

  const active = shortMemory?.constitutionSurveyState || null;
  const startInitial = isInitialConstitutionSurveyTrigger(text);
  const startPeriodic = isPeriodicConstitutionSurveyTrigger(text);

  if (!active && !startInitial && !startPeriodic) return null;

  if (!active && (startInitial || startPeriodic)) {
    const state = startPeriodic
      ? constitutionSurveyConfig.buildPeriodicCheckState()
      : constitutionSurveyConfig.buildInitialSurveyState();
    const survey = constitutionSurveyConfig.getSurveyByType(state.surveyType);
    await saveShortMemory(input.userId, { constitutionSurveyState: state });
    const firstQuestion = buildConstitutionQuestionMessage(state);
    return {
      replyText: [survey.introMessage, survey.completeMessage ? '' : null, firstQuestion?.text || ''].filter(Boolean).join('\n'),
      replyMessage: firstQuestion || { type: 'text', text: survey.introMessage },
      internal: { intentType: startPeriodic ? 'constitution_periodic_start' : 'constitution_initial_start', responseMode: 'guided' }
    };
  }

  if (!active) return null;

  const survey = constitutionSurveyConfig.getSurveyByType(active.surveyType);
  const answerOption = active.surveyType === constitutionSurveyConfig.SURVEY_TYPES.PERIODIC
    ? constitutionSurveyConfig.getPeriodicCheckAnswerOption(text)
    : constitutionSurveyConfig.getInitialSurveyAnswerOption(text);

  if (!answerOption) {
    const questionMessage = buildConstitutionQuestionMessage(active);
    return {
      replyText: `${survey.title}はボタンから選べます。近いものを1つ選んでください。`,
      replyMessage: questionMessage || { type: 'text', text: `${survey.title}はボタンから選べます。` },
      internal: { intentType: 'constitution_answer_retry', responseMode: 'guided' }
    };
  }

  const nextState = constitutionSurveyConfig.applySurveyAnswer(active, answerOption.label);
  if (!constitutionSurveyConfig.isSurveyComplete(nextState)) {
    await saveShortMemory(input.userId, { constitutionSurveyState: nextState });
    const nextQuestion = buildConstitutionQuestionMessage(nextState);
    return {
      replyText: nextQuestion?.text || '次の質問に進みます。',
      replyMessage: nextQuestion || { type: 'text', text: '次の質問に進みます。' },
      internal: { intentType: 'constitution_question_progress', responseMode: 'guided' }
    };
  }

  let replyText = survey.completeMessage;
  if (nextState.surveyType === constitutionSurveyConfig.SURVEY_TYPES.INITIAL) {
    const evaluated = constitutionSurveyConfig.evaluateInitialSurvey(nextState.answers || {});
    const nextSupportPreference = buildSupportPreferenceFromInitialResult(evaluated?.result || {});
    const aiTypeFallback = normalizeText(longMemory?.aiType || '') ? null : normalizeText(evaluated?.result?.recommendedAiTypes?.[0] || '');
    const voiceStyleFallback = normalizeText(longMemory?.voiceStyle || '') ? null : normalizeText(evaluated?.result?.recommendedVoiceStyles?.[0] || '');
    await mergeLongMemory(input.userId, {
      constitutionType: evaluated?.result?.mainTypeLabel || '',
      lifeContext: [
        `体質主タイプ: ${evaluated?.result?.mainTypeLabel || '未判定'}`,
        `体質副タイプ: ${evaluated?.result?.subTypeLabel || '未判定'}`
      ],
      supportPreference: nextSupportPreference,
      ...(aiTypeFallback ? { aiType: aiTypeFallback } : {}),
      ...(voiceStyleFallback ? { voiceStyle: voiceStyleFallback } : {})
    });
    await saveMonthlySurvey(input.userId, {
      completed: true,
      answers: nextState.answers || {},
      result: evaluated?.result || {},
      scores: evaluated?.scores || {}
    });
    replyText = [survey.completeMessage, '', evaluated?.result?.text || '今の傾向を整理しました。'].join('\n');
  } else {
    const currentDelta = constitutionSurveyConfig.scorePeriodicCheck(nextState.answers || {});
    const previousDelta = shortMemory?.lastPeriodicConstitutionDelta || {};
    const diffComment = constitutionSurveyConfig.buildPeriodicCheckSummary(previousDelta, currentDelta);
    const nextSupportPreference = buildSupportPreferenceFromPeriodicDelta(currentDelta);
    await mergeLongMemory(input.userId, {
      lifeContext: ['定期体質チェックを実施'],
      supportPreference: nextSupportPreference
    });
    await saveWeeklySurvey(input.userId, {
      completed: true,
      answers: nextState.answers || {},
      delta: currentDelta
    });
    await saveShortMemory(input.userId, { lastPeriodicConstitutionDelta: currentDelta });
    replyText = [survey.completeMessage, '', diffComment].join('\n');
  }

  await saveShortMemory(input.userId, { constitutionSurveyState: null });
  return {
    replyText,
    replyMessage: { type: 'text', text: replyText },
    internal: { intentType: 'constitution_result', responseMode: 'guided' }
  };
}

async function orchestrateConversation(input) {
  try {
    const shortMemory = await contextMemoryService.getShortMemory(input.userId);
    const longMemory = await contextMemoryService.getLongMemory(input.userId);
    const userStateBefore = await contextMemoryService.getUserState(input.userId);
    const recentSummary = await contextMemoryService.buildRecentSummary(input.userId, 3);
    const recentMessages = await contextMemoryService.getRecentMessages(input.userId, 20);

    const text = normalizeText(input.rawText || '');
    let intent = detectIntent(input, shortMemory);
    intent = adjustIntentForFollowupContext(intent, text, shortMemory);

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

    const constitutionSurveyHandled = await maybeHandleConstitutionSurvey(
      input,
      shortMemory,
      longMemory,
      contextMemoryService.mergeLongMemory,
      contextMemoryService.saveShortMemory,
      contextMemoryService.saveWeeklySurvey,
      contextMemoryService.saveMonthlySurvey
    );
    if (constitutionSurveyHandled) {
      await appendTurn(input.userId, input.rawText || '', constitutionSurveyHandled.replyText);
      return {
        ok: true,
        replyMessages: [constitutionSurveyHandled.replyMessage || { type: 'text', text: constitutionSurveyHandled.replyText }],
        internal: constitutionSurveyHandled.internal || { intentType: 'constitution_survey', responseMode: 'guided' }
      };
    }

    if (input?.messageType === 'text' && shortMemory?.pendingClarification?.type === 'image_route') {
      const selected = resolveImageRouteSelection(text);
      if (selected) {
        const autoRoute = normalizeText(shortMemory?.pendingClarification?.autoRoute || '');
        if (autoRoute && autoRoute !== selected) {
          await contextMemoryService.mergeLongMemory(input.userId, {
            lifeContext: [`画像分類補正: 自動=${autoRoute} / 手動=${selected}`]
          });
        }
        const pendingImage = await resolvePendingImagePayload(input.userId);
        await contextMemoryService.saveShortMemory(input.userId, {
          lastImageType: selected,
          pendingClarification: null
        });
        if (pendingImage?.imagePayload?.buffer) {
          const routed = await handleImageByExplicitRoute({
            route: selected,
            input,
            shortMemory,
            textHint: pendingImage.textHint || text,
            imagePayload: pendingImage.imagePayload
          });
          await appendTurn(input.userId, input.rawText || '', routed.replyText);
          return {
            ok: true,
            replyMessages: [{ type: 'text', text: routed.replyText }],
            internal: routed.internal
          };
        }
        const replyText = `ありがとうございます。次は「${selected === 'meal' ? '食事' : selected === 'lab' ? '血液検査' : selected === 'shoe_wear' ? '靴底摩耗' : '動作解析'}」として見ます。画像の保持が切れてしまったようなので、同じ写真をもう一度送ってください。（画像が大きい場合はこちらで保持できないことがあります）`;
        await appendTurn(input.userId, input.rawText || '', replyText);
        return {
          ok: true,
          replyMessages: [{ type: 'text', text: replyText }],
          internal: { intentType: 'image_route_selected', responseMode: 'guided' }
        };
      }
    }

    const painThread = input?.messageType === 'text' ? maybeHandlePainConversationFollowUp(input, shortMemory) : null;
    if (painThread?.replyText) {
      await contextMemoryService.saveShortMemory(input.userId, { painSupportState: painThread.nextState || shortMemory?.painSupportState });
      await appendTurn(input.userId, input.rawText || '', painThread.replyText);
      return {
        ok: true,
        replyMessages: [{ type: 'text', text: painThread.replyText }],
        internal: { intentType: 'pain_thread', responseMode: 'empathy_plus_one_hint' },
      };
    }

    if (input?.messageType === 'text' && (looksLikeDistress(text) || looksLikePain(text))) {
      const supportReply = await maybeHandleSupportState(input, shortMemory);
      if (supportReply) {
        await appendTurn(input.userId, input.rawText || '', supportReply);
        return { ok: true, replyMessages: [{ type: 'text', text: supportReply }], internal: { intentType: 'care_priority', responseMode: 'empathy_only' } };
      }
    }

    if (input?.messageType === 'text' && looksLikeAnnyui(text)) {
      const replyText = buildAnnyuiReply(text);
      const replyMessage = textMessageWithQuickReplies(replyText, ['今日は記録だけ', '体調だけ整理', '1つだけ提案して']);
      await appendTurn(input.userId, input.rawText || '', replyText);
      return {
        ok: true,
        replyMessages: [replyMessage],
        internal: { intentType: 'annyui_support', responseMode: 'empathy_plus_one_hint' }
      };
    }

    const directGuideIntent = detectGuideIntent(text);
    if (directGuideIntent) {
      const replyMessage = buildGuideReplyMessage(directGuideIntent, {
        conversationState: getConversationState(input.userId),
      });
      const replyText = replyMessage?.text || buildHelpAnswer();
      await appendTurn(input.userId, input.rawText || '', replyText);
      return { ok: true, replyMessages: [replyMessage], internal: { intentType: directGuideIntent, responseMode: 'guided' } };
    }

    const mealAnnouncementHandled = maybeHandleMealAnnouncement(input);
    if (mealAnnouncementHandled) {
      await appendTurn(input.userId, input.rawText || '', mealAnnouncementHandled.replyText);
      return { ok: true, replyMessages: [{ type: 'text', text: mealAnnouncementHandled.replyText }], internal: mealAnnouncementHandled.internal };
    }

    let imagePayload = null;
    if (input?.messageType === 'image') {
      let ingested = null;
      if (input?.webImagePayload?.buffer) {
        ingested = {
          ok: true,
          payload: {
            ok: true,
            buffer: input.webImagePayload.buffer,
            mimeType: input.webImagePayload.mimeType || 'image/jpeg',
          },
        };
      } else {
        ingested = await imageIngestService.ingestLineImage(input);
      }
      if (!ingested?.ok) {
        const replyText = buildImageIngestFailureReply();
        await appendTurn(input.userId, input.rawText || '[image]', replyText);
        return {
          ok: true,
          replyMessages: [{ type: 'text', text: replyText }],
          internal: { intentType: 'image_ingest_ng', responseMode: 'answer' }
        };
      }

      imagePayload = ingested.payload;

      let labImageHandled = null;
      let mealImageHandled = null;

      labImageHandled = await maybeHandleLabImage(input, imagePayload);
      if (labImageHandled?.handled) {
        await appendTurn(input.userId, input.rawText || '[image]', labImageHandled.replyText);
        return { ok: true, replyMessages: [{ type: 'text', text: labImageHandled.replyText }], internal: { intentType: 'lab_image', responseMode: 'answer' } };
      }
      mealImageHandled = await maybeHandleMealImage(input, imagePayload);
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
      const routeDecision = resolveImageRouteDecision({
        shortMemory,
        recentMessages,
        imageAnalysis: {
          lab: labImageHandled?.analysis || null,
          meal: mealImageHandled?.analysis || null
        },
        textHint: text
      });
      if (labImageHandled?.analysis?.labLike) {
        const labPanel = labImageHandled.analysis;
        const cachedItemMap = labItemAliasService.buildLabItemMapFromPanel(labPanel || {});
        const latestLabCache = {
          examDate: labPanel?.latestExamDate || labPanel?.examDate || '',
          items: cachedItemMap,
          rawText: normalizeText(labPanel?.rawText || ''),
          updatedAt: new Date().toISOString()
        };
        await contextMemoryService.saveShortMemory(input.userId, {
          lastImageType: 'lab_pending',
          followUpContext: {
            source: 'image',
            imageType: 'lab_pending',
            extractedItems: [],
            examDate: labPanel.examDate || '',
            latestExamDate: labPanel.latestExamDate || labPanel.examDate || '',
            selectedLabExamDate: labPanel.latestExamDate || labPanel.examDate || '',
            availableLabDates: Array.isArray(labPanel?.examDates) ? labPanel.examDates : [],
            labPanel: labPanel || null,
            latestLabCache
          }
        });
        try {
          if (labPanel) await contextMemoryService.upsertLabPanel(input.userId, labPanel);
        } catch (error) {
          console.error('[conversation_orchestrator] lab_like branch upsert error:', error?.message || error);
        }
        const replyText = [
          '血液検査の画像を受け取りました。',
          labPanel?.latestExamDate || labPanel?.examDate ? `検査日候補: ${labPanel?.latestExamDate || labPanel?.examDate}` : null,
          '抽出は進行中ですが、読めた項目は優先して返します。「TGは？」「HbA1cは？」「LDLは？」と聞いてください。'
        ].filter(Boolean).join('\n');
        await appendTurn(input.userId, input.rawText || '[image]', replyText);
        return {
          ok: true,
          replyMessages: [{ type: 'text', text: replyText }],
          internal: { intentType: 'lab_image_pending', responseMode: 'answer' }
        };
      }

      // スコアは検査寄りだが motion フォールバックに落とさない（誤って「動作解析」文面になるのを防ぐ）
      if (routeDecision.isReliable && routeDecision.topRoute === 'lab') {
        const replyText = [
          '血液検査の画像として受け止めています。',
          '自動判定が迷ったようなので、同じ写真でもう一度送るか、検査日の近くが読めるように寄せて送ってもらえると助かります。',
          '「TGは？」「HbA1cは？」のように項目名で聞いても大丈夫です。'
        ].join('\n');
        await appendTurn(input.userId, input.rawText || '[image]', replyText);
        return {
          ok: true,
          replyMessages: [{ type: 'text', text: replyText }],
          internal: { intentType: 'lab_image_route_hint', responseMode: 'answer', routeDecision }
        };
      }

      if (routeDecision.isReliable && routeDecision.topRoute === 'meal') {
        const replyText = [
          '食事の写真として受け止めています。',
          'いまの1枚だけでは料理の輪郭がはっきりしなかったので、全体が写る1枚をもう一度送ってもらえると助かります。'
        ].join('\n');
        await appendTurn(input.userId, input.rawText || '[image]', replyText);
        return {
          ok: true,
          replyMessages: [{ type: 'text', text: replyText }],
          internal: { intentType: 'meal_image_route_hint', responseMode: 'guided', routeDecision }
        };
      }

      const isShoeContext = looksLikeShoeContext(shortMemory, recentMessages, text);
      const isMotionContext = looksLikeMotionContext(shortMemory, recentMessages, text);
      if (!isShoeContext && !isMotionContext && !routeDecision.isReliable) {
        const replyMessage = buildImageRouteClarifyMessage();
        setPendingImageForClarification(input.userId, imagePayload, text);
        const persistFields = buildPendingImagePersistFields(imagePayload);
        await contextMemoryService.saveShortMemory(input.userId, {
          pendingClarification: {
            type: 'image_route',
            at: new Date().toISOString(),
            autoRoute: routeDecision.topRoute,
            autoScore: routeDecision.topScore,
            secondRoute: routeDecision.secondRoute,
            secondScore: routeDecision.secondScore,
            textHint: normalizeText(text),
            pendingImageExpiresAt: Date.now() + PENDING_IMAGE_TTL_MS,
            ...persistFields
          }
        });
        await appendTurn(input.userId, input.rawText || '[image]', replyMessage?.text || '画像の種類を確認したいです。');
        return {
          ok: true,
          replyMessages: [replyMessage || { type: 'text', text: '画像の種類を確認したいです。' }],
          internal: {
            intentType: 'image_route_clarify',
            responseMode: 'guided',
            imageKind,
            fallbackKind,
            routeDecision
          }
        };
      }

      const motionHint = (isShoeContext || routeDecision.route === 'shoe_wear')
        ? `${text}\n靴底・ソール摩耗の観点で、歩き方や走り方の癖につながる所見を優先してください。`
        : text;
      const { motionResult, replyText } = await analyzeMotionFromFrames({
        input,
        shortMemory,
        textHint: motionHint,
        frames: [{
          buffer: imagePayload.buffer,
          mimeType: imagePayload.mimeType || 'image/jpeg',
        }],
        sourceType: 'image',
      });
      await appendTurn(input.userId, input.rawText || '[image]', replyText);
      return {
        ok: true,
        replyMessages: [{ type: 'text', text: replyText }],
        internal: {
          intentType: (isShoeContext || routeDecision.route === 'shoe_wear') ? 'shoe_motion_image' : 'motion_image_fallback',
          responseMode: 'answer',
          motionModel: motionResult?.usedModel || '',
          routeDecision
        }
      };
    }

    if (input?.messageType === 'video') {
      const mediaPayload = await lineMediaService.getMediaPayload(input);
      if (!mediaPayload?.ok || mediaPayload.kind !== 'video') {
        const replyText = buildVideoIngestFailureReply();
        await appendTurn(input.userId, input.rawText || '[video]', replyText);
        return {
          ok: true,
          replyMessages: [{ type: 'text', text: replyText }],
          internal: { intentType: 'video_ingest_ng', responseMode: 'answer' }
        };
      }

      const motionVideo = await analyzeMotionFromVideo({
        input,
        shortMemory,
        mediaPayload,
        textHint: text,
      });
      await appendTurn(input.userId, input.rawText || '[video]', motionVideo.replyText);
      return {
        ok: true,
        replyMessages: [{ type: 'text', text: motionVideo.replyText }],
        internal: {
          intentType: motionVideo.ok ? 'motion_video' : 'motion_video_fallback',
          responseMode: 'answer',
          motionModel: motionVideo?.motionResult?.usedModel || '',
          reason: motionVideo.reason || '',
        }
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
      await contextMemoryService.addDailyRecord(
        input.userId,
        mealFollowUpHandled.correctionRecord || {
          type: 'meal',
          name: '食事',
          summary: mealFollowUpHandled.adjusted?.amountNote || '食事量補正',
          estimatedNutrition: mealFollowUpHandled.adjusted?.estimatedNutrition || {},
          kcal: Number(mealFollowUpHandled.adjusted?.estimatedNutrition?.kcal || 0),
          protein: Number(mealFollowUpHandled.adjusted?.estimatedNutrition?.protein || 0),
          fat: Number(mealFollowUpHandled.adjusted?.estimatedNutrition?.fat || 0),
          carbs: Number(mealFollowUpHandled.adjusted?.estimatedNutrition?.carbs || 0)
        }
      );
      await appendTurn(input.userId, input.rawText || '', mealFollowUpHandled.replyText);
      return { ok: true, replyMessages: [{ type: 'text', text: mealFollowUpHandled.replyText }], internal: { intentType: 'meal_followup', responseMode: 'record' } };
    }

    const exerciseCalorieHandled = await maybeHandleExerciseCalorieQuestion(input, text, longMemory);
    if (exerciseCalorieHandled) {
      await appendTurn(input.userId, input.rawText || '', exerciseCalorieHandled.replyText);
      return { ok: true, replyMessages: [{ type: 'text', text: exerciseCalorieHandled.replyText }], internal: { intentType: 'exercise_calorie', responseMode: 'answer' } };
    }

    const mealDraftQuestion = await maybeHandleMealDraftQuestion(input, refreshedShortMemory);
    if (mealDraftQuestion) {
      await appendTurn(input.userId, input.rawText || '', mealDraftQuestion.replyText);
      return { ok: true, replyMessages: [{ type: 'text', text: mealDraftQuestion.replyText }], internal: { intentType: 'meal_draft_followup', responseMode: 'answer' } };
    }

    if (intent === 'time_question') {
      const replyText = buildTimeAnswer();
      await appendTurn(input.userId, input.rawText || '', replyText);
      return { ok: true, replyMessages: [{ type: 'text', text: replyText }], internal: { intentType: 'time_question', responseMode: 'answer' } };
    }

    if (intent === 'weight_lookup') {
      const replyText = await conversationFactResolverService.buildWeightLookupReply(input.userId);
      await appendTurn(input.userId, input.rawText || '', replyText);
      return { ok: true, replyMessages: [{ type: 'text', text: replyText }], internal: { intentType: 'weight_lookup', responseMode: 'answer' } };
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
      const recentDailyRecords = await contextMemoryService.getRecentDailyRecords(input.userId, 7);
      const replyText = await weeklyReportService.buildWeeklyReport({
        longMemory: await contextMemoryService.getLongMemory(input.userId),
        recentMessages,
        todayRecords: records,
        recentDailyRecords
      });
      await appendTurn(input.userId, input.rawText || '', replyText);
      return { ok: true, replyMessages: [{ type: 'text', text: replyText }], internal: { intentType: 'weekly_report', responseMode: 'answer' } };
    }

    if (intent === 'monthly_report') {
      const recentDailyRecords = await contextMemoryService.getRecentDailyRecords(input.userId, 31);
      const replyText = await monthlyReportService.buildMonthlyReport({
        longMemory: await contextMemoryService.getLongMemory(input.userId),
        recentMessages,
        recentDailyRecords
      });
      await appendTurn(input.userId, input.rawText || '', replyText);
      return { ok: true, replyMessages: [{ type: 'text', text: replyText }], internal: { intentType: 'monthly_report', responseMode: 'answer' } };
    }

    if (intent === 'point_summary') {
      const totalPoints = await contextMemoryService.getPoints(input.userId);
      const replyText = pointsService.buildPointSummary(totalPoints);
      await appendTurn(input.userId, input.rawText || '', replyText);
      return { ok: true, replyMessages: [{ type: 'text', text: replyText }], internal: { intentType: 'point_summary', responseMode: 'answer' } };
    }

    if (intent === 'admin_check') {
      const records = await contextMemoryService.getTodayRecords(input.userId);
      const longMemoryLatest = await contextMemoryService.getLongMemory(input.userId);
      const totalPoints = await contextMemoryService.getPoints(input.userId);
      const replyText = buildAdminCheckReply({ longMemory: longMemoryLatest, records, points: totalPoints });
      await appendTurn(input.userId, input.rawText || '', replyText);
      return { ok: true, replyMessages: [{ type: 'text', text: replyText }], internal: { intentType: 'admin_check', responseMode: 'answer' } };
    }

    if (intent === 'today_records') {
      const records = await contextMemoryService.getTodayRecords(input.userId);
      const replyText = buildTodayRecordsAnswer(records);
      await appendTurn(input.userId, input.rawText || '', replyText);
      return { ok: true, replyMessages: [{ type: 'text', text: replyText }], internal: { intentType: 'today_records', responseMode: 'answer' } };
    }

    if (intent === 'today_meal_totals') {
      const records = await contextMemoryService.getTodayRecords(input.userId);
      const replyText = buildTodayMealTotalsAnswer(records);
      await appendTurn(input.userId, input.rawText || '', replyText);
      return { ok: true, replyMessages: [{ type: 'text', text: replyText }], internal: { intentType: 'today_meal_totals', responseMode: 'answer' } };
    }

    if (intent === 'today_meal_balance') {
      const records = await contextMemoryService.getTodayRecords(input.userId);
      const replyText = buildTodayMealBalanceAnswer(records);
      await appendTurn(input.userId, input.rawText || '', replyText);
      return { ok: true, replyMessages: [{ type: 'text', text: replyText }], internal: { intentType: 'today_meal_balance', responseMode: 'answer' } };
    }

    if (intent === 'biweekly_meal_balance') {
      const recentDailyRecords = await contextMemoryService.getRecentDailyRecords(input.userId, 28);
      const replyText = buildBiweeklyMealBalanceAnswer(recentDailyRecords);
      await appendTurn(input.userId, input.rawText || '', replyText);
      return { ok: true, replyMessages: [{ type: 'text', text: replyText }], internal: { intentType: 'biweekly_meal_balance', responseMode: 'answer' } };
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
      if (/^無料体験$/u.test(text)) {
        const replyMessage = buildGuideReplyMessage('trial', { conversationState: getConversationState(input.userId) });
        const replyText = replyMessage?.text || buildHelpAnswer();
        await appendTurn(input.userId, input.rawText || '', replyText);
        return { ok: true, replyMessages: [replyMessage], internal: { intentType: 'trial', responseMode: 'guided' } };
      }
      if (/^AIタイプ$/u.test(text)) {
        const replyMessage = buildGuideReplyMessage('type', { conversationState: getConversationState(input.userId) });
        const replyText = replyMessage?.text || buildHelpAnswer();
        await appendTurn(input.userId, input.rawText || '', replyText);
        return { ok: true, replyMessages: [replyMessage], internal: { intentType: 'type', responseMode: 'guided' } };
      }
      if (/^プラン案内$/u.test(text)) {
        const replyMessage = buildGuideReplyMessage('plan', { conversationState: getConversationState(input.userId) });
        const replyText = replyMessage?.text || buildHelpAnswer();
        await appendTurn(input.userId, input.rawText || '', replyText);
        return { ok: true, replyMessages: [replyMessage], internal: { intentType: 'plan', responseMode: 'guided' } };
      }
      if (/^食事の送り方$/u.test(text)) {
        const replyMessage = buildGuideReplyMessage('meal_input_help', { conversationState: getConversationState(input.userId) });
        const replyText = replyMessage?.text || buildHelpAnswer();
        await appendTurn(input.userId, input.rawText || '', replyText);
        return { ok: true, replyMessages: [replyMessage], internal: { intentType: 'meal_input_help', responseMode: 'guided' } };
      }
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

    if (/^AIタイプ変更$|^タイプ変更$|^人格変更$/.test(text)) {
      const replyMessage = buildPersonaTypeQuickReplyMessage();
      const replyText = replyMessage?.text || 'AIタイプ変更ですね。タイプ名を送ってください。';
      await appendTurn(input.userId, input.rawText || '', replyText);
      return { ok: true, replyMessages: [replyMessage || { type: 'text', text: replyText }], internal: { intentType: 'ai_type_change_prompt', responseMode: 'guided' } };
    }

    if (/^雰囲気変更$|^話し方変更$|^スタイル変更$/.test(text)) {
      const replyMessage = buildVoiceStyleQuickReplyMessage();
      const replyText = replyMessage?.text || '雰囲気変更ですね。希望の雰囲気を送ってください。';
      await appendTurn(input.userId, input.rawText || '', replyText);
      return { ok: true, replyMessages: [replyMessage || { type: 'text', text: replyText }], internal: { intentType: 'voice_style_change_prompt', responseMode: 'guided' } };
    }

    const personaTypeLabel = maybeParsePersonaType(text);
    if (personaTypeLabel) {
      await contextMemoryService.mergeLongMemory(input.userId, { aiType: personaTypeLabel });
      const replyText = `AIタイプを「${personaTypeLabel}」に更新しました。必要なら続けて「雰囲気変更」で温度感も合わせられます。`;
      await appendTurn(input.userId, input.rawText || '', replyText);
      return { ok: true, replyMessages: [{ type: 'text', text: replyText }], internal: { intentType: 'ai_type_update', responseMode: 'answer' } };
    }

    const voiceStyleLabel = maybeParseVoiceStyle(text);
    if (voiceStyleLabel) {
      await contextMemoryService.mergeLongMemory(input.userId, { voiceStyle: voiceStyleLabel });
      const replyText = `雰囲気を「${voiceStyleLabel}」に更新しました。`;
      await appendTurn(input.userId, input.rawText || '', replyText);
      return { ok: true, replyMessages: [{ type: 'text', text: replyText }], internal: { intentType: 'voice_style_update', responseMode: 'answer' } };
    }

    if (/^(ライト|スタンダード|プレミアム)$/u.test(text)) {
      await contextMemoryService.mergeLongMemory(input.userId, { selectedPlan: text });
      const replyText = `プラン候補を「${text}」として見ています。必要ならこのまま詳しい案内につなげます。`;
      await appendTurn(input.userId, input.rawText || '', replyText);
      return { ok: true, replyMessages: [{ type: 'text', text: replyText }], internal: { intentType: 'plan_select', responseMode: 'answer' } };
    }

    if (shouldAnswerWithChatFirst(text)) {
      const replyText = await buildNormalReply(input, recentMessages, recentSummary, longMemory, shortMemory);
      await appendTurn(input.userId, input.rawText || '', replyText);
      return {
        ok: true,
        replyMessages: [{ type: 'text', text: replyText }],
        internal: { intentType: 'normal', responseMode: 'conversation_first' }
      };
    }

    const simpleExerciseHandled = await maybeHandleSimpleExerciseRecord(input, text, longMemory);
    if (simpleExerciseHandled) {
      await appendTurn(input.userId, input.rawText || '', simpleExerciseHandled.replyText);
      return { ok: true, replyMessages: [{ type: 'text', text: simpleExerciseHandled.replyText }], internal: { intentType: 'exercise_record', responseMode: 'record' } };
    }

    const simpleWeightHandled = await maybeHandleSimpleWeightRecord(input, text);
    if (simpleWeightHandled) {
      await appendTurn(input.userId, input.rawText || '', simpleWeightHandled.replyText);
      return { ok: true, replyMessages: [{ type: 'text', text: simpleWeightHandled.replyText }], internal: { intentType: 'weight_record', responseMode: 'record' } };
    }

    const mealTextHandled = await maybeHandleMealText(input);
    if (mealTextHandled) {
      await contextMemoryService.addDailyRecord(input.userId, buildMealRecordPayload(text, mealTextHandled.parsedMeal));
      await appendTurn(input.userId, input.rawText || '', mealTextHandled.replyText);
      return { ok: true, replyMessages: [{ type: 'text', text: mealTextHandled.replyText }], internal: { intentType: 'meal_text', responseMode: 'record' } };
    }

    await maybeStoreSimpleRecords(input.userId, text);

    const longMemoryLatest = await contextMemoryService.getLongMemory(input.userId);
    const replyText = await buildNormalReply(input, recentMessages, recentSummary, longMemoryLatest, shortMemory);

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
