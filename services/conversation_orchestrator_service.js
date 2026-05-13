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
const { resolveMealTextDuplicateWindowHours } = require('../config/meal_text_env');
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
const mealLogQueryService = require('./meal_log_query_service');
const activeContextService = require('./active_context_service');
const imageIngressV2Service = require('./v2/image_ingress_v2_service');
const followupQueryV2Service = require('./v2/queries/followup_query_service');
const newFlowImageIngestService = require('./newflow/image_ingest_orchestrator_service');
const newFlowFollowupRouterService = require('./newflow/followup_router_service');
const responseGuardService = require('./newflow/response_guard_service');
const conversationSurfaceService = require('./conversation_surface_service');
const replyIntegrityService = require('./reply_integrity_service');
const companionReplyService = require('./companion_reply_service');
const lineNaturalReplyGeneratorService = require('./line_natural_reply_generator_service');
const emotionalQualityCheckService = require('./emotional_quality_check_service');
const conversationStateInterpreterService = require('./conversation_state_interpreter_service');
const relationshipPhaseService = require('./relationship_phase_service');
const trustSignalDetectorService = require('./trust_signal_detector_service');
const lifeCompanionConversationService = require('./life_companion_conversation_service');
const imageContextClassifierService = require('./image_context_classifier_service');
const mealReplyFormatterService = require('./meal_reply_formatter_service');
const dailyNutritionSummaryService = require('./daily_nutrition_summary_service');
const dailyEnergyBalanceService = require('./daily_energy_balance_service');
const mealTextManualRecordService = require('./meal_text_manual_record_service');
const exerciseRecordService = require('./exercise_record_service');
const compassionateJudgmentService = require('./compassionate_judgment_service');
const pendingConfirmationService = require('./pending_confirmation_service');
const nextStepSupportService = require('./next_step_support_service');
const constitutionSurveyConfig = require('../config/constitution_survey_config');
const aiPersonaConfig = require('../config/ai_persona_config');

const pendingImageClarificationStore = new Map();
const PENDING_IMAGE_TTL_MS = 15 * 60 * 1000;
/** shortMemory に退避する最大バイト（スナップショット肥大化を抑える） */
const MAX_PENDING_IMAGE_PERSIST_BYTES = 900 * 1024;

function normalizeText(value) {
  return String(value || '').trim();
}

function runtimeFlag(name, fallbackValue) {
  const raw = process.env[name];
  if (raw == null || raw === '') return Boolean(fallbackValue);
  return ['1', 'true', 'yes', 'on'].includes(String(raw).trim().toLowerCase());
}

function resolveNewFlowToggle(name, fallbackValue, archEnabled) {
  if (archEnabled) return true;
  return runtimeFlag(name, fallbackValue);
}

function clampScore(value) {
  return Math.min(10, Math.max(1, Number(value || 5)));
}

function clamp01(value) {
  return Math.max(0, Math.min(1, Number(value || 0)));
}

function resolveRelationshipStage(score) {
  const s = Number(score || 0);
  if (s >= 0.75) return 'best_friend';
  if (s >= 0.4) return 'friend';
  return 'coach';
}

function resolveRecallStyle(turnCount) {
  const turns = Number(turnCount || 0);
  // たまに「思い出すのに少し時間」がある揺らぎを作る
  if (turns > 0 && turns % 7 === 0) return 'slow_recall_with_hint';
  return 'direct';
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

function buildLabPendingAckReply(panel, userId) {
  const dateHint = panel?.latestExamDate || panel?.examDate
    ? `日付や項目名の一部は「${panel.latestExamDate || panel.examDate}」あたりに見えるかもしれません。`
    : '日付や項目名の一部がまだはっきり読み取りにくいです。';
  const seed = hashText(`${userId}:${panel?.latestExamDate || panel?.examDate || ''}:${Math.floor(Date.now() / 45000)}`);
  return pickVariant(seed, [
    `血液検査の画像として受け取りました。${dateHint}\n読めた部分から進めます。気になる項目（例: 中性脂肪、HbA1c）を一文で送ってください。`,
    `血液検査の画像ですね。${dateHint}\n寄せて撮れた部分から整理します。「LDLは？」のように聞いても大丈夫です。`,
    `検査結果の画像として受け取りました。${dateHint}\nはっきり見える数値から返します。項目名を指定してもらえると早いです。`,
  ]);
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
  if (/カレー/.test(joined)) return 'カレー系のように見える食事';
  if (/ラーメン|うどん|そば|パスタ/.test(joined)) return '麺類のように見える食事';
  return `${joined}のように見える食事`;
}

function formatTokyoYmd() {
  return new Intl.DateTimeFormat('sv-SE', {
    timeZone: 'Asia/Tokyo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).format(new Date());
}

function enrichLabPanelFromAliases(panel) {
  if (!panel) return null;
  const existing = Array.isArray(panel.items) ? panel.items : [];
  const hasConcrete = existing.some((it) => {
    const v = normalizeText(it?.value || it?.currentValue || '');
    const h = Array.isArray(it?.history) ? it.history : [];
    return Boolean(v) || h.some((row) => normalizeText(row?.value));
  });
  if (hasConcrete) return panel;
  const map = labItemAliasService.buildLabItemMapFromPanel(panel);
  const derived = Object.values(map || {})
    .map((e) => ({
      itemName: e.label || e.rawLabel || '',
      value: e.value || '',
      unit: e.unit || '',
      flag: '',
      currentValue: e.value || '',
      history: []
    }))
    .filter((it) => normalizeText(it.itemName) && normalizeText(it.value));
  if (!derived.length) return panel;
  return { ...panel, items: derived };
}

function isMealDayScopeQuestion(text) {
  const safe = normalizeText(text);
  if (!safe) return false;
  if (/1日のカロリー|一日のカロリー|本日の合計|今日の合計|今日.*総カロリー|総カロリー.*今日|今日.*摂取|今日の摂取|積算|今日何食|何食.*(食べた|なってる|になってる)|食事.*何件|日次|全体のカロリー|本日.*摂取/.test(safe)) return true;
  if (/訂正.*(1日|一日|本日|今日).*(カロリー|摂取|食事)|(1日|一日|本日|今日).*カロリー.*訂正/.test(safe)) return true;
  if ((/二食|２食|2食|三食|３食|3食/.test(safe)) && (/カロリー|kcal|キロカロリー|おかし|不自然|多すぎ|おかしい|合って|ずれ|重複/.test(safe))) return true;
  return false;
}

function detectMealQuestionScope(text) {
  const safe = normalizeText(text);
  if (!safe) return null;
  if (labFollowupService.normalizeTarget(safe)) return null;
  const mealish = /食事|食べた|メニュー|kcal|キロカロリー|カロリー|摂取|詳細|内訳|一覧|写真|運動|消費|今週|昨日|一昨日|今日|何食べ|件|^\d{1,2}月\d{1,2}日|20\d{2}-\d{2}-\d{2}/.test(safe);
  if (!mealish) return null;

  if (/食事と運動|摂取と消費|摂取.*消費|消費.*摂取|運動.*食事/.test(safe)) {
    return { scope: 'meal_and_exercise' };
  }

  const iso = safe.match(/(20\d{2})-(\d{2})-(\d{2})/);
  if (iso) return { scope: 'specific_date', dateYmd: `${iso[1]}-${iso[2]}-${iso[3]}` };

  const jp = safe.match(/(\d{1,2})月(\d{1,2})日/);
  if (jp) {
    const y = Number(formatTokyoYmd().slice(0, 4));
    const mm = String(jp[1]).padStart(2, '0');
    const dd = String(jp[2]).padStart(2, '0');
    return { scope: 'specific_date', dateYmd: `${y}-${mm}-${dd}` };
  }

  if (/一昨日/.test(safe)) return { scope: 'day_before_yesterday' };
  if (/今週|この1週間|週間の食事|週間.*カロリー/.test(safe)) return { scope: 'week' };
  if (/昨日の|昨日は|昨日.*(食事|カロリー|kcal|食べた|摂取)/.test(safe)) return { scope: 'yesterday' };
  if (/この食事|これは何|この写真|写真のカロリー|この写真のカロリー|直前の食事|さっきの写真|この1食/.test(safe)) return { scope: 'last_meal' };
  if (/詳細|内訳|一覧|具体的に|何が入って/.test(safe)) return { scope: 'today', detailOnly: true };
  if (
    /今日の(食事|合計|カロリー|摂取|記録|一覧|内訳)/.test(safe) ||
    /今日.*(食事|合計|カロリー|kcal|食べた|1日|摂取)/.test(safe) ||
    /今日は.*(食事|カロリー|kcal|食べた)/.test(safe) ||
    /今日何食べ/.test(safe)
  ) {
    return { scope: 'today' };
  }
  if (/今日.*(\d+\s*件|件数|何件)/.test(safe)) return { scope: 'today' };
  if (isMealDayScopeQuestion(safe)) return { scope: 'today', totalsFocus: true };
  return null;
}

function mealLogsToRecordMeals(logs) {
  const list = mealLogQueryService.deduplicateMealLogs(Array.isArray(logs) ? logs : []);
  return list.map((log) => ({
    type: 'meal',
    summary: log.mealLabel,
    name: log.mealLabel,
    items: log.foodItems,
    food_items: log.foodItems,
    kcal: log.kcal,
    protein: log.protein,
    fat: log.fat,
    carbs: log.carbs,
    estimatedNutrition: {
      kcal: log.kcal,
      protein: log.protein,
      fat: log.fat,
      carbs: log.carbs
    },
    confidence: log.confidence,
    createdAt: log.eatenAt
  }));
}

async function maybeHandleUnifiedMealScopeQuestion(input, text) {
  if (input?.messageType !== 'text') return null;
  const safe = normalizeText(text || input?.rawText || '');
  const spec = detectMealQuestionScope(safe);
  if (!spec) return null;

  const todayYmd = contextMemoryService.getTokyoTodayYmd();

  if (spec.scope === 'meal_and_exercise') {
    const { totals: msum } = await mealLogQueryService.fetchAggregateMealLogsFromDb(
      input.userId,
      todayYmd,
      todayYmd,
      'unified_meal_and_exercise'
    );
    const bal = await dailyEnergyBalanceService.fetchTodayEnergyBalance(input.userId);
    const burn = Number(bal.exerciseBurnKcal || 0);
    const lines = [
      '【今日の摂取と運動（DBの食事ログ＋今日の運動記録）】',
      `食事: ${msum.count}件 / 約${round1(msum.kcal)} kcal`,
      buildMealNutritionLine({ protein: msum.protein, fat: msum.fat, carbs: msum.carbs }),
      `運動の記録から拾えた消費目安: 約${round1(burn)} kcal（運動ログが無い場合は0に近いです）`,
    ];
    return { replyText: lines.join('\n') };
  }

  let fromYmd = todayYmd;
  let toYmd = todayYmd;
  let label = '今日';

  if (spec.scope === 'yesterday') {
    fromYmd = toYmd = contextMemoryService.addCalendarDaysToTokyoYmd(todayYmd, -1);
    label = '昨日';
  } else if (spec.scope === 'day_before_yesterday') {
    fromYmd = toYmd = contextMemoryService.addCalendarDaysToTokyoYmd(todayYmd, -2);
    label = '一昨日';
  } else if (spec.scope === 'week') {
    fromYmd = contextMemoryService.addCalendarDaysToTokyoYmd(todayYmd, -6);
    toYmd = todayYmd;
    label = '直近7日（今週に近い範囲）';
  } else if (spec.scope === 'specific_date') {
    fromYmd = toYmd = spec.dateYmd;
    label = spec.dateYmd;
  } else if (spec.scope === 'last_meal') {
    fromYmd = contextMemoryService.addCalendarDaysToTokyoYmd(todayYmd, -30);
    toYmd = todayYmd;
  }

  const { deduped: logs, totals: sum } = await mealLogQueryService.fetchAggregateMealLogsFromDb(
    input.userId,
    fromYmd,
    toYmd,
    `unified_${spec.scope}`
  );

  if (spec.scope === 'last_meal') {
    const one = logs[0];
    if (!one) {
      return { replyText: '直近の食事ログ（DB）が見つかりませんでした。食事を記録してからもう一度聞いてください。' };
    }
    const lines = mealLogQueryService.formatMealLogDetails([one], { maxItems: 1 });
    return { replyText: ['【直近1件の食事（DB）】', lines[0] || '—'].join('\n') };
  }

  const wantDetails = Boolean(spec.detailOnly) || /詳細|内訳|一覧|具体的|何が入って|何食べた/.test(safe);
  const lines = [
    `【${label}の食事（DB meal_logs、重複は除外済み）】`,
    `件数: ${sum.count} / 合計 約${round1(sum.kcal)} kcal`,
    buildMealNutritionLine({ protein: sum.protein, fat: sum.fat, carbs: sum.carbs }),
  ];
  if (wantDetails && sum.count > 0) {
    lines.push('', '▼ 一覧（新しい順、最大25件）');
    lines.push(...mealLogQueryService.formatMealLogDetails(logs, { maxItems: 25 }));
  } else if (sum.count === 0) {
    lines.push('', '該当日の食事ログは0件でした。');
  }
  return { replyText: lines.join('\n') };
}

function buildMealDayAnomalyNote(mealCount, totals) {
  const kcal = Number(totals?.kcal || 0);
  const n = Number(mealCount || 0);
  if (n >= 1 && n <= 4 && kcal >= 2800) {
    return '※ 本日の合計が大きめです。食事の重複登録や量の補正がズレていないか、いまの食事ログを一度見直すのがおすすめです。';
  }
  if (n === 2 && kcal >= 2200) {
    return '※ 2食でこの合計はやや高めに見えます。どちらか一方の推定が大きい可能性があるので、気になる食事だけ料理名や量を送ってください。';
  }
  return '';
}

async function maybeHandleMealDayScopeSummary(input, text) {
  if (input?.messageType !== 'text') return null;
  const safe = normalizeText(text || input?.rawText || '');
  if (!isMealDayScopeQuestion(safe)) return null;

  const todayYmd = contextMemoryService.getTokyoTodayYmd();
  const { deduped } = await mealLogQueryService.fetchAggregateMealLogsFromDb(
    input.userId,
    todayYmd,
    todayYmd,
    'meal_day_scope_summary'
  );
  const records = { meals: mealLogsToRecordMeals(deduped) };
  const energyBal = await dailyEnergyBalanceService.fetchTodayEnergyBalance(input.userId);
  const replyText = buildTodayMealTotalsAnswer(records, {
    dayScopeHeader: true,
    includeAnomalyNote: true,
    includeEnergyBalance: true,
    exerciseBurnKcal: energyBal.exerciseBurnKcal
  });
  return { replyText };
}

function parseTokyoHourMinuteFromText(safe) {
  const m = String(safe || '').match(/(\d{1,2})\s*時(?:\s*(\d{1,2})\s*分?)?/);
  if (!m) return null;
  const hour = Number(m[1]);
  const minute = m[2] != null && m[2] !== '' ? Number(m[2]) : null;
  if (!Number.isFinite(hour) || hour < 0 || hour > 23) return null;
  if (minute != null && (!Number.isFinite(minute) || minute < 0 || minute > 59)) return null;
  return { hour, minute };
}

function mealDeletionIntent(safe) {
  if (/(削除して|削除してください|消して下さい|消してください|取り消し|食事を削除|食事は削除|記録を削除|枚の写真削除|枚削除)/.test(safe)) return true;
  if (/消して/.test(safe) && /(食事|記録|写真|枚|のやつ|のもの)/.test(safe)) return true;
  return false;
}

function buildMealDeleteCommandId(userId, safe) {
  const minuteBucket = Math.floor(Date.now() / (60 * 1000));
  return `${normalizeText(userId)}:${normalizeText(safe).slice(0, 80)}:${minuteBucket}`;
}

async function resolveMealDeletionTargetIds(userId, safe) {
  const todayYmd = contextMemoryService.getTokyoTodayYmd();
  let fromYmd = todayYmd;
  let toYmd = todayYmd;
  if (/一昨日/.test(safe)) {
    fromYmd = toYmd = contextMemoryService.addCalendarDaysToTokyoYmd(todayYmd, -2);
  } else if (/昨日|昨晩/.test(safe)) {
    fromYmd = toYmd = contextMemoryService.addCalendarDaysToTokyoYmd(todayYmd, -1);
  }

  const raw = await mealLogQueryService.getMealLogsByDateRange(userId, fromYmd, toYmd);
  const rows = mealLogQueryService.deduplicateMealLogs(raw);
  if (!rows.length) return { ids: [], reason: 'no_rows' };

  const hm = parseTokyoHourMinuteFromText(safe);
  if (hm && mealDeletionIntent(safe)) {
    const matchTime = (log) => {
      const t = mealLogQueryService.formatTimeTokyo(log.eatenAt);
      const parts = String(t || '').split(':');
      const th = Number(parts[0]);
      const tm = Number(parts[1] || 0);
      if (!Number.isFinite(th)) return false;
      if (th !== hm.hour) return false;
      if (hm.minute == null) return true;
      return Math.abs(tm - hm.minute) <= 8;
    };
    let candidates = rows.filter(matchTime);
    if (candidates.length > 1) {
      const metaPref = candidates.filter((r) => mealAnalysisService.isMealMetaOrCorrectionText(normalizeText(r.mealLabel || '')));
      if (metaPref.length) candidates = metaPref;
    }
    const pick = candidates.sort((a, b) => String(b.eatenAt || '').localeCompare(String(a.eatenAt || '')))[0];
    if (pick?.id) return { ids: [pick.id], reason: 'tokyo_time_match' };
  }

  if (mealDeletionIntent(safe) && /ストロベリーミルク|ストロベリー\s*ミルク/i.test(safe)) {
    const nm = safe.match(/(\d+)\s*枚/);
    const n = nm ? Math.max(1, Math.min(15, Number(nm[1]))) : 1;
    const hits = rows.filter((r) => /ストロベリーミルク/i.test(normalizeText(r.mealLabel || '')));
    const ids = hits.slice(0, n).map((r) => r.id).filter(Boolean);
    if (ids.length) return { ids, reason: 'strawberry_repeat' };
  }

  if (mealDeletionIntent(safe) && mealAnalysisService.isMealMetaOrCorrectionText(safe)) {
    const bad = rows.filter((r) => mealAnalysisService.isMealMetaOrCorrectionText(normalizeText(r.mealLabel || '')));
    if (bad.length) return { ids: bad.map((r) => r.id), reason: 'meta_meal_label' };
  }

  if (mealDeletionIntent(safe) && /(直近|一つ前|ひとつ前|この)\s*の?食事/.test(safe)) {
    const id = rows[0]?.id;
    if (id) return { ids: [id], reason: 'explicit_latest' };
  }

  return { ids: [], reason: 'unresolved' };
}

async function maybeHandleMealLogCorrection(input, text) {
  if (input?.messageType !== 'text') return null;
  const safe = normalizeText(text || input?.rawText || '');
  if (!safe) return null;

  if (mealAnalysisService.isMealNegationOrNonRecordText(safe) || /(間違えた|誤送信|同じ写真送ってしまった|食べてないよ|これは食べてない)/.test(safe)) {
    return {
      replyText: '了解です。これは食事として保存しません。必要なら「この食事を削除して」や「10時58分の分を削除して」のように対象を指定してください。'
    };
  }

  if (mealDeletionIntent(safe)) {
    const commandId = buildMealDeleteCommandId(input.userId, safe);
    const sm = await contextMemoryService.getShortMemory(input.userId);
    if (normalizeText(sm?.mealDeleteGuard?.lastCommandId || '') === commandId) {
      const todayYmd = contextMemoryService.getTokyoTodayYmd();
      const rawT = await mealLogQueryService.getMealLogsByDateRange(input.userId, todayYmd, todayYmd);
      const totals = { meals: mealLogsToRecordMeals(rawT) };
      const agg = mealLogQueryService.aggregateMealLogs(rawT);
      return {
        replyText: [
          '同じ削除指示はすでに反映済みです（idempotent guard）。',
          `現在の今日集計: ${agg.count}件 / 約${round1(agg.kcal)} kcal`,
          '',
          buildTodayMealTotalsAnswer(totals, { dayScopeHeader: true, includeAnomalyNote: true })
        ].join('\n')
      };
    }
    const { ids, reason } = await resolveMealDeletionTargetIds(input.userId, safe);
    if (ids.length) {
      const res = await contextMemoryService.deleteMealLogsByIds(input.userId, ids);
      if (!res.ok || !res.deleted) {
        return { replyText: '削除の指示は受け取りましたが、DB側の更新に失敗しました。少し時間をあけて、もう一度「〇時〇分の分を削除」「ストロベリーミルク2枚削除」のように送ってください。' };
      }
      await contextMemoryService.saveShortMemory(input.userId, {
        mealDeleteGuard: { lastCommandId: commandId, updatedAt: new Date().toISOString() }
      });
      const todayYmd = contextMemoryService.getTokyoTodayYmd();
      const rawT = await mealLogQueryService.getMealLogsByDateRange(input.userId, todayYmd, todayYmd);
      const totals = { meals: mealLogsToRecordMeals(rawT) };
      const delAgg = mealLogQueryService.aggregateMealLogs(rawT);
      console.info('[meal] recomputed_today_total', { count: delAgg.count, kcal: round1(delAgg.kcal), deleteReason: reason });
      return {
        replyText: [
          `対象の食事をDBから${res.deleted}件削除しました（${reason}）。`,
          '',
          buildTodayMealTotalsAnswer(totals, { dayScopeHeader: true, includeAnomalyNote: true }),
        ].join('\n')
      };
    }
    if (/(直近の食事|この食事を|一つ前の食事|ひとつ前の食事).*(削除|消して)|記録を削除/.test(safe)) {
      const beforeYmd = contextMemoryService.getTokyoTodayYmd();
      const rawBefore = await mealLogQueryService.getMealLogsByDateRange(input.userId, beforeYmd, beforeYmd);
      const beforeAgg = mealLogQueryService.aggregateMealLogs(rawBefore);
      const res = await contextMemoryService.deleteLastMealLog(input.userId);
      if (!res.ok) {
        return { replyText: `保存データを読み直しましたが、直近の食事1件が見つかりませんでした（内訳: ${res.reason}）。もう一度食事を送るか、いつの分かを書いてください。` };
      }
      const todayYmd = contextMemoryService.getTokyoTodayYmd();
      const rawT = await mealLogQueryService.getMealLogsByDateRange(input.userId, todayYmd, todayYmd);
      const delAgg = mealLogQueryService.aggregateMealLogs(rawT);
      await contextMemoryService.saveShortMemory(input.userId, {
        mealDeleteGuard: { lastCommandId: commandId, updatedAt: new Date().toISOString() }
      });
      console.info('[meal] recomputed_today_total', { count: delAgg.count, kcal: round1(delAgg.kcal) });
      const totals = { meals: mealLogsToRecordMeals(rawT) };
      return {
        replyText: [
          '直近の食事1件をDBから削除し、今日の分を再読込して合計を出し直しました。',
          `差分: ${beforeAgg.count}件→${delAgg.count}件 / 約${round1(beforeAgg.kcal)}→約${round1(delAgg.kcal)} kcal`,
          '',
          buildTodayMealTotalsAnswer(totals, { dayScopeHeader: true, includeAnomalyNote: true })
        ].join('\n')
      };
    }
  }

  if (/昨日の分|昨晩の食事|昨晩の分|これは昨晩|昨日食べた|昨日にして|昨日だった|日付は昨日|前の日の分|一つ前の日|食事.*昨日/.test(safe)) {
    const todayYmd = contextMemoryService.getTokyoTodayYmd();
    const y = contextMemoryService.addCalendarDaysToTokyoYmd(todayYmd, -1);
    const res = await contextMemoryService.relocateLastMealToTokyoDate(input.userId, y);
    if (!res.ok) {
      return { replyText: `保存データを読み直しましたが、直近の食事1件が見つかりませんでした（内訳: ${res.reason}）。食事写真やテキストでもう一度送ってください。` };
    }
    const rawToday = await mealLogQueryService.getMealLogsByDateRange(input.userId, todayYmd, todayYmd);
    const rawYest = await mealLogQueryService.getMealLogsByDateRange(input.userId, y, y);
    const tRec = { meals: mealLogsToRecordMeals(rawToday) };
    const yRec = { meals: mealLogsToRecordMeals(rawYest) };
    const tSum = mealLogQueryService.aggregateMealLogs(rawToday);
    const ySum = mealLogQueryService.aggregateMealLogs(rawYest);
    console.info('[meal] recomputed_today_total', { count: tSum.count, kcal: round1(tSum.kcal) });
    console.info('[meal] recomputed_target_day_total', { date: y, count: ySum.count, kcal: round1(ySum.kcal) });
    return {
      replyText: [
        `DBの meal_logs.eaten_at を更新し、直近1件を「${y}」へ移しました（今日の合計からは外れています）。`,
        '',
        `【今日 ${todayYmd}】${tSum.count}件 / 約${round1(tSum.kcal)} kcal`,
        buildTodayMealTotalsAnswer(tRec, { dayScopeHeader: false, includeAnomalyNote: true }),
        '',
        `【昨日 ${y}】${ySum.count}件 / 約${round1(ySum.kcal)} kcal`,
        buildTodayMealTotalsAnswer(yRec, { dayScopeHeader: false, includeAnomalyNote: false }),
      ].join('\n')
    };
  }

  if (/再計算|合計.*し直し|積算.*し直し|今日の合計.*もう一度|記録を修正して/.test(safe)) {
    const todayYmd = contextMemoryService.getTokyoTodayYmd();
    const rawT = await mealLogQueryService.getMealLogsByDateRange(input.userId, todayYmd, todayYmd);
    const recalc = mealLogQueryService.aggregateMealLogs(rawT);
    console.info('[meal] recomputed_today_total', { count: recalc.count, kcal: round1(recalc.kcal) });
    const totals = { meals: mealLogsToRecordMeals(rawT) };
    return { replyText: ['DBを再読込して今日の合計を出し直しました。', '', buildTodayMealTotalsAnswer(totals, { dayScopeHeader: true, includeAnomalyNote: true })].join('\n') };
  }

  if (mealAnalysisService.isMealMetaOrCorrectionText(safe)) {
    const todayYmd = contextMemoryService.getTokyoTodayYmd();
    const rawToday = await mealLogQueryService.getMealLogsByDateRange(input.userId, todayYmd, todayYmd);
    const rows = mealLogQueryService.deduplicateMealLogs(rawToday);
    const junkIds = rows
      .filter((r) => mealAnalysisService.isMealMetaOrCorrectionText(normalizeText(r.mealLabel || '')))
      .map((r) => r.id)
      .filter(Boolean);
    if (junkIds.length) {
      const res = await contextMemoryService.deleteMealLogsByIds(input.userId, junkIds);
      if (res.deleted) {
        const rawT = await mealLogQueryService.getMealLogsByDateRange(input.userId, todayYmd, todayYmd);
        const totals = { meals: mealLogsToRecordMeals(rawT) };
        return {
          replyText: [
            `訂正の説明文だけが食事ログに残っていた${res.deleted}件をDBから取り除きました。`,
            '',
            buildTodayMealTotalsAnswer(totals, { dayScopeHeader: true, includeAnomalyNote: true }),
          ].join('\n')
        };
      }
    }
    return {
      replyText: '了解です。これは食事としては保存していません。もし一覧に誤った行が残っている場合は「〇時〇分の分を削除」か「ストロベリーミルク2枚削除」のように送ってください。'
    };
  }

  return null;
}

function maybeHandleConversationFrustrationRepair(input, text) {
  if (input?.messageType !== 'text') return null;
  const safe = normalizeText(text || input?.rawText || '');
  if (!safe) return null;
  if (labFollowupService.normalizeTarget(safe)) return null;
  if (isMealDayScopeQuestion(safe)) return null;
  if (!/(繰り返|同じこと|同じ返事|言い換え(だけ)?|また同じ|同じ文|テンプレ|ロボット|答えてない|ちゃんと答えて|別の話|違う話|直して|やり直して)/.test(safe)) return null;
  return {
    replyText: [
      'すみません、返し方がループに寄ってしまっていました。',
      'いまいちばん決めたいことを一つだけ送ってください（例: 「TGは？」「今日の食事の合計を出して」「検査の日付はいつ？」）。',
      '用途ごとに処理を切り替えて、その質問にだけ答えます。'
    ].join('\n')
  };
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
  if (/今日の食事の総カロリー|今日の総カロリー|1日の総カロリー|今日の食事の合計|今日の食事の総計|1日のカロリー|一日のカロリー|本日の合計|今日の合計/.test(text)) return 'today_meal_totals';
  if (/積算|今日ここまで|ここまでの合計|今日何食|何食.*(食べた|なってる|になってる)|食事.*何件/.test(text)) return 'today_meal_totals';
  if (/栄養バランス|1日の食事の総括|今日の食事の総括|今日の栄養/.test(text)) return 'today_meal_balance';
  if (/最近の食事バランス|2週間の食事バランス|二週間の食事バランス|直近2週間/.test(text)) return 'biweekly_meal_balance';
  if (/今何ポイント|今ポイント|ポイント教えて|ポイントは\??/.test(text)) return 'point_summary';
  if (/管理確認|管理メモ|管理用まとめ/.test(text)) return 'admin_check';

  if (/使い方教えて|使い方|ヘルプ|コマンド|無料体験|プラン案内|AIタイプ|メニュー表示|操作メニュー/.test(text)) return 'help';
  if (/無料体験開始|無料体験スタート|体験開始|プロフィール変更|プロフィール入力|プロフィール修正/.test(text)) return 'onboarding';
  return 'normal';
}

function hasMealFollowupContextSync(shortMemory = {}) {
  const actType = normalizeText(shortMemory?.activeContext?.type || '');
  return Boolean(
    shortMemory?.pendingRecordCandidate?.recordType === 'meal_record'
    || shortMemory?.followUpContext?.imageType === 'meal'
    || shortMemory?.followUpContext?.lastRecordType === 'meal'
    || shortMemory?.lastImageType === 'meal'
    || /^meal_/.test(actType)
  );
}

function hasMealFollowupContextFromShortAndActive(shortMemory = {}, activeCtx = null) {
  if (hasMealFollowupContextSync(shortMemory)) return true;
  const t = normalizeText(activeCtx?.type || '');
  return /^meal_/.test(t);
}

function looksLikeMealCalorieConfirmationText(text, shortMemory = {}, activeCtx = null) {
  const safe = normalizeText(text);
  if (!safe || !hasMealFollowupContextFromShortAndActive(shortMemory, activeCtx)) return false;
  if (/今日の食事の総カロリー|今日の総カロリー|1日の総カロリー|今日の食事の合計|今日の食事の総計|1日のカロリー|一日のカロリー|本日の合計|今日の合計|今日ここまで|積算/.test(safe)) {
    return false;
  }
  const hasKcalMention = /(カロリー|kcal|キロカロリー)/i.test(safe);
  const hasNumber = /(\d{2,4})\s*k?kcal?|(カロリー|kcal)\s*[：:はが]?\s*(\d{2,4})/i.test(safe);
  const hasQuestion = /かな\??|ですか\??|だろ|でしょう|合って|あって|正しい|どう思|どう\?|どう？|いくつ|くらい\?|くらい？|\?|？/.test(safe);
  if (hasKcalMention && hasNumber && hasQuestion) return true;
  if (hasNumber && hasQuestion && /(合って|あって|正しい)/.test(safe)) return true;
  return false;
}

function extractUserSuggestedKcalFromText(text) {
  const safe = normalizeText(text);
  const m1 = safe.match(/(\d{2,4})\s*k?kcal?/i);
  if (m1) return Number(m1[1]);
  const m2 = safe.match(/カロリー\s*[：:はが]?\s*(\d{2,4})/i);
  if (m2) return Number(m2[1]);
  return null;
}

function buildMealCalorieConfirmationReply(kcal) {
  const k = Number(kcal || 0);
  const kPart = Number.isFinite(k) && k > 0 ? `おっしゃっている目安（だいたい ${Math.round(k)}kcal）` : 'その目安';
  return [
    `了解です。${kPart}は、店名やメニュー表があると精度が上がりやすい手がかりです。`,
    'こちらではいったんその前提で受け止めます。量が違ったら「ご飯半分」などでいつでも言い直せます。'
  ].join('\n');
}

function detectPriorityRouteForText(text, shortMemory = {}) {
  const safe = normalizeText(text);
  if (!safe) return { route: '', reason: '' };
  if (/半分|1\/4|１\/４|麺だけ0kcal|食べてない|完食|ごはん半分|ご飯半分|少しだけ|ちょっとだけ/.test(safe)) {
    if (hasMealFollowupContextSync(shortMemory)) {
      return { route: 'meal_correction', reason: 'explicit_meal_correction_with_context' };
    }
  }
  if (exerciseRecordService.tryParseExerciseRecord(safe, { weightKg: 60 })) {
    return { route: 'exercise_record', reason: 'explicit_exercise_record' };
  }
  if (/(TG|中性脂肪|HbA1c|hba1c|LDH|AST|ALT|血糖|クレアチニン).*(は|？|\?)?$|何読み取れた|他の日付/.test(safe)) {
    return { route: 'lab_followup', reason: 'explicit_lab_followup' };
  }
  if (/今日の食事の総カロリー|今日の総カロリー|1日の総カロリー|今日の食事の合計|今日の食事の総計|1日のカロリー|一日のカロリー|本日の合計|今日の合計|今日の食事は\?|今日どれくらい/.test(safe)) {
    return { route: 'today_meal_totals', reason: 'explicit_today_totals' };
  }
  if (/^(こんにちは|こんばんは|おはよう|やあ|はじめまして)$/u.test(safe)) {
    return { route: 'normal_chat', reason: 'greeting_text' };
  }
  return { route: '', reason: '' };
}

function buildRecentUncertaintySignals(recentMessages = [], text = '') {
  const window = (Array.isArray(recentMessages) ? recentMessages : []).slice(-12);
  const source = [text, ...window.map((m) => normalizeText(m?.content || ''))].filter(Boolean);
  return source.filter((line) => /(たぶん|覚えてない|まあいいや|かも|曖昧|わからない|半分くらい)/.test(line)).slice(-8);
}

function buildPreviousCorrections(recentMessages = []) {
  const window = (Array.isArray(recentMessages) ? recentMessages : []).slice(-20);
  return window
    .map((m) => normalizeText(m?.content || ''))
    .filter((line) => /(半分|1\/4|食べてない|完食|補正|修正)/.test(line))
    .slice(-8);
}

function buildProposedActionFromJudgment(judgment = {}, text = '') {
  const surfaceIntent = normalizeText(judgment?.surface_intent || '');
  if (surfaceIntent === 'meal_correction') {
    return {
      type: 'meal_correction',
      source_text: normalizeText(text)
    };
  }
  if (surfaceIntent === 'meal_record_text') {
    return {
      type: 'meal_record_text',
      source_text: normalizeText(text)
    };
  }
  if (surfaceIntent === 'body_condition_note') {
    return {
      type: 'body_condition_note',
      body_note: normalizeText(text)
    };
  }
  return {
    type: surfaceIntent || 'normal_chat',
    source_text: normalizeText(text)
  };
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
  const intake = normalizeText(fu?.intakeKind || '');
  const inLab = img === 'lab' || img === 'lab_pending' || intake === 'blood_test' || intake === 'lab_image' || Boolean(fu?.labPanel);
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

function mealFoodDescription(meal) {
  const fi = Array.isArray(meal?.food_items) && meal.food_items.length
    ? meal.food_items
    : (Array.isArray(meal?.items) ? meal.items : []);
  const joined = fi.map((x) => normalizeText(x)).filter(Boolean).join('、');
  return joined || '';
}

function buildTodayRecordsAnswer(records) {
  const lines = [];

  if (Array.isArray(records?.meals) && records.meals.length) {
    lines.push(`今日の食事記録: ${records.meals.length}件（保存データを読み直した結果です）`);
    for (const meal of records.meals.slice(0, 8)) {
      const title = meal.summary || meal.name || '食事';
      const kcal = Number(meal.kcal || meal.estimatedNutrition?.kcal || 0);
      const food = mealFoodDescription(meal);
      lines.push(`- ${title}${food ? `（食べたもののメモ: ${food}）` : ''}${kcal ? ` 約${round1(kcal)}kcal` : ''}`);
    }
  } else {
    lines.push('いま保存データを読み直したところ、今日付けの食事は0件でした。食事写真や「昨日の分です」と送れば整理できます。');
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

function buildTodayMealTotalsAnswer(records, options = {}) {
  const totals = mealLogQueryService.aggregateLegacyMealRecords(records?.meals);
  const mealCount = totals.count;
  if (!mealCount) {
    return 'いま保存データ（今日付け）を読み直したところ、食事は0件でした。食べた記録を送るか、「昨日の分です」と直近1件を昨日へ移せます。';
  }

  const ymd = options.dateLabel || formatTokyoYmd();
  const header = options.dayScopeHeader
    ? `本日（${ymd}）の食事記録は ${mealCount} 件です（いま保存されている分から積み上げ直しています）。`
    : null;
  const warn = options.includeAnomalyNote ? buildMealDayAnomalyNote(mealCount, totals) : '';

  const lines = [
    header,
    '📈 本日の合計（積算）',
    '━━━━━━━━━━━━━',
    `🍽️ 食事件数: ${mealCount}件`,
    `🔥 エネルギー: 約${round1(totals.kcal)} kcal`,
    buildMealNutritionLine(totals),
    '━━━━━━━━━━━━━',
    options.dayScopeHeader ? '数字はDBに残っている食事だけを足し直した結果です。' : 'このまま次の食事も足していけば、1日の流れを見やすく追えます。',
  ].filter(Boolean);

  if (options.includeEnergyBalance) {
    const ex = Number(options.exerciseBurnKcal || 0);
    const net = Number(totals.kcal || 0) - ex;
    lines.push('', `🏃‍♂️ 運動消費: 約${round1(ex)} kcal`, `🔥 摂取 − 消費: 約${round1(net)} kcal`);
  }

  if (warn) lines.push('', warn);
  return lines.join('\n');
}

function buildTodayMealBalanceAnswer(records) {
  const totals = mealLogQueryService.aggregateLegacyMealRecords(records?.meals);
  const mealCount = totals.count;
  if (!mealCount) {
    return '今日はまだ食事記録が見当たらないので、食べたものや写真を送ってもらえれば栄養バランスも見ていけます。';
  }
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

async function mergeRecentDailyRecordsWithDbMeals(userId, limit) {
  const days = await contextMemoryService.getRecentDailyRecords(userId, limit);
  const todayYmd = contextMemoryService.getTokyoTodayYmd();
  const fromYmd = contextMemoryService.addCalendarDaysToTokyoYmd(todayYmd, -(limit - 1));
  const raw = await mealLogQueryService.getMealLogsByDateRange(userId, fromYmd, todayYmd);
  const byDay = mealLogQueryService.groupMealLogsByTokyoDay(raw);
  console.info('[meal] fetched_records_count', { scope: 'weekly_merge', limit, rawRows: raw.length });
  return days.map((day) => {
    const dayLogs = byDay.get(day.date) || [];
    return {
      ...day,
      records: {
        ...(day.records || {}),
        meals: mealLogsToRecordMeals(dayLogs)
      }
    };
  });
}

async function buildBiweeklyMealBalanceAnswerFromDb(userId) {
  const todayYmd = contextMemoryService.getTokyoTodayYmd();
  const fromYmd = contextMemoryService.addCalendarDaysToTokyoYmd(todayYmd, -27);
  const raw = await mealLogQueryService.getMealLogsByDateRange(userId, fromYmd, todayYmd);
  const logs = mealLogQueryService.deduplicateMealLogs(raw);
  console.info('[meal] fetched_records_count', { scope: 'biweekly_28d', rawRows: raw.length, dedupedRows: logs.length });
  const currentStart = contextMemoryService.addCalendarDaysToTokyoYmd(todayYmd, -13);
  const currentLogs = logs.filter((l) => mealLogQueryService.tokyoYmdFromIso(l.eatenAt) >= currentStart);
  const prevLogs = logs.filter((l) => mealLogQueryService.tokyoYmdFromIso(l.eatenAt) < currentStart);
  const currentTotals = mealLogQueryService.aggregateMealLogs(currentLogs);
  const previousTotals = mealLogQueryService.aggregateMealLogs(prevLogs);
  console.info('[meal] total_calculated', { scope: 'biweekly_current_14d', count: currentTotals.count, kcal: round1(currentTotals.kcal) });
  console.info('[meal] total_calculated', { scope: 'biweekly_prev_14d', count: previousTotals.count, kcal: round1(previousTotals.kcal) });
  const currentDays = 14;
  const previousDays = 14;
  const kcalDiff = round1(currentTotals.kcal - previousTotals.kcal);
  const proteinDiff = round1(currentTotals.protein - previousTotals.protein);
  const fatDiff = round1(currentTotals.fat - previousTotals.fat);
  const carbsDiff = round1(currentTotals.carbs - previousTotals.carbs);

  const lines = [
    '📊 食事バランス比較（直近14日 vs その前14日）※DB meal_logs から再集計',
    '━━━━━━━━━━━━━',
    `🍽️ 直近14日: ${currentTotals.count}件`,
    `🔥 kcal: ${round1(currentTotals.kcal)}（差分 ${kcalDiff >= 0 ? '+' : ''}${kcalDiff}）`,
    `💪 たんぱく質: ${round1(currentTotals.protein)}g（差分 ${proteinDiff >= 0 ? '+' : ''}${proteinDiff}）`,
    `🍳 脂質: ${round1(currentTotals.fat)}g（差分 ${fatDiff >= 0 ? '+' : ''}${fatDiff}）`,
    `🍞 糖質: ${round1(currentTotals.carbs)}g（差分 ${carbsDiff >= 0 ? '+' : ''}${carbsDiff}）`,
    `📉 1日平均kcal: ${round1(currentTotals.kcal / currentDays)}（前期 ${round1(previousTotals.kcal / previousDays)}）`,
    '━━━━━━━━━━━━━',
  ];

  if (!previousTotals.count) {
    lines.push('💬 比較元の記録がまだ少ないため、今回は直近14日の基準値として見ていきましょう。');
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

function sumNutritionFromDailyRecords(recentDailyRecords = []) {
  const totals = { kcal: 0, protein: 0, fat: 0, carbs: 0, mealCount: 0 };
  for (const day of recentDailyRecords) {
    const records = day?.records || {};
    const dayTotals = mealLogQueryService.aggregateLegacyMealRecords(records?.meals);
    totals.kcal += Number(dayTotals.kcal || 0);
    totals.protein += Number(dayTotals.protein || 0);
    totals.fat += Number(dayTotals.fat || 0);
    totals.carbs += Number(dayTotals.carbs || 0);
    totals.mealCount += Number(dayTotals.count || 0);
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

function looksLikeMealText(text) {
  const safe = normalizeText(text);
  if (!safe || containsQuestionTone(safe)) return false;
  if (mealAnalysisService.isMealMetaOrCorrectionText(safe)) return false;
  if (mealAnalysisService.isMealNegationOrNonRecordText(safe)) return false;
  if (isMealAnnouncementText(safe)) return false;
  if (/使い方|送り方|メニュー|コマンド/.test(safe)) return false;
  if (/^(朝|昼|夜|夕)(ごはん|ご飯|食)(です|でした)?$/.test(safe)) return false;
  if (/^(ごはん|ご飯)(です|でした)?$/.test(safe)) return false;
  return /朝ごはん|昼ごはん|夜ごはん|朝食|昼食|夕食|食べた|食べちゃ|飲んだ|ラーメン|カレー|寿司|卵|味付き卵|味噌汁|サラダ|ごはん|ご飯|パン|ヨーグルト|バナナ|パスタ|おにぎり|弁当|白湯|おはぎ|玄米/.test(safe);
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
    `🫒 脂質: ${round1(nutrition?.fat || 0)} g`,
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

  const todayYmd = contextMemoryService.getTokyoTodayYmd();
  const { totals: todayTotals } = await mealLogQueryService.fetchAggregateMealLogsFromDb(
    input.userId,
    todayYmd,
    todayYmd,
    'meal_draft_followup'
  );
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
  return mealReplyFormatterService.formatMealReplyText(parsedMeal, {
    todayTotals: options?.todayTotals || null,
    mealCount: options?.mealCount != null ? Number(options.mealCount) : null,
    exerciseBurnKcal: Number(options?.exerciseBurnKcal || 0),
    netKcal: Number(options?.netKcal || 0),
  });
}

function buildMealRecordPayload(text, parsedMeal, input = {}) {
  const items = Array.isArray(parsedMeal?.items) ? parsedMeal.items.filter(Boolean) : [];
  const recordKind = normalizeText(parsedMeal?.recordKind || 'meal_text_record');
  const textFingerprint = normalizeText(parsedMeal?.text_fingerprint || '');
  return {
    type: 'meal',
    date: formatTokyoYmd(),
    name: items.length ? items.join('、') : normalizeText(text),
    summary: normalizeText(text) || '食事',
    items,
    food_items: items,
    estimatedNutrition: parsedMeal?.estimatedNutrition || { kcal: 0, protein: 0, fat: 0, carbs: 0 },
    kcal: Number(parsedMeal?.estimatedNutrition?.kcal || 0),
    protein: Number(parsedMeal?.estimatedNutrition?.protein || 0),
    fat: Number(parsedMeal?.estimatedNutrition?.fat || 0),
    carbs: Number(parsedMeal?.estimatedNutrition?.carbs || 0),
    amountRatio: Number(parsedMeal?.amountRatio || 1),
    amountNote: parsedMeal?.amountNote || '',
    confidence: parsedMeal?.confidence != null ? Number(parsedMeal.confidence) : null,
    comment: parsedMeal?.comment || '',
    calorie_source: normalizeText(parsedMeal?.calorie_source || 'gemini_estimate'),
    calorie_confidence: normalizeText(parsedMeal?.calorie_confidence || 'medium'),
    original_gemini_calories: Number(parsedMeal?.original_gemini_calories || parsedMeal?.estimatedNutrition?.kcal || 0),
    final_calories: Number(parsedMeal?.final_calories || parsedMeal?.estimatedNutrition?.kcal || 0),
    correction_reason: normalizeText(parsedMeal?.correction_reason || ''),
    sourceLineMessageId: normalizeText(input?.messageId || ''),
    dedupeKey: normalizeText(input?.messageId ? `msg:${input.messageId}` : ''),
    record_kind: recordKind,
    text_fingerprint: textFingerprint
  };
}

function buildImageMealRecordPayload(parsedMeal, input = {}) {
  const items = Array.isArray(parsedMeal?.items) ? parsedMeal.items.filter(Boolean) : [];
  const itemLabel = items.length ? items.join('、') : '食事写真';

  return {
    type: 'meal',
    date: formatTokyoYmd(),
    name: itemLabel,
    summary: itemLabel,
    items,
    food_items: items,
    estimatedNutrition: parsedMeal?.estimatedNutrition || { kcal: 0, protein: 0, fat: 0, carbs: 0 },
    kcal: Number(parsedMeal?.estimatedNutrition?.kcal || 0),
    protein: Number(parsedMeal?.estimatedNutrition?.protein || 0),
    fat: Number(parsedMeal?.estimatedNutrition?.fat || 0),
    carbs: Number(parsedMeal?.estimatedNutrition?.carbs || 0),
    amountNote: parsedMeal?.amountNote || '',
    confidence: parsedMeal?.confidence != null ? Number(parsedMeal.confidence) : null,
    comment: parsedMeal?.comment || '',
    calorie_source: normalizeText(parsedMeal?.calorie_source || 'gemini_estimate'),
    calorie_confidence: normalizeText(parsedMeal?.calorie_confidence || 'medium'),
    original_gemini_calories: Number(parsedMeal?.original_gemini_calories || parsedMeal?.estimatedNutrition?.kcal || 0),
    final_calories: Number(parsedMeal?.final_calories || parsedMeal?.estimatedNutrition?.kcal || 0),
    correction_reason: normalizeText(parsedMeal?.correction_reason || ''),
    sourceLineMessageId: normalizeText(input?.messageId || ''),
    dedupeKey: normalizeText(input?.messageId ? `msg:${input.messageId}` : '')
  };
}

function buildLabImageReply(lab) {
  return labFollowupService.buildLabImageReply(lab);
}

function hasTentativeLabSignal(lab = {}) {
  if (!lab || typeof lab !== 'object') return false;
  if (normalizeText(lab?.printDate || '')) return true;
  if (normalizeText(lab?.patientName || '')) return true;
  if (normalizeText(lab?.facilityName || '')) return true;
  if (Array.isArray(lab?.examDates) && lab.examDates.length) return true;
  if (Array.isArray(lab?.items) && lab.items.length) return true;
  if (normalizeText(lab?.rawText || '').length >= 20) return true;
  return false;
}

async function maybeHandleActiveContextFollowUp(input, text, shortMemory = {}) {
  const safe = normalizeText(text || input?.rawText || '');
  if (!safe) return null;
  const active = await activeContextService.getActiveContext(input.userId, shortMemory);
  if (!active?.type) return null;

  const type = normalizeText(active.type);
  if (/^lab_/.test(type)) {
    const panel = active?.payload?.labPanel
      || shortMemory?.followUpContext?.labPanel
      || null;
    if (!panel) return null;
    if (/患者名|氏名/.test(safe)) return { intentType: 'active_lab_followup', replyText: labFollowupService.buildPatientNameReply(panel) };
    if (/病院名|医院名|クリニック名|医療機関/.test(safe)) return { intentType: 'active_lab_followup', replyText: labFollowupService.buildFacilityNameReply(panel) };
    if (/印刷日|発行日|出力日/.test(safe)) return { intentType: 'active_lab_followup', replyText: labFollowupService.buildPrintDateReply(panel) };
    if (/日付|検査日|採血日|一番新しい日付|最新日/.test(safe)) return { intentType: 'active_lab_followup', replyText: labFollowupService.buildExamDateQuickReply(panel) };
    if (/他に|何が読み取れ|読み取れた/.test(safe)) return { intentType: 'active_lab_followup', replyText: labFollowupService.buildReadableInventoryReply(panel) };
    const target = labFollowupService.normalizeTarget(safe);
    if (target) {
      const selectedDate = shortMemory?.followUpContext?.selectedLabExamDate || panel?.latestExamDate || panel?.examDate || '';
      return { intentType: 'active_lab_followup', replyText: labFollowupService.buildItemReply(panel, target, selectedDate) };
    }
    return null;
  }

  if (/^meal_/.test(type)) {
    if (/ゼロ|0kcal|0 kcal|食べてない|食べなかった|キャンセル|取り消し/.test(safe)) {
      const del = await contextMemoryService.deleteLastMealLog(input.userId);
      if (del?.ok) {
        const todayYmd = contextMemoryService.getTokyoTodayYmd();
        const rawT = await mealLogQueryService.getMealLogsByDateRange(input.userId, todayYmd, todayYmd);
        const totals = { meals: mealLogsToRecordMeals(rawT) };
        await activeContextService.clearActiveContext(input.userId, shortMemory);
        return {
          intentType: 'active_meal_followup',
          replyText: [
            '了解です。直前の食事記録を取り消して、0kcal扱いにしました。',
            '',
            buildTodayMealTotalsAnswer(totals, { dayScopeHeader: true, includeAnomalyNote: true })
          ].join('\n')
        };
      }
      return { intentType: 'active_meal_followup', replyText: '了解です。0kcal扱いにしたい対象の食事を特定できなかったため、「この食事を削除して」と送ってください。' };
    }
    return null;
  }

  return null;
}

async function maybeAnswerLabFollowUp(userId, text, shortMemory) {
  const safe = normalizeText(text);
  let panel =
    shortMemory?.followUpContext?.labPanel
    || await contextMemoryService.getLatestLabPanel(userId)
    || await labDocumentStoreService.getLatestPanelForUser(userId)
    || null;
  panel = enrichLabPanelFromAliases(panel);
  if (!panel) return null;

  if (labFollowupService.shouldHandleTrendQuestion(safe)) {
    return labFollowupService.buildTrendReply(panel, safe);
  }

  if (/他に(?:は)?読めた|他に取れた|拾えてる項目|読めた記録|他の項目|記録を教えて/.test(safe)) {
    return labFollowupService.buildReadableInventoryReply(panel);
  }
  if (/患者名|氏名/.test(safe)) {
    return labFollowupService.buildPatientNameReply(panel);
  }
  if (/病院名|医院名|クリニック名|医療機関/.test(safe)) {
    return labFollowupService.buildFacilityNameReply(panel);
  }
  if (/印刷日|発行日|出力日/.test(safe)) {
    return labFollowupService.buildPrintDateReply(panel);
  }
  if (/一番新しい日付|最新日|最新の検査日/.test(safe)) {
    return labFollowupService.buildLatestDateReply(panel);
  }
  if (/異常がついている項目|異常項目|H\/L|ハイフラグ|ローフラグ/.test(safe)) {
    return labFollowupService.buildAbnormalItemsReply(panel);
  }
  if (/日付は|いつ[？?]|検査日|採血日は/.test(safe)) {
    return labFollowupService.buildExamDateQuickReply(panel);
  }

  if (/悪い値|危ない値|異常そう|問題ありそう|大丈夫そう/.test(safe)) {
    return labFollowupService.buildAbnormalItemsReply(panel);
  }
  if (/数値全部|ぜんぶ教えて|全部.*教え|一覧.*数値|数値を.*並べ/.test(safe)) {
    return labFollowupService.buildNaturalAllValuesReply(panel);
  }

  const targetName = labFollowupService.normalizeTarget(safe);
  if (!targetName) return null;

  const selectedDate = shortMemory?.followUpContext?.selectedLabExamDate || panel?.latestExamDate || panel?.examDate || '';
  return labFollowupService.buildItemReply(panel, targetName, selectedDate);
}

async function maybeHandleLabDateSelection(input, shortMemory) {
  const safe = normalizeText(input?.rawText || '');
  const basePanel =
    shortMemory?.followUpContext?.labPanel
    || await contextMemoryService.getLatestLabPanel(input?.userId)
    || await labDocumentStoreService.getLatestPanelForUser(input?.userId)
    || null;
  const panel = enrichLabPanelFromAliases(basePanel);
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
  const basePanel =
    shortMemory?.followUpContext?.labPanel
    || await contextMemoryService.getLatestLabPanel(input?.userId)
    || await labDocumentStoreService.getLatestPanelForUser(input?.userId)
    || null;
  const panel = enrichLabPanelFromAliases(basePanel);
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
  if (followUpType === 'meal' || followUpType === 'lab' || followUpType === 'lab_pending' || followUpType === 'blood_test' || followUpType === 'lab_image') return false;

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
      await contextMemoryService.saveShortMemory(input.userId, { pendingClarification: null });
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
      await contextMemoryService.saveShortMemory(input.userId, { pendingClarification: null });
      const labIntent = labImageHandled?.analysis?.labPending ? 'lab_image_pending' : 'lab_image';
      return {
        ok: true,
        replyText: labImageHandled.replyText,
        internal: { intentType: labIntent, responseMode: 'answer' }
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
  const replyId = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  await contextMemoryService.appendRecentMessage(userId, 'user', userText);
  await contextMemoryService.appendRecentMessage(userId, 'assistant', replyText, { messageId: replyId });
  await contextMemoryService.saveShortMemory(userId, {
    lastAssistantReplySnapshot: {
      replyId,
      text: normalizeText(replyText || '').slice(0, 240),
      sourceUserText: normalizeText(userText || '').slice(0, 160),
      at: new Date().toISOString()
    }
  });
}

function shouldSkipHealthAggregationForIntent(intentType = '') {
  const t = normalizeText(intentType || '');
  return /^(emotional_support|life_companion|correction_feedback|exercise_feedback)$/.test(t);
}

const NATURAL_REPLY_MODES = new Set([
  'emotional_support',
  'correction_feedback',
  'meal_record_text',
  'meal_note',
  'meal_text',
  'exercise_feedback',
  'life_companion',
  'lab_followup',
]);

function inferNaturalConversationMode(intentType) {
  const it = normalizeText(intentType || '');
  if (it === 'meal_note') return 'reward_food';
  return it;
}

async function resolveLabFollowUpFeatureResults(userId, text, shortMemory) {
  const panel = enrichLabPanelFromAliases(
    shortMemory?.followUpContext?.labPanel
    || await contextMemoryService.getLatestLabPanel(userId)
    || await labDocumentStoreService.getLatestPanelForUser(userId)
    || null
  );
  const selectedDate = shortMemory?.followUpContext?.selectedLabExamDate || panel?.latestExamDate || panel?.examDate || '';
  return labFollowupService.buildFollowUpFeatureResults(panel, text, selectedDate);
}

async function withSurfaceReply(input, draftText, ctx, intentType, options = {}) {
  const itNorm = normalizeText(intentType || '');
  const useNatural = Boolean(
    options.featureResults
    || (options.useNaturalGenerator !== false && NATURAL_REPLY_MODES.has(itNorm))
  );

  if (useNatural) {
    const conversationMode = inferNaturalConversationMode(itNorm);
    const generated = await lineNaturalReplyGeneratorService.generateNaturalLineReply({
      userId: input.userId,
      userText: input?.rawText || '',
      conversationMode,
      intent: /meal/.test(itNorm) ? 'meal' : itNorm,
      featureResults: options.featureResults || {},
      userContext: {
        relationshipPhase: normalizeText(ctx?.longMemory?.relationshipPhase || ''),
        stableRoutineEvidenceCount: options.stableRoutineEvidenceCount,
        recentMessages: ctx?.recentMessages || [],
        longMemory: ctx?.longMemory || {},
      },
      observationHints: options.observationHints || [],
      replyDepth: options.replyDepth || (itNorm === 'emotional_support' ? 'deep' : 'normal'),
    });
    const hour = Number(getJapanNow().hour || 0);
    let totalTurns = 0;
    try {
      const st = await contextMemoryService.getUserState(input.userId);
      totalTurns = Number(st?.totalTurns || 0);
    } catch (_e) {
      totalTurns = 0;
    }
    const enhanced = await companionReplyService.enhanceReply({
      userId: input.userId,
      userText: input?.rawText || '',
      rawReply: generated.text,
      intentType: itNorm,
      conversationMode: itNorm,
      recentMessages: ctx?.recentMessages || [],
      longMemory: ctx?.longMemory || {},
      hour,
      totalTurns,
      replyDepth: options.replyDepth || (itNorm === 'emotional_support' ? 'deep' : 'normal'),
    });
    return normalizeText(enhanced?.text || generated.text) || generated.text;
  }

  if (itNorm === 'correction_feedback') {
    let base = normalizeText(draftText) || String(draftText || '');
    const guarded = responseGuardService.guardReplyText(base);
    if (runtimeFlag('ENABLE_NEW_FLOW_RESPONSE_GUARD', featureFlags.ENABLE_NEW_FLOW_RESPONSE_GUARD)) {
      base = normalizeText(guarded?.text || base) || base;
    }
    const hour = Number(getJapanNow().hour || 0);
    let totalTurns = 0;
    try {
      const st = await contextMemoryService.getUserState(input.userId);
      totalTurns = Number(st?.totalTurns || 0);
    } catch (_e) {
      totalTurns = 0;
    }
    const eq = emotionalQualityCheckService.applyEmotionalQualityPass({
      text: base,
      userText: input?.rawText || '',
      intent: 'correction_feedback',
      conversationMode: 'correction_feedback',
      replyDepth: 'normal',
      relationshipPhase: normalizeText(ctx?.longMemory?.relationshipPhase || ''),
      userId: input.userId,
      hour,
      totalTurns
    });
    return normalizeText(eq.text) || base;
  }

  const polished = await conversationSurfaceService.polishDraftToSurface({
    userMessage: input?.rawText || '',
    draftReply: draftText,
    recentMessages: ctx?.recentMessages || [],
    longMemory: ctx?.longMemory || {},
    intentType: intentType || 'surface',
    messageType: input?.messageType || 'text'
  });
  const softened = replyIntegrityService.softenCantDoStatements(polished);
  let base = softened;
  const guarded = responseGuardService.guardReplyText(softened);
  if (runtimeFlag('ENABLE_NEW_FLOW_RESPONSE_GUARD', featureFlags.ENABLE_NEW_FLOW_RESPONSE_GUARD)) {
    base = guarded?.text || softened;
  }

  try {
    const hour = Number(getJapanNow().hour || 0);
    const shortMemory = await contextMemoryService.getShortMemory(input.userId);
    const activeContextType = normalizeText(
      shortMemory?.followUpContext?.imageType
      || shortMemory?.followUpContext?.source
      || shortMemory?.pendingRecordCandidate?.recordType
      || ''
    );
    const skipHealth = Boolean(options.skipHealthAggregation) || shouldSkipHealthAggregationForIntent(intentType);
    let todayNutritionSummary = null;
    let todayEnergyBalance = null;
    if (!skipHealth) {
      todayNutritionSummary = await dailyNutritionSummaryService.fetchTodayNutritionSummary(input.userId);
      todayEnergyBalance = await dailyEnergyBalanceService.fetchTodayEnergyBalance(input.userId);
    }
    const enhanced = await companionReplyService.enhanceReply({
      userId: input.userId,
      userText: input?.rawText || '',
      rawReply: base,
      intentType: intentType || 'surface',
      conversationMode: intentType || 'surface',
      activeContextType,
      recentMessages: ctx?.recentMessages || [],
      longMemory: ctx?.longMemory || {},
      todayNutritionSummary: todayNutritionSummary || {},
      todayEnergyBalance: todayEnergyBalance || {},
      hour,
      stableRoutineEvidenceCount: options.stableRoutineEvidenceCount
    });
    return normalizeText(enhanced?.text || base) || base;
  } catch (_e) {
    return base;
  }
}

async function polishReplyMessage(input, replyMessage, ctx, intentType) {
  if (!replyMessage || replyMessage.type !== 'text') return replyMessage;
  const base = normalizeText(replyMessage.text || '');
  if (!base) return replyMessage;
  const polished = await withSurfaceReply(input, base, ctx, intentType);
  return { ...replyMessage, text: polished };
}

async function polishQuickReplyBundle(input, handled, ctx, intentType) {
  const base = normalizeText(handled?.replyText || '');
  if (!base) {
    const fallback = handled?.replyMessage || { type: 'text', text: '' };
    await appendTurn(input.userId, input.rawText || '', fallback.text || '');
    return {
      ok: true,
      replyMessages: [fallback],
      internal: handled.internal
    };
  }
  const labels = Array.isArray(handled?.replyMessage?.quickReply?.items)
    ? handled.replyMessage.quickReply.items
      .map((it) => normalizeText(it?.action?.label || it?.action?.text || ''))
      .filter(Boolean)
    : [];
  const polished = await withSurfaceReply(input, base, ctx, intentType);
  const nextMessage = labels.length
    ? textMessageWithQuickReplies(polished, labels)
    : { type: 'text', text: polished };
  await appendTurn(input.userId, input.rawText || '', nextMessage.text || polished);
  return {
    ok: true,
    replyMessages: [nextMessage],
    internal: handled.internal
  };
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
    if (!lab?.isLabImage && !lab?.labLike && !hasTentativeLabSignal(lab)) {
      return { handled: false, analysis: lab || null };
    }

    if (!hasItems) {
      const fromRaw = labItemAliasService.buildLabItemMapFromRawText(lab?.rawText || '');
      const fromPanel = labItemAliasService.buildLabItemMapFromPanel(lab || {});
      const cachedItemMap = { ...fromRaw, ...fromPanel };
      const latestLabCache = {
        userId: input.userId,
        sourceImageId: normalizeText(imagePayload?.id || ''),
        sourceMessageId: normalizeText(input?.messageId || ''),
        examDate: lab?.latestExamDate || lab?.examDate || '',
        examDates: Array.isArray(lab?.examDates) ? lab.examDates : [],
        items: cachedItemMap,
        rawText: normalizeText(lab?.rawText || ''),
        updatedAt: new Date().toISOString(),
        createdAt: new Date().toISOString(),
        expiresAt: new Date(Date.now() + (24 * 60 * 60 * 1000)).toISOString(),
        patientName: normalizeText(lab?.patientName || ''),
        facilityName: normalizeText(lab?.facilityName || ''),
        printDate: normalizeText(lab?.printDate || ''),
      };
      console.info('[lab] cache_save_pending', {
        userId: input.userId,
        examDate: latestLabCache.examDate || '',
        rawTextPresent: Boolean(normalizeText(lab?.rawText || '')),
        rawExtractedKeyCount: Object.keys(fromRaw).length,
        panelExtractedKeyCount: Object.keys(fromPanel).length,
        mergedItemKeys: Object.keys(cachedItemMap)
      });
      await contextMemoryService.saveShortMemory(input.userId, {
        lastImageType: 'lab_pending',
        followUpContext: {
          source: 'image',
          imageType: 'lab_pending',
          intakeKind: lab?.intakeKind || 'lab_image',
          extractedItems: [],
          examDate: lab?.examDate || '',
          latestExamDate: lab?.latestExamDate || lab?.examDate || '',
          selectedLabExamDate: lab?.latestExamDate || lab?.examDate || '',
          availableLabDates: Array.isArray(lab?.examDates) ? lab.examDates : [],
          labPanel: lab || null,
          latestLabCache
        }
      });
      await activeContextService.setActiveContext(input.userId, {
        type: 'lab_image_session',
        payload: { labPanel: lab }
      });
      try {
        if (lab) await contextMemoryService.upsertLabPanel(input.userId, lab);
      } catch (error) {
        console.error('[conversation_orchestrator] pending lab panel save error:', error?.message || error);
      }

      return {
        handled: true,
        analysis: lab,
        replyText: buildLabPendingAckReply(lab, input.userId)
      };
    }

    await contextMemoryService.saveShortMemory(input.userId, {
      lastImageType: 'lab',
      followUpContext: {
        source: 'image',
        imageType: 'lab',
        intakeKind: lab.intakeKind || 'blood_test',
        extractedItems: lab.items,
        examDate: lab.examDate || '',
        latestExamDate: lab.latestExamDate || lab.examDate || '',
        selectedLabExamDate: lab.latestExamDate || lab.examDate || '',
        availableLabDates: Array.isArray(lab?.examDates) ? lab.examDates : [],
        labPanel: lab,
        latestLabCache: {
          userId: input.userId,
          sourceImageId: normalizeText(imagePayload?.id || ''),
          sourceMessageId: normalizeText(input?.messageId || ''),
          examDate: lab.latestExamDate || lab.examDate || '',
          examDates: Array.isArray(lab?.examDates) ? lab.examDates : [],
          items: {
            ...labItemAliasService.buildLabItemMapFromRawText(lab?.rawText || ''),
            ...labItemAliasService.buildLabItemMapFromPanel(lab)
          },
          rawText: normalizeText(lab?.rawText || ''),
          updatedAt: new Date().toISOString(),
          createdAt: new Date().toISOString(),
          expiresAt: new Date(Date.now() + (24 * 60 * 60 * 1000)).toISOString(),
          patientName: normalizeText(lab?.patientName || ''),
          facilityName: normalizeText(lab?.facilityName || ''),
          printDate: normalizeText(lab?.printDate || '')
        }
      }
    });
    await activeContextService.setActiveContext(input.userId, {
      type: 'lab_followup_session',
      payload: { labPanel: lab }
    });
    const fromRawParsed = labItemAliasService.buildLabItemMapFromRawText(lab?.rawText || '');
    const fromPanelParsed = labItemAliasService.buildLabItemMapFromPanel(lab);
    const mergedParsed = { ...fromRawParsed, ...fromPanelParsed };
    console.info('[lab] cache_save_parsed', {
      userId: input.userId,
      examDate: lab?.latestExamDate || lab?.examDate || '',
      rawTextPresent: Boolean(normalizeText(lab?.rawText || '')),
      rawExtractedKeyCount: Object.keys(fromRawParsed).length,
      panelExtractedKeyCount: Object.keys(fromPanelParsed).length,
      mergedItemKeys: Object.keys(mergedParsed)
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

const MEAL_IMAGE_CONFIDENCE_MIN = Number(process.env.KOKOKARA_MEAL_IMAGE_CONFIDENCE_MIN || 0.56) || 0.56;

async function maybeHandleMealImage(input, imagePayload) {
  if (input?.messageType !== 'image' || !imagePayload?.ok) return { handled: false, analysis: null };

  try {
    const caption = normalizeText(input?.rawText || '');
    const meal = await mealAnalysisService.analyzeMealImage(imagePayload, input.userId, caption);
    const conf = Number(meal?.confidence);
    if (!meal?.isMealImage || !Number.isFinite(conf) || conf < MEAL_IMAGE_CONFIDENCE_MIN) {
      return { handled: false, analysis: meal || null };
    }

    const summary = await dailyNutritionSummaryService.fetchTodayNutritionSummary(input.userId);
    const dbTotals = {
      kcal: Number(summary.kcal || 0),
      protein: Number(summary.protein || 0),
      fat: Number(summary.fat || 0),
      carbs: Number(summary.carbs || 0),
      count: Number(summary.meal_count || 0),
    };
    const mk = Number(meal?.estimatedNutrition?.kcal || 0);
    const mp = Number(meal?.estimatedNutrition?.protein || 0);
    const mf = Number(meal?.estimatedNutrition?.fat || 0);
    const mc = Number(meal?.estimatedNutrition?.carbs || 0);
    const todayTotals = {
      kcal: round1(dbTotals.kcal + mk),
      protein: round1(dbTotals.protein + mp),
      fat: round1(dbTotals.fat + mf),
      carbs: round1(dbTotals.carbs + mc)
    };
    const energyBal = await dailyEnergyBalanceService.fetchTodayEnergyBalance(input.userId);
    console.info('[meal_reply_format_start]', {
      user_id: input.userId,
      meal_record_id: '',
      has_calories: Number.isFinite(mk) && mk > 0,
      has_pfc: (Number(mp) > 0 || Number(mf) > 0 || Number(mc) > 0),
    });
    const replyText = buildMealReply(meal, {
      todayTotals,
      mealCount: dbTotals.count + 1,
      exerciseBurnKcal: energyBal.exerciseBurnKcal,
      netKcal: todayTotals.kcal - Number(energyBal.exerciseBurnKcal || 0),
    });

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
    await activeContextService.setActiveContext(input.userId, {
      type: 'meal_image_session',
      payload: { parsedMeal: meal }
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

async function findRecentMealTextDuplicate(userId, fingerprint, recordKind) {
  const fp = normalizeText(fingerprint);
  if (!fp) return null;
  const todayYmd = contextMemoryService.getTokyoTodayYmd();
  const logs = await mealLogQueryService.getMealLogsByDateRange(userId, todayYmd, todayYmd);
  const windowMs = resolveMealTextDuplicateWindowHours() * 60 * 60 * 1000;
  const now = Date.now();
  const kind = normalizeText(recordKind || '');
  for (const log of logs) {
    const raw = log?.rawModelJson && typeof log.rawModelJson === 'object' ? log.rawModelJson : {};
    const existingFingerprint = normalizeText(raw.text_fingerprint || raw.textFingerprint || '');
    const existingKind = normalizeText(raw.record_kind || raw.recordKind || '');
    const t = new Date(log?.eatenAt || '').getTime();
    const inWindow = Number.isFinite(t) ? Math.abs(now - t) <= windowMs : false;
    if (!inWindow) continue;
    if (existingFingerprint && existingFingerprint === fp && (!kind || !existingKind || existingKind === kind)) {
      return {
        id: log?.id || '',
        label: normalizeText(log?.mealLabel || ''),
        time: normalizeText(log?.eatenAt || '')
      };
    }
  }
  return null;
}

async function maybeHandleMealText(input, conversationState = null) {
  const text = normalizeText(input?.rawText || '');
  if (mealAnalysisService.isMealMetaOrCorrectionText(text)) return null;

  const primary = normalizeText(conversationState?.primary_conversation_mode || '');
  const useManual = primary === 'meal_text_record' || primary === 'reward_food';

  if (useManual) {
    console.info('[meal_text_record_detected]', {
      user_id: input.userId,
      text: text.slice(0, 160),
      primary_conversation_mode: primary
    });
    const manual = mealTextManualRecordService.parseAndBuildManualMealRecord(text, {
      recordKind: primary === 'reward_food' ? 'reward_food' : 'meal_text_record'
    });
    if (!manual?.parsedMeal) return null;
    const fingerprint = mealTextManualRecordService.buildMealTextFingerprint({
      text,
      parsedMeal: manual.parsedMeal,
      recordKind: manual.recordKind
    });
    manual.parsedMeal.text_fingerprint = fingerprint;

    const recentForStable = await contextMemoryService.getRecentMessages(input.userId, 80);
    const stableRoutineEvidenceCount = mealTextManualRecordService.countStableRoutineEvidence({
      recentMessages: recentForStable,
      fingerprint,
      recordKind: manual.recordKind,
      currentUserText: text
    });

    console.info('[meal_text_record_parsed]', {
      user_id: input.userId,
      items: manual.parsedMeal.items,
      kcal: manual.parsedMeal.estimatedNutrition?.kcal,
      protein: manual.parsedMeal.estimatedNutrition?.protein,
      record_kind: manual.recordKind,
      calorie_source: manual.parsedMeal.calorie_source,
      fingerprint,
      stable_routine_evidence_count: stableRoutineEvidenceCount
    });

    const summary = await dailyNutritionSummaryService.fetchTodayNutritionSummary(input.userId);
    const dbTotals = {
      kcal: Number(summary.kcal || 0),
      protein: Number(summary.protein || 0),
      fat: Number(summary.fat || 0),
      carbs: Number(summary.carbs || 0),
      count: Number(summary.meal_count || 0),
    };
    const mk = Number(manual.parsedMeal?.estimatedNutrition?.kcal || 0);
    const todayAfter = round1(dbTotals.kcal + mk);

    const replyText = mealTextManualRecordService.buildShortManualReply({
      parsedMeal: manual.parsedMeal,
      breakdownLines: manual.breakdownLines,
      recordKind: manual.recordKind,
      userText: text,
      todayTotalKcal: todayAfter,
      stable_routine_evidence_count: stableRoutineEvidenceCount
    });

    await contextMemoryService.saveShortMemory(input.userId, {
      pendingRecordCandidate: {
        recordType: 'meal_record',
        extracted: manual.parsedMeal
      }
    });
    await activeContextService.setActiveContext(input.userId, {
      type: 'meal_followup_session',
      payload: { parsedMeal: manual.parsedMeal }
    });

    return {
      replyText,
      parsedMeal: manual.parsedMeal,
      recordKind: manual.recordKind,
      fromManualText: true,
      stableRoutineEvidenceCount: stableRoutineEvidenceCount
    };
  }

  if (!looksLikeMealText(text)) return null;

  const parsedMeal = mealAnalysisService.parseMealText(text);
  if (Number(parsedMeal?.confidence || 0) < 0.4) return null;

  const summary = await dailyNutritionSummaryService.fetchTodayNutritionSummary(input.userId);
  const dbTotals = {
    kcal: Number(summary.kcal || 0),
    protein: Number(summary.protein || 0),
    fat: Number(summary.fat || 0),
    carbs: Number(summary.carbs || 0),
    count: Number(summary.meal_count || 0),
  };
  const mk = Number(parsedMeal?.estimatedNutrition?.kcal || 0);
  const mp = Number(parsedMeal?.estimatedNutrition?.protein || 0);
  const mf = Number(parsedMeal?.estimatedNutrition?.fat || 0);
  const mc = Number(parsedMeal?.estimatedNutrition?.carbs || 0);
  const todayTotals = {
    kcal: round1(dbTotals.kcal + mk),
    protein: round1(dbTotals.protein + mp),
    fat: round1(dbTotals.fat + mf),
    carbs: round1(dbTotals.carbs + mc)
  };
  const energyBal = await dailyEnergyBalanceService.fetchTodayEnergyBalance(input.userId);
  console.info('[meal_reply_format_start]', {
    user_id: input.userId,
    meal_record_id: '',
    has_calories: Number.isFinite(mk) && mk > 0,
    has_pfc: (Number(mp) > 0 || Number(mf) > 0 || Number(mc) > 0),
  });
  const replyText = buildMealReply(parsedMeal, {
    todayTotals,
    mealCount: dbTotals.count + 1,
    exerciseBurnKcal: energyBal.exerciseBurnKcal,
    netKcal: todayTotals.kcal - Number(energyBal.exerciseBurnKcal || 0),
  });

  await contextMemoryService.saveShortMemory(input.userId, {
    pendingRecordCandidate: {
      recordType: 'meal_record',
      extracted: parsedMeal
    }
  });
  await activeContextService.setActiveContext(input.userId, {
    type: 'meal_followup_session',
    payload: { parsedMeal }
  });

  return {
    replyText,
    parsedMeal
  };
}

async function maybeHandleMealFollowUp(input, shortMemory) {
  const text = normalizeText(input?.rawText || '');
  const fromPending = shortMemory?.pendingRecordCandidate?.recordType === 'meal_record' ? shortMemory?.pendingRecordCandidate?.extracted : null;
  const fromFollowUp = shortMemory?.followUpContext?.imageType === 'meal' ? shortMemory?.followUpContext?.extractedMeal : null;
  let source = fromPending || fromFollowUp ? 'active_context' : '';
  let sourceMealId = normalizeText(fromPending?.meal_id || fromPending?.id || fromFollowUp?.meal_id || fromFollowUp?.id || '');
  let mealLabel = '';
  let meal = fromPending || fromFollowUp;
  if (source === 'active_context' && !sourceMealId) {
    console.info('[meal_correction_active_context_invalid]', {
      user_id: input.userId,
      reason: 'empty_meal_id',
      fallback: 'latest_base_meal'
    });
    meal = null;
    source = '';
  }
  if (!meal || typeof meal !== 'object') {
    const latestBase = await mealLogQueryService.getLatestBaseMealLogWithTrace(input.userId, 7);
    const latest = latestBase?.meal || null;
    const trace = latestBase?.trace || {};
    console.info('[meal_correction_target_candidates]', {
      candidate_count: Number(trace.candidate_count || 0),
      excluded_correction_count: Number(trace.excluded_correction_count || 0),
      selected_meal_id: String(trace.selected_meal_id || ''),
      selected_meal_label: String(trace.selected_meal_label || ''),
      selection_reason: String(trace.selection_reason || '')
    });
    if (latest) {
      source = 'latest_meal';
      sourceMealId = String(latest.id || '');
      mealLabel = normalizeText(latest.mealLabel || '');
      console.info('[meal_correction_base_meal_selected]', {
        user_id: input.userId,
        base_meal_id: sourceMealId,
        base_meal_label: mealLabel,
        skipped_latest_correction: Boolean(trace.skipped_latest_correction)
      });
      meal = {
        items: Array.isArray(latest.foodItems) && latest.foodItems.length ? latest.foodItems : [latest.mealLabel || '食事'],
        estimatedNutrition: {
          kcal: Number(latest.kcal || 0),
          protein: Number(latest.protein || 0),
          fat: Number(latest.fat || 0),
          carbs: Number(latest.carbs || 0),
        },
        mealLabel: latest.mealLabel || '',
      };
    }
  }
  if (!meal || typeof meal !== 'object') return null;
  if (!/半分|少し|少なめ|全部|完食|食べてない|残した/.test(text)) return null;

  const mealBody = meal;
  const base = mealBody?.estimatedNutrition || { kcal: 0, protein: 0, fat: 0, carbs: 0 };

  let ratio = 1;
  if (/半分/.test(text)) ratio = 0.5;
  else if (/少し|少なめ|残した/.test(text)) ratio = 0.7;
  else if (/食べてない/.test(text)) ratio = 0;
  else if (/全部|完食/.test(text)) ratio = 1;
  const targetFood = (() => {
    if (/ご飯|ごはん|米/.test(text)) return 'ご飯';
    if (/麺/.test(text)) return '麺';
    if (/パン/.test(text)) return 'パン';
    if (/サラダ/.test(text)) return 'サラダ';
    if (/卵/.test(text)) return '卵';
    if (/肉/.test(text)) return '肉';
    if (/魚/.test(text)) return '魚';
    if (/おかず/.test(text)) return 'おかず';
    return '食事全体';
  })();
  const duplicate = await mealLogQueryService.findRecentMealCorrectionDuplicate(input.userId, {
    targetMealId: sourceMealId,
    targetFood,
    fraction: ratio,
    daysBack: 7
  });
  if (duplicate && !input?.allowDuplicateMealCorrection) {
    console.info('[meal_correction_duplicate_detected]', {
      user_id: input.userId,
      target_meal_id: sourceMealId,
      target_food: targetFood,
      fraction: ratio,
      existing_correction_id: String(duplicate.id || ''),
      action: 'ask_confirmation'
    });
    return {
      requiresConfirmation: true,
      confirmationPayload: {
        type: 'meal_correction_duplicate_confirm',
        target_meal_id: sourceMealId,
        target_food: targetFood,
        fraction: ratio
      },
      replyText: `${targetFood}半分としてはすでに見直しています。さらに少なめに直しますか？`
    };
  }
  console.info('[meal_correction_target_resolved]', {
    user_id: input.userId,
    meal_id: sourceMealId,
    meal_label: mealLabel || normalizeText((mealBody?.items || [])[0] || mealBody?.mealLabel || ''),
    target_food: targetFood,
    fraction: ratio,
    source: source || 'active_context'
  });

  const foodShare = (() => {
    if (targetFood === 'ご飯') return 0.4;
    if (targetFood === '麺') return 0.5;
    if (targetFood === 'パン') return 0.35;
    if (targetFood === 'サラダ') return 0.15;
    if (targetFood === '卵') return 0.2;
    if (targetFood === '肉') return 0.3;
    if (targetFood === '魚') return 0.25;
    if (targetFood === 'おかず') return 0.25;
    return 1;
  })();
  const effectiveRatio = foodShare >= 0.99 ? ratio : (1 - ((1 - ratio) * foodShare));
  const adjustedNutrition = {
    kcal: round1(base.kcal * effectiveRatio),
    protein: round1(base.protein * effectiveRatio),
    fat: round1(base.fat * effectiveRatio),
    carbs: round1(base.carbs * effectiveRatio)
  };

  const adjusted = {
    ...mealBody,
    amountNote: text,
    estimatedNutrition: adjustedNutrition
  };
  const deltaNutrition = {
    kcal: round1(adjustedNutrition.kcal - Number(base.kcal || 0)),
    protein: round1(adjustedNutrition.protein - Number(base.protein || 0)),
    fat: round1(adjustedNutrition.fat - Number(base.fat || 0)),
    carbs: round1(adjustedNutrition.carbs - Number(base.carbs || 0))
  };
  if (deltaNutrition.kcal > 0) {
    console.info('[meal_correction_positive_insert_blocked]', {
      user_id: input.userId,
      text: text.slice(0, 120),
      attempted_kcal: deltaNutrition.kcal,
      reason: 'meal_correction_must_not_increase_daily_total'
    });
    deltaNutrition.kcal = 0;
    deltaNutrition.protein = 0;
    deltaNutrition.fat = 0;
    deltaNutrition.carbs = 0;
  }

  const todayYmd = contextMemoryService.getTokyoTodayYmd();
  const { totals: dbTotals } = await mealLogQueryService.fetchAggregateMealLogsFromDb(
    input.userId,
    todayYmd,
    todayYmd,
    'meal_followup_adjust'
  );
  const correctedTotals = {
    kcal: round1(dbTotals.kcal + deltaNutrition.kcal),
    protein: round1(dbTotals.protein + deltaNutrition.protein),
    fat: round1(dbTotals.fat + deltaNutrition.fat),
    carbs: round1(dbTotals.carbs + deltaNutrition.carbs)
  };
  console.info('[meal_correction_applied]', {
    user_id: input.userId,
    target_meal_id: sourceMealId,
    target_food: targetFood,
    previous_kcal: Number(base.kcal || 0),
    corrected_kcal: Number(adjustedNutrition.kcal || 0),
    delta_kcal: Number(deltaNutrition.kcal || 0),
    method: source === 'latest_meal' ? 'latest_meal_food_share_adjustment' : 'active_context_food_share_adjustment'
  });

  const memPatch = {
    pendingRecordCandidate: {
      recordType: 'meal_record',
      extracted: adjusted
    }
  };
  if (shortMemory?.followUpContext?.imageType === 'meal') {
    memPatch.followUpContext = { ...shortMemory.followUpContext, extractedMeal: adjusted };
  }
  await contextMemoryService.saveShortMemory(input.userId, memPatch);

  return {
    replyText: [
      `${targetFood}は${/半分/.test(text) ? '半分' : '控えめ'}だったんですね。`,
      `では、${mealLabel || normalizeText((mealBody?.items || [])[0] || '直前の食事')}の${targetFood === '食事全体' ? '全体量' : `${targetFood}分`}を少し控えめに見直しておきます。`,
      'こういう一言、写真だけでは分からないのでかなり助かります。',
      `🍽️ 見直し後のこの食事: 約${round1(adjustedNutrition.kcal)}kcal`,
      buildMealNutritionLine(adjustedNutrition || {}),
      '',
      '📈 今日の合計（補正後）',
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
      amountNote: text,
      target_meal_id: sourceMealId || '',
      parent_meal_id: sourceMealId || '',
      target_food: targetFood,
      fraction: ratio,
      correction_type: 'manual_correction_delta'
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

function buildExerciseBodyFeedbackReply() {
  return [
    'ストレッチのあとに「伸びた感じ」まで拾えているのは、とても良い流れです。',
    'その感覚を覚えておけると、次も続けやすいです。無理に量は増やさなくて大丈夫です。',
  ].join('\n');
}

async function maybeHandleSimpleExerciseRecord(input, text, longMemoryLatest) {
  if (looksLikeCoachingOrConsultationText(text) || shouldAnswerWithChatFirst(text)) return null;
  if (containsQuestionTone(text)) return null;
  const out = await exerciseRecordService.recordExerciseFromText(input.userId, text, {
    weightKg: Number(longMemoryLatest?.weight || 60) || 60,
  });
  if (!out?.record) return null;

  await contextMemoryService.saveShortMemory(input.userId, { recentSmallTalkTopic: text, followUpContext: { source: 'text', imageType: '', lastRecordType: 'exercise' } });
  return { replyText: out.replyText, record: out.record };
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
  const mealTotals = mealLogQueryService.aggregateLegacyMealRecords(records?.meals);
  const lines = [
    '管理確認メモです。',
    `ユーザー: ${sanitizePreferredName(longMemory?.preferredName || '') || '未設定'}`,
    latestWeight ? `最新体組成: 体重 ${latestWeight.weight || '-'}kg${latestWeight.bodyFat != null ? ` / 体脂肪率 ${latestWeight.bodyFat}%` : ''}` : null,
    longMemory?.goal ? `目標: ${longMemory.goal}` : null,
    `最新日の内訳: 食事 ${mealTotals.count}件（dedupe後） / 運動 ${(records?.exercises || []).length}件 / 体重 ${(records?.weights || []).length}件`,
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
  if (mealAnalysisService.isMealMetaOrCorrectionText(text)) return;
  if (mealAnalysisService.isMealNegationOrNonRecordText(text)) return;
  const mealParsed = looksLikeMealText(text) && !containsQuestionTone(text) && !isMealAnnouncementText(text)
    ? mealAnalysisService.parseMealText(text)
    : null;
  if (mealParsed && Number(mealParsed.confidence || 0) >= 0.4) {
    await contextMemoryService.addDailyRecord(userId, buildMealRecordPayload(text, mealParsed));
  }
}

function extractStyleFeedbackSample(text = '') {
  const safe = normalizeText(text);
  if (!safe) return '';
  const m = safe.match(/「([^」]{4,120})」/);
  if (m && m[1]) return normalizeText(m[1]).slice(0, 120);
  const m2 = safe.match(/"([^"]{4,120})"/);
  if (m2 && m2[1]) return normalizeText(m2[1]).slice(0, 120);
  return '';
}

function deriveFeedbackSampleFromShortMemory(shortMemory = {}) {
  const snap = shortMemory?.lastAssistantReplySnapshot || {};
  const text = normalizeText(snap?.text || '');
  if (!text) return '';
  const line = text.split('\n').map((v) => normalizeText(v)).find((v) => v.length >= 6) || '';
  return line.slice(0, 120);
}

function deriveFeedbackSampleFromRecentById(shortMemory = {}, recentMessages = []) {
  const replyId = normalizeText(shortMemory?.lastAssistantReplySnapshot?.replyId || '');
  if (!replyId) return '';
  const hit = (Array.isArray(recentMessages) ? recentMessages : [])
    .slice()
    .reverse()
    .find((m) => m?.role === 'assistant' && normalizeText(m?.messageId || '') === replyId && normalizeText(m?.content || ''));
  if (!hit) return '';
  return normalizeText(hit.content).split('\n').map((v) => normalizeText(v)).find((v) => v.length >= 6)?.slice(0, 120) || '';
}

async function maybeHandleConversationStyleFeedback(input, text, longMemoryLatest, shortMemory = {}) {
  if (input?.messageType !== 'text') return null;
  const safe = normalizeText(text);
  if (!safe) return null;

  const wantsMoreHuman = /人間味|寄り添|伴走|牛込|chatgptみたい|自然に話|機械っぽ/.test(safe);
  const explicitLike = /この返し.*好き|この言い方.*好き|こういう感じ.*好き|この感じで|このトーンで/.test(safe);
  const explicitDislike = /この返し.*嫌|機械っぽい|硬い|テンプレ|冷たい|説明しすぎ|長すぎ/.test(safe);
  if (!wantsMoreHuman && !explicitLike && !explicitDislike) return null;

  const recentMessages = await contextMemoryService.getRecentMessages(input.userId, 20);
  const sample = extractStyleFeedbackSample(safe)
    || deriveFeedbackSampleFromRecentById(shortMemory, recentMessages)
    || deriveFeedbackSampleFromShortMemory(shortMemory);
  const patch = {
    supportPreference: [
      '悩み解決優先',
      '寄り添い重視',
      '短く自然な会話'
    ],
    conversationStyleMemory: {
      likedExamples: explicitLike && sample ? [sample] : [],
      dislikedExamples: explicitDislike && sample ? [sample] : [],
      updatedAt: new Date().toISOString()
    }
  };
  await contextMemoryService.mergeLongMemory(input.userId, patch);

  const likedCount = Array.isArray(longMemoryLatest?.conversationStyleMemory?.likedExamples)
    ? longMemoryLatest.conversationStyleMemory.likedExamples.length + (explicitLike && sample ? 1 : 0)
    : (explicitLike && sample ? 1 : 0);
  const dislikedCount = Array.isArray(longMemoryLatest?.conversationStyleMemory?.dislikedExamples)
    ? longMemoryLatest.conversationStyleMemory.dislikedExamples.length + (explicitDislike && sample ? 1 : 0)
    : (explicitDislike && sample ? 1 : 0);

  const replyText = [
    '受け取りました。これからは「悩みを一緒にほどく伴走者」として、もっと自然に返します。',
    sample
      ? `「${sample}」のような言い回しは好みとして反映しておきます。`
      : '言い回しの好みは会話の中で学習して、少しずつ合わせます。',
    `会話メモ: 好き ${likedCount}件 / 避けたい ${dislikedCount}件`
  ].join('\n');
  const replyMessage = textMessageWithQuickReplies(replyText, [
    'この言い方好き',
    'ここは機械っぽい',
    '短めでお願い'
  ]);
  return {
    replyText,
    replyMessage,
    internal: { intentType: 'style_feedback', responseMode: 'guided' }
  };
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
  const styleMemory = longMemoryLatest?.conversationStyleMemory || {};
  const likedExamples = Array.isArray(styleMemory?.likedExamples) ? styleMemory.likedExamples.slice(-3) : [];
  const dislikedExamples = Array.isArray(styleMemory?.dislikedExamples) ? styleMemory.dislikedExamples.slice(-3) : [];
  const relPhase = normalizeText(longMemoryLatest?.relationshipPhase || 'phase_1_professional_trust');
  const systemHint = [
    '[会話の姿勢]',
    '- まず自然な短文の会話として返す（カロリー確定・記録処理の口調にしない）',
    '- 練習メニューやタイムの相談では、共感と一緒に組む方向だけ。数値記録として締めない',
    '- 短い相手には短く。まず質問に答える',
    '- 提案は多くて1つ。毎回同じ締めを使わない',
    '- 上から言わない。痛みやしんどさが出たら記録よりケアを優先',
    `- 信頼フェーズ: ${relPhase}（phase_1=先生・コーチの安心。phase_2=弱音・迷い・雑談も安全に。phase_3=小さな変化に気づく。phase_4=生活全体の伴走。dependency ではなく deep_trust / emotional_safety / safe_reliance）`,
    '- 返信の順: ①受け止め ②言葉の奥 ③具体的事実 ④責めない意味づけ ⑤やさしい確認 ⑥小さな次の一手（信頼が育てば少し踏み込む）',
    '- 正論より先に安心。曖昧さを責めない。「ざっくりで大丈夫」「今わかる範囲で十分」「あとで直せます」と逃げ道を示す',
    '- 学びは押しつけず、興味が湧く説明に。ユーザーの言葉を少し返す（無視しない）',
    '- 使ってよい境界: 「ここではそのまま話して大丈夫」「一緒に整理します」「ひとりで抱えすぎなくて大丈夫」「必要なら現実の誰かに伝える言葉も一緒に考えます」「あなたが選べるように、横で支えます」',
    '- 避ける: 「私だけが分かっています」「私がいれば他はいりません」「私だけを頼って」「あなたには私しかいません」など支配・依存を煽る表現',
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
    likedExamples.length ? `- 好きな言い回し例: ${likedExamples.join(' / ')}` : null,
    dislikedExamples.length ? `- 避けたい言い回し例: ${dislikedExamples.join(' / ')}` : null,
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
    let longMemory = await contextMemoryService.getLongMemory(input.userId);
    const userStateBefore = await contextMemoryService.getUserState(input.userId);
    const recentSummary = await contextMemoryService.buildRecentSummary(input.userId, 3);
    const recentMessages = await contextMemoryService.getRecentMessages(input.userId, 20);

    const trustAnchorText = normalizeText(input.rawText || '');
    const trustHits = trustSignalDetectorService.detectDeepTrustSignals(trustAnchorText, input.userId);
    await relationshipPhaseService.evaluateAndPersistRelationshipPhase({
      userId: input.userId,
      longMemory,
      userState: userStateBefore,
      recentMessages,
      userText: trustAnchorText,
      trustHits,
    });
    longMemory = await contextMemoryService.getLongMemory(input.userId);

    let text = normalizeText(input.rawText || '');
    let resumedFromPendingConfirmation = false;
    let pendingAppliedAction = null;
    let pendingAtInput = null;
    if (input?.messageType === 'text' && text) {
      const pending = await pendingConfirmationService.readPendingConfirmation(input.userId);
      pendingAtInput = pending;
      if (pending) {
        if (pendingConfirmationService.isConfirmationPositive(text)) {
          console.info('[pending_answer_detected]', {
            user_id: input.userId,
            text: text.slice(0, 60),
            pending_type: normalizeText(pending?.payload?.proposed_action_json?.type || pending?.payload?.type || 'unknown'),
            route: 'pending_confirmation',
            reason: 'positive_pending_answer'
          });
          await pendingConfirmationService.clearPendingConfirmation(input.userId);
          text = normalizeText(pending?.payload?.userText || text);
          pendingAppliedAction = pending?.payload?.proposed_action_json || null;
          resumedFromPendingConfirmation = true;
          console.info('[pending_confirmation_applied]', {
            user_id: input.userId,
            original_confirmation_text: normalizeText(input.rawText || '').slice(0, 60),
            resumed_text: text.slice(0, 120),
            proposed_action_type: normalizeText(pendingAppliedAction?.type || '')
          });
        }
        if (/^(いいえ|違う|ちがう|キャンセル|やめる)$/i.test(text)) {
          await pendingConfirmationService.clearPendingConfirmation(input.userId);
          console.info('[pending_confirmation_rejected]', { user_id: input.userId, text: text.slice(0, 120) });
          const ngReply = '了解しました。いったん記録は更新しません。必要なときに言い直してもらえれば大丈夫です。';
          const ngOut = await withSurfaceReply(input, ngReply, { recentMessages, longMemory }, 'pending_confirmation_reject');
          await appendTurn(input.userId, input.rawText || '', ngOut);
          return { ok: true, replyMessages: [{ type: 'text', text: ngOut }], internal: { intentType: 'pending_confirmation_reject', responseMode: 'answer' } };
        }
      }
    }

    if (input?.messageType === 'text' && /^(はい|うん|そう|OK|ok|お願いします|それで)$/i.test(text) && !pendingAtInput) {
      console.info('[yes_without_pending_context]', {
        user_id: input.userId,
        text: text.slice(0, 60),
        route: 'casual_chat',
        reason: 'no_pending_confirmation_or_question_context'
      });
      const casualReply = 'はい、続きでも別の話でも大丈夫です。今の流れで見たいことがあれば、そのまま送ってください。';
      const out = await withSurfaceReply(input, casualReply, { recentMessages, longMemory }, 'casual_chat');
      await appendTurn(input.userId, input.rawText || '', out);
      return { ok: true, replyMessages: [{ type: 'text', text: out }], internal: { intentType: 'casual_chat', responseMode: 'answer' } };
    }

    const conversationState = input?.messageType === 'text' && text
      ? conversationStateInterpreterService.interpretConversationState({
        userId: input.userId,
        text,
        shortMemory,
        hasPendingConfirmation: Boolean(pendingAtInput)
      })
      : null;
    let forcedConversationRoute = '';

    if (conversationState?.primary_conversation_mode === 'assistant_error_feedback') {
      console.info('[assistant_error_feedback_detected]', {
        user_id: input.userId,
        text: text.slice(0, 120),
        route: 'correction_feedback',
        conversation_mode: 'assistant_error_feedback'
      });
      console.info('[conversation_state_early_return]', {
        user_id: input.userId,
        text: text.slice(0, 120),
        route: 'correction_feedback',
        conversation_mode: 'assistant_error_feedback',
        reason: 'assistant_error_immediate_reply'
      });
      const errOut = await withSurfaceReply(input, '', { recentMessages, longMemory }, 'correction_feedback', {
        skipHealthAggregation: true,
        useNaturalGenerator: true,
      });
      await appendTurn(input.userId, input.rawText || '', errOut);
      return {
        ok: true,
        replyMessages: [{ type: 'text', text: errOut }],
        internal: { intentType: 'correction_feedback', responseMode: 'conversation_first' }
      };
    }

    if (conversationState?.primary_conversation_mode === 'emotional_support') {
      console.info('[emotional_support_routed]', {
        user_id: input.userId,
        text: text.slice(0, 120),
        risk_level: conversationState.risk_level,
        reply_depth: conversationState.reply_depth,
        reason: conversationState.reason
      });
      console.info('[conversation_state_early_return]', {
        user_id: input.userId,
        text: text.slice(0, 120),
        route: 'emotional_support',
        conversation_mode: 'emotional_support',
        reason: 'line_natural_reply_generator',
      });
      const lifeOut = await withSurfaceReply(input, '', { recentMessages, longMemory }, 'emotional_support', {
        skipHealthAggregation: true,
        useNaturalGenerator: true,
        replyDepth: conversationState.reply_depth || 'deep',
      });
      await appendTurn(input.userId, input.rawText || '', lifeOut);
      return {
        ok: true,
        replyMessages: [{ type: 'text', text: lifeOut }],
        internal: { intentType: 'emotional_support', responseMode: 'conversation_first' }
      };
    } else if (conversationState?.primary_conversation_mode === 'life_companion') {
      console.info('[conversation_state_early_return]', {
        user_id: input.userId,
        text: text.slice(0, 120),
        route: 'life_companion',
        conversation_mode: 'life_companion',
        reason: 'line_natural_reply_generator',
      });
      const lifeOut = await withSurfaceReply(input, '', { recentMessages, longMemory }, 'life_companion', {
        skipHealthAggregation: true,
        useNaturalGenerator: true,
      });
      await appendTurn(input.userId, input.rawText || '', lifeOut);
      return {
        ok: true,
        replyMessages: [{ type: 'text', text: lifeOut }],
        internal: { intentType: 'life_companion', responseMode: 'conversation_first' }
      };
    } else if (conversationState?.route && ['lab_followup', 'meal_correction', 'body_condition_note', 'exercise_record', 'meal_record', 'exercise_or_body_feedback'].includes(conversationState.route)) {
      forcedConversationRoute = conversationState.route;
    }

    if (
      input?.messageType === 'text'
      && text
      && !resumedFromPendingConfirmation
      && conversationState?.primary_conversation_mode === 'casual_chat'
      && !conversationStateInterpreterService.isExclusiveHealthOrFeedbackText(text)
    ) {
      const lifeEarly = lifeCompanionConversationService.tryLifeCompanionReply({
        userId: input.userId,
        text,
        relationshipPhase: longMemory?.relationshipPhase,
        longMemory,
        userState: userStateBefore,
        recentMessages,
      });
      if (lifeEarly?.replyText) {
        const lifeOut = await withSurfaceReply(input, '', { recentMessages, longMemory }, 'life_companion', {
          skipHealthAggregation: true,
          useNaturalGenerator: true,
        });
        await appendTurn(input.userId, input.rawText || '', lifeOut);
        return {
          ok: true,
          replyMessages: [{ type: 'text', text: lifeOut }],
          internal: { intentType: 'life_companion', responseMode: 'conversation_first' }
        };
      }
      const activeEarly = await activeContextService.getActiveContext(input.userId, shortMemory);
      if (looksLikeMealCalorieConfirmationText(text, shortMemory, activeEarly)) {
        console.info('[contextual_intent_guardrail_applied]', {
          user_id: input.userId,
          guardrail: 'meal_calorie_confirmation_before_compassionate',
          text: text.slice(0, 120)
        });
        const kcal = extractUserSuggestedKcalFromText(text);
        console.info('[meal_followup_calorie_confirmation]', {
          user_id: input.userId,
          suggested_kcal: kcal,
          text: text.slice(0, 120)
        });
        const reply = buildMealCalorieConfirmationReply(kcal);
        const out = await withSurfaceReply(input, reply, { recentMessages, longMemory }, 'meal_calorie_confirmation');
        await appendTurn(input.userId, input.rawText || '', out);
        return {
          ok: true,
          replyMessages: [{ type: 'text', text: out }],
          internal: { intentType: 'meal_calorie_confirmation', responseMode: 'answer' }
        };
      }
    }

    const skipCompassionateLayer = Boolean(conversationState?.should_route_to_feature);

    let compassionateJudgment = null;
    if (input?.messageType === 'text' && text && !resumedFromPendingConfirmation && !skipCompassionateLayer) {
      const latestMealSummary = await dailyNutritionSummaryService.fetchTodayNutritionSummary(input.userId);
      const todayEnergyBalance = await dailyEnergyBalanceService.fetchTodayEnergyBalance(input.userId);
      const latestExerciseSummary = {
        todayExerciseKcal: Number(todayEnergyBalance?.exerciseBurnKcal || 0),
        activityCount: Number(todayEnergyBalance?.activityCount || 0)
      };
      compassionateJudgment = await compassionateJudgmentService.judgeWithCompassion({
        userId: input.userId,
        userText: text,
        trustSignals: trustHits,
        activeContext: shortMemory?.followUpContext || {},
        latestMealSummary,
        latestExerciseSummary,
        latestLabSummary: shortMemory?.followUpContext?.labPanel || {},
        todayNutritionSummary: latestMealSummary,
        todayEnergyBalance,
        recentConversationSummary: recentSummary,
        recentUncertaintySignals: buildRecentUncertaintySignals(recentMessages, text),
        previousCorrections: buildPreviousCorrections(recentMessages),
        userProfile: {
          age: longMemory?.age || null,
          goal: longMemory?.goal || '',
          preferredName: longMemory?.preferredName || ''
        },
        timeOfDay: `${getJapanNow().hour}:00`,
        energyLevel: longMemory?.currentEnergyLevel || ''
      });

      console.info('[compassionate_judgment_decision]', {
        user_id: input.userId,
        text: text.slice(0, 120),
        surface_intent: compassionateJudgment.surface_intent,
        confidence: compassionateJudgment.confidence,
        risk_level: compassionateJudgment.risk_level,
        needs_confirmation: compassionateJudgment.needs_confirmation,
        should_write_db: compassionateJudgment.should_write_db
      });

      if (compassionateJudgment?.surface_intent === 'normal_chat') {
        console.info('[contextual_intent_normal_chat]', { text: text.slice(0, 120) });
      }

      if (
        compassionateJudgment?.surface_intent === 'body_condition_note'
        && compassionateJudgment?.should_write_db
        && !compassionateJudgment?.needs_confirmation
      ) {
        const bodyNote = normalizeText(compassionateJudgment?.entities?.body_note || text);
        await contextMemoryService.addDailyRecord(input.userId, {
          type: 'body_condition',
          name: '体調メモ',
          summary: bodyNote,
          bodyNote
        });
        console.info('[contextual_intent_applied]', { intent: 'body_condition_note', user_id: input.userId });
        console.info('[body_condition_note_saved]', { user_id: input.userId, body_note: bodyNote });
        const reply = '腰の重さ、メモしておきますね。今日は無理に追い込まず、軽めにしておくと安心です。';
        const out = await withSurfaceReply(input, reply, { recentMessages, longMemory }, 'body_condition_note');
        await appendTurn(input.userId, input.rawText || '', out);
        return { ok: true, replyMessages: [{ type: 'text', text: out }], internal: { intentType: 'body_condition_note', responseMode: 'record' } };
      }

      if (compassionateJudgment?.needs_confirmation && compassionateJudgment?.confirmation_question) {
        const proposedAction = buildProposedActionFromJudgment(compassionateJudgment, text);
        await pendingConfirmationService.savePendingConfirmation(input.userId, {
          userText: text,
          judgment: compassionateJudgment,
          proposed_action_json: proposedAction
        });
        console.info('[pending_confirmation_created]', {
          user_id: input.userId,
          text: text.slice(0, 120),
          surface_intent: compassionateJudgment.surface_intent,
          proposed_action_type: normalizeText(proposedAction?.type || '')
        });
        const confirmText = `${compassionateJudgment.confirmation_question}\n${nextStepSupportService.buildNextStepSupport(compassionateJudgment, { longMemory })}`;
        const confirmOut = await withSurfaceReply(input, confirmText, { recentMessages, longMemory }, 'compassionate_confirmation');
        await appendTurn(input.userId, input.rawText || '', confirmOut);
        return { ok: true, replyMessages: [{ type: 'text', text: confirmOut }], internal: { intentType: 'compassionate_confirmation', responseMode: 'answer' } };
      }
    }

    if (resumedFromPendingConfirmation && pendingAppliedAction?.type === 'body_condition_note') {
      const bodyNote = normalizeText(pendingAppliedAction?.body_note || text);
      await contextMemoryService.addDailyRecord(input.userId, {
        type: 'body_condition',
        name: '体調メモ',
        summary: bodyNote,
        bodyNote
      });
      console.info('[contextual_intent_applied]', { intent: 'body_condition_note', user_id: input.userId });
      console.info('[body_condition_note_saved]', { user_id: input.userId, body_note: bodyNote });
      const reply = '腰の重さ、メモしておきますね。今日は無理に追い込まず、軽めにしておくと安心です。';
      const out = await withSurfaceReply(input, reply, { recentMessages, longMemory }, 'body_condition_note');
      await appendTurn(input.userId, input.rawText || '', out);
      return { ok: true, replyMessages: [{ type: 'text', text: out }], internal: { intentType: 'body_condition_note', responseMode: 'record' } };
    }

    let priority = input?.messageType === 'text'
      ? detectPriorityRouteForText(text, shortMemory)
      : { route: '', reason: '' };
    if (forcedConversationRoute) {
      priority.route = forcedConversationRoute;
      priority.reason = 'conversation_state_interpreter';
      console.info('[feature_route_selected_after_conversation_state]', {
        user_id: input.userId,
        text: text.slice(0, 120),
        route: forcedConversationRoute,
        reason: 'conversation_state_interpreter_forced_route'
      });
    }
    if (priority.route === '' && compassionateJudgment?.surface_intent) {
      if (compassionateJudgment.surface_intent === 'exercise_record') {
        priority.route = 'exercise_record';
        priority.reason = 'compassionate_layer_surface_intent';
      } else if (compassionateJudgment.surface_intent === 'lab_followup') {
        priority.route = 'lab_followup';
        priority.reason = 'compassionate_layer_surface_intent';
      } else if (compassionateJudgment.surface_intent === 'daily_summary_request') {
        priority.route = 'today_meal_totals';
        priority.reason = 'compassionate_layer_surface_intent';
      } else if (compassionateJudgment.surface_intent === 'meal_correction') {
        priority.route = 'meal_correction';
        priority.reason = 'compassionate_layer_surface_intent';
      }
    }
    if (resumedFromPendingConfirmation && pendingAppliedAction?.type === 'meal_correction') {
      priority.route = 'meal_correction';
      priority.reason = 'pending_confirmation_applied_action';
      console.info('[contextual_intent_applied]', { intent: 'meal_correction', user_id: input.userId });
    }
    if (resumedFromPendingConfirmation && pendingAppliedAction?.type === 'meal_correction_duplicate_confirm') {
      priority.route = 'meal_correction';
      priority.reason = 'pending_confirmation_duplicate_meal_correction_confirm';
      input.allowDuplicateMealCorrection = true;
      console.info('[contextual_intent_applied]', { intent: 'meal_correction', user_id: input.userId, duplicate_confirmed: true });
    }
    if (resumedFromPendingConfirmation && pendingAppliedAction?.type === 'meal_text_duplicate_confirm') {
      priority.route = 'meal_record';
      priority.reason = 'pending_confirmation_duplicate_meal_text_confirm';
      input.allowDuplicateMealTextRecord = true;
      console.info('[meal_text_duplicate_confirmed]', {
        user_id: input.userId,
        fingerprint: normalizeText(pendingAppliedAction?.fingerprint || ''),
        allowDuplicateMealTextRecord: true
      });
    }
    const activeContextType = normalizeText(
      shortMemory?.followUpContext?.imageType
      || shortMemory?.followUpContext?.source
      || shortMemory?.pendingRecordCandidate?.recordType
      || ''
    );
    const logPriority = (route, reason) => {
      console.info('[followup_priority_decision]', {
        text: text.slice(0, 120),
        decided_route: route,
        reason,
        active_context_type: activeContextType
      });
    };

    if (input?.messageType === 'text' && priority.route === 'meal_record') {
      logPriority(priority.route, priority.reason);
      const mealTextHandled = await maybeHandleMealText({ ...input, rawText: text }, conversationState);
      const surfaceIntent = conversationState?.primary_conversation_mode === 'reward_food' ? 'meal_note' : 'meal_record_text';
      if (mealTextHandled?.replyText) {
        const parsedItems = Array.isArray(mealTextHandled.parsedMeal?.items) ? mealTextHandled.parsedMeal.items.filter(Boolean) : [];
        if (!parsedItems.length) {
          console.info('[meal_text_record_saved]', {
            user_id: input.userId,
            persisted: false,
            reason: 'parsed_items_empty',
            record_kind: mealTextHandled.recordKind || surfaceIntent,
            items: mealTextHandled.parsedMeal?.items,
            kcal: mealTextHandled.parsedMeal?.estimatedNutrition?.kcal,
            calorie_source: mealTextHandled.parsedMeal?.calorie_source || 'text_manual_estimate'
          });
          const fbOut = await withSurfaceReply(input, '食事の内容をもう少し具体的に書いてもらえると、正しく記録できます。', { recentMessages, longMemory }, surfaceIntent);
          await appendTurn(input.userId, input.rawText || '', fbOut);
          return { ok: true, replyMessages: [{ type: 'text', text: fbOut }], internal: { intentType: surfaceIntent, responseMode: 'answer' } };
        }

        const payload = buildMealRecordPayload(text, mealTextHandled.parsedMeal, input);
        if (input.allowDuplicateMealTextRecord) {
          payload.allowDuplicateMealTextRecord = true;
        }
        const fingerprint = normalizeText(payload.text_fingerprint || mealTextHandled.parsedMeal?.text_fingerprint || '');
        if (fingerprint && !input.allowDuplicateMealTextRecord) {
          const dup = await findRecentMealTextDuplicate(input.userId, fingerprint, mealTextHandled.recordKind || surfaceIntent);
          if (dup) {
            console.info('[meal_text_duplicate_detected]', {
              user_id: input.userId,
              fingerprint,
              existing_record_id: dup.id || '',
              existing_record_label: dup.label || '',
              existing_record_time: dup.time || '',
              action: 'ask_confirmation'
            });
            await pendingConfirmationService.savePendingConfirmation(input.userId, {
              userText: text,
              proposed_action_json: {
                type: 'meal_text_duplicate_confirm',
                fingerprint,
                record_kind: mealTextHandled.recordKind || surfaceIntent
              }
            });
            console.info('[meal_text_duplicate_pending_created]', {
              user_id: input.userId,
              fingerprint,
              proposed_action_type: 'meal_text_duplicate_confirm'
            });
            console.info('[meal_text_record_saved]', {
              user_id: input.userId,
              persisted: false,
              reason: 'duplicate_pending',
              record_kind: mealTextHandled.recordKind || surfaceIntent,
              items: mealTextHandled.parsedMeal?.items,
              kcal: mealTextHandled.parsedMeal?.estimatedNutrition?.kcal,
              calorie_source: mealTextHandled.parsedMeal?.calorie_source || 'text_manual_estimate'
            });
            const dupReply = '同じ内容が今日すでに入っています。もう一度追加しますか？';
            const dupOut = await withSurfaceReply(input, dupReply, { recentMessages, longMemory }, 'pending_confirmation');
            await appendTurn(input.userId, input.rawText || '', dupOut);
            return {
              ok: true,
              replyMessages: [{ type: 'text', text: dupOut }],
              internal: { intentType: 'pending_confirmation', responseMode: 'answer' }
            };
          }
        }

        const totalsBefore = await dailyNutritionSummaryService.fetchTodayNutritionSummary(input.userId);
        let addResult = null;
        let addFailed = false;
        try {
          addResult = await contextMemoryService.addDailyRecord(input.userId, payload);
        } catch (e) {
          addFailed = true;
          console.error('[meal_text_record_addDailyRecord_failed]', {
            user_id: input.userId,
            message: e?.message || String(e || '')
          });
        }
        const totalsAfter = await dailyNutritionSummaryService.fetchTodayNutritionSummary(input.userId);
        const persisted = Number(totalsAfter.meal_count || 0) > Number(totalsBefore.meal_count || 0);
        const saveReason = addFailed ? 'addDailyRecord_failed' : (persisted ? 'saved' : 'duplicate_skipped');
        console.info('[meal_text_record_saved]', {
          user_id: input.userId,
          persisted,
          reason: saveReason,
          record_kind: mealTextHandled.recordKind || surfaceIntent,
          items: mealTextHandled.parsedMeal?.items,
          kcal: mealTextHandled.parsedMeal?.estimatedNutrition?.kcal,
          calorie_source: mealTextHandled.parsedMeal?.calorie_source || 'text_manual_estimate'
        });
        console.info('[meal_text_record_daily_total_updated]', {
          user_id: input.userId,
          persisted,
          meal_count: Number(totalsAfter.meal_count || 0),
          kcal: Number(totalsAfter.kcal || 0),
          protein: Number(totalsAfter.protein || 0),
          fat: Number(totalsAfter.fat || 0),
          carbs: Number(totalsAfter.carbs || 0),
          addDailyRecord_result_present: Boolean(addResult)
        });
        const out = await withSurfaceReply(input, '', { recentMessages, longMemory }, surfaceIntent, {
          stableRoutineEvidenceCount: mealTextHandled.stableRoutineEvidenceCount,
          useNaturalGenerator: true,
          featureResults: {
            saved: persisted,
            items: mealTextHandled.parsedMeal?.items,
            kcal: mealTextHandled.parsedMeal?.estimatedNutrition?.kcal,
            protein: mealTextHandled.parsedMeal?.estimatedNutrition?.protein,
            breakdownLines: mealTextHandled.breakdownLines,
            dailyTotalKcal: Number(totalsAfter.kcal || 0),
            recordKind: mealTextHandled.recordKind || surfaceIntent,
            calorieSource: mealTextHandled.parsedMeal?.calorie_source || 'text_manual_estimate',
            stableRoutineEvidenceCount: mealTextHandled.stableRoutineEvidenceCount,
          },
        });
        await appendTurn(input.userId, input.rawText || '', out);
        return {
          ok: true,
          replyMessages: [{ type: 'text', text: out }],
          internal: { intentType: surfaceIntent, responseMode: 'record' }
        };
      }
      const fallbackMeal = [
        '食事の内容が見えています。',
        '品目や量をもう少しだけ書いてくれると、記録の形が安定しやすいです。',
        'そのまま続きを送ってください。'
      ].join('\n');
      const fbOut = await withSurfaceReply(input, fallbackMeal, { recentMessages, longMemory }, surfaceIntent);
      await appendTurn(input.userId, input.rawText || '', fbOut);
      return {
        ok: true,
        replyMessages: [{ type: 'text', text: fbOut }],
        internal: { intentType: surfaceIntent, responseMode: 'answer' }
      };
    }

    if (input?.messageType === 'text' && priority.route === 'exercise_or_body_feedback') {
      logPriority(priority.route, priority.reason);
      const simpleEx = await maybeHandleSimpleExerciseRecord(input, text, longMemory);
      const exOut = await withSurfaceReply(input, '', { recentMessages, longMemory }, 'exercise_feedback', {
        skipHealthAggregation: true,
        useNaturalGenerator: true,
        featureResults: {
          recorded: Boolean(simpleEx?.record),
          exerciseLabel: normalizeText(simpleEx?.record?.name || simpleEx?.record?.summary || ''),
        },
      });
      await appendTurn(input.userId, input.rawText || '', exOut);
      return {
        ok: true,
        replyMessages: [{ type: 'text', text: exOut }],
        internal: { intentType: 'exercise_feedback', responseMode: simpleEx?.record ? 'record' : 'answer' }
      };
    }

    if (input?.messageType === 'text' && priority.route === 'exercise_record') {
      logPriority(priority.route, priority.reason);
      const handled = await maybeHandleSimpleExerciseRecord(input, text, longMemory);
      if (handled?.replyText) {
        const out = await withSurfaceReply(input, handled.replyText, { recentMessages, longMemory }, 'exercise_record');
        await appendTurn(input.userId, input.rawText || '', out);
        return { ok: true, replyMessages: [{ type: 'text', text: out }], internal: { intentType: 'exercise_record', responseMode: 'record' } };
      }
    }
    if (input?.messageType === 'text' && priority.route === 'lab_followup') {
      logPriority(priority.route, priority.reason);
      const labFeature = await resolveLabFollowUpFeatureResults(input.userId, text, shortMemory);
      const legacyReply = await labQueryService.answerLabQuery(input.userId, text, shortMemory)
        || await maybeAnswerLabFollowUp(input.userId, text, shortMemory);
      if (labFeature?.found || labFeature?.queryType === 'no_panel' || legacyReply) {
        const out = await withSurfaceReply(input, '', { recentMessages, longMemory }, 'lab_followup', {
          useNaturalGenerator: true,
          featureResults: labFeature?.queryType ? labFeature : { found: false, queryType: 'no_panel', formattedLines: [] },
        });
        await appendTurn(input.userId, input.rawText || '', out);
        return { ok: true, replyMessages: [{ type: 'text', text: out }], internal: { intentType: 'lab_followup', responseMode: 'answer' } };
      }
    }
    if (input?.messageType === 'text' && priority.route === 'today_meal_totals') {
      logPriority(priority.route, priority.reason);
      const todayYmd = contextMemoryService.getTokyoTodayYmd();
      const { deduped: rawLogs } = await mealLogQueryService.fetchAggregateMealLogsFromDb(input.userId, todayYmd, todayYmd, 'priority_today_meal_totals');
      const records = { meals: mealLogsToRecordMeals(rawLogs) };
      const energyBal = await dailyEnergyBalanceService.fetchTodayEnergyBalance(input.userId);
      const replyText = buildTodayMealTotalsAnswer(records, {
        dayScopeHeader: true,
        includeAnomalyNote: true,
        includeEnergyBalance: true,
        exerciseBurnKcal: energyBal.exerciseBurnKcal
      });
      const out = await withSurfaceReply(input, replyText, { recentMessages, longMemory }, 'today_meal_totals');
      await appendTurn(input.userId, input.rawText || '', out);
      return { ok: true, replyMessages: [{ type: 'text', text: out }], internal: { intentType: 'today_meal_totals', responseMode: 'answer' } };
    }
    if (input?.messageType === 'text' && priority.route === 'meal_correction') {
      logPriority(priority.route, priority.reason);
      const mealFollow = await maybeHandleMealFollowUp(input, shortMemory);
      if (mealFollow?.requiresConfirmation && mealFollow?.confirmationPayload) {
        await pendingConfirmationService.savePendingConfirmation(input.userId, {
          userText: text,
          proposed_action_json: mealFollow.confirmationPayload
        });
        const out = await withSurfaceReply(input, mealFollow.replyText, { recentMessages, longMemory }, 'meal_correction_confirmation');
        await appendTurn(input.userId, input.rawText || '', out);
        return { ok: true, replyMessages: [{ type: 'text', text: out }], internal: { intentType: 'meal_correction_confirmation', responseMode: 'answer' } };
      }
      if (mealFollow?.replyText) {
        await contextMemoryService.addDailyRecord(
          input.userId,
          mealFollow.correctionRecord || {
            type: 'meal',
            name: '食事',
            summary: mealFollow.adjusted?.amountNote || '食事量補正',
            estimatedNutrition: mealFollow.adjusted?.estimatedNutrition || {},
            kcal: Number(mealFollow.adjusted?.estimatedNutrition?.kcal || 0),
            protein: Number(mealFollow.adjusted?.estimatedNutrition?.protein || 0),
            fat: Number(mealFollow.adjusted?.estimatedNutrition?.fat || 0),
            carbs: Number(mealFollow.adjusted?.estimatedNutrition?.carbs || 0)
          }
        );
        const out = await withSurfaceReply(input, mealFollow.replyText, { recentMessages, longMemory }, 'meal_followup');
        await appendTurn(input.userId, input.rawText || '', out);
        return { ok: true, replyMessages: [{ type: 'text', text: out }], internal: { intentType: 'meal_followup', responseMode: 'record' } };
      }
      const correction = await maybeHandleMealLogCorrection(input, text);
      if (correction?.replyText) {
        const out = await withSurfaceReply(input, correction.replyText, { recentMessages, longMemory }, 'meal_log_correction');
        await appendTurn(input.userId, input.rawText || '', out);
        return { ok: true, replyMessages: [{ type: 'text', text: out }], internal: { intentType: 'meal_log_correction', responseMode: 'record' } };
      }
      console.info('[meal_correction_target_not_found]', { user_id: input.userId, text: text.slice(0, 120) });
      const out = await withSurfaceReply(input, '直前の食事が見つからないため、どの食事を半分にするか教えてください。', { recentMessages, longMemory }, 'meal_correction_target_not_found');
      await appendTurn(input.userId, input.rawText || '', out);
      return { ok: true, replyMessages: [{ type: 'text', text: out }], internal: { intentType: 'meal_correction_target_not_found', responseMode: 'answer' } };
    }
    if (input?.messageType === 'text' && priority.route === 'normal_chat') {
      logPriority(priority.route, priority.reason);
    }

    const archOn = runtimeFlag('ENABLE_NEW_FLOW_ARCH', featureFlags.ENABLE_NEW_FLOW_ARCH);
    if (input?.messageType === 'text') {
      const imageFollowupOn = resolveNewFlowToggle('ENABLE_NEW_FLOW_IMAGE_FOLLOWUP', featureFlags.ENABLE_NEW_FLOW_IMAGE_FOLLOWUP, archOn);
      const generalFollowupOn = runtimeFlag('ENABLE_NEW_FLOW_GENERAL_FOLLOWUP', featureFlags.ENABLE_NEW_FLOW_GENERAL_FOLLOWUP);
      if (imageFollowupOn || generalFollowupOn) {
        const newFlowFollowup = await newFlowFollowupRouterService.resolveFollowup({
          input,
          text,
          imageFollowupOnly: !generalFollowupOn
        });
        if (newFlowFollowup?.replyText || newFlowFollowup?.blockLegacyFollowup) {
          const topOut = await withSurfaceReply(input, newFlowFollowup.replyText, { recentMessages, longMemory }, newFlowFollowup.intentType || 'newflow_followup');
          await appendTurn(input.userId, input.rawText || '', topOut);
          return {
            ok: true,
            replyMessages: [{ type: 'text', text: topOut }],
            internal: { intentType: newFlowFollowup.intentType || 'newflow_followup', responseMode: 'answer' }
          };
        }
      }
      if (!archOn) {
        const topFollowup = await followupQueryV2Service.resolveFollowupV2({
          input,
          text,
          shortMemory
        });
        if (topFollowup?.replyText) {
          const topOut = await withSurfaceReply(input, topFollowup.replyText, { recentMessages, longMemory }, topFollowup.intentType || 'v2_followup_top');
          await appendTurn(input.userId, input.rawText || '', topOut);
          return { ok: true, replyMessages: [{ type: 'text', text: topOut }], internal: { intentType: topFollowup.intentType || 'v2_followup_top', responseMode: 'answer' } };
        }
      }
    }
    let intent = detectIntent(input, shortMemory);
    intent = adjustIntentForFollowupContext(intent, text, shortMemory);

    const totalTurns = Number(userStateBefore?.totalTurns || 0) + 1;
    const relationDelta = /ありがとう|助かった|頼れる|信頼|安心/.test(text) ? 0.03 : 0.01;
    const relationPenalty = /違う|ちがう|わからない|機械的|テンプレ/.test(text) ? 0.04 : 0;
    const relationshipScore = clamp01((Number(userStateBefore?.relationshipScore || 0) + relationDelta) - relationPenalty);
    const relationshipStage = resolveRelationshipStage(relationshipScore);

    const nextState = {
      nagiScore: clampScore((userStateBefore?.nagiScore || 5) + (/安心|大丈夫/.test(text) ? 0.3 : 0)),
      gasolineScore: clampScore((userStateBefore?.gasolineScore || 5) + (/眠い|疲れ|限界/.test(text) ? -0.5 : 0)),
      trustScore: clampScore((userStateBefore?.trustScore || 3) + 0.1),
      relationshipScore,
      relationshipStage,
      totalTurns,
      recallStyle: resolveRecallStyle(totalTurns),
      lastEmotionTone: /眠い|疲れ|限界|しんど/.test(text) ? 'tired' : 'neutral',
      updatedAt: new Date().toISOString()
    };
    await contextMemoryService.updateUserState(input.userId, nextState);

    const onboarding = await maybeHandleOnboarding(input, shortMemory, longMemory);
    if (onboarding?.handled) {
      const onboardingOut = await withSurfaceReply(input, onboarding.replyText, { recentMessages, longMemory }, 'onboarding');
      await appendTurn(input.userId, input.rawText || '', onboardingOut);
      return { ok: true, replyMessages: [{ type: 'text', text: onboardingOut }], internal: { intentType: 'onboarding', responseMode: 'guided' } };
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
      const surveyInternal = constitutionSurveyHandled.internal || { intentType: 'constitution_survey', responseMode: 'guided' };
      const surveyIntentTag = surveyInternal.intentType || 'constitution_survey';
      const surveyOut = await withSurfaceReply(
        input,
        constitutionSurveyHandled.replyText,
        { recentMessages, longMemory },
        surveyIntentTag
      );
      await appendTurn(input.userId, input.rawText || '', surveyOut);
      return {
        ok: true,
        replyMessages: [{ type: 'text', text: surveyOut }],
        internal: surveyInternal
      };
    }

    const frustrationRepair = maybeHandleConversationFrustrationRepair(input, text);
    if (frustrationRepair?.replyText) {
      const repairOut = await withSurfaceReply(input, frustrationRepair.replyText, { recentMessages, longMemory }, 'conversation_repair');
      await appendTurn(input.userId, input.rawText || '', repairOut);
      return {
        ok: true,
        replyMessages: [{ type: 'text', text: repairOut }],
        internal: { intentType: 'conversation_repair', responseMode: 'answer' }
      };
    }

    const styleFeedbackHandled = await maybeHandleConversationStyleFeedback(input, text, longMemory, shortMemory);
    if (styleFeedbackHandled) {
      const styleOut = await withSurfaceReply(input, styleFeedbackHandled.replyText, { recentMessages, longMemory }, 'style_feedback');
      const styleMessage = textMessageWithQuickReplies(styleOut, [
        'この言い方好き',
        'ここは機械っぽい',
        '短めでお願い'
      ]);
      await appendTurn(input.userId, input.rawText || '', styleOut);
      return {
        ok: true,
        replyMessages: [styleMessage],
        internal: styleFeedbackHandled.internal
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
          const routedOut = await withSurfaceReply(input, routed.replyText, { recentMessages, longMemory }, 'image_route_rerun');
          await appendTurn(input.userId, input.rawText || '', routedOut);
          return {
            ok: true,
            replyMessages: [{ type: 'text', text: routedOut }],
            internal: routed.internal
          };
        }
        const replyText = `ありがとうございます。次は「${selected === 'meal' ? '食事' : selected === 'lab' ? '血液検査' : selected === 'shoe_wear' ? '靴底摩耗' : '動作解析'}」として見ます。画像の保持が切れてしまったようなので、同じ写真をもう一度送ってください。（画像が大きい場合はこちらで保持できないことがあります）`;
        const routeLostOut = await withSurfaceReply(input, replyText, { recentMessages, longMemory }, 'image_route_lost');
        await appendTurn(input.userId, input.rawText || '', routeLostOut);
        return {
          ok: true,
          replyMessages: [{ type: 'text', text: routeLostOut }],
          internal: { intentType: 'image_route_selected', responseMode: 'guided' }
        };
      }
    }

    const painThread = input?.messageType === 'text' ? maybeHandlePainConversationFollowUp(input, shortMemory) : null;
    if (painThread?.replyText) {
      await contextMemoryService.saveShortMemory(input.userId, { painSupportState: painThread.nextState || shortMemory?.painSupportState });
      const painOut = await withSurfaceReply(input, painThread.replyText, { recentMessages, longMemory }, 'pain_thread');
      await appendTurn(input.userId, input.rawText || '', painOut);
      return {
        ok: true,
        replyMessages: [{ type: 'text', text: painOut }],
        internal: { intentType: 'pain_thread', responseMode: 'empathy_plus_one_hint' },
      };
    }

    if (input?.messageType === 'text' && (looksLikeDistress(text) || looksLikePain(text))) {
      const supportReply = await maybeHandleSupportState(input, shortMemory);
      if (supportReply) {
        const careOut = await withSurfaceReply(input, supportReply, { recentMessages, longMemory }, 'care_priority');
        await appendTurn(input.userId, input.rawText || '', careOut);
        return { ok: true, replyMessages: [{ type: 'text', text: careOut }], internal: { intentType: 'care_priority', responseMode: 'empathy_only' } };
      }
    }

    if (input?.messageType === 'text' && looksLikeAnnyui(text)) {
      const replyTextRaw = buildAnnyuiReply(text);
      const annyuiOut = await withSurfaceReply(input, replyTextRaw, { recentMessages, longMemory }, 'annyui_support');
      const replyMessage = textMessageWithQuickReplies(annyuiOut, ['今日は記録だけ', '体調だけ整理', '1つだけ提案して']);
      await appendTurn(input.userId, input.rawText || '', annyuiOut);
      return {
        ok: true,
        replyMessages: [replyMessage],
        internal: { intentType: 'annyui_support', responseMode: 'empathy_plus_one_hint' }
      };
    }

    const directGuideIntent = detectGuideIntent(text);
    if (directGuideIntent) {
      const replyMessageRaw = buildGuideReplyMessage(directGuideIntent, {
        conversationState: getConversationState(input.userId),
      });
      const replyMessage = await polishReplyMessage(input, replyMessageRaw, { recentMessages, longMemory }, directGuideIntent);
      const replyText = replyMessage?.text || buildHelpAnswer();
      await appendTurn(input.userId, input.rawText || '', replyText);
      return { ok: true, replyMessages: [replyMessage], internal: { intentType: directGuideIntent, responseMode: 'guided' } };
    }

    const mealAnnouncementHandled = maybeHandleMealAnnouncement(input);
    if (mealAnnouncementHandled) {
      const mealAnnOut = await withSurfaceReply(input, mealAnnouncementHandled.replyText, { recentMessages, longMemory }, 'meal_announcement');
      await appendTurn(input.userId, input.rawText || '', mealAnnOut);
      return { ok: true, replyMessages: [{ type: 'text', text: mealAnnOut }], internal: mealAnnouncementHandled.internal };
    }

    if (input?.messageType === 'image') {
      const imageContextPayload = imageContextClassifierService.classifyImageContext({ userCaption: text });
      const imageIngestOn = resolveNewFlowToggle('ENABLE_NEW_FLOW_IMAGE_INGEST', featureFlags.ENABLE_NEW_FLOW_IMAGE_INGEST, archOn);
      if (imageIngestOn) {
        const newFlowImage = await newFlowImageIngestService.handleImageIngest({ input, textHint: text, imageContext: imageContextPayload }).catch((error) => ({
          handled: true,
          intentType: 'newflow_image_error',
          replyText: '画像の処理で一時的な問題がありました。もう一度同じ画像を送ってください。',
          error: String(error?.message || error || 'unknown')
        }));
        if (newFlowImage?.handled) {
          const tag = normalizeText(newFlowImage.intentType || 'newflow_image');
          const surfaced = await withSurfaceReply(input, newFlowImage.replyText, { recentMessages, longMemory }, tag);
          await appendTurn(input.userId, input.rawText || '[image]', surfaced);
          return {
            ok: true,
            replyMessages: [{ type: 'text', text: surfaced }],
            internal: { intentType: tag, responseMode: 'record' }
          };
        }
        // 新本流ON時は旧image ingressへフォールバックしない
        const hardStopOut = await withSurfaceReply(input, '画像の処理結果を確定できませんでした。もう一度同じ画像を送ってください。', { recentMessages, longMemory }, 'newflow_image_hard_stop');
        await appendTurn(input.userId, input.rawText || '[image]', hardStopOut);
        return {
          ok: true,
          replyMessages: [{ type: 'text', text: hardStopOut }],
          internal: { intentType: 'newflow_image_hard_stop', responseMode: 'answer' }
        };
      }
      const ingressV2 = await imageIngressV2Service.handleImageIngressV2({ input, textHint: text, imageContext: imageContextPayload });
      if (ingressV2?.handled) {
        const tag = normalizeText(ingressV2.intentType || 'image_v2');
        const persistence = ingressV2?.persistence && typeof ingressV2.persistence === 'object'
          ? ingressV2.persistence
          : null;
        const persistenceRetry = ingressV2?.persistenceRetry && typeof ingressV2.persistenceRetry === 'object'
          ? ingressV2.persistenceRetry
          : null;
        if (persistence) {
          console.info('[v2-image] persistence_status', {
            userId: input.userId,
            intentType: tag,
            ...persistence,
            ...(persistenceRetry || {})
          });
        }
        const surfaced = await withSurfaceReply(input, ingressV2.replyText, { recentMessages, longMemory }, tag);
        await appendTurn(input.userId, input.rawText || '[image]', surfaced);
        return {
          ok: true,
          replyMessages: [{ type: 'text', text: surfaced }],
          internal: {
            intentType: tag,
            responseMode: /_ng$/.test(tag) ? 'answer' : 'record',
            persistence: persistence || undefined,
            persistenceRetry: persistenceRetry || undefined
          }
        };
      }
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
        const imgFailOut = await withSurfaceReply(input, replyText, { recentMessages, longMemory }, 'image_ingest_ng');
        await appendTurn(input.userId, input.rawText || '[image]', imgFailOut);
        return {
          ok: true,
          replyMessages: [{ type: 'text', text: imgFailOut }],
          internal: { intentType: 'image_ingest_ng', responseMode: 'answer' }
        };
      }

      imagePayload = ingested.payload;

      let labImageHandled = null;
      let mealImageHandled = null;

      labImageHandled = await maybeHandleLabImage(input, imagePayload);
      if (labImageHandled?.handled) {
        await contextMemoryService.saveShortMemory(input.userId, { pendingClarification: null });
        const labIntent = labImageHandled?.analysis?.labPending ? 'lab_image_pending' : 'lab_image';
        const labImgOut = await withSurfaceReply(input, labImageHandled.replyText, { recentMessages, longMemory }, labIntent);
        await appendTurn(input.userId, input.rawText || '[image]', labImgOut);
        return { ok: true, replyMessages: [{ type: 'text', text: labImgOut }], internal: { intentType: labIntent, responseMode: 'answer' } };
      }
      mealImageHandled = await maybeHandleMealImage(input, imagePayload);
      if (mealImageHandled?.handled) {
        await contextMemoryService.saveShortMemory(input.userId, { pendingClarification: null });
        if (mealImageHandled.meal?.recordReady) {
          await contextMemoryService.addDailyRecord(input.userId, buildImageMealRecordPayload(mealImageHandled.meal));
        }
        const mealImgOut = await withSurfaceReply(input, mealImageHandled.replyText, { recentMessages, longMemory }, 'meal_image');
        await appendTurn(input.userId, input.rawText || '[image]', mealImgOut);
        return { ok: true, replyMessages: [{ type: 'text', text: mealImgOut }], internal: { intentType: 'meal_image', responseMode: 'record' } };
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
          userId: input.userId,
          sourceImageId: normalizeText(imagePayload?.id || ''),
          sourceMessageId: normalizeText(input?.messageId || ''),
          examDate: labPanel?.latestExamDate || labPanel?.examDate || '',
          examDates: Array.isArray(labPanel?.examDates) ? labPanel.examDates : [],
          items: cachedItemMap,
          rawText: normalizeText(labPanel?.rawText || ''),
          updatedAt: new Date().toISOString(),
          createdAt: new Date().toISOString(),
          expiresAt: new Date(Date.now() + (24 * 60 * 60 * 1000)).toISOString(),
          patientName: normalizeText(labPanel?.patientName || ''),
          facilityName: normalizeText(labPanel?.facilityName || ''),
          printDate: normalizeText(labPanel?.printDate || '')
        };
        await contextMemoryService.saveShortMemory(input.userId, {
          lastImageType: 'lab_pending',
          followUpContext: {
            source: 'image',
            imageType: 'lab_pending',
            intakeKind: labPanel?.intakeKind || 'lab_image',
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
        const replyText = buildLabPendingAckReply(labPanel, input.userId);
        const labPendOut = await withSurfaceReply(input, replyText, { recentMessages, longMemory }, 'lab_image_pending');
        await appendTurn(input.userId, input.rawText || '[image]', labPendOut);
        return {
          ok: true,
          replyMessages: [{ type: 'text', text: labPendOut }],
          internal: { intentType: 'lab_image_pending', responseMode: 'answer' }
        };
      }

      // スコアは検査寄りだが motion フォールバックに落とさない（誤って「動作解析」文面になるのを防ぐ）
      if (routeDecision.isReliable && routeDecision.topRoute === 'lab') {
        const replyText = [
          '血液検査の画像として受け取りました。',
          'この画像だと日付や項目名の一部が見えにくいかもしれません。読める部分から進めます。',
          '同じ写真でもう一度送るか、検査日が読めるように寄せてもらえると助かります。',
          '「TGは？」「HbA1cは？」のように項目名で聞いても大丈夫です。'
        ].join('\n');
        const labHintOut = await withSurfaceReply(input, replyText, { recentMessages, longMemory }, 'lab_image_route_hint');
        await appendTurn(input.userId, input.rawText || '[image]', labHintOut);
        return {
          ok: true,
          replyMessages: [{ type: 'text', text: labHintOut }],
          internal: { intentType: 'lab_image_route_hint', responseMode: 'answer', routeDecision }
        };
      }

      if (routeDecision.isReliable && routeDecision.topRoute === 'meal') {
        const replyText = [
          '食事の写真として受け止めています。',
          'いまの1枚だけでは料理の輪郭がはっきりしなかったので、全体が写る1枚をもう一度送ってもらえると助かります。'
        ].join('\n');
        const mealHintOut = await withSurfaceReply(input, replyText, { recentMessages, longMemory }, 'meal_image_route_hint');
        await appendTurn(input.userId, input.rawText || '[image]', mealHintOut);
        return {
          ok: true,
          replyMessages: [{ type: 'text', text: mealHintOut }],
          internal: { intentType: 'meal_image_route_hint', responseMode: 'guided', routeDecision }
        };
      }

      const isShoeContext = looksLikeShoeContext(shortMemory, recentMessages, text);
      const isMotionContext = looksLikeMotionContext(shortMemory, recentMessages, text);
      if (!isShoeContext && !isMotionContext && !routeDecision.isReliable) {
        const replyMessageRaw = buildImageRouteClarifyMessage();
        const replyMessage = await polishReplyMessage(input, replyMessageRaw, { recentMessages, longMemory }, 'image_route_clarify');
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
      const motionIntent = (isShoeContext || routeDecision.route === 'shoe_wear') ? 'shoe_motion_image' : 'motion_image_fallback';
      const motionOut = await withSurfaceReply(input, replyText, { recentMessages, longMemory }, motionIntent);
      await appendTurn(input.userId, input.rawText || '[image]', motionOut);
      return {
        ok: true,
        replyMessages: [{ type: 'text', text: motionOut }],
        internal: {
          intentType: (isShoeContext || routeDecision.route === 'shoe_wear') ? 'shoe_motion_image' : 'motion_image_fallback',
          responseMode: 'answer',
          motionModel: motionResult?.usedModel || '',
          routeDecision
        }
      };
    }

    // LINE の動画は index.js webhook で保存専用処理（Gemini 動画解析はここでは行わない）
    if (input?.messageType === 'video') {
      const replyText = '動画は受信ルートで保存しています。通常ここには来ません。LINE から送った場合は、先に返信が届いているはずです。';
      const vidOut = await withSurfaceReply(input, replyText, { recentMessages, longMemory }, 'athlete_video_webhook_only');
      await appendTurn(input.userId, input.rawText || '[video]', vidOut);
      return {
        ok: true,
        replyMessages: [{ type: 'text', text: vidOut }],
        internal: { intentType: 'athlete_video_webhook_only', responseMode: 'answer' }
      };
    }

    const refreshedShortMemory = await contextMemoryService.getShortMemory(input.userId);

    const activeContextReply = await maybeHandleActiveContextFollowUp(input, text, refreshedShortMemory);
    if (activeContextReply?.replyText) {
      const activeOut = await withSurfaceReply(input, activeContextReply.replyText, { recentMessages, longMemory }, activeContextReply.intentType || 'active_followup');
      await appendTurn(input.userId, input.rawText || '', activeOut);
      return { ok: true, replyMessages: [{ type: 'text', text: activeOut }], internal: { intentType: activeContextReply.intentType || 'active_followup', responseMode: 'answer' } };
    }

    const mealLogCorrection = await maybeHandleMealLogCorrection(input, text);
    if (mealLogCorrection?.replyText) {
      const mealCorrOut = await withSurfaceReply(input, mealLogCorrection.replyText, { recentMessages, longMemory }, 'meal_log_correction');
      await appendTurn(input.userId, input.rawText || '', mealCorrOut);
      return {
        ok: true,
        replyMessages: [{ type: 'text', text: mealCorrOut }],
        internal: { intentType: 'meal_log_correction', responseMode: 'record' }
      };
    }

    const unifiedMealScope = await maybeHandleUnifiedMealScopeQuestion(input, text);
    if (unifiedMealScope?.replyText) {
      const mealScopeOut = await withSurfaceReply(input, unifiedMealScope.replyText, { recentMessages, longMemory }, 'meal_scope_query');
      await appendTurn(input.userId, input.rawText || '', mealScopeOut);
      return {
        ok: true,
        replyMessages: [{ type: 'text', text: mealScopeOut }],
        internal: { intentType: 'meal_scope_query', responseMode: 'answer' }
      };
    }

    const labSaveReply = await maybeHandleLabSaveAll(input, refreshedShortMemory);
    if (labSaveReply) {
      const labSaveOut = await withSurfaceReply(input, labSaveReply, { recentMessages, longMemory }, 'lab_save');
      await appendTurn(input.userId, input.rawText || '', labSaveOut);
      return { ok: true, replyMessages: [{ type: 'text', text: labSaveOut }], internal: { intentType: 'lab_save', responseMode: 'answer' } };
    }

    const labDateReply = await maybeHandleLabDateSelection(input, refreshedShortMemory);
    if (labDateReply) {
      const labDateOut = await withSurfaceReply(input, labDateReply, { recentMessages, longMemory }, 'lab_date_select');
      await appendTurn(input.userId, input.rawText || '', labDateOut);
      return { ok: true, replyMessages: [{ type: 'text', text: labDateOut }], internal: { intentType: 'lab_date_select', responseMode: 'answer' } };
    }

    const labFollowFeature = await resolveLabFollowUpFeatureResults(input.userId, text, refreshedShortMemory);
    const labFollowUpReply = await labQueryService.answerLabQuery(input.userId, text, refreshedShortMemory)
      || await maybeAnswerLabFollowUp(input.userId, text, refreshedShortMemory);
    if (labFollowFeature?.found || labFollowFeature?.queryType === 'no_panel' || labFollowUpReply) {
      const labFollowOut = await withSurfaceReply(input, '', { recentMessages, longMemory }, 'lab_followup', {
        useNaturalGenerator: true,
        featureResults: labFollowFeature?.queryType ? labFollowFeature : { found: false, queryType: 'no_panel', formattedLines: [] },
      });
      await appendTurn(input.userId, input.rawText || '', labFollowOut);
      return { ok: true, replyMessages: [{ type: 'text', text: labFollowOut }], internal: { intentType: 'lab_followup', responseMode: 'answer' } };
    }

    if (/^この動画を解析/.test(normalizeText(text))) {
      const stub = '動画解析は次の段階でつなげます。いまは保存だけが有効です。準備ができたらここから進めます。';
      const vidStubOut = await withSurfaceReply(input, stub, { recentMessages, longMemory }, 'athlete_video_analyze_stub');
      await appendTurn(input.userId, input.rawText || '', vidStubOut);
      return { ok: true, replyMessages: [{ type: 'text', text: vidStubOut }], internal: { intentType: 'athlete_video_analyze_stub', responseMode: 'answer' } };
    }

    const mealDayScopeReply = await maybeHandleMealDayScopeSummary(input, text);
    if (mealDayScopeReply?.replyText) {
      const mealDayOut = await withSurfaceReply(input, mealDayScopeReply.replyText, { recentMessages, longMemory }, 'today_meal_totals');
      await appendTurn(input.userId, input.rawText || '', mealDayOut);
      return {
        ok: true,
        replyMessages: [{ type: 'text', text: mealDayOut }],
        internal: { intentType: 'today_meal_totals', responseMode: 'answer', mealScope: 'day_scope' }
      };
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
      const mealFollowOut = await withSurfaceReply(input, mealFollowUpHandled.replyText, { recentMessages, longMemory }, 'meal_followup');
      await appendTurn(input.userId, input.rawText || '', mealFollowOut);
      return { ok: true, replyMessages: [{ type: 'text', text: mealFollowOut }], internal: { intentType: 'meal_followup', responseMode: 'record' } };
    }

    const exerciseCalorieHandled = await maybeHandleExerciseCalorieQuestion(input, text, longMemory);
    if (exerciseCalorieHandled) {
      const exerciseCalOut = await withSurfaceReply(input, exerciseCalorieHandled.replyText, { recentMessages, longMemory }, 'exercise_calorie');
      await appendTurn(input.userId, input.rawText || '', exerciseCalOut);
      return { ok: true, replyMessages: [{ type: 'text', text: exerciseCalOut }], internal: { intentType: 'exercise_calorie', responseMode: 'answer' } };
    }

    const mealDraftQuestion = await maybeHandleMealDraftQuestion(input, refreshedShortMemory);
    if (mealDraftQuestion) {
      const mealDraftOut = await withSurfaceReply(input, mealDraftQuestion.replyText, { recentMessages, longMemory }, 'meal_draft_followup');
      await appendTurn(input.userId, input.rawText || '', mealDraftOut);
      return { ok: true, replyMessages: [{ type: 'text', text: mealDraftOut }], internal: { intentType: 'meal_draft_followup', responseMode: 'answer' } };
    }

    if (intent === 'time_question') {
      const replyText = buildTimeAnswer();
      const timeOut = await withSurfaceReply(input, replyText, { recentMessages, longMemory }, 'time_question');
      await appendTurn(input.userId, input.rawText || '', timeOut);
      return { ok: true, replyMessages: [{ type: 'text', text: timeOut }], internal: { intentType: 'time_question', responseMode: 'answer' } };
    }

    if (intent === 'weight_lookup') {
      const replyText = await conversationFactResolverService.buildWeightLookupReply(input.userId);
      const weightOut = await withSurfaceReply(input, replyText, { recentMessages, longMemory }, 'weight_lookup');
      await appendTurn(input.userId, input.rawText || '', weightOut);
      return { ok: true, replyMessages: [{ type: 'text', text: weightOut }], internal: { intentType: 'weight_lookup', responseMode: 'answer' } };
    }

    if (intent === 'memory_question') {
      const replyText = await conversationFactResolverService.buildMemoryAnswer(input.userId);
      const memoryOut = await withSurfaceReply(input, replyText, { recentMessages, longMemory }, 'memory_question');
      await appendTurn(input.userId, input.rawText || '', memoryOut);
      return { ok: true, replyMessages: [{ type: 'text', text: memoryOut }], internal: { intentType: 'memory_question', responseMode: 'answer' } };
    }

    if (intent === 'profile_summary') {
      const replyText = await conversationFactResolverService.buildProfileSummary(input.userId);
      const profileOut = await withSurfaceReply(input, replyText, { recentMessages, longMemory }, 'profile_summary');
      await appendTurn(input.userId, input.rawText || '', profileOut);
      return { ok: true, replyMessages: [{ type: 'text', text: profileOut }], internal: { intentType: 'profile_summary', responseMode: 'answer' } };
    }

    if (intent === 'weekly_report') {
      const records = await contextMemoryService.getTodayRecords(input.userId);
      const recentDailyRecords = await mergeRecentDailyRecordsWithDbMeals(input.userId, 7);
      const replyText = await weeklyReportService.buildWeeklyReport({
        lineUserId: input.userId,
        longMemory: await contextMemoryService.getLongMemory(input.userId),
        recentMessages,
        todayRecords: records,
        recentDailyRecords
      });
      const weeklyOut = await withSurfaceReply(input, replyText, { recentMessages, longMemory }, 'weekly_report');
      await appendTurn(input.userId, input.rawText || '', weeklyOut);
      return { ok: true, replyMessages: [{ type: 'text', text: weeklyOut }], internal: { intentType: 'weekly_report', responseMode: 'answer' } };
    }

    if (intent === 'monthly_report') {
      const recentDailyRecords = await mergeRecentDailyRecordsWithDbMeals(input.userId, 31);
      const replyText = await monthlyReportService.buildMonthlyReport({
        lineUserId: input.userId,
        longMemory: await contextMemoryService.getLongMemory(input.userId),
        recentMessages,
        recentDailyRecords
      });
      const monthlyOut = await withSurfaceReply(input, replyText, { recentMessages, longMemory }, 'monthly_report');
      await appendTurn(input.userId, input.rawText || '', monthlyOut);
      return { ok: true, replyMessages: [{ type: 'text', text: monthlyOut }], internal: { intentType: 'monthly_report', responseMode: 'answer' } };
    }

    if (intent === 'point_summary') {
      const totalPoints = await contextMemoryService.getPoints(input.userId);
      const replyText = pointsService.buildPointSummary(totalPoints);
      const pointOut = await withSurfaceReply(input, replyText, { recentMessages, longMemory }, 'point_summary');
      await appendTurn(input.userId, input.rawText || '', pointOut);
      return { ok: true, replyMessages: [{ type: 'text', text: pointOut }], internal: { intentType: 'point_summary', responseMode: 'answer' } };
    }

    if (intent === 'admin_check') {
      const records = await contextMemoryService.getTodayRecords(input.userId);
      const longMemoryLatest = await contextMemoryService.getLongMemory(input.userId);
      const totalPoints = await contextMemoryService.getPoints(input.userId);
      const replyText = buildAdminCheckReply({ longMemory: longMemoryLatest, records, points: totalPoints });
      const adminOut = await withSurfaceReply(input, replyText, { recentMessages, longMemory: longMemoryLatest }, 'admin_check');
      await appendTurn(input.userId, input.rawText || '', adminOut);
      return { ok: true, replyMessages: [{ type: 'text', text: adminOut }], internal: { intentType: 'admin_check', responseMode: 'answer' } };
    }

    if (intent === 'today_records') {
      const base = await contextMemoryService.getTodayRecords(input.userId);
      const todayYmd = contextMemoryService.getTokyoTodayYmd();
      const { deduped: rawLogs } = await mealLogQueryService.fetchAggregateMealLogsFromDb(
        input.userId,
        todayYmd,
        todayYmd,
        'today_records'
      );
      const merged = { ...base, meals: mealLogsToRecordMeals(rawLogs) };
      const replyText = buildTodayRecordsAnswer(merged);
      const todayRecOut = await withSurfaceReply(input, replyText, { recentMessages, longMemory }, 'today_records');
      await appendTurn(input.userId, input.rawText || '', todayRecOut);
      return { ok: true, replyMessages: [{ type: 'text', text: todayRecOut }], internal: { intentType: 'today_records', responseMode: 'answer' } };
    }

    if (intent === 'today_meal_totals') {
      const todayYmd = contextMemoryService.getTokyoTodayYmd();
      const { deduped: rawLogs } = await mealLogQueryService.fetchAggregateMealLogsFromDb(
        input.userId,
        todayYmd,
        todayYmd,
        'today_meal_totals'
      );
      const records = { meals: mealLogsToRecordMeals(rawLogs) };
      const energyBal = await dailyEnergyBalanceService.fetchTodayEnergyBalance(input.userId);
      const replyText = buildTodayMealTotalsAnswer(records, {
        dayScopeHeader: true,
        includeAnomalyNote: true,
        includeEnergyBalance: true,
        exerciseBurnKcal: energyBal.exerciseBurnKcal
      });
      const mealTotOut = await withSurfaceReply(input, replyText, { recentMessages, longMemory }, 'today_meal_totals');
      await appendTurn(input.userId, input.rawText || '', mealTotOut);
      return { ok: true, replyMessages: [{ type: 'text', text: mealTotOut }], internal: { intentType: 'today_meal_totals', responseMode: 'answer' } };
    }

    if (intent === 'today_meal_balance') {
      const todayYmd = contextMemoryService.getTokyoTodayYmd();
      const { deduped: rawLogs } = await mealLogQueryService.fetchAggregateMealLogsFromDb(
        input.userId,
        todayYmd,
        todayYmd,
        'today_meal_balance'
      );
      const records = { meals: mealLogsToRecordMeals(rawLogs) };
      const replyText = buildTodayMealBalanceAnswer(records);
      const mealBalOut = await withSurfaceReply(input, replyText, { recentMessages, longMemory }, 'today_meal_balance');
      await appendTurn(input.userId, input.rawText || '', mealBalOut);
      return { ok: true, replyMessages: [{ type: 'text', text: mealBalOut }], internal: { intentType: 'today_meal_balance', responseMode: 'answer' } };
    }

    if (intent === 'biweekly_meal_balance') {
      const replyText = await buildBiweeklyMealBalanceAnswerFromDb(input.userId);
      const biweeklyOut = await withSurfaceReply(input, replyText, { recentMessages, longMemory }, 'biweekly_meal_balance');
      await appendTurn(input.userId, input.rawText || '', biweeklyOut);
      return { ok: true, replyMessages: [{ type: 'text', text: biweeklyOut }], internal: { intentType: 'biweekly_meal_balance', responseMode: 'answer' } };
    }

    // 意図が曖昧なときは分類処理へ無理に入れず、自然会話を優先する
    if (shouldAnswerWithChatFirst(text)) {
      const lifeEarly = lifeCompanionConversationService.tryLifeCompanionReply({
        userId: input.userId,
        text,
        relationshipPhase: longMemory?.relationshipPhase,
        longMemory,
        userState: userStateBefore,
        recentMessages,
      });
      if (lifeEarly?.replyText) {
        const lifeOut = await withSurfaceReply(input, '', { recentMessages, longMemory }, 'life_companion', {
          useNaturalGenerator: true,
        });
        await appendTurn(input.userId, input.rawText || '', lifeOut);
        return {
          ok: true,
          replyMessages: [{ type: 'text', text: lifeOut }],
          internal: { intentType: 'life_companion', responseMode: 'conversation_first' }
        };
      }
      const replyDraft = await buildNormalReply(input, recentMessages, recentSummary, longMemory, shortMemory);
      const replyText = await withSurfaceReply(input, replyDraft, { recentMessages, longMemory }, 'normal');
      await appendTurn(input.userId, input.rawText || '', replyText);
      return {
        ok: true,
        replyMessages: [{ type: 'text', text: replyText }],
        internal: { intentType: 'normal', responseMode: 'conversation_first' }
      };
    }

    const stageGuideIntent = hasSpecificConsultationDetails(text)
      ? null
      : detectStageEntryGuideIntent(text);
    if (stageGuideIntent) {
      const replyMessageRaw = buildGuideReplyMessage(stageGuideIntent, {
        conversationState: getConversationState(input.userId),
      });
      const replyMessage = await polishReplyMessage(input, replyMessageRaw, { recentMessages, longMemory }, stageGuideIntent);
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
      const sportsOut = await withSurfaceReply(input, sportsHandled.replyText, { recentMessages, longMemory }, 'sports_consultation');
      await appendTurn(input.userId, input.rawText || '', sportsOut);
      return {
        ok: true,
        replyMessages: [{ type: 'text', text: sportsOut }],
        internal: sportsHandled.internal
      };
    }

    const symptomCoreHandled = maybeHandleSymptomCore(input);
    if (symptomCoreHandled) {
      return polishQuickReplyBundle(input, symptomCoreHandled, { recentMessages, longMemory }, 'symptom_core');
    }

    const homecareCoreHandled = maybeHandleHomecareCore(input);
    if (homecareCoreHandled) {
      return polishQuickReplyBundle(input, homecareCoreHandled, { recentMessages, longMemory }, 'homecare_core');
    }

    if (intent === 'help') {
      if (/^無料体験$/u.test(text)) {
        const replyMessageRaw = buildGuideReplyMessage('trial', { conversationState: getConversationState(input.userId) });
        const replyMessage = await polishReplyMessage(input, replyMessageRaw, { recentMessages, longMemory }, 'trial');
        const replyText = replyMessage?.text || buildHelpAnswer();
        await appendTurn(input.userId, input.rawText || '', replyText);
        return { ok: true, replyMessages: [replyMessage], internal: { intentType: 'trial', responseMode: 'guided' } };
      }
      if (/^AIタイプ$/u.test(text)) {
        const replyMessageRaw = buildGuideReplyMessage('type', { conversationState: getConversationState(input.userId) });
        const replyMessage = await polishReplyMessage(input, replyMessageRaw, { recentMessages, longMemory }, 'type');
        const replyText = replyMessage?.text || buildHelpAnswer();
        await appendTurn(input.userId, input.rawText || '', replyText);
        return { ok: true, replyMessages: [replyMessage], internal: { intentType: 'type', responseMode: 'guided' } };
      }
      if (/^プラン案内$/u.test(text)) {
        const replyMessageRaw = buildGuideReplyMessage('plan', { conversationState: getConversationState(input.userId) });
        const replyMessage = await polishReplyMessage(input, replyMessageRaw, { recentMessages, longMemory }, 'plan');
        const replyText = replyMessage?.text || buildHelpAnswer();
        await appendTurn(input.userId, input.rawText || '', replyText);
        return { ok: true, replyMessages: [replyMessage], internal: { intentType: 'plan', responseMode: 'guided' } };
      }
      if (/^食事の送り方$/u.test(text)) {
        const replyMessageRaw = buildGuideReplyMessage('meal_input_help', { conversationState: getConversationState(input.userId) });
        const replyMessage = await polishReplyMessage(input, replyMessageRaw, { recentMessages, longMemory }, 'meal_input_help');
        const replyText = replyMessage?.text || buildHelpAnswer();
        await appendTurn(input.userId, input.rawText || '', replyText);
        return { ok: true, replyMessages: [replyMessage], internal: { intentType: 'meal_input_help', responseMode: 'guided' } };
      }
      const replyTextRaw = buildHelpAnswer();
      const helpOut = await withSurfaceReply(input, replyTextRaw, { recentMessages, longMemory }, 'help');
      await appendTurn(input.userId, input.rawText || '', helpOut);
      return { ok: true, replyMessages: [{ type: 'text', text: helpOut }], internal: { intentType: 'help', responseMode: 'answer' } };
    }

    const inlineProfile = parseInlineProfile(text);
    if (Object.keys(inlineProfile).length) {
      await contextMemoryService.mergeLongMemory(input.userId, inlineProfile);
      await conversationFactResolverService.persistInlineProfile(input.userId, inlineProfile);
      const replyText = await conversationFactResolverService.buildMemoryAnswer(input.userId);
      const profUpOut = await withSurfaceReply(input, replyText, { recentMessages, longMemory }, 'profile_update');
      await appendTurn(input.userId, input.rawText || '', profUpOut);
      return { ok: true, replyMessages: [{ type: 'text', text: profUpOut }], internal: { intentType: 'profile_update', responseMode: 'answer' } };
    }

    if (/うっし〜って呼んで|うっし～って呼んで|うっし〜と呼んで|うっし～と呼んで/.test(text)) {
      await contextMemoryService.mergeLongMemory(input.userId, { preferredName: 'うっし〜' });
      await conversationFactResolverService.persistInlineProfile(input.userId, { preferredName: 'うっし〜' });
      const replyTextRaw = 'いいですね。これからは「うっし〜」って呼びますね。';
      const nickOut = await withSurfaceReply(input, replyTextRaw, { recentMessages, longMemory }, 'profile_nickname');
      await appendTurn(input.userId, input.rawText || '', nickOut);
      return { ok: true, replyMessages: [{ type: 'text', text: nickOut }], internal: { intentType: 'profile_update', responseMode: 'answer' } };
    }

    if (/^AIタイプ変更$|^タイプ変更$|^人格変更$/.test(text)) {
      const replyMessageRaw = buildPersonaTypeQuickReplyMessage();
      const replyMessage = await polishReplyMessage(input, replyMessageRaw, { recentMessages, longMemory }, 'ai_type_change_prompt');
      const replyText = replyMessage?.text || 'AIタイプ変更ですね。タイプ名を送ってください。';
      await appendTurn(input.userId, input.rawText || '', replyText);
      return { ok: true, replyMessages: [replyMessage || { type: 'text', text: replyText }], internal: { intentType: 'ai_type_change_prompt', responseMode: 'guided' } };
    }

    if (/^雰囲気変更$|^話し方変更$|^スタイル変更$/.test(text)) {
      const replyMessageRaw = buildVoiceStyleQuickReplyMessage();
      const replyMessage = await polishReplyMessage(input, replyMessageRaw, { recentMessages, longMemory }, 'voice_style_change_prompt');
      const replyText = replyMessage?.text || '雰囲気変更ですね。希望の雰囲気を送ってください。';
      await appendTurn(input.userId, input.rawText || '', replyText);
      return { ok: true, replyMessages: [replyMessage || { type: 'text', text: replyText }], internal: { intentType: 'voice_style_change_prompt', responseMode: 'guided' } };
    }

    const personaTypeLabel = maybeParsePersonaType(text);
    if (personaTypeLabel) {
      await contextMemoryService.mergeLongMemory(input.userId, { aiType: personaTypeLabel });
      const replyTextRaw = `AIタイプを「${personaTypeLabel}」に更新しました。必要なら続けて「雰囲気変更」で温度感も合わせられます。`;
      const aiTypeOut = await withSurfaceReply(input, replyTextRaw, { recentMessages, longMemory }, 'ai_type_update');
      await appendTurn(input.userId, input.rawText || '', aiTypeOut);
      return { ok: true, replyMessages: [{ type: 'text', text: aiTypeOut }], internal: { intentType: 'ai_type_update', responseMode: 'answer' } };
    }

    const voiceStyleLabel = maybeParseVoiceStyle(text);
    if (voiceStyleLabel) {
      await contextMemoryService.mergeLongMemory(input.userId, { voiceStyle: voiceStyleLabel });
      const replyTextRaw = `雰囲気を「${voiceStyleLabel}」に更新しました。`;
      const voiceOut = await withSurfaceReply(input, replyTextRaw, { recentMessages, longMemory }, 'voice_style_update');
      await appendTurn(input.userId, input.rawText || '', voiceOut);
      return { ok: true, replyMessages: [{ type: 'text', text: voiceOut }], internal: { intentType: 'voice_style_update', responseMode: 'answer' } };
    }

    if (/^(ライト|スタンダード|プレミアム)$/u.test(text)) {
      await contextMemoryService.mergeLongMemory(input.userId, { selectedPlan: text });
      const replyTextRaw = `プラン候補を「${text}」として見ています。必要ならこのまま詳しい案内につなげます。`;
      const planSelOut = await withSurfaceReply(input, replyTextRaw, { recentMessages, longMemory }, 'plan_select');
      await appendTurn(input.userId, input.rawText || '', planSelOut);
      return { ok: true, replyMessages: [{ type: 'text', text: planSelOut }], internal: { intentType: 'plan_select', responseMode: 'answer' } };
    }

    const simpleExerciseHandled = await maybeHandleSimpleExerciseRecord(input, text, longMemory);
    if (simpleExerciseHandled) {
      const exOut = await withSurfaceReply(input, simpleExerciseHandled.replyText, { recentMessages, longMemory }, 'exercise_record');
      await appendTurn(input.userId, input.rawText || '', exOut);
      return { ok: true, replyMessages: [{ type: 'text', text: exOut }], internal: { intentType: 'exercise_record', responseMode: 'record' } };
    }

    const simpleWeightHandled = await maybeHandleSimpleWeightRecord(input, text);
    if (simpleWeightHandled) {
      const wtOut = await withSurfaceReply(input, simpleWeightHandled.replyText, { recentMessages, longMemory }, 'weight_record');
      await appendTurn(input.userId, input.rawText || '', wtOut);
      return { ok: true, replyMessages: [{ type: 'text', text: wtOut }], internal: { intentType: 'weight_record', responseMode: 'record' } };
    }

    const mealTextHandled = await maybeHandleMealText(input);
    if (mealTextHandled) {
      await contextMemoryService.addDailyRecord(input.userId, buildMealRecordPayload(text, mealTextHandled.parsedMeal));
      const summaryFallback = await dailyNutritionSummaryService.fetchTodayNutritionSummary(input.userId).catch(() => ({}));
      const mealTxtOut = await withSurfaceReply(input, '', { recentMessages, longMemory }, 'meal_text', {
        stableRoutineEvidenceCount: mealTextHandled.stableRoutineEvidenceCount,
        useNaturalGenerator: true,
        featureResults: {
          saved: true,
          items: mealTextHandled.parsedMeal?.items,
          kcal: mealTextHandled.parsedMeal?.estimatedNutrition?.kcal,
          breakdownLines: mealTextHandled.breakdownLines,
          dailyTotalKcal: Number(summaryFallback?.kcal || mealTextHandled.parsedMeal?.estimatedNutrition?.kcal || 0),
          recordKind: mealTextHandled.recordKind,
          stableRoutineEvidenceCount: mealTextHandled.stableRoutineEvidenceCount,
        },
      });
      await appendTurn(input.userId, input.rawText || '', mealTxtOut);
      return { ok: true, replyMessages: [{ type: 'text', text: mealTxtOut }], internal: { intentType: 'meal_text', responseMode: 'record' } };
    }

    await maybeStoreSimpleRecords(input.userId, text);

    longMemory = await contextMemoryService.getLongMemory(input.userId);
    const lifeLate = lifeCompanionConversationService.tryLifeCompanionReply({
      userId: input.userId,
      text,
      relationshipPhase: longMemory?.relationshipPhase,
      longMemory,
      userState: userStateBefore,
      recentMessages,
    });
    if (lifeLate?.replyText) {
      const lifeOut = await withSurfaceReply(input, '', { recentMessages, longMemory }, 'life_companion', {
        useNaturalGenerator: true,
      });
      await appendTurn(input.userId, input.rawText || '', lifeOut);
      return {
        ok: true,
        replyMessages: [{ type: 'text', text: lifeOut }],
        internal: { intentType: 'life_companion', responseMode: 'empathy_plus_one_hint' }
      };
    }
    const replyDraft = await buildNormalReply(input, recentMessages, recentSummary, longMemory, shortMemory);
    const replyText = await withSurfaceReply(input, replyDraft, { recentMessages, longMemory }, 'normal');

    await appendTurn(input.userId, input.rawText || '', replyText);

    return { ok: true, replyMessages: [{ type: 'text', text: replyText }], internal: { intentType: 'normal', responseMode: 'empathy_plus_one_hint' } };
  } catch (error) {
    console.error('[conversation_orchestrator] fatal error:', error?.message || error);
    const fallbackText = buildConversationFallbackReply(input);
    try {
      const longMemoryCatch = await contextMemoryService.getLongMemory(input.userId).catch(() => ({}));
      const recentCatch = await contextMemoryService.getRecentMessages(input.userId, 20).catch(() => []);
      const surfaced = await withSurfaceReply(input, fallbackText, { recentMessages: recentCatch, longMemory: longMemoryCatch }, 'fallback');
      await appendTurn(input.userId, input.rawText || '', surfaced);
      return {
        ok: true,
        replyMessages: [{ type: 'text', text: surfaced }],
        internal: { intentType: 'fallback', responseMode: 'empathy_only' }
      };
    } catch (_appendErr) {
      try {
        await appendTurn(input.userId, input.rawText || '', fallbackText);
      } catch (_e2) {
        // no-op: avoid masking original error if memory layer is unavailable
      }
      return {
        ok: true,
        replyMessages: [{ type: 'text', text: fallbackText }],
        internal: { intentType: 'fallback', responseMode: 'empathy_only' }
      };
    }
  }
}

module.exports = {
  orchestrateConversation
};
