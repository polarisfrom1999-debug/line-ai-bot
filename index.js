require('dotenv').config();

const express = require('express');
const fs = require('fs');

const { getEnv } = require('./config/env');
const { EXERCISE_WORD_HINTS } = require('./config/constants');
const { supabase } = require('./services/supabase_service');
const { ensureUser, refreshUserById } = require('./services/user_service');
const {
  verifyLineSignature,
  replyMessage,
  getLineImageContent,
  textMessageWithQuickReplies,
} = require('./services/line_service');
const { generateTextOnly } = require('./services/gemini_service');
const {
  analyzeMealPhotoWithGemini,
  normalizeGeminiMealResult,
  analyzeMealTextWithGemini,
  applyMealCorrectionWithGemini,
} = require('./services/gemini_meal_service');
const {
  detectMessageIntent,
  shouldAvoidMealExerciseAutoCapture,
} = require('./services/message_intent_service');
const {
  AI_PERSONA_TYPES,
  PERSONA_LABELS,
  normalizePersonaType,
  getPersonaLabel,
  getPersonaQuickReplyItems,
  getPersonaSystemStyle,
  getPersonaSelectionMessage,
} = require('./services/ai_persona_service');
const {
  parseDisplayName,
  normalizeStoredDisplayName,
  getUserDisplayName,
} = require('./parsers/name_parser');
const {
  parseActivity,
  estimateActivityKcalWithStrength,
} = require('./parsers/activity_parser');
const {
  profileGuideMessage,
  buildProfileUpdatePayload,
  buildProfileReply,
} = require('./services/profile_service');
const {
  buildEnergySummaryText,
} = require('./services/energy_service');
const {
  seemsMealTextCandidate,
  buildMealTextGuide,
} = require('./services/meal_service');
const {
  analyzeMealTextWithAI,
} = require('./services/meal_ai_service');
const {
  analyzeMealImageWithAI,
} = require('./services/meal_image_ai_service');
const {
  applyMealCorrection,
} = require('./services/meal_correction_service');
const {
  CONSULT_MESSAGE,
  isPainLikeText,
  isStretchIntent,
  detectPainArea,
  buildPainSupportResponse,
  buildStretchSupportResponse,
  buildExerciseFollowupQuickReplies,
  buildAdminSymptomSummary,
} = require('./services/pain_support_service');
const {
  buildVideoSupportResponse,
  buildExerciseMenuResponse,
  isVideoIntent,
} = require('./services/video_support_service');
const {
  buildPredictionText,
  isPredictionIntent,
} = require('./services/prediction_service');
const {
  buildLabGraphMessage,
  buildEnergyGraphMessage,
  buildWeightGraphMessage,
  buildGraphMenuQuickReplies,
} = require('./services/graph_service');
const {
  findPanelDateFromInput,
  mapCorrectionLabelToField,
  buildLabDraftSummaryMessage,
  buildLabDateChoiceMessage,
  buildLabCorrectionGuide,
  createEmptyIntakeAnswers,
  renderIntakeStepMessage,
  validateIntakeAnswer,
  buildIntakeProfilePatch,
  buildIntakeProfileSummary,
} = require('./services/lab_intake_service');
const {
  createLabDraftSession,
  getOpenLabDraft,
  setActiveLabCorrection,
  applyLabCorrection,
  confirmLabDraftToResults,
  confirmAllLabDraftToResults,
  getRecentLabResults,
  buildPostSaveComparisonMessage,
  formatDateOnly,
} = require('./blood_test_flow_helpers');
const {
  safeText,
  fmt,
} = require('./utils/formatters');
const {
  toIsoStringInTZ,
  currentDateYmdInTZ,
  addDaysYmd,
  listRecentDatesYmd,
  buildDayRangeIsoInTZ,
  formatJapaneseDateInTZ,
  formatTimeHmInTZ,
  getWeekdayJaInTZ,
} = require('./utils/dates');
const {
  createInitialOnboardingState,
  normalizeUserState,
  isOnboardingActive,
  buildReplyPayload,
  advanceOnboardingState,
  buildOnboardingStatePatch,
  startProfileEditFromUser,
} = require('./services/onboarding_service');
const {
  AI_TYPE_VALUES,
} = require('./config/ai_type_config');
const {
  MEMBERSHIP_STATUS,
  PLAN_TYPES,
  startTrialPatch,
  activatePlanPatch,
  markTrialPlanPromptedPatch,
  markRenewalPromptedPatch,
  shouldPromptTrialPlan,
  shouldPromptRenewal,
  normalizePlanSelection,
  isPlanGuideTrigger,
  isTrialStatusIntent,
  isCurrentPlanIntent,
  buildTrialStartedMessage,
  buildTrialStatusMessage,
  buildCurrentPlanStatusMessage,
  buildPlanSelectedMessage,
  getMembershipStatus,
} = require('./services/trial_membership_service');
const {
  buildTrialReviewMessage,
  buildMonthlyRenewalMessage,
  buildPlanGuideMessageV2,
  buildPauseReasonPrompt,
  buildCancelReasonPrompt,
  buildResumeGuideMessage,
} = require('./services/membership_flow_service');
const {
  isMembershipConfirmIntent,
  isMembershipCancelIntent,
  buildPauseMembershipPatch,
  buildCancelMembershipPatch,
  buildResumeMembershipPatch,
  buildMembershipConfirmMessage,
  buildMembershipCancelMessage,
  getPlanLabel,
} = require('./services/membership_action_service');
const {
  analyzeNewCaptureCandidate,
  isOnboardingStart,
} = require('./services/capture_router_service');
const {
  createPendingCapture,
  hasPendingCapture,
  mergePendingCaptureReply,
  updateUserWithPendingResult,
} = require('./services/pending_capture_service');
const {
  buildInputHelpMessage,
  buildRetrySupportMessage,
  buildPastDateHelpMessage,
} = require('./services/gentle_followup_service');
const {
  buildRewardMessage,
} = require('./services/reward_message_service');
const {
  buildHealthConsultationGuide,
} = require('./services/health_consultation_service');
const {
  buildTypeRecommendationBlock,
  normalizeTypeKey,
  getTypeProfile,
  buildTypeSelectionGuide,
} = require('./services/type_recommendation_service');
const {
  detectGuideIntent,
  buildFirstGuideMessage,
  buildFoodGuideMessage,
  buildExerciseGuideMessage,
  buildWeightGuideMessage,
  buildConsultGuideMessage,
  buildLabGuideMessage,
  buildHelpMenuMessage,
  buildFaqMessage,
} = require('./services/user_guide_service');
const {
  buildTrialMessageExamples,
} = require('./services/trial_message_examples_service');
const {
  analyzeChatCapture,
} = require('./services/chat_capture_service');
let analyzePainText = null;
let generatePainResponse = null;
let looksLikePainConsultation = null;

try {
  const painAdvanced = require('./services/pain_support_service');
  analyzePainText = typeof painAdvanced.analyzePainText === 'function'
    ? painAdvanced.analyzePainText
    : null;
  generatePainResponse = typeof painAdvanced.generatePainResponse === 'function'
    ? painAdvanced.generatePainResponse
    : null;
  looksLikePainConsultation = typeof painAdvanced.looksLikePainConsultation === 'function'
    ? painAdvanced.looksLikePainConsultation
    : null;
} catch (error) {
  console.warn('⚠️ advanced pain support functions are not available:', error?.message || error);
}

let generateWeeklyReportDraft = null;
let generateMonthlyReportDraft = null;

try {
  const reportDraftService = require('./services/report_draft_service');
  generateWeeklyReportDraft = typeof reportDraftService.generateWeeklyReportDraft === 'function'
    ? reportDraftService.generateWeeklyReportDraft
    : null;
  generateMonthlyReportDraft = typeof reportDraftService.generateMonthlyReportDraft === 'function'
    ? reportDraftService.generateMonthlyReportDraft
    : null;
} catch (error) {
  console.warn('⚠️ report_draft_service is not available:', error?.message || error);
}

let createPainAdminMemo = null;
let createReportAdminMemo = null;
let createMembershipAdminMemo = null;

try {
  const adminMemoService = require('./services/admin_memo_service');
  createPainAdminMemo = typeof adminMemoService.createPainAdminMemo === 'function'
    ? adminMemoService.createPainAdminMemo
    : null;
  createReportAdminMemo = typeof adminMemoService.createReportAdminMemo === 'function'
    ? adminMemoService.createReportAdminMemo
    : null;
} catch (error) {
  console.warn('⚠️ admin_memo_service is not available:', error?.message || error);
}

try {
  const membershipAdminMemoService = require('./services/membership_admin_memo_service');
  createMembershipAdminMemo = typeof membershipAdminMemoService.createMembershipAdminMemo === 'function'
    ? membershipAdminMemoService.createMembershipAdminMemo
    : null;
} catch (error) {
  console.warn('⚠️ membership_admin_memo_service is not available:', error?.message || error);
}

let diagnosisService = {};
let diagnosisMembershipFlowService = {};
let diagnosisTrialFlowService = {};
let diagnosisPlanLinks = {};

try {
  diagnosisService = require('./services/diagnosis_service');
} catch (error) {
  console.warn('⚠️ diagnosis_service is not available:', error?.message || error);
}

try {
  diagnosisMembershipFlowService = require('./services/diagnosis_membership_flow_service');
} catch (error) {
  console.warn('⚠️ diagnosis_membership_flow_service is not available:', error?.message || error);
}

try {
  diagnosisTrialFlowService = require('./services/diagnosis_trial_flow_service');
} catch (error) {
  console.warn('⚠️ diagnosis_trial_flow_service is not available:', error?.message || error);
}

try {
  diagnosisPlanLinks = require('./services/diagnosis_plan_links');
} catch (error) {
  console.warn('⚠️ diagnosis_plan_links is not available:', error?.message || error);
}

const env = getEnv();
const app = express();
const PORT = env.PORT;
const TZ = env.TZ;

const AI_PROMPT_PATHS = [
  './prompts/ai_ushigome_prompt.txt',
  './ai_ushigome_prompt.txt',
];
const AI_MEMORY_PROMPT_PATHS = [
  './prompts/ai_ushigome_memory_prompt.txt',
  './ai_ushigome_memory_prompt.txt',
];

const recentMealDrafts = new Map();
const recentSupportContexts = new Map();
const recentCaptureConfirmations = new Map();
const FALLBACK_DIAGNOSIS_QUESTIONS = [
  {
    key: 'goal',
    text: 'まず、今いちばん近い目的はどれですか？',
    options: ['しっかり減量したい', '健康的に整えたい', '痛みや不調も気になる', '本気で人生を変えたい'],
  },
  {
    key: 'pace',
    text: '進め方の希望はどれに近いですか？',
    options: ['まずは気楽に', '少しずつ確実に', 'できれば早めに変えたい', '本気で手厚く進めたい'],
  },
  {
    key: 'support_need',
    text: 'サポートの濃さはどれが合いそうですか？',
    options: ['AIだけで十分', '週の振り返りが欲しい', '手書き報告も欲しい', '毎日しっかり見てほしい'],
  },
  {
    key: 'input_style',
    text: '入力のしかたはどれがやりやすいですか？',
    options: ['短文で送りたい', '写真中心がいい', '必要なら少し詳しく送れる', '細かく見てもらいたい'],
  },
  {
    key: 'continuity',
    text: '続ける上で今いちばん不安なのはどれですか？',
    options: ['続けられるか不安', '結果が出るか不安', '入力が面倒になりそう', '一人では甘えそう'],
  },
  {
    key: 'report_need',
    text: '振り返りはどれくらい欲しいですか？',
    options: ['毎日の返信だけでいい', '週間報告が欲しい', '週間と月間の報告が欲しい', '毎日手厚く見てほしい'],
  },
  {
    key: 'ai_style',
    text: 'AI牛込の雰囲気はどれが好きですか？',
    options: ['そっと寄り添う', '明るく後押し', '頼もしく導く', '力強く支える'],
  },
];

function readTextFileOrFallback(filePaths, fallbackLines) {
  const candidates = Array.isArray(filePaths) ? filePaths : [filePaths];

  for (const filePath of candidates) {
    try {
      if (fs.existsSync(filePath)) {
        return fs.readFileSync(filePath, 'utf8');
      }
    } catch (error) {
      console.error(`⚠️ Failed to read ${filePath}:`, error?.message || error);
    }
  }

  return fallbackLines.join('\n');
}

function loadAiPrompt() {
  return readTextFileOrFallback(AI_PROMPT_PATHS, [
    'あなたはAI牛込です。',
    'ポラリス整骨院の牛込先生の雰囲気を持ち、優しく聞き役として寄り添います。',
    '共感、復唱、状況整理、気づき、小さな提案の順番を大切にしてください。',
    '健康知識は自然な会話の中で軽く補足してください。',
    '相手を責めず、断定しすぎず、必要ならポラリス整骨院で牛込先生への相談を勧めてください。',
  ]);
}

function loadAiMemoryPrompt() {
  return readTextFileOrFallback(AI_MEMORY_PROMPT_PATHS, [
    'あなたは会話記録から、今後の伴走に役立つ情報だけを抽出する記憶アシスタントです。',
    '利用者への返答はしません。必ずJSONだけを返してください。',
    '{',
    '  "should_save": false,',
    '  "memories": []',
    '}',
  ]);
}

const AI_BASE_PROMPT = loadAiPrompt();
const AI_MEMORY_PROMPT = loadAiMemoryPrompt();

app.get('/', (_req, res) => {
  res.status(200).send('AI Ushigome LINE bot is running.');
});

app.post('/webhook', express.raw({ type: '*/*', limit: '20mb' }), async (req, res) => {
  try {
    const signature = req.headers['x-line-signature'];
    const rawBody = req.body;

    if (!verifyLineSignature(rawBody, signature, env.LINE_CHANNEL_SECRET)) {
      return res.status(401).send('Invalid signature');
    }

    const bodyText = rawBody.toString('utf8');
    const body = JSON.parse(bodyText);
    const events = Array.isArray(body.events) ? body.events : [];

    res.status(200).send('OK');

    for (const event of events) {
      processEvent(event).catch((error) => {
        console.error('❌ Event processing failed:', error?.stack || error?.message || error);
      });
    }
  } catch (error) {
    console.error('❌ Webhook fatal error:', error?.stack || error?.message || error);
    if (!res.headersSent) {
      res.status(500).send('Internal Server Error');
    }
  }
});

async function processEvent(event) {
  if (!event || event.type !== 'message' || !event.message) return;

  const source = event.source || {};
  const lineUserId = source.userId || null;
  if (!lineUserId) {
    console.warn('⚠️ userId not available. Skipping event.');
    return;
  }

  const user = await ensureUser(supabase, lineUserId, TZ);

  if (event.message.type === 'text') {
    await handleTextMessage(event, user);
    return;
  }

  if (event.message.type === 'image') {
    await handleImageMessage(event, user);
    return;
  }

  await replyMessage(
    event.replyToken,
    '今はテキスト、食事写真、血液検査画像を中心に対応しています。',
    env.LINE_CHANNEL_ACCESS_TOKEN
  );
}

function prefixWithName(user, message, options = {}) {
  const name = getUserDisplayName(user);
  const text = String(message || '').trim();
  const { force = false } = options;

  if (!text) return text;
  if (!name) return text;

  const alreadyHasName =
    text.includes(`${name}さん`) ||
    text.includes(`${name}様`) ||
    text.startsWith(name);

  if (alreadyHasName) return text;
  if (!force) return text;

  return `${name}さん、${text}`;
}

function buildLineTextMessage(text, quickReply = null) {
  const message = {
    type: 'text',
    text: String(text || '').trim(),
  };

  if (quickReply && Array.isArray(quickReply.items) && quickReply.items.length) {
    message.quickReply = quickReply;
  }

  return message;
}

function buildMembershipReplyMessage(user, payload) {
  return buildLineTextMessage(
    prefixWithName(user, payload?.text || ''),
    payload?.quickReply || null
  );
}

function isHelpCommand(text) {
  return ['help', 'ヘルプ', '使い方', 'メニュー'].some((x) => text.includes(x));
}

function isProfileCommand(text) {
  return text.includes('プロフィール');
}

function isProfileConfirmCommand(text) {
  return ['プロフィール確認', 'プロフィールを確認', '設定確認'].includes(String(text || '').trim());
}

function isProfileEditCommand(text) {
  return ['プロフィール変更', 'プロフィールを変更', '設定変更'].includes(String(text || '').trim());
}

function isProfileResetCommand(text) {
  return ['プロフィール再設定', 'プロフィールを再設定', '設定をやり直す', 'プロフィールをやり直す'].includes(String(text || '').trim());
}

function isOnboardingStartCommand(text) {
  const t = String(text || '').trim();
  return ['はじめる', 'スタート', '開始'].includes(t) || isOnboardingStart(t);
}

function normalizeTextLoose(text) {
  return String(text || '')
    .trim()
    .toLowerCase()
    .replace(/[！!？?。.,，、]/g, '')
    .replace(/\s+/g, '');
}

function hasQuestionIntent(text) {
  const raw = String(text || '').trim();
  const t = normalizeTextLoose(text);

  if (!t) return false;
  if (/[？?]/.test(raw)) return true;

  const patterns = [
    'かな', 'ですか', 'ますか', 'いいですか', '大丈夫ですか', 'だめですか', 'ダメですか',
    'してもいい', 'して平気', '問題ない', 'どうかな', 'どうですか', '良いですか', '悪いですか',
    'いいかな', '平気かな', 'だめかな', 'ダメかな', 'どうしたら', 'どうすれば', 'どう思う', '教えて',
  ];

  return patterns.some((p) => t.includes(normalizeTextLoose(p)));
}

function hasPainOrMedicalContext(text) {
  const t = normalizeTextLoose(text);
  if (!t) return false;

  const patterns = [
    '痛い', '痛み', 'しびれ', '腫れ', '炎症', '違和感', 'だるい', '重い', 'つらい', '辛い',
    '足底腱膜炎', '膝', '腰', '股関節', '肩', '首', 'かかと', '足裏', 'ふくらはぎ', '整形外科', '病院', '治療', '症状',
  ];

  return patterns.some((p) => t.includes(normalizeTextLoose(p)));
}

function isExerciseConsultationText(text) {
  const t = normalizeTextLoose(text);
  if (!t) return false;

  const hasExerciseWord = [
    '走る', 'ジョギング', 'ランニング', '歩く', '運動', '筋トレ', 'ストレッチ', 'スクワット', '散歩', 'トレーニング',
  ].some((w) => t.includes(normalizeTextLoose(w)));

  if (!hasExerciseWord) return false;
  return hasQuestionIntent(text) || hasPainOrMedicalContext(text);
}

function getEffectivePersonaType(user) {
  return normalizePersonaType(
    user?.ai_persona_type ||
    user?.ai_type ||
    AI_PERSONA_TYPES.GENTLE
  );
}

function buildAiPersonaQuickReplies() {
  return getPersonaQuickReplyItems().map((item) => item.label);
}

function isAiPersonaChangeCommand(text) {
  const t = String(text || '').trim();
  return ['AIタイプ変更', '話し方を変更', '人格変更', 'AI人格変更', 'タイプ変更'].includes(t);
}

function isPersonaSelectionText(text) {
  return Object.values(PERSONA_LABELS).includes(String(text || '').trim());
}

function getPersonaTypeFromLabel(text) {
  const v = String(text || '').trim();
  if (v === PERSONA_LABELS[AI_PERSONA_TYPES.GENTLE]) return AI_PERSONA_TYPES.GENTLE;
  if (v === PERSONA_LABELS[AI_PERSONA_TYPES.BRIGHT]) return AI_PERSONA_TYPES.BRIGHT;
  if (v === PERSONA_LABELS[AI_PERSONA_TYPES.RELIABLE]) return AI_PERSONA_TYPES.RELIABLE;
  if (v === PERSONA_LABELS[AI_PERSONA_TYPES.STRONG]) return AI_PERSONA_TYPES.STRONG;
  return AI_PERSONA_TYPES.GENTLE;
}

async function updateUserAiPersona(userId, personaType) {
  const normalized = normalizePersonaType(personaType);
  const patch = {
    ai_persona_type: normalized,
    ai_persona_selected_at: new Date().toISOString(),
    ai_type: normalized,
  };

  const { data, error } = await supabase
    .from('users')
    .update(patch)
    .eq('id', userId)
    .select('*')
    .single();

  if (error) throw error;
  return data || null;
}

function isActivityCommand(text) {
  if (shouldAvoidMealExerciseAutoCapture(text)) return false;
  if (isExerciseConsultationText(text)) return false;
  return EXERCISE_WORD_HINTS.some((w) => text.includes(w)) || text.includes('歩数') || text.includes('消費');
}

function isMealSaveCommand(text) {
  const t = String(text || '').trim();
  return ['この内容で食事保存', '食事を保存', '保存', 'これで保存', 'この内容で保存'].includes(t);
}

function isMealCancelCommand(text) {
  const t = String(text || '').trim();
  return ['食事をキャンセル', '食事やめる', 'キャンセル', '写真取り消し'].includes(t);
}

function isMealManualEditCommand(text) {
  return String(text || '').trim() === '手書きで追加・修正';
}

function isMealAddPhotoCommand(text) {
  return String(text || '').trim() === '追加で写真';
}

function isIntakeStartCommand(text) {
  const t = String(text || '').trim();
  return t === '初回診断' || t === '初回診断を始める';
}

function isGraphMenuIntent(text) {
  const t = String(text || '').trim().toLowerCase();
  return ['グラフ', 'グラフ見たい', 'グラフを見たい', 'グラフみたい', '推移を見たい', 'データを見たい', '記録を見たい', '見える化'].includes(t);
}

function isEnergyGraphIntent(text) {
  const t = String(text || '').trim().toLowerCase();
  return [
    '食事活動グラフ', '食事グラフ', '運動グラフ', '活動グラフ', '食事と運動のグラフ', '食事と活動のグラフ',
    'カロリーグラフ', '摂取カロリーグラフ', '消費カロリーグラフ', '食事量のグラフ', '運動量のグラフ',
    '食事と運動を見たい', '食事と活動を見たい',
  ].includes(t);
}

function isHbA1cGraphIntent(text) {
  const t = String(text || '').trim().toLowerCase();
  return ['hba1cグラフ', 'hba1c', 'hba1c見たい', '血糖グラフ', '血糖を見たい', 'ヘモグロビンa1cグラフ'].includes(t);
}

function isLdlGraphIntent(text) {
  const t = String(text || '').trim().toLowerCase();
  return ['ldlグラフ', 'ldl', 'ldl見たい', 'コレステロールグラフ', '悪玉コレステロールグラフ', 'コレステロールを見たい', 'ldlを見たい'].includes(t);
}

function isLabGraphIntent(text) {
  const t = String(text || '').trim().toLowerCase();
  return ['血液検査グラフ', '血液検査のグラフ', '血液グラフ', '採血グラフ', '血液検査を見たい', '血液データを見たい'].includes(t) || isHbA1cGraphIntent(t) || isLdlGraphIntent(t);
}

function isWeightGraphIntent(text) {
  const t = String(text || '').trim().toLowerCase();
  return ['体重グラフ', '体重のグラフ', '体重見たい', '体重を見たい', '体重推移', '体重の推移', '体重の変化'].includes(t);
}

function isWeeklyReportRequest(text) {
  return /週間報告|週報|1週間報告|一週間報告/.test(String(text || '').trim());
}

function isMonthlyReportRequest(text) {
  return /月間報告|月報|1か月報告|一か月報告/.test(String(text || '').trim());
}

function isAdminMemoDebugEnabled() {
  return String(process.env.ADMIN_MEMO_DEBUG || '').trim() === '1';
}

function safeConsoleLog(label, value) {
  try {
    console.log(label, typeof value === 'string' ? value : JSON.stringify(value, null, 2));
  } catch (_error) {
    console.log(label, value);
  }
}

function isCurrentDateTimeQuestion(text) {
  const t = String(text || '')
    .trim()
    .toLowerCase()
    .replace(/[？?。！!、]/g, '')
    .replace(/\s+/g, '');

  const patterns = [
    '今日は何月何日', 'きょうは何月何日', '今日何日', 'きょう何日', '今日は何日',
    '今何時', 'いま何時', '今何時ですか', 'いま何時ですか', '今は何時', 'いまは何時',
    '今は何時ですか', 'いまは何時ですか', '今何時何分', 'いま何時何分', '今は何時何分', 'いまは何時何分',
    '何時何分', '現在時刻', '今日の日付', '今日の日時', '今の日時', '今日は何曜日', 'きょうは何曜日', '今日何曜日',
    'きょう何曜日', '今は何月何日', '今日は何月何日ですか', 'いま何月何日', '今の日付',
  ];

  return patterns.some((p) => t.includes(p));
}

function isRetryIntent(text) {
  const t = normalizeTextLoose(text);
  return ['やり直し', 'ちがう', '違う', '間違えた', 'さっきのなし', '訂正', '訂正したい']
    .some((x) => t.includes(normalizeTextLoose(x)));
}

function isInputHelpIntent(text) {
  const t = normalizeTextLoose(text);
  return ['入力できない', 'うまくできない', 'やり方がわからない', '送れない', '何を送ればいい', 'わからない']
    .some((x) => t.includes(normalizeTextLoose(x)));
}

function isPastDateHelpIntent(text) {
  const t = normalizeTextLoose(text);
  return ['昨日の分', '一昨日', '過去分', '日付をずらして', '後から登録', '昨日でもいい']
    .some((x) => t.includes(normalizeTextLoose(x)));
}

function isPauseReasonOption(text) {
  return ['忙しい', '費用面', '体調面', 'モチベ低下', '効果を感じにくい', 'その他', '今は答えない'].includes(String(text || '').trim());
}

function isCancelReasonOption(text) {
  return ['忙しい', '費用面', '体調面', '効果を感じにくい', '自分で続けたい', 'その他', '今は答えない'].includes(String(text || '').trim());
}

function buildCurrentDateTimeReply(tz = 'Asia/Tokyo') {
  const now = new Date();
  const dateText = formatJapaneseDateInTZ(now, tz);
  const weekday = getWeekdayJaInTZ(now, tz);
  const timeText = formatTimeHmInTZ(now, tz);

  return [`東京では、今日は ${dateText}（${weekday}）です。`, `今の時刻は ${timeText} です。`].join('\n');
}

function parseBodyMetricsInput(text) {
  const raw = String(text || '').trim();
  if (!raw) {
    return {
      weightKg: null,
      bodyFatPercent: null,
    };
  }

  const normalized = raw
    .replace(/[　]/g, ' ')
    .replace(/％/g, '%')
    .replace(/ｋｇ/gi, 'kg');

  let weightKg = null;
  let bodyFatPercent = null;

  const weightPatterns = [
    /(?:^|[\s、,，/])(?:体重|今朝の体重|本日の体重|今日の体重)\s*[:：]?\s*(-?\d+(?:\.\d+)?)(?:\s*(?:kg|キロ))?/i,
    /(?:^|[\s、,，/])(-?\d+(?:\.\d+)?)\s*(?:kg|キロ)/i,
  ];

  const bodyFatPatterns = [
    /(?:^|[\s、,，/])(?:体脂肪率|体脂肪)\s*[:：]?\s*(-?\d+(?:\.\d+)?)(?:\s*(?:%|パーセント|パー))?/i,
    /(?:^|[\s、,，/])(-?\d+(?:\.\d+)?)\s*(?:%|パーセント|パー)/i,
  ];

  for (const re of weightPatterns) {
    const m = normalized.match(re);
    if (m && m[1] != null) {
      const value = Number(m[1]);
      if (Number.isFinite(value) && value >= 20 && value <= 300) {
        weightKg = value;
        break;
      }
    }
  }

  for (const re of bodyFatPatterns) {
    const m = normalized.match(re);
    if (m && m[1] != null) {
      const value = Number(m[1]);
      if (Number.isFinite(value) && value >= 1 && value <= 80) {
        bodyFatPercent = value;
        break;
      }
    }
  }

  return {
    weightKg,
    bodyFatPercent,
  };
}

function parseWeightInput(text) {
  const parsed = parseBodyMetricsInput(text);
  return parsed.weightKg;
}

function parseBodyFatInput(text) {
  const parsed = parseBodyMetricsInput(text);
  return parsed.bodyFatPercent;
}

function helpMessage() {
  return [
    '使い方の例です。',
    '・はじめる',
    '・プロフィール確認',
    '・プロフィール変更',
    '・プロフィール再設定',
    '・名前は 牛込',
    '・初回診断',
    '・無料診断',
    '・AIタイプ変更',
    '・体重 63.2',
    '・ジョギング 20分',
    '・ストレッチ 5分',
    '・朝食 食パン1枚 チーズ1枚 コーヒー',
    '・この内容で食事保存',
    '・膝が重いです',
    '・ストレッチしたい',
    '・動画で見たい',
    '・1分メニュー',
    '・3分メニュー',
    '・予測',
    '・グラフ',
    '・体重グラフ',
    '・血液検査グラフ',
    '・食事活動グラフ',
    '・週間報告',
    '・月間報告',
    '・食事写真も送れます',
    '・血液検査画像も送れます',
    '・体験状況確認',
    '・現在のプラン',
    '・プラン案内',
    '・無料体験',
    '・食事の送り方',
    '・運動の送り方',
    '・相談の送り方',
    '・血液検査の送り方',
    '・AIタイプ',
  ].join('\n');
}

function buildAiTypePrompt(userOrType) {
  const personaType = normalizePersonaType(
    typeof userOrType === 'string'
      ? userOrType
      : (userOrType?.ai_persona_type || userOrType?.ai_type || AI_PERSONA_TYPES.GENTLE)
  );

  return [
    `現在のAI人格タイプ: ${getPersonaLabel(personaType)}`,
    getPersonaSystemStyle(personaType),
  ].join('\n');
}

function buildMealFollowupQuickReplies() {
  return ['この内容で食事保存', '手書きで追加・修正', '追加で写真', '写真取り消し'];
}

function getMealDraft(lineUserId) {
  const draft = recentMealDrafts.get(lineUserId);
  if (!draft) return null;
  const ageMs = Date.now() - Number(draft.updatedAt || 0);
  if (ageMs > 30 * 60 * 1000) {
    recentMealDrafts.delete(lineUserId);
    return null;
  }
  return draft;
}

function setMealDraft(lineUserId, mealResult, options = {}) {
  const { awaitingAdditionalPhoto = false } = options;
  recentMealDrafts.set(lineUserId, {
    meal: mealResult,
    awaitingAdditionalPhoto: Boolean(awaitingAdditionalPhoto),
    updatedAt: Date.now(),
  });
}

function clearMealDraft(lineUserId) {
  recentMealDrafts.delete(lineUserId);
}

function markMealDraftAwaitingAdditionalPhoto(lineUserId, awaiting = true) {
  const draft = getMealDraft(lineUserId);
  if (!draft) return;

  recentMealDrafts.set(lineUserId, {
    ...draft,
    awaitingAdditionalPhoto: Boolean(awaiting),
    updatedAt: Date.now(),
  });
}

function getSupportContext(lineUserId) {
  const data = recentSupportContexts.get(lineUserId);
  if (!data) return null;
  const ageMs = Date.now() - Number(data.updatedAt || 0);
  if (ageMs > 30 * 60 * 1000) {
    recentSupportContexts.delete(lineUserId);
    return null;
  }
  return data;
}

function setSupportContext(lineUserId, patch) {
  const prev = getSupportContext(lineUserId) || {};
  recentSupportContexts.set(lineUserId, { ...prev, ...patch, updatedAt: Date.now() });
}
function getRecentCaptureConfirmation(lineUserId) {
  const data = recentCaptureConfirmations.get(lineUserId);
  if (!data) return null;

  const ageMs = Date.now() - Number(data.updatedAt || 0);
  if (ageMs > 30 * 60 * 1000) {
    recentCaptureConfirmations.delete(lineUserId);
    return null;
  }

  return data;
}

function setRecentCaptureConfirmation(lineUserId, payload) {
  recentCaptureConfirmations.set(lineUserId, {
    ...payload,
    updatedAt: Date.now(),
  });
}

function clearRecentCaptureConfirmation(lineUserId) {
  recentCaptureConfirmations.delete(lineUserId);
}

function isConfirmSaveText(text) {
  return ['はい、保存', 'はい保存', '保存する', 'この内容で保存', 'はい'].includes(String(text || '').trim());
}

function isDeclineSaveText(text) {
  return ['今回は保存しない', '保存しない', 'やめておく', '今回はやめる'].includes(String(text || '').trim());
}

function isEditSaveText(text) {
  return ['修正する', '訂正する', '違います', 'ちがいます'].includes(String(text || '').trim());
}

async function saveBodyMetricsFromPayload(user, payload = {}, rawText = '') {
  const weightKg = Number(payload.weight_kg);
  const bodyFatPercent = Number(payload.body_fat_percent);

  if (Number.isFinite(weightKg) && weightKg >= 20 && weightKg <= 300) {
    await saveWeightToLog(user.id, weightKg, rawText);
  }

  if (Number.isFinite(bodyFatPercent) && bodyFatPercent >= 1 && bodyFatPercent <= 80) {
    await saveBodyFatToLog(user.id, bodyFatPercent, rawText);
  }

  const statePatch = {
    last_any_log_at: new Date().toISOString(),
  };

  if (Number.isFinite(weightKg) && weightKg >= 20 && weightKg <= 300) {
    statePatch.last_weight_logged_at = new Date().toISOString();
  }

  if (Number.isFinite(bodyFatPercent) && bodyFatPercent >= 1 && bodyFatPercent <= 80) {
    statePatch.last_body_fat_logged_at = new Date().toISOString();
  }

  await saveUserState(user.id, statePatch);

  let diffText = null;
  if (Number.isFinite(weightKg) && weightKg >= 20 && weightKg <= 300) {
    const recentWeights = await getRecentWeightRows(user.id, 10);
    const latest = recentWeights[0] || { weight_kg: weightKg };
    const prev = recentWeights[1] || null;

    diffText = (() => {
      if (!prev || prev.weight_kg == null) return '前回比較はまだありません。';
      const diff = Math.round((Number(latest.weight_kg) - Number(prev.weight_kg)) * 10) / 10;
      if (diff === 0) return '前回から変化はありません。';
      if (diff > 0) return `前回より ${diff}kg 増えています。`;
      return `前回より ${Math.abs(diff)}kg 減っています。`;
    })();
  }

  const lines = [];
  if (Number.isFinite(weightKg) && Number.isFinite(bodyFatPercent)) {
    lines.push('体重と体脂肪率を記録しておきました。');
    lines.push(`体重: ${weightKg}kg`);
    lines.push(`体脂肪率: ${bodyFatPercent}%`);
  } else if (Number.isFinite(weightKg)) {
    lines.push('体重を記録しておきました。');
    lines.push(`今回: ${weightKg}kg`);
  } else if (Number.isFinite(bodyFatPercent)) {
    lines.push('体脂肪率を記録しておきました。');
    lines.push(`今回: ${bodyFatPercent}%`);
  }

  if (diffText) {
    lines.push(diffText);
  }

  if (Number.isFinite(weightKg) && !Number.isFinite(bodyFatPercent)) {
    lines.push('体脂肪率も分かれば、そのまま続けて送ってくださいね。');
  }

  if (Number.isFinite(bodyFatPercent) && !Number.isFinite(weightKg)) {
    lines.push('体重も分かれば、そのまま続けて送ってくださいね。');
  }

  return lines.join('\n');
}
function seemsMealCorrectionText(text) {
  const t = String(text || '').trim();
  if (!t) return false;
  return [
    'です', 'ではない', 'じゃない', '違います', 'ちがいます', '個です', '杯です', '本です',
    'お酒ではない', 'お茶です', '水です', 'ノンアル', 'ジャスミンティー', '烏龍茶',
    'ウーロン茶', '緑茶', '麦茶', '紅茶', '薄く', '少し', '多め', '少なめ',
    '追加', '増やし', '減らし', '半分', 'ひとくち', '一口', '抜いて', 'なしで',
  ].some((w) => t.includes(w));
}

function normalizeMealIntentText(text) {
  return String(text || '')
    .trim()
    .toLowerCase()
    .replace(/[！!？?。.,，、]/g, '')
    .replace(/\s+/g, '');
}

function isMealDesireOrFeelingText(text) {
  const t = normalizeMealIntentText(text);
  if (!t) return false;

  const patterns = [
    '食べたい', '飲みたい', 'お腹いっぱい食べたい', 'おなかいっぱい食べたい', 'お腹一杯食べたい', 'おなか一杯食べたい',
    'いっぱい食べたい', '甘いもの食べたい', '何か食べたい', '食欲がある', '食欲がない', '食欲あります', '食欲ない',
    'お腹すいた', 'おなかすいた', '食べたくなる', '食べてしまいそう', '食べそう', '飲みたくなる',
    '食欲が止まらない', '食欲がすごい', '食べすぎそう', '食べ過ぎそう', '食べすぎたくなる',
    '甘いものが止まらない', 'お腹いっぱい食べれる', 'おなかいっぱい食べれる',
  ];

  if (patterns.some((p) => t.includes(p))) return true;
  return (t.includes('食べ') || t.includes('飲み')) && t.includes('たい');
}

function isExplicitMealLogText(text) {
  const t = normalizeMealIntentText(text);
  if (!t) return false;
  if (shouldAvoidMealExerciseAutoCapture(text)) return false;
  if (isMealDesireOrFeelingText(t)) return false;
  if (hasQuestionIntent(text)) return false;

  const directPatterns = [
    '食べた', '飲んだ', '食べました', '飲みました', '食べたよ', '飲んだよ', '食べたです',
    '朝食', '昼食', '夕食', '朝ごはん', '昼ごはん', '夜ごはん', '晩ごはん', '朝飯', '昼飯', '夜飯', '今朝', 'さっき',
  ];

  if (directPatterns.some((p) => t.includes(p))) return true;

  const hasMealVerb = /食べた|飲んだ|食べました|飲みました/.test(t);
  const hasFoodLikeWord = /ラーメン|ご飯|ごはん|パン|おにぎり|うどん|そば|パスタ|カレー|寿司|すし|肉|魚|卵|サラダ|スープ|味噌汁|みそ汁|コーヒー|お茶|ジュース|ビール|お酒|ケーキ|チョコ|アイス|青汁|食パン|ピーナッツバター/.test(t);

  return hasMealVerb || hasFoodLikeWord;
}

function isExplicitMealGuideIntent(text) {
  const t = String(text || '').trim();
  return [
    '食事を記録したい', '食事記録したい', '食事を登録したい', '食事の記録方法', '食事の保存方法', '食事を入力したい',
    '食べたものを記録したい', '飲んだものを記録したい',
  ].includes(t);
}

function isTrialGuideIntent(text) {
  const t = normalizeTextLoose(text);
  return ['無料体験', '体験', '体験中', '7日無料', '7日無料体験', '体験状況確認']
    .some((x) => t.includes(normalizeTextLoose(x)));
}

function isPlanSelectionByLinkFlow(text) {
  const t = normalizeTextLoose(text);
  return ['ライト', 'ベーシック', 'プレミアム', 'スペシャル', '人数限定絶対痩せたいスペシャル']
    .some((x) => t === normalizeTextLoose(x));
}

function sumBy(arr, key) {
  return (arr || []).reduce((sum, row) => sum + (Number(row?.[key]) || 0), 0);
}

function buildDailySeries(rows, field, dateKeys = []) {
  const map = new Map();
  for (const ymd of dateKeys || []) {
    if (ymd) map.set(ymd, 0);
  }

  for (const row of rows || []) {
    const dt = formatDateOnly(row?.[field]);
    if (!map.has(dt)) continue;
    const prev = map.get(dt) || 0;
    map.set(dt, prev + (Number(row?.estimated_kcal || row?.estimated_activity_kcal || 0) || 0));
  }

  return Array.from(map.entries()).map(([date, value]) => ({ date, value }));
}

function normalizeJsonText(rawText) {
  const text = String(rawText || '').trim();
  if (!text) return '';
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  return fenced ? fenced[1].trim() : text;
}

function safeParseJson(rawText, fallback = null) {
  try {
    return JSON.parse(normalizeJsonText(rawText));
  } catch (_error) {
    return fallback;
  }
}

function isMissingRelationError(error) {
  const msg = String(error?.message || '').toLowerCase();
  return msg.includes('does not exist') || msg.includes('relation') || msg.includes('schema cache');
}

function trimMemoryText(value, max = 300) {
  return safeText(typeof value === 'string' ? value : JSON.stringify(value), max);
}

function normalizeMemoryContent(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[ 　\t\r\n]+/g, '')
    .replace(/[。、,.!！?？:：;；"'“”‘’（）()\[\]【】]/g, '');
}

function isMemoryContentNear(a, b) {
  const na = normalizeMemoryContent(a);
  const nb = normalizeMemoryContent(b);
  if (!na || !nb) return false;
  if (na === nb) return true;
  if (na.length >= 8 && nb.includes(na)) return true;
  if (nb.length >= 8 && na.includes(nb)) return true;
  return false;
}

function dedupeMemoryRows(rows) {
  const result = [];
  for (const row of rows || []) {
    const duplicate = result.some((saved) => saved.memory_type === row.memory_type && isMemoryContentNear(saved.content, row.content));
    if (!duplicate) result.push(row);
  }
  return result;
}

function normalizeMemoryPayload(payload) {
  const shouldSave = Boolean(payload?.should_save);
  const memories = Array.isArray(payload?.memories)
    ? payload.memories.filter((item) => item && typeof item === 'object')
    : [];

  return {
    should_save: shouldSave && memories.length > 0,
    memories: memories
      .map((item) => ({
        memory_type: safeText(item.memory_type || '', 80),
        content: trimMemoryText(item.content, 400),
        detail_json: item.detail_json && typeof item.detail_json === 'object' ? item.detail_json : {},
      }))
      .filter((item) => item.memory_type && item.content),
  };
}

function buildMemoryRows(user, payload, sourceText, aiReply) {
  const normalized = normalizeMemoryPayload(payload);
  const nowIso = toIsoStringInTZ(new Date(), TZ);

  if (!normalized.should_save || !normalized.memories.length) return [];

  return dedupeMemoryRows(
    normalized.memories.map((memory) => ({
      user_id: user.id,
      line_user_id: user.line_user_id,
      memory_type: memory.memory_type,
      content: memory.content,
      detail_json: memory.detail_json || {},
      source_text: safeText(sourceText, 1000),
      assistant_reply: safeText(aiReply, 1000),
      created_at: nowIso,
    }))
  );
}

async function getRecentConversationMemories(userId, limit = 30) {
  try {
    const { data, error } = await supabase
      .from('conversation_memories')
      .select('memory_type, content, detail_json, created_at')
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .limit(limit);

    if (error) {
      if (isMissingRelationError(error)) return [];
      throw error;
    }

    return Array.isArray(data) ? data : [];
  } catch (error) {
    console.error('⚠️ getRecentConversationMemories failed:', error?.message || error);
    return [];
  }
}

function splitMemoryContext(memories) {
  const followUps = [];
  const grouped = new Map();

  for (const row of memories || []) {
    const type = row.memory_type || 'other';
    const content = trimMemoryText(row.content, 160);
    if (!content) continue;

    if (type === 'follow_up_hint') {
      if (!followUps.some((x) => isMemoryContentNear(x, content))) followUps.push(content);
      continue;
    }

    if (!grouped.has(type)) grouped.set(type, []);
    const list = grouped.get(type);
    if (!list.some((x) => isMemoryContentNear(x, content))) list.push(content);
  }

  return { followUps: followUps.slice(0, 4), grouped };
}
function buildMemorySummary(memories) {
  if (!Array.isArray(memories) || !memories.length) {
    return {
      followUpText: '特に優先フォローはまだありません。',
      memoryText: '過去記憶はまだありません。',
    };
  }

  const { followUps, grouped } = splitMemoryContext(memories);
  const labels = {
    goal: '目標', concern: '気がかり', anxiety: '不安', mood_pattern: '気分の傾向', craving_pattern: '食欲の傾向',
    snacking_pattern: '間食傾向', eating_pattern: '食習慣', routine_pattern: '生活リズム', exercise_pattern: '運動傾向',
    pain_pattern: '痛み傾向', symptom_pattern: '症状傾向', medical_attention: '医療注意', motivation_barrier: 'やる気の壁',
    continuation_barrier: '継続の壁', lifestyle_context: '生活背景', work_context: '仕事背景', family_context: '家庭背景',
    emotional_trigger: '気持ちの引き金', helpful_support_style: '合う声かけ', disliked_support_style: '合わない声かけ',
    value: '大切にしていること', preference: '好み', personality_tendency: '性格傾向', sleep_pattern: '睡眠傾向',
    time_of_day_pattern: '時間帯傾向', other: 'その他',
  };

  const preferredOrder = [
    'goal', 'concern', 'anxiety', 'craving_pattern', 'eating_pattern', 'exercise_pattern', 'pain_pattern',
    'continuation_barrier', 'helpful_support_style', 'time_of_day_pattern', 'work_context', 'family_context', 'medical_attention',
  ];

  const memoryLines = [];
  const handled = new Set();

  for (const type of preferredOrder) {
    const items = grouped.get(type);
    if (!items || !items.length) continue;
    const label = labels[type] || type;
    memoryLines.push(`- ${label}: ${items.slice(0, 2).join(' / ')}`);
    handled.add(type);
  }

  for (const [type, items] of grouped.entries()) {
    if (!items.length || handled.has(type)) continue;
    const label = labels[type] || type;
    memoryLines.push(`- ${label}: ${items.slice(0, 2).join(' / ')}`);
  }

  return {
    followUpText: followUps.length ? followUps.map((x) => `- ${x}`).join('\n') : '特に優先フォローはまだありません。',
    memoryText: memoryLines.length ? memoryLines.join('\n') : '過去記憶はまだありません。',
  };
}

async function extractConversationMemory(user, userText, aiReply) {
  try {
    const prompt = [
      AI_MEMORY_PROMPT,
      '',
      `利用者名: ${getUserDisplayName(user) || '未設定'}`,
      `利用者メッセージ: ${userText}`,
      `AI返答: ${aiReply}`,
      '',
      'JSONだけを返してください。',
    ].join('\n');

    const raw = await generateTextOnly(prompt, 0.1);
    const parsed = safeParseJson(raw, { should_save: false, memories: [] });
    return normalizeMemoryPayload(parsed);
  } catch (error) {
    console.error('⚠️ extractConversationMemory failed:', error?.message || error);
    return normalizeMemoryPayload({ should_save: false, memories: [] });
  }
}

function filterDuplicateRowsAgainstRecent(rows, recentRows) {
  return (rows || []).filter((row) => {
    const duplicate = (recentRows || []).some((recent) => recent.memory_type === row.memory_type && isMemoryContentNear(recent.content, row.content));
    return !duplicate;
  });
}

async function saveConversationMemory(user, userText, aiReply) {
  try {
    const payload = await extractConversationMemory(user, userText, aiReply);
    const rows = buildMemoryRows(user, payload, userText, aiReply);
    if (!rows.length) return;

    const recentRows = await getRecentConversationMemories(user.id, 120);
    const filteredRows = filterDuplicateRowsAgainstRecent(rows, recentRows);
    if (!filteredRows.length) return;

    const { error } = await supabase.from('conversation_memories').insert(filteredRows);
    if (error) {
      if (isMissingRelationError(error)) {
        console.warn('⚠️ conversation_memories table not found. Memory save skipped.');
        return;
      }
      throw error;
    }
  } catch (error) {
    console.error('⚠️ saveConversationMemory failed:', error?.message || error);
  }
}

async function rememberInteraction(user, userText, aiReply) {
  try {
    await saveConversationMemory(user, userText, aiReply);
  } catch (error) {
    console.error('⚠️ rememberInteraction failed:', error?.message || error);
  }
}

function normalizeAiReplyText(text) {
  return String(text || '')
    .replace(/\r\n/g, '\n')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function countQuestions(text) {
  const matches = String(text || '').match(/[？?]/g);
  return matches ? matches.length : 0;
}

function limitReplyQuestions(text, maxQuestions = 1) {
  if (countQuestions(text) <= maxQuestions) return text;
  let seen = 0;
  return String(text || '').replace(/[？?]/g, (mark) => {
    seen += 1;
    return seen <= maxQuestions ? mark : '。';
  });
}

function cleanupAiPhrases(text) {
  const replacements = [
    [/報告ありがとうございます/g, '教えてもらえて助かります'],
    [/素晴らしいです/g, 'いいですね'],
    [/引き続き頑張りましょう/g, 'また少しずつ整えていきましょう'],
    [/無理せず頑張ってください/g, '今日は無理を広げすぎないでいきましょう'],
    [/お大事にしてください/g, '今日はいたわりながらいきましょう'],
    [/何よりです/g, 'そこは大きいです'],
  ];

  let out = String(text || '');
  for (const [pattern, replacement] of replacements) {
    out = out.replace(pattern, replacement);
  }
  return out;
}

function trimReplyLength(text, max = 420) {
  const normalized = normalizeAiReplyText(text);
  if (normalized.length <= max) return normalized;

  const firstBreak = normalized.indexOf('\n');
  if (firstBreak > 0 && firstBreak < max) return normalized.slice(0, firstBreak).trim();

  const cut = normalized.slice(0, max);
  const lastPunc = Math.max(cut.lastIndexOf('。'), cut.lastIndexOf('！'), cut.lastIndexOf('？'), cut.lastIndexOf('\n'));
  if (lastPunc >= 40) return cut.slice(0, lastPunc + 1).trim();
  return cut.trim();
}

function postProcessAiReply(user, rawReply) {
  let text = normalizeAiReplyText(rawReply);
  text = cleanupAiPhrases(text);
  text = limitReplyQuestions(text, 1);
  text = trimReplyLength(text, 420);
  text = safeText(text, 600);
  if (!text) text = '今日はそんな感じなんですね。ここからまた整えていきましょう。';
  return prefixWithName(user, text);
}

function roundMacroGram(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  return Math.round(n * 10) / 10;
}

function buildMealNutritionLines(meal) {
  const protein = roundMacroGram(meal?.protein_g);
  const fat = roundMacroGram(meal?.fat_g);
  const carbs = roundMacroGram(meal?.carbs_g);
  if (protein == null && fat == null && carbs == null) return [];

  return [
    '栄養の目安',
    protein != null ? `・たんぱく質: ${protein}g` : null,
    fat != null ? `・脂質: ${fat}g` : null,
    carbs != null ? `・糖質: ${carbs}g` : null,
  ].filter(Boolean);
}

function normalizeMealCorrectionText(text) {
  const raw = String(text || '').trim();
  if (!raw) return raw;

  const t = raw.replace(/\s+/g, '').replace(/[。．]/g, '');

  if (/^ご飯半分$/.test(t) || /^ごはん半分$/.test(t)) return 'ご飯は半分です';
  if (/^ご飯少なめ$/.test(t) || /^ごはん少なめ$/.test(t)) return 'ご飯は少なめです';
  if (/^ご飯多め$/.test(t) || /^ごはん多め$/.test(t)) return 'ご飯は多めです';
  if (/^味噌汁追加$/.test(t) || /^みそ汁追加$/.test(t)) return '味噌汁を追加します';
  if (/^ご飯追加$/.test(t) || /^ごはん追加$/.test(t)) return 'ご飯を追加します';
  if (/^お茶$/.test(t)) return '飲み物はお茶です';
  if (/^水$/.test(t)) return '飲み物は水です';
  if (/^ノンアル$/.test(t)) return '飲み物はノンアルです';
  if (/^\d+個$/.test(t)) return `個数は${t}です`;

  return raw;
}

function buildMealReplyWithSaveGuide(meal, options = {}) {
  const { textOnly = false } = options;
  const lines = [
    '食事内容を整理しました。',
    `料理: ${safeText(meal?.meal_label || '食事', 120)}`,
    meal?.estimated_kcal != null
      ? `推定カロリー: ${fmt(meal.estimated_kcal)} kcal${
          meal?.kcal_min != null && meal?.kcal_max != null
            ? ` (${fmt(meal.kcal_min)}〜${fmt(meal.kcal_max)} kcal)`
            : ''
        }`
      : null,
  ].filter(Boolean);

  const nutritionLines = buildMealNutritionLines(meal);
  if (nutritionLines.length) {
    lines.push('');
    lines.push(...nutritionLines);
  }

  lines.push('');
  lines.push(
    textOnly
      ? '合っていれば保存、違うところがあればそのまま訂正してください。'
      : '合っていれば保存、違うところがあればボタンか文字で訂正してください。'
  );

  return lines.join('\n');
}

function mergeFoodItems(baseItems = [], extraItems = []) {
  return [...baseItems, ...extraItems].map((item) => ({
    name: safeText(item?.name || '不明な食品', 80),
    estimated_amount: safeText(item?.estimated_amount || '1つ', 80),
    estimated_kcal: Number(item?.estimated_kcal) || 0,
    category: item?.category || null,
    confidence: Number(item?.confidence) || 0.7,
    needs_confirmation: Boolean(item?.needs_confirmation),
  }));
}

function mergeMealLabels(baseLabel, extraLabel) {
  const labels = [baseLabel, extraLabel].map((x) => String(x || '').trim()).filter(Boolean);
  return Array.from(new Set(labels)).join(' / ') || '食事';
}

function sumNullableNumber(a, b) {
  const av = Number(a);
  const bv = Number(b);
  const hasA = Number.isFinite(av);
  const hasB = Number.isFinite(bv);
  if (!hasA && !hasB) return null;
  return (hasA ? av : 0) + (hasB ? bv : 0);
}

function mergeMealDrafts(baseMeal, extraMeal) {
  const baseFoodItems = Array.isArray(baseMeal?.food_items) ? baseMeal.food_items : [];
  const extraFoodItems = Array.isArray(extraMeal?.food_items) ? extraMeal.food_items : [];
  const confidenceValues = [Number(baseMeal?.confidence), Number(extraMeal?.confidence)].filter((x) => Number.isFinite(x));

  return {
    is_meal: true,
    meal_label: mergeMealLabels(baseMeal?.meal_label, extraMeal?.meal_label),
    food_items: mergeFoodItems(baseFoodItems, extraFoodItems),
    estimated_kcal: sumNullableNumber(baseMeal?.estimated_kcal, extraMeal?.estimated_kcal),
    kcal_min: sumNullableNumber(baseMeal?.kcal_min, extraMeal?.kcal_min),
    kcal_max: sumNullableNumber(baseMeal?.kcal_max, extraMeal?.kcal_max),
    protein_g: sumNullableNumber(baseMeal?.protein_g, extraMeal?.protein_g),
    fat_g: sumNullableNumber(baseMeal?.fat_g, extraMeal?.fat_g),
    carbs_g: sumNullableNumber(baseMeal?.carbs_g, extraMeal?.carbs_g),
    confidence: confidenceValues.length
      ? Math.round((confidenceValues.reduce((sum, x) => sum + x, 0) / confidenceValues.length) * 100) / 100
      : 0.75,
    uncertainty_notes: [
      ...(Array.isArray(baseMeal?.uncertainty_notes) ? baseMeal.uncertainty_notes : []),
      ...(Array.isArray(extraMeal?.uncertainty_notes) ? extraMeal.uncertainty_notes : []),
    ],
    confirmation_questions: [
      ...(Array.isArray(baseMeal?.confirmation_questions) ? baseMeal.confirmation_questions : []),
      ...(Array.isArray(extraMeal?.confirmation_questions) ? extraMeal.confirmation_questions : []),
    ],
    ai_comment: safeText('追加写真も含めて食事内容を再整理しました。', 1000),
    raw_model_json: {
      source: 'merged_meal_draft',
      base_meal: baseMeal?.raw_model_json || baseMeal || {},
      extra_meal: extraMeal?.raw_model_json || extraMeal || {},
    },
  };
}

function countDetectedLabItems(extraction) {
  const panels = Array.isArray(extraction?.panels) ? extraction.panels : [];
  let count = 0;
  for (const panel of panels) {
    const items = panel?.items || {};
    for (const value of Object.values(items)) {
      if (value !== null && value !== undefined && String(value).trim() !== '') count += 1;
    }
  }
  return count;
}

function isLikelyBloodTestExtraction(extraction) {
  const dates = Array.isArray(extraction?.dates) ? extraction.dates.filter(Boolean) : [];
  const panels = Array.isArray(extraction?.panels) ? extraction.panels : [];
  const itemCount = countDetectedLabItems(extraction);
  return dates.length > 0 && panels.length > 0 && itemCount >= 2;
}

function isMeaningfulMealDraft(meal) {
  if (!meal || !meal.is_meal) return false;
  const kcal = Number(meal.estimated_kcal || 0);
  const foodCount = Array.isArray(meal.food_items) ? meal.food_items.length : 0;
  const label = String(meal.meal_label || '').trim();
  if (kcal > 0) return true;
  if (foodCount > 0) return true;
  if (label && label !== '食事' && label !== '食事なし') return true;
  return false;
}

async function analyzeMealTextPrimary(text) {
  if (typeof analyzeMealTextWithGemini === 'function') {
    try {
      const geminiMeal = await analyzeMealTextWithGemini(text);
      if (geminiMeal?.is_meal) return geminiMeal;
      if (geminiMeal?.meal_label || geminiMeal?.estimated_kcal != null) return geminiMeal;
    } catch (error) {
      console.error('⚠️ analyzeMealTextWithGemini failed. Fallback to analyzeMealTextWithAI:', error?.message || error);
    }
  }
  return analyzeMealTextWithAI(text);
}

async function applyMealCorrectionPrimary(currentMeal, correctionText) {
  if (typeof applyMealCorrectionWithGemini === 'function') {
    try {
      const corrected = await applyMealCorrectionWithGemini(currentMeal, correctionText);
      if (corrected?.meal_label || corrected?.estimated_kcal != null) return corrected;
    } catch (error) {
      console.error('⚠️ applyMealCorrectionWithGemini failed. Fallback to applyMealCorrection:', error?.message || error);
    }
  }
  return applyMealCorrection(currentMeal, correctionText);
}

async function getTodayEnergyTotals(userId) {
  const dateYmd = currentDateYmdInTZ(TZ);
  const { startIso, endIso } = buildDayRangeIsoInTZ(dateYmd, TZ);

  const [mealsRes, actsRes] = await Promise.all([
    supabase.from('meal_logs').select('estimated_kcal').eq('user_id', userId).gte('eaten_at', startIso).lte('eaten_at', endIso),
    supabase.from('activity_logs').select('estimated_activity_kcal').eq('user_id', userId).gte('logged_at', startIso).lte('logged_at', endIso),
  ]);

  if (mealsRes.error) throw mealsRes.error;
  if (actsRes.error) throw actsRes.error;

  return {
    intake_kcal: sumBy(mealsRes.data || [], 'estimated_kcal'),
    activity_kcal: sumBy(actsRes.data || [], 'estimated_activity_kcal'),
  };
}

async function getSevenDayEnergyRows(userId) {
  const endYmd = currentDateYmdInTZ(TZ);
  const startYmd = addDaysYmd(endYmd, -6);
  const dateKeys = listRecentDatesYmd(7, TZ, endYmd);
  const { startIso } = buildDayRangeIsoInTZ(startYmd, TZ);
  const { endIso } = buildDayRangeIsoInTZ(endYmd, TZ);

  const [mealsRes, actsRes] = await Promise.all([
    supabase.from('meal_logs').select('eaten_at, estimated_kcal').eq('user_id', userId).gte('eaten_at', startIso).lte('eaten_at', endIso),
    supabase.from('activity_logs').select('logged_at, estimated_activity_kcal').eq('user_id', userId).gte('logged_at', startIso).lte('logged_at', endIso),
  ]);

  if (mealsRes.error) throw mealsRes.error;
  if (actsRes.error) throw actsRes.error;

  const intakeSeries = buildDailySeries(mealsRes.data || [], 'eaten_at', dateKeys);
  const activitySeries = buildDailySeries(actsRes.data || [], 'logged_at', dateKeys);

  return intakeSeries.map((row, idx) => {
    const activity = activitySeries[idx]?.value || 0;
    return { date: row.date, intake_kcal: row.value, activity_kcal: activity, net_kcal: row.value - activity };
  });
}

async function getRecentWeightRows(userId, limit = 20) {
  const { data, error } = await supabase
    .from('weight_logs')
    .select('*')
    .eq('user_id', userId)
    .order('measured_at', { ascending: false })
    .limit(limit);

  if (error) throw error;
  return Array.isArray(data) ? data : [];
}

async function getRecentBodyFatRows(userId, limit = 20) {
  try {
    const { data, error } = await supabase
      .from('body_fat_logs')
      .select('*')
      .eq('user_id', userId)
      .order('measured_at', { ascending: false })
      .limit(limit);

    if (error) {
      if (isMissingRelationError(error)) return [];
      throw error;
    }

    return Array.isArray(data) ? data : [];
  } catch (error) {
    console.error('⚠️ getRecentBodyFatRows failed:', error?.message || error);
    return [];
  }
}

async function getRecentMealRows(userId, limit = 50) {
  const { data, error } = await supabase
    .from('meal_logs')
    .select('*')
    .eq('user_id', userId)
    .order('eaten_at', { ascending: false })
    .limit(limit);

  if (error) throw error;
  return Array.isArray(data) ? data : [];
}

async function getRecentActivityRows(userId, limit = 50) {
  const { data, error } = await supabase
    .from('activity_logs')
    .select('*')
    .eq('user_id', userId)
    .order('logged_at', { ascending: false })
    .limit(limit);

  if (error) throw error;
  return Array.isArray(data) ? data : [];
}

async function getRecentSymptomRows(userId, limit = 20) {
  try {
    const { data, error } = await supabase
      .from('conversation_memories')
      .select('content, created_at, memory_type')
      .eq('user_id', userId)
      .in('memory_type', ['pain_pattern', 'symptom_pattern', 'medical_attention'])
      .order('created_at', { ascending: false })
      .limit(limit);

    if (error) {
      if (isMissingRelationError(error)) return [];
      throw error;
    }

    return Array.isArray(data)
      ? data.map((row) => ({ date: row.created_at, symptom: row.content, memory_type: row.memory_type }))
      : [];
  } catch (error) {
    console.error('⚠️ getRecentSymptomRows failed:', error?.message || error);
    return [];
  }
}

function filterRowsWithinDays(rows, dateField, days) {
  const list = Array.isArray(rows) ? rows : [];
  const end = new Date();
  const start = new Date(end.getTime() - (days * 24 * 60 * 60 * 1000));

  return list
    .filter((row) => {
      const value = row?.[dateField];
      if (!value) return false;
      const dt = new Date(value);
      return !Number.isNaN(dt.getTime()) && dt >= start && dt <= end;
    })
    .sort((a, b) => new Date(a?.[dateField] || 0) - new Date(b?.[dateField] || 0));
}
async function buildReportDraftInput(user, reportType) {
  const days = reportType === 'monthly' ? 31 : 7;

  const [weightRows, bodyFatRows, mealRows, activityRows, labRows, symptomRows] = await Promise.all([
    getRecentWeightRows(user.id, reportType === 'monthly' ? 60 : 20),
    getRecentBodyFatRows(user.id, reportType === 'monthly' ? 60 : 20),
    getRecentMealRows(user.id, reportType === 'monthly' ? 200 : 80),
    getRecentActivityRows(user.id, reportType === 'monthly' ? 200 : 80),
    getRecentLabResults(supabase, user.id, reportType === 'monthly' ? 12 : 6),
    getRecentSymptomRows(user.id, reportType === 'monthly' ? 40 : 20),
  ]);

  const weights = filterRowsWithinDays(weightRows, 'measured_at', days).map((row) => ({ date: row.measured_at, weight_kg: row.weight_kg }));
  const bodyFats = filterRowsWithinDays(bodyFatRows, 'measured_at', days).map((row) => ({ date: row.measured_at, body_fat_percent: row.body_fat_percent }));
  const meals = filterRowsWithinDays(mealRows, 'eaten_at', days).map((row) => ({
    date: row.eaten_at,
    calories: row.estimated_kcal,
    protein_g: row.protein_g,
    fat_g: row.fat_g,
    carbs_g: row.carbs_g,
    meal_type: row.meal_label,
    meal_time: row.eaten_at ? formatTimeHmInTZ(row.eaten_at, TZ) : '',
  }));
  const exercises = filterRowsWithinDays(activityRows, 'logged_at', days).map((row) => ({
    date: row.logged_at,
    duration_minutes: row.walking_minutes || null,
    calories_burned: row.estimated_activity_kcal,
    exercise_type: row.exercise_summary,
  }));
  const symptoms = filterRowsWithinDays(symptomRows, 'date', days).map((row) => ({ date: row.date, symptom: row.symptom }));

  const periodEnd = currentDateYmdInTZ(TZ);
  const periodStart = addDaysYmd(periodEnd, -(days - 1));

  return {
    user_name: getUserDisplayName(user) || '利用者',
    period_label: `${periodStart}〜${periodEnd}`,
    weights,
    body_fats: bodyFats,
    meals,
    exercises,
    symptoms,
    lab_results: Array.isArray(labRows) ? labRows : [],
  };
}

async function saveWeightToLog(userId, weightKg, rawText) {
  const insertPayload = {
    user_id: userId,
    measured_at: toIsoStringInTZ(new Date(), TZ),
    weight_kg: weightKg,
    source: 'line',
    raw_text: safeText(rawText || '', 300),
  };

  const { error } = await supabase.from('weight_logs').insert(insertPayload);
  if (error) throw error;
  return insertPayload;
}

async function saveMealToLog(userId, meal) {
  const insertPayload = {
    user_id: userId,
    eaten_at: toIsoStringInTZ(new Date(), TZ),
    meal_label: safeText(meal.meal_label || '食事', 100),
    food_items: Array.isArray(meal.food_items) ? meal.food_items : [],
    estimated_kcal: meal.estimated_kcal ?? null,
    kcal_min: meal.kcal_min ?? null,
    kcal_max: meal.kcal_max ?? null,
    protein_g: meal.protein_g ?? null,
    fat_g: meal.fat_g ?? null,
    carbs_g: meal.carbs_g ?? null,
    confidence: meal.confidence ?? null,
    ai_comment: safeText(meal.ai_comment || '食事を保存しました。', 1000),
    raw_model_json: meal,
  };

  const { error } = await supabase.from('meal_logs').insert(insertPayload);
  if (error) throw error;
  return insertPayload;
}

async function saveUserState(userId, patch = {}) {
  if (!userId || !patch || typeof patch !== 'object') return null;

  const { data, error } = await supabase
    .from('users')
    .update(patch)
    .eq('id', userId)
    .select('*')
    .single();

  if (error) throw error;
  return data || null;
}

async function saveBodyFatToLog(userId, bodyFatPercent, rawText) {
  const insertPayload = {
    user_id: userId,
    measured_at: toIsoStringInTZ(new Date(), TZ),
    body_fat_percent: bodyFatPercent,
    source: 'line',
    raw_text: safeText(rawText || '', 300),
  };

  const { error } = await supabase.from('body_fat_logs').insert(insertPayload);
  if (error) {
    if (isMissingRelationError(error)) {
      console.warn('⚠️ body_fat_logs table not found. Body fat save skipped.');
      return null;
    }
    throw error;
  }

  return insertPayload;
}

async function saveExerciseSmartPayload(user, payload = {}, rawText = '') {
  const activity = {
    steps: null,
    walking_minutes: payload.activity === 'walking' ? Number(payload.duration_min || 0) : null,
    estimated_activity_kcal: null,
    exercise_summary: null,
    raw_detail_json: {
      source: 'smart_capture',
      activity: payload.activity || null,
      duration_min: payload.duration_min || null,
      distance_km: payload.distance_km || null,
      source_text: safeText(rawText || payload.source_text || '', 300),
    },
  };

  if (payload.activity === 'jogging') {
    activity.exercise_summary = payload.distance_km
      ? `ジョギング ${payload.distance_km}km ${payload.duration_min}分`
      : `ジョギング ${payload.duration_min}分`;
    activity.walking_minutes = Number(payload.duration_min || 0);
  } else if (payload.activity === 'walking') {
    activity.exercise_summary = payload.distance_km
      ? `ウォーキング ${payload.distance_km}km ${payload.duration_min}分`
      : `ウォーキング ${payload.duration_min}分`;
  } else if (payload.activity === 'strength_training') {
    activity.exercise_summary = `筋トレ ${payload.duration_min}分`;
    activity.walking_minutes = null;
  } else {
    activity.exercise_summary = safeText(rawText || '運動記録', 100);
    activity.walking_minutes = Number(payload.duration_min || 0) || null;
  }

  activity.estimated_activity_kcal = estimateActivityKcalWithStrength(
    activity.steps,
    activity.walking_minutes,
    user.weight_kg || 60,
    activity.raw_detail_json || {}
  );

  const insertPayload = {
    user_id: user.id,
    logged_at: toIsoStringInTZ(new Date(), TZ),
    steps: activity.steps,
    walking_minutes: activity.walking_minutes,
    estimated_activity_kcal: activity.estimated_activity_kcal,
    exercise_summary: activity.exercise_summary,
    raw_detail_json: activity.raw_detail_json,
  };

  const { error } = await supabase.from('activity_logs').insert(insertPayload);
  if (error) throw error;
  return insertPayload;
}

async function saveMealSmartPayload(user, payload = {}, rawText = '') {
  const analyzedMeal = await analyzeMealTextPrimary(rawText || payload.raw_text || payload.source_text || '');
  return saveMealToLog(user.id, analyzedMeal);
}

async function handleSmartConversationFlow({ user, text }) {
  const analysis = analyzeNewCaptureCandidate(text);
  const intent = detectMessageIntent(text);

  if (analysis.route === 'onboarding_start') {
    return { handled: false, next: 'onboarding_start' };
  }

  if (hasPendingCapture(user)) {
    const pendingResult = mergePendingCaptureReply(user, text);
    const updatedUser = updateUserWithPendingResult(user, pendingResult, text);

    await saveUserState(user.id, {
      pending_capture_type: updatedUser.pending_capture_type,
      pending_capture_status: updatedUser.pending_capture_status,
      pending_capture_payload: updatedUser.pending_capture_payload,
      pending_capture_missing_fields: updatedUser.pending_capture_missing_fields,
      pending_capture_prompt: updatedUser.pending_capture_prompt,
      pending_capture_started_at: updatedUser.pending_capture_started_at,
      pending_capture_source_text: updatedUser.pending_capture_source_text,
      pending_capture_attempts: updatedUser.pending_capture_attempts,
    });

    if (pendingResult.isReadyToSave) {
      return {
        handled: true,
        next: `save_${pendingResult.captureType}_from_pending`,
        payload: pendingResult.payload,
        updatedUser,
      };
    }

    return {
      handled: true,
      next: 'reply_pending_question',
      replyText: updatedUser.pending_capture_prompt || 'もう少しだけ教えてください。',
      updatedUser,
    };
  }

  if (analysis.route === 'pending_clarification') {
    const nextUser = createPendingCapture(user, {
      captureType: analysis.captureType,
      payload: analysis.payload,
      missingFields: analysis.missingFields,
      replyText: analysis.replyText,
      sourceText: text,
    });

    await saveUserState(user.id, {
      pending_capture_type: nextUser.pending_capture_type,
      pending_capture_status: nextUser.pending_capture_status,
      pending_capture_payload: nextUser.pending_capture_payload,
      pending_capture_missing_fields: nextUser.pending_capture_missing_fields,
      pending_capture_prompt: nextUser.pending_capture_prompt,
      pending_capture_started_at: nextUser.pending_capture_started_at,
      pending_capture_source_text: nextUser.pending_capture_source_text,
      pending_capture_attempts: nextUser.pending_capture_attempts,
    });

    return {
      handled: true,
      next: 'reply_pending_question',
      replyText: analysis.replyText,
      updatedUser: nextUser,
    };
  }

  if ((analysis.route === 'save_exercise' || analysis.route === 'save_meal') && shouldAvoidMealExerciseAutoCapture(text)) {
    return {
      handled: false,
      next: intent.type === 'consultation' ? 'consultation_chat' : 'general_chat',
      payload: analysis.payload,
    };
  }

  if (analysis.route === 'save_exercise') return { handled: true, next: 'save_exercise', payload: analysis.payload };
  if (analysis.route === 'save_meal') return { handled: true, next: 'save_meal', payload: analysis.payload };
  if (analysis.route === 'save_weight') return { handled: true, next: 'save_weight', payload: analysis.payload };
  if (analysis.route === 'save_body_fat') return { handled: true, next: 'save_body_fat', payload: analysis.payload };
  if (analysis.route === 'consultation_chat') return { handled: false, next: 'consultation_chat', payload: analysis.payload };

  return { handled: false, next: 'general_chat', payload: analysis.payload };
}

async function updateUserTrialMembership(userId, patch = {}) {
  if (!userId || !patch || typeof patch !== 'object') return null;

  const { data, error } = await supabase
    .from('users')
    .update(patch)
    .eq('id', userId)
    .select('*')
    .single();

  if (error) {
    console.error('⚠️ updateUserTrialMembership failed:', error?.message || error);
    return null;
  }

  return data || null;
}

async function ensureTrialStartedForUser(user) {
  if (!user?.id) return { user, started: false };

  const membershipStatus = safeText(user?.membership_status || '', '');
  const canStartTrial = !user?.trial_started_at && (!membershipStatus || membershipStatus === MEMBERSHIP_STATUS.NONE);
  if (!canStartTrial) return { user, started: false };

  const updatedUser = await updateUserTrialMembership(user.id, startTrialPatch());
  return { user: updatedUser || user, started: Boolean(updatedUser) };
}

async function defaultChatReply(user, userText) {
  const name = getUserDisplayName(user);
  const recentMemories = await getRecentConversationMemories(user.id, 40);
  const { followUpText, memoryText } = buildMemorySummary(recentMemories);

  const prompt = [
    AI_BASE_PROMPT,
    buildAiTypePrompt(user),
    name ? `利用者の呼び名: ${name}さん` : '',
    '',
    '【優先フォロー項目】',
    followUpText,
    '',
    '【過去の伴走メモ】',
    memoryText,
    '',
    '【今回の返答ルール】',
    '- 相手の言葉の中から最低1つ具体的に拾う',
    '- 会話が主役。迷ったら記録や分析より会話を優先する',
    '- 欲求、弱音、相談、雑談はまず自然会話で受ける',
    '- 記録が必要そうでも、返答は先に自然会話から入る',
    '- AIっぽい定型文を避ける',
    '- 必要なら短く提案する',
    '- 雑談も自然に返す',
    '- 相手の名前は毎回呼ばない',
    '- 同じ返答の中で名前を繰り返さない',
    '- 質問は多くても1つまでにする',
    '- 質問しなくても成立するなら質問しない',
    '- 1回で励まし、助言、質問を詰め込みすぎない',
    '- LINEでは少し余白のある短めの返答を優先する',
    '- 「何よりです」「嬉しいな」「よく分かりますよ」を多用しない',
    '- きれいにまとめすぎず、自然な会話を優先する',
    '- 必要なら以前の話題に軽く触れてよい',
    '- ただし毎回すべての過去情報を持ち出さない',
    '- follow_up_hint があれば自然に最優先で活かす',
    '- 痛みや不調は不安を煽らず、危険なら受診もやさしくすすめる',
    '',
    `利用者メッセージ: ${userText}`,
  ].filter(Boolean).join('\n');

  const rawReply = await generateTextOnly(prompt, 0.8);
  return postProcessAiReply(user, rawReply);
}

function buildLegacyMealFromGeminiResult(result) {
  const normalized = normalizeGeminiMealResult(result || {});
  const mainItems = (normalized.items || []).filter((item) => item.is_main_subject);

  const foodItems = mainItems.map((item) => ({
    name: safeText(item.name || '不明な食品', 80),
    estimated_amount: safeText(item.qty_text || '1つ', 80),
    estimated_kcal: Number(item.estimated_kcal) || 0,
    category: null,
    confidence: Number(item.confidence) || 0.7,
    needs_confirmation: Boolean(normalized.needs_confirmation),
  }));

  const uncertainPoints = Array.isArray(normalized.uncertain_points) ? normalized.uncertain_points.filter(Boolean) : [];
  const confirmationQuestions = Array.isArray(normalized.confirmation_questions) ? normalized.confirmation_questions.filter(Boolean) : [];

  const commentLines = [];
  if (uncertainPoints.length) {
    commentLines.push('確認したい点:');
    commentLines.push(...uncertainPoints.map((x) => `・${x}`));
  }
  if (confirmationQuestions.length) commentLines.push(...confirmationQuestions.map((x) => `・${x}`));

  const mealLabel = safeText(normalized.meal_label || '', 100) || safeText(mainItems.map((item) => item.name).join(' / ') || '食事', 100);

  return {
    is_meal: true,
    meal_label: mealLabel,
    food_items: foodItems,
    estimated_kcal: Number(normalized.total_kcal) || 0,
    kcal_min: Number(normalized.range_min) || 0,
    kcal_max: Number(normalized.range_max) || 0,
    protein_g: normalized.protein_g ?? null,
    fat_g: normalized.fat_g ?? null,
    carbs_g: normalized.carbs_g ?? null,
    confidence: Math.max(
      0.55,
      mainItems.length
        ? Math.round((mainItems.reduce((sum, item) => sum + (Number(item.confidence) || 0.7), 0) / mainItems.length) * 100) / 100
        : 0.75
    ),
    uncertainty_notes: uncertainPoints,
    confirmation_questions: confirmationQuestions,
    ai_comment: safeText(
      commentLines.length ? commentLines.join('\n') : `写真から推定しました。約${fmt(Number(normalized.total_kcal) || 0)} kcalです。`,
      1000
    ),
    raw_model_json: { source: 'gemini_meal_service', gemini_result: normalized },
  };
}

async function analyzeMealImageWithGeminiPrimary(buffer, mimeType) {
  const base64Image = buffer.toString('base64');
  const result = await analyzeMealPhotoWithGemini({ base64Image, mimeType: mimeType || 'image/jpeg' });
  return buildLegacyMealFromGeminiResult(result);
}

function buildPainSituationResponse(text, area = '全身') {
  const map = {
    '少し動くと楽': {
      message: [
        `${area}は、少し動くと楽になる感じなんですね。`,
        '固まりすぎるより、やさしく動かした方が流れが良くなりやすそうです。',
        area === '膝'
          ? '膝だけでなく、股関節やふくらはぎも少し整えると歩きやすさにもつながりやすいです。'
          : '少しずつ動きやすさが出ると、活動量や代謝にもつながりやすいです。',
      ].join('\n'),
      quickReplies: ['ストレッチしたい', '動画で見たい', '1分メニュー', '今日はここまで'],
    },
    '歩くとつらい': {
      message: [`${area}は歩くとつらいんですね。`, '今日は頑張って動くより、まず負担を減らしながら整える方向が良さそうです。', CONSULT_MESSAGE].join('\n'),
      quickReplies: ['ストレッチしたい', '少し動くと楽', '動画で見たい', '牛込先生に相談したい'],
    },
  };
  return map[text] || null;
}

async function extractBloodTestDraftFromImage(buffer, mimeType) {
  const imagePart = { inlineData: { mimeType, data: buffer.toString('base64') } };

  const schema = {
    type: 'object',
    properties: {
      dates: { type: 'array', items: { type: 'string' } },
      panels: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            date: { type: 'string' },
            items: {
              type: 'object',
              properties: {
                hba1c: { type: 'string' },
                fasting_glucose: { type: 'string' },
                ldl: { type: 'string' },
                hdl: { type: 'string' },
                triglycerides: { type: 'string' },
                ast: { type: 'string' },
                alt: { type: 'string' },
                ggt: { type: 'string' },
                uric_acid: { type: 'string' },
                creatinine: { type: 'string' },
              },
            },
          },
          required: ['date', 'items'],
        },
      },
    },
    required: ['dates', 'panels'],
  };

  const prompt = [
    'あなたは日本の血液検査画像を読み取るアシスタントです。',
    '画像内の検査日を dates に入れてください。',
    '日付ごとの結果を panels に入れてください。',
    '読める項目だけ拾ってください。',
    '日付は YYYY-MM-DD 形式にしてください。',
    '必ずJSONだけを返してください。',
  ].join('\n');

  const { genAI, extractGeminiText, safeJsonParse, retry } = require('./services/gemini_service');
  const tryModels = [env.GEMINI_MODEL, env.GEMINI_FALLBACK_MODEL];
  let lastError;

  for (const model of tryModels) {
    try {
      const response = await retry(async () => genAI.models.generateContent({
        model,
        contents: [{ role: 'user', parts: [{ text: prompt }, imagePart] }],
        config: {
          responseMimeType: 'application/json',
          responseJsonSchema: schema,
          temperature: 0.1,
        },
      }), 2, 700);

      return safeJsonParse(extractGeminiText(response));
    } catch (error) {
      lastError = error;
    }
  }

  throw lastError || new Error('Blood test image analysis failed');
}
async function getOpenIntakeSession(userId) {
  const { data, error } = await supabase
    .from('intake_sessions')
    .select('*')
    .eq('user_id', userId)
    .eq('status', 'draft')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) throw error;
  return data || null;
}

async function startOrResumeIntake(user) {
  const existing = await getOpenIntakeSession(user.id);
  if (existing) return existing;

  const { data, error } = await supabase
    .from('intake_sessions')
    .insert({ user_id: user.id, status: 'draft', current_step: 'choose_ai_type', answers_json: createEmptyIntakeAnswers() })
    .select('*')
    .single();

  if (error) throw error;
  await supabase.from('users').update({ intake_status: 'in_progress' }).eq('id', user.id);
  return data;
}

async function updateIntakeSession(sessionId, patch) {
  const { data, error } = await supabase
    .from('intake_sessions')
    .update(patch)
    .eq('id', sessionId)
    .select('*')
    .single();

  if (error) throw error;
  return data;
}

async function completeIntakeSession(user, session) {
  const answers = session.answers_json || {};
  const userPatch = buildIntakeProfilePatch(answers);
  const profileSummary = buildIntakeProfileSummary(answers);

  const { error: userError } = await supabase
    .from('users')
    .update({ ...userPatch, intake_status: 'completed' })
    .eq('id', user.id);
  if (userError) throw userError;

  const { error: profileError } = await supabase
    .from('user_profiles')
    .upsert({
      user_id: user.id,
      conversation_style: profileSummary.conversation_style,
      encouragement_style: profileSummary.encouragement_style,
      current_barriers: profileSummary.current_barriers,
    }, { onConflict: 'user_id' });

  if (profileError) console.error('⚠️ user_profiles upsert failed:', profileError?.message || profileError);

  const { error: sessionError } = await supabase.from('intake_sessions').update({ status: 'completed' }).eq('id', session.id);
  if (sessionError) throw sessionError;
}

function buildLabSaveMessage(savedRow, recentRows) {
  const comparisonText = buildPostSaveComparisonMessage(savedRow, recentRows);
  return [
    '血液検査を保存しました。',
    '',
    comparisonText,
    '',
    '無理はしないでくださいね。気になる変化やつらさがあるときは、直接牛込先生に相談してください。',
  ].join('\n');
}

function getDiagnosisQuestions() {
  return FALLBACK_DIAGNOSIS_QUESTIONS;
}

function normalizeDiagnosisState(user) {
  const raw = user?.diagnosis_state_json;
  const parsed = typeof raw === 'string' ? safeParseJson(raw, null) : (raw && typeof raw === 'object' ? raw : null);
  if (parsed && typeof parsed === 'object') return parsed;

  return {
    active: false,
    stepIndex: 0,
    answers: {},
    recommended_plan: null,
    recommended_ai_type: null,
    special_interest: false,
    completed: false,
  };
}

function isDiagnosisStartTrigger(text) {
  const t = normalizeTextLoose(text);
  if (!t) return false;

  if (typeof diagnosisService?.isDiagnosisStartIntent === 'function') {
    try {
      return Boolean(diagnosisService.isDiagnosisStartIntent(text));
    } catch (_error) {}
  }

  return [
    '無料診断',
    '診断',
    '体質診断',
    'ダイエット診断',
    '診断したい',
    '無料で診断',
    '診断お願いします',
  ].some((x) => t === normalizeTextLoose(x) || t.includes(normalizeTextLoose(x)));
}

function isDiagnosisActive(user) {
  const state = normalizeDiagnosisState(user);
  return Boolean(state.active && !state.completed);
}

function buildDiagnosisStartReply() {
  return {
    text: [
      'ありがとうございます。7問の無料診断で、今のあなたに合う進め方を一緒に整理します。',
      '終わったら、おすすめタイプ・7日無料体験・本プランの流れまで自然につなげます。',
      '',
      '準備がよければ始めますね。',
    ].join('\n'),
    quickReplies: ['診断スタート', 'またあとで'],
  };
}

function buildDiagnosisQuestionReply(state) {
  const questions = getDiagnosisQuestions();
  const q = questions[state.stepIndex];
  if (!q) return null;

  const questionText = String(q?.text || '').trim();
  const options = Array.isArray(q?.options) ? q.options.filter(Boolean) : [];

  return {
    text: `【無料診断 ${state.stepIndex + 1}/7】\n${questionText}`,
    quickReplies: options,
  };
}

function mapDiagnosisAiTypeLabelToValue(label) {
  const normalized = String(label || '').trim();

  if (normalized === '明るく後押し') return AI_TYPE_VALUES.BRIGHT;
  if (normalized === '頼もしく導く') return AI_TYPE_VALUES.RELIABLE;
  if (normalized === '力強く支える') return AI_TYPE_VALUES.STRONG;
  return AI_TYPE_VALUES.GENTLE || AI_TYPE_VALUES.SOFT || 'gentle';
}

function scoreDiagnosisFallback(answers = {}) {
  const goal = String(answers.goal || '');
  const pace = String(answers.pace || '');
  const supportNeed = String(answers.support_need || '');
  const inputStyle = String(answers.input_style || '');
  const continuity = String(answers.continuity || '');
  const reportNeed = String(answers.report_need || '');
  const aiStyle = String(answers.ai_style || '');

  let recommendedPlan = PLAN_TYPES.LIGHT;
  let specialInterest = false;

  const specialSignals = [
    goal.includes('人生を変えたい'),
    pace.includes('本気で手厚く'),
    supportNeed.includes('毎日しっかり見てほしい'),
    reportNeed.includes('毎日手厚く見てほしい'),
    continuity.includes('一人では甘えそう'),
  ].filter(Boolean).length;

  if (specialSignals >= 2) {
    recommendedPlan = PLAN_TYPES.SPECIAL;
    specialInterest = true;
  } else if (
    supportNeed.includes('手書き報告') ||
    reportNeed.includes('週間と月間')
  ) {
    recommendedPlan = PLAN_TYPES.PREMIUM;
  } else if (
    supportNeed.includes('週の振り返り') ||
    reportNeed.includes('週間報告')
  ) {
    recommendedPlan = PLAN_TYPES.BASIC;
  } else {
    recommendedPlan = PLAN_TYPES.LIGHT;
  }

  const recommendedAiType = mapDiagnosisAiTypeLabelToValue(aiStyle);
  const recommendedAiLabel = aiStyle || 'そっと寄り添う';

  return {
    recommended_plan: recommendedPlan,
    recommended_ai_type: recommendedAiType,
    recommended_ai_label: recommendedAiLabel,
    special_interest: specialInterest,
    summary: {
      goal,
      pace,
      supportNeed,
      inputStyle,
      continuity,
      reportNeed,
    },
  };
}

function scoreDiagnosisResult(answers = {}) {
  if (typeof diagnosisService?.scoreDiagnosisResult === 'function') {
    try {
      const result = diagnosisService.scoreDiagnosisResult(answers);
      if (result?.recommended_plan) return result;
    } catch (_error) {}
  }
  return scoreDiagnosisFallback(answers);
}

function getPlanPriceLabel(planType) {
  if (planType === PLAN_TYPES.SPECIAL) return '29,800円';
  if (planType === PLAN_TYPES.PREMIUM) return '9,800円';
  if (planType === PLAN_TYPES.BASIC) return '5,980円';
  return '2,980円';
}

function getPlanNameLabel(planType) {
  if (planType === PLAN_TYPES.SPECIAL) return '人数限定！絶対痩せたいスペシャル';
  if (planType === PLAN_TYPES.PREMIUM) return 'プレミアム';
  if (planType === PLAN_TYPES.BASIC) return 'ベーシック';
  return 'ライト';
}

function getPlanDescriptionLabel(planType) {
  if (planType === PLAN_TYPES.SPECIAL) return 'AI毎日・牛込手書き毎日・週間報告・月間報告・整骨院優先予約枠あり';
  if (planType === PLAN_TYPES.PREMIUM) return 'AI毎日・牛込手書き週間報告、月間報告';
  if (planType === PLAN_TYPES.BASIC) return 'AI毎日・週間報告';
  return 'AI毎日返信のみ';
}

function getDiagnosisPlanLink(planType) {
  if (!diagnosisPlanLinks || typeof diagnosisPlanLinks !== 'object') return '';
  if (typeof diagnosisPlanLinks.getPlanPaymentLink === 'function') {
    try {
      return diagnosisPlanLinks.getPlanPaymentLink(planType) || '';
    } catch (_error) {
      return '';
    }
  }
  return '';
}

function buildDiagnosisResultReply(result, user) {
  const planType = result?.recommended_plan || PLAN_TYPES.LIGHT;
  const aiLabel = result?.recommended_ai_label || 'そっと寄り添う';
  const typeBlock = buildTypeRecommendationBlock(aiLabel, {
    reason: `${aiLabel}タイプは、今の進め方や気持ちに合わせやすそうです。`,
  });
  const specialLine = result?.special_interest
    ? '今回は、かなり本気度が高そうなので「人数限定！絶対痩せたいスペシャル」導線も相性が良いです。'
    : null;

  const planLink = getDiagnosisPlanLink(planType);

  const lines = [
    '無料診断ありがとうございました。',
    '',
    typeBlock,
    '',
    `おすすめプラン: ${getPlanNameLabel(planType)}（${getPlanPriceLabel(planType)}）`,
    `内容: ${getPlanDescriptionLabel(planType)}`,
    '',
    '今のあなたは、無理に詰め込みすぎるより「続けやすさ」と「伴走の濃さ」のバランスが大切そうです。',
    specialLine,
    '',
    'まずは 7日無料ライト体験 から始めて、合えば本プランへ進む形がおすすめです。',
    planLink ? `参考リンク: ${planLink}` : null,
  ].filter(Boolean);

  return {
    text: lines.join('\n'),
    quickReplies: ['7日無料ライト体験へ進む', 'プラン案内を見る', '無料体験', 'AIタイプ'],
  };
}

function buildDiagnosisPlanGuideReply() {
  const lightLink = getDiagnosisPlanLink(PLAN_TYPES.LIGHT);
  const basicLink = getDiagnosisPlanLink(PLAN_TYPES.BASIC);
  const premiumLink = getDiagnosisPlanLink(PLAN_TYPES.PREMIUM);
  const specialLink = getDiagnosisPlanLink(PLAN_TYPES.SPECIAL);

  const lines = [
    'プラン案内です。',
    '',
    `ライト 2,980円\nAI毎日返信のみ${lightLink ? `\n${lightLink}` : ''}`,
    '',
    `ベーシック 5,980円\nAI毎日・週間報告${basicLink ? `\n${basicLink}` : ''}`,
    '',
    `プレミアム 9,800円\nAI毎日・牛込手書き週間報告、月間報告${premiumLink ? `\n${premiumLink}` : ''}`,
    '',
    `人数限定！絶対痩せたいスペシャル 29,800円\nAI毎日・牛込手書き毎日・週間報告・月間報告・整骨院優先予約枠あり${specialLink ? `\n${specialLink}` : ''}`,
  ];

  return {
    text: lines.join('\n'),
    quickReplies: ['ライト', 'ベーシック', 'プレミアム', 'スペシャル'],
  };
}

function buildDiagnosisSpecialReply() {
  return {
    text: [
      'スペシャル希望、ありがとうございます。',
      '本気で変えたい時は、毎日の伴走と手書きの深い振り返りがかなり力になります。',
      '',
      '人数限定！絶対痩せたいスペシャル',
      '29,800円',
      'AI毎日・牛込手書き毎日・週間報告・月間報告・整骨院優先予約枠あり',
      '',
      'まずは7日無料ライト体験から入って、途中でスペシャルへ進む流れでも大丈夫です。',
    ].join('\n'),
    quickReplies: ['7日無料ライト体験へ進む', 'プラン案内を見る', 'まず相談したい', 'またあとで'],
  };
}

function buildDiagnosisTrialStartedReply(user) {
  const trialPayload = typeof diagnosisTrialFlowService?.buildTrialStartPayload === 'function'
    ? diagnosisTrialFlowService.buildTrialStartPayload({
        userName: getUserDisplayName(user),
        recommendedType: user?.diagnosis_recommended_ai_type || user?.recommended_ai_type || user?.ai_persona_type || 'そっと寄り添う',
      })
    : null;

  const guideText = typeof diagnosisTrialFlowService?.buildTrialQuickGuideMessage === 'function'
    ? diagnosisTrialFlowService.buildTrialQuickGuideMessage({ userName: getUserDisplayName(user) })
    : buildFirstGuideMessage({ userName: getUserDisplayName(user) });

  const valueText = typeof diagnosisTrialFlowService?.buildTrialValueGuideMessage === 'function'
    ? diagnosisTrialFlowService.buildTrialValueGuideMessage()
    : '';

  const examplesText = buildTrialMessageExamples();

  return {
    text: [
      trialPayload?.message || '7日無料ライト体験を開始しました。',
      '',
      guideText,
      '',
      valueText,
      '',
      examplesText,
    ].filter(Boolean).join('\n\n'),
    quickReplies: ['食事の送り方', '運動の送り方', '体重の送り方', '相談の送り方'],
  };
}

async function buildDiagnosisDay5Reply(user) {
  if (typeof diagnosisTrialFlowService?.buildTrialDay5Message === 'function') {
    return {
      text: diagnosisTrialFlowService.buildTrialDay5Message({ userName: getUserDisplayName(user) }),
      quickReplies: ['プラン案内を見る', '現在のプラン', '体重グラフ', 'グラフ'],
    };
  }

  if (generateWeeklyReportDraft) {
    try {
      const input = await buildReportDraftInput(user, 'weekly');
      const weeklyDraft = generateWeeklyReportDraft(input);
      if (weeklyDraft?.draft_text) {
        return {
          text: [
            '体験5日目の振り返りです。',
            '',
            weeklyDraft.draft_text,
            '',
            'ここまで続けられている所を土台に、あと2日で合う続け方を一緒に見ていきましょう。',
          ].join('\n'),
          quickReplies: ['プラン案内を見る', '現在のプラン', '体重グラフ', 'グラフ'],
        };
      }
    } catch (error) {
      console.error('⚠️ diagnosis day5 weekly draft failed:', error?.message || error);
    }
  }

  return {
    text: [
      '体験5日目の振り返りです。',
      'ここまでで、少しずつ使い方や続けやすさが見えてきた頃だと思います。',
      '完璧を目指すより、続けられる流れを作れているかが大事です。',
      '',
      'あと2日で、あなたに合う本プランも整理していきましょう。',
    ].join('\n'),
    quickReplies: ['プラン案内を見る', '現在のプラン', '体重グラフ', 'グラフ'],
  };
}

function buildDiagnosisDay7Reply(user) {
  if (typeof diagnosisTrialFlowService?.buildTrialDay7Message === 'function') {
    return {
      text: diagnosisTrialFlowService.buildTrialDay7Message({ userName: getUserDisplayName(user) }),
      quickReplies: ['プラン案内を見る', 'ライト', 'ベーシック', 'プレミアム', 'スペシャル'],
    };
  }

  const planType = user?.diagnosis_recommended_plan || PLAN_TYPES.BASIC;
  return {
    text: [
      '7日無料ライト体験、おつかれさまでした。',
      '',
      'ここまで試してみて、続ける価値がありそうなら本プランへ進むタイミングです。',
      `おすすめは ${getPlanNameLabel(planType)}（${getPlanPriceLabel(planType)}）です。`,
      getPlanDescriptionLabel(planType),
      '',
      'もちろん、他のプランと見比べてから決めても大丈夫です。',
    ].join('\n'),
    quickReplies: ['プラン案内を見る', 'ライト', 'ベーシック', 'プレミアム', 'スペシャル'],
  };
}

async function saveDiagnosisState(userId, state) {
  const patch = {
    diagnosis_state_json: state,
    diagnosis_status: state.active ? 'in_progress' : (state.completed ? 'completed' : null),
    diagnosis_step: Number(state.stepIndex || 0),
    diagnosis_answers_json: state.answers || {},
    diagnosis_recommended_plan: state.recommended_plan || null,
    diagnosis_recommended_ai_type: state.recommended_ai_type || null,
    diagnosis_special_interest: Boolean(state.special_interest),
    diagnosis_completed_at: state.completed ? new Date().toISOString() : null,
  };

  return saveUserState(userId, patch);
}

async function startDiagnosisForUser(user) {
  const state = {
    active: true,
    stepIndex: 0,
    answers: {},
    recommended_plan: null,
    recommended_ai_type: null,
    special_interest: false,
    completed: false,
    started_at: new Date().toISOString(),
  };
  const updated = await saveDiagnosisState(user.id, state);
  return updated || { ...user, diagnosis_state_json: state };
}

async function resetDiagnosisForUser(user) {
  const state = {
    active: true,
    stepIndex: 0,
    answers: {},
    recommended_plan: null,
    recommended_ai_type: null,
    special_interest: false,
    completed: false,
    started_at: new Date().toISOString(),
  };
  const updated = await saveDiagnosisState(user.id, state);
  return updated || { ...user, diagnosis_state_json: state };
}

async function completeDiagnosisForUser(user, result, answers) {
  const state = {
    active: false,
    stepIndex: 7,
    answers: answers || {},
    recommended_plan: result?.recommended_plan || null,
    recommended_ai_type: result?.recommended_ai_type || null,
    recommended_ai_label: result?.recommended_ai_label || null,
    special_interest: Boolean(result?.special_interest),
    completed: true,
    completed_at: new Date().toISOString(),
  };

  const normalizedType = normalizeTypeKey(result?.recommended_ai_label || result?.recommended_ai_type || 'そっと寄り添う');
  const typeProfile = getTypeProfile(normalizedType);

  const patch = {
    diagnosis_state_json: state,
    diagnosis_status: 'completed',
    diagnosis_step: 7,
    diagnosis_answers_json: answers || {},
    diagnosis_started_at: user?.diagnosis_started_at || new Date().toISOString(),
    diagnosis_completed_at: new Date().toISOString(),
    diagnosis_recommended_plan: result?.recommended_plan || null,
    diagnosis_recommended_ai_type: result?.recommended_ai_type || null,
    diagnosis_special_interest: Boolean(result?.special_interest),
    recommended_ai_type: typeProfile.label,
    ai_type: result?.recommended_ai_type || user?.ai_type || null,
    ai_persona_type: result?.recommended_ai_type || user?.ai_persona_type || null,
    ai_persona_selected_at: new Date().toISOString(),
  };

  const updated = await saveUserState(user.id, patch);
  return updated || { ...user, ...patch };
}

function getDiagnosisQuestionByStep(stepIndex) {
  const questions = getDiagnosisQuestions();
  return questions[stepIndex] || null;
}

function findDiagnosisOptionMatch(question, text) {
  const raw = String(text || '').trim();
  if (!question || !Array.isArray(question.options)) return null;
  return question.options.find((opt) => normalizeTextLoose(opt) === normalizeTextLoose(raw)) || null;
}
async function handleDiagnosisAnswer(event, user, text) {
  const current = normalizeDiagnosisState(user);
  const question = getDiagnosisQuestionByStep(current.stepIndex);
  if (!question) {
    const resetUser = await resetDiagnosisForUser(user);
    const state = normalizeDiagnosisState(resetUser);
    const firstQ = buildDiagnosisQuestionReply(state);
    await replyMessage(event.replyToken, textMessageWithQuickReplies(firstQ.text, firstQ.quickReplies), env.LINE_CHANNEL_ACCESS_TOKEN);
    return;
  }

  const matched = findDiagnosisOptionMatch(question, text);
  if (!matched) {
    const currentQ = buildDiagnosisQuestionReply(current);
    await replyMessage(
      event.replyToken,
      textMessageWithQuickReplies(
        `この質問は、下の選択肢から選んでください。\n\n${currentQ.text}`,
        currentQ.quickReplies
      ),
      env.LINE_CHANNEL_ACCESS_TOKEN
    );
    return;
  }

  const nextAnswers = { ...(current.answers || {}), [question.key]: matched };
  const nextStep = current.stepIndex + 1;

  if (nextStep >= 7) {
    const result = scoreDiagnosisResult(nextAnswers);
    const completedUser = await completeDiagnosisForUser(user, result, nextAnswers);
    const resultReply = buildDiagnosisResultReply(result, completedUser);
    await replyMessage(
      event.replyToken,
      textMessageWithQuickReplies(prefixWithName(completedUser, resultReply.text), resultReply.quickReplies),
      env.LINE_CHANNEL_ACCESS_TOKEN
    );
    await rememberInteraction(completedUser, text, resultReply.text);
    return;
  }

  const nextState = {
    ...current,
    active: true,
    completed: false,
    answers: nextAnswers,
    stepIndex: nextStep,
  };
  const updatedUser = await saveDiagnosisState(user.id, nextState);
  const nextReply = buildDiagnosisQuestionReply(normalizeDiagnosisState(updatedUser || { ...user, diagnosis_state_json: nextState }));
  await replyMessage(event.replyToken, textMessageWithQuickReplies(nextReply.text, nextReply.quickReplies), env.LINE_CHANNEL_ACCESS_TOKEN);
}

async function startDiagnosisLightTrial(user) {
  const trialPatch = startTrialPatch();
  const patch = {
    ...trialPatch,
    current_plan: PLAN_TYPES.LIGHT,
    membership_status: 'trial',
    trial_status: 'active',
    diagnosis_trial_started_at: new Date().toISOString(),
    diagnosis_trial_day5_sent_at: null,
    diagnosis_trial_day7_sent_at: null,
  };
  const updated = await updateUserTrialMembership(user.id, patch);
  return updated || { ...user, ...patch };
}

function calcDaysSince(isoString) {
  if (!isoString) return null;
  const dt = new Date(isoString);
  if (Number.isNaN(dt.getTime())) return null;
  const diff = Date.now() - dt.getTime();
  return Math.floor(diff / (24 * 60 * 60 * 1000));
}

async function maybeSendDiagnosisTrialFollowup(event, user) {
  const startedAt = user?.diagnosis_trial_started_at;
  if (!startedAt) return false;

  const days = calcDaysSince(startedAt);
  if (days == null) return false;

  if (days >= 7 && !user?.diagnosis_trial_day7_sent_at) {
    const payload = buildDiagnosisDay7Reply(user);
    await saveUserState(user.id, { diagnosis_trial_day7_sent_at: new Date().toISOString() });
    await replyMessage(event.replyToken, textMessageWithQuickReplies(prefixWithName(user, payload.text), payload.quickReplies), env.LINE_CHANNEL_ACCESS_TOKEN);
    return true;
  }

  if (days >= 5 && !user?.diagnosis_trial_day5_sent_at) {
    const payload = await buildDiagnosisDay5Reply(user);
    await saveUserState(user.id, { diagnosis_trial_day5_sent_at: new Date().toISOString() });
    await replyMessage(event.replyToken, textMessageWithQuickReplies(prefixWithName(user, payload.text), payload.quickReplies), env.LINE_CHANNEL_ACCESS_TOKEN);
    return true;
  }

  return false;
}

function buildGuideReplyByIntent(user, intent) {
  if (intent === 'food') return buildFoodGuideMessage();
  if (intent === 'exercise') return buildExerciseGuideMessage();
  if (intent === 'weight') return buildWeightGuideMessage();
  if (intent === 'consult') return buildConsultGuideMessage();
  if (intent === 'lab') return buildLabGuideMessage();
  if (intent === 'type') return buildTypeSelectionGuide();
  if (intent === 'faq') return buildFaqMessage();
  if (intent === 'help') return buildHelpMenuMessage();
  if (intent === 'trial') {
    return [
      typeof diagnosisTrialFlowService?.buildTrialQuickGuideMessage === 'function'
        ? diagnosisTrialFlowService.buildTrialQuickGuideMessage({ userName: getUserDisplayName(user) })
        : buildFirstGuideMessage({ userName: getUserDisplayName(user) }),
      '',
      typeof diagnosisTrialFlowService?.buildTrialValueGuideMessage === 'function'
        ? diagnosisTrialFlowService.buildTrialValueGuideMessage()
        : '',
      '',
      buildTrialMessageExamples(),
    ].filter(Boolean).join('\n\n');
  }
  if (intent === 'plan') {
    const guide = buildDiagnosisPlanGuideReply();
    return guide.text;
  }
  return '';
}

async function handleImageMessage(event, user) {
  try {
    const { buffer, mimeType } = await getLineImageContent(event.message.id, env.LINE_CHANNEL_ACCESS_TOKEN);
    const existingMealDraft = getMealDraft(user.line_user_id);

    let bloodExtraction = null;
    try {
      bloodExtraction = await extractBloodTestDraftFromImage(buffer, mimeType);
    } catch (bloodError) {
      console.error('⚠️ Blood test extraction failed:', bloodError?.message || bloodError);
    }

    const bloodTestLikely = isLikelyBloodTestExtraction(bloodExtraction);

    if (bloodTestLikely) {
      const dates = Array.isArray(bloodExtraction?.dates) ? bloodExtraction.dates.filter(Boolean) : [];
      const panels = Array.isArray(bloodExtraction?.panels) ? bloodExtraction.panels : [];

      const workingData = {};
      for (const panel of panels) {
        if (!panel?.date) continue;
        workingData[panel.date] = panel.items || {};
      }

      await createLabDraftSession(supabase, {
        user_id: user.id,
        line_user_id: user.line_user_id,
        line_message_id: event.message.id,
        status: 'draft',
        detected_dates_json: dates,
        selected_date: dates.length === 1 ? dates[0] : null,
        raw_extracted_json: bloodExtraction,
        working_data_json: workingData,
        source_image_url: null,
        expires_at: new Date(Date.now() + 30 * 60 * 1000).toISOString(),
      });

      clearMealDraft(user.line_user_id);

      if (dates.length > 1) {
        const msg = buildLabDateChoiceMessage({ working_data_json: workingData });
        await replyMessage(event.replyToken, textMessageWithQuickReplies(msg.text, msg.quickReplies), env.LINE_CHANNEL_ACCESS_TOKEN);
        return;
      }

      const msg = buildLabDraftSummaryMessage({ working_data_json: workingData, selected_date: dates[0] });
      await replyMessage(event.replyToken, textMessageWithQuickReplies(msg.text, msg.quickReplies), env.LINE_CHANNEL_ACCESS_TOKEN);
      return;
    }

    let finalMealDraft = null;
    try {
      finalMealDraft = await analyzeMealImageWithGeminiPrimary(buffer, mimeType);
    } catch (geminiMealError) {
      console.error('⚠️ Gemini meal analysis failed. Fallback to meal_image_ai_service:', geminiMealError?.message || geminiMealError);
    }

    if (!isMeaningfulMealDraft(finalMealDraft)) {
      const analyzedMeal = await analyzeMealImageWithAI(buffer, mimeType);
      finalMealDraft = isMeaningfulMealDraft(analyzedMeal) ? analyzedMeal : null;
    }

    if (existingMealDraft?.awaitingAdditionalPhoto) {
      if (isMeaningfulMealDraft(finalMealDraft)) {
        const mergedMeal = mergeMealDrafts(existingMealDraft.meal, finalMealDraft);
        setMealDraft(user.line_user_id, mergedMeal);
        const mealMessage = buildMealReplyWithSaveGuide(mergedMeal);
        await replyMessage(
          event.replyToken,
          textMessageWithQuickReplies(prefixWithName(user, `追加写真も反映しました。\n\n${mealMessage}`), buildMealFollowupQuickReplies()),
          env.LINE_CHANNEL_ACCESS_TOKEN
        );
        return;
      }

      setMealDraft(user.line_user_id, existingMealDraft.meal);
      await replyMessage(
        event.replyToken,
        textMessageWithQuickReplies(
          prefixWithName(user, '追加写真を食事として読み取れませんでした。もう一度送り直すか、そのまま文字で追加・修正内容を送ってください。'),
          buildMealFollowupQuickReplies()
        ),
        env.LINE_CHANNEL_ACCESS_TOKEN
      );
      return;
    }

    if (isMeaningfulMealDraft(finalMealDraft)) {
      setMealDraft(user.line_user_id, finalMealDraft);
      const mealMessage = buildMealReplyWithSaveGuide(finalMealDraft);
      await replyMessage(
        event.replyToken,
        textMessageWithQuickReplies(prefixWithName(user, mealMessage), buildMealFollowupQuickReplies()),
        env.LINE_CHANNEL_ACCESS_TOKEN
      );
      return;
    }

    await replyMessage(event.replyToken, '画像を読み取りましたが、食事写真や血液検査画像としてはっきり判定できませんでした。もう少し見やすい写真を送ってください。', env.LINE_CHANNEL_ACCESS_TOKEN);
   } catch (error) {
    console.error('❌ handleImageMessage error:', error?.stack || error?.message || error);
    await replyMessage(
      event.replyToken,
      '写真ありがとうございます。こちらでうまく整理しきれなかったので、もう一度だけ送ってもらえると助かります。少し見やすい角度だと読み取りやすいです。',
      env.LINE_CHANNEL_ACCESS_TOKEN
    );
  }
}

async function handleOnboardingMessage(event, user) {
  const text = String(event?.message?.text || '').trim();

  let state = normalizeUserState(user);
  if (!user?.onboarding_state_json && !user?.onboarding_status) {
    state = createInitialOnboardingState();
    const initialPatch = buildOnboardingStatePatch(state);
    const { error } = await supabase.from('users').update(initialPatch).eq('id', user.id);
    if (error) throw error;
  }

  const currentUserForAdvance = { ...user, onboarding_state_json: JSON.stringify(state) };
  const result = advanceOnboardingState(currentUserForAdvance, text);

  if (!result.ok && result.errorMessage) {
    const reply = buildReplyPayload(state);
    const errorText = `${result.errorMessage}\n\n${reply.text}`;
    await replyMessage(event.replyToken, textMessageWithQuickReplies(errorText, reply.quickReplies), env.LINE_CHANNEL_ACCESS_TOKEN);
    return;
  }

  const nextState = result.state || state;
  const patch = buildOnboardingStatePatch(nextState);
  const { error } = await supabase.from('users').update(patch).eq('id', user.id);
  if (error) throw error;

  const reply = buildReplyPayload(nextState);
  const onboardingCompleted = safeText(patch?.onboarding_status || '', '') === 'completed' || String(nextState?.current_step || '').trim().toLowerCase() === 'done';

  if (onboardingCompleted) {
    const refreshedUser = await refreshUserById(supabase, user.id);
    const trialResult = await ensureTrialStartedForUser(refreshedUser || user);
    const messages = [textMessageWithQuickReplies(reply.text, reply.quickReplies)];

    if (trialResult.started) {
      const trialStarted = buildTrialStartedMessage();
      messages.push(buildMembershipReplyMessage(trialResult.user || refreshedUser || user, trialStarted));
    }

    await replyMessage(event.replyToken, messages, env.LINE_CHANNEL_ACCESS_TOKEN);
    return;
  }

  await replyMessage(event.replyToken, textMessageWithQuickReplies(reply.text, reply.quickReplies), env.LINE_CHANNEL_ACCESS_TOKEN);
}

async function beginProfileManagementFlow(event, user, mode) {
  const state = startProfileEditFromUser(user, mode);
  const patch = buildOnboardingStatePatch(state);
  const { error } = await supabase.from('users').update(patch).eq('id', user.id);
  if (error) throw error;

  const reply = buildReplyPayload(state);
  await replyMessage(event.replyToken, textMessageWithQuickReplies(reply.text, reply.quickReplies), env.LINE_CHANNEL_ACCESS_TOKEN);
}

async function saveMembershipAdminMemo(input = {}) {
  if (!createMembershipAdminMemo || !isAdminMemoDebugEnabled()) return;
  const memo = createMembershipAdminMemo(input);
  safeConsoleLog('[MEMBERSHIP_ADMIN_MEMO]', memo?.memo_text || memo);
}

async function handleTextMessage(event, user) {
  const text = String(event.message.text || '').trim();
  const lower = text.toLowerCase();

  try {
    const parsedName = parseDisplayName(text);
    if (parsedName) {
      const safeName = normalizeStoredDisplayName(parsedName);
      if (!safeName) {
        await replyMessage(event.replyToken, 'お名前の受け取りが少しあいまいでした。たとえば「名前は牛込です」のように送ってください。', env.LINE_CHANNEL_ACCESS_TOKEN);
        return;
      }

      const { error } = await supabase.from('users').update({ display_name: safeName }).eq('id', user.id);
      if (error) throw error;

      const replyText = `${safeName}さんですね。これからはそうお呼びします。`;
      await replyMessage(event.replyToken, replyText, env.LINE_CHANNEL_ACCESS_TOKEN);
      await rememberInteraction(user, text, replyText);
      return;
    }

    if (isCurrentDateTimeQuestion(text)) {
      const replyText = buildCurrentDateTimeReply(TZ);
      await replyMessage(event.replyToken, replyText, env.LINE_CHANNEL_ACCESS_TOKEN);
      await rememberInteraction(user, text, replyText);
      return;
    }

    if (isAiPersonaChangeCommand(text)) {
      const replyText = prefixWithName(user, getPersonaSelectionMessage());
      await replyMessage(
        event.replyToken,
        textMessageWithQuickReplies(replyText, buildAiPersonaQuickReplies()),
        env.LINE_CHANNEL_ACCESS_TOKEN
      );
      return;
    }

    if (isPersonaSelectionText(text) && !isDiagnosisActive(user)) {
      const updatedUser = await updateUserAiPersona(user.id, getPersonaTypeFromLabel(text));
      const label = getPersonaLabel(getEffectivePersonaType(updatedUser || user));
      const replyText = prefixWithName(updatedUser || user, `これからは「${label}」の雰囲気で伴走しますね。必要ならまた変えられます。`);
      await replyMessage(event.replyToken, replyText, env.LINE_CHANNEL_ACCESS_TOKEN);
      await rememberInteraction(updatedUser || user, text, replyText);
      return;
    }
    const pendingConfirmation = getRecentCaptureConfirmation(user.line_user_id);
    if (pendingConfirmation) {
      if (isConfirmSaveText(text)) {
        if (pendingConfirmation.capture_type === 'body_metrics') {
          const savedReply = await saveBodyMetricsFromPayload(user, pendingConfirmation.payload, pendingConfirmation.source_text || text);
          clearRecentCaptureConfirmation(user.line_user_id);

          const replyText = prefixWithName(user, savedReply);
          await replyMessage(
            event.replyToken,
            textMessageWithQuickReplies(replyText, ['体重グラフ', '予測', '食事活動グラフ', 'グラフ']),
            env.LINE_CHANNEL_ACCESS_TOKEN
          );
          await rememberInteraction(user, text, replyText);
          return;
        }
      }

      if (isDeclineSaveText(text)) {
        clearRecentCaptureConfirmation(user.line_user_id);
        const replyText = prefixWithName(user, '大丈夫です。今回は保存せず、このまま会話を続けましょう。');
        await replyMessage(event.replyToken, replyText, env.LINE_CHANNEL_ACCESS_TOKEN);
        await rememberInteraction(user, text, replyText);
        return;
      }

      if (isEditSaveText(text)) {
        clearRecentCaptureConfirmation(user.line_user_id);
        const replyText = prefixWithName(user, 'ありがとうございます。では、違うところだけそのまま教えてくださいね。こちらで整えます。');
        await replyMessage(event.replyToken, replyText, env.LINE_CHANNEL_ACCESS_TOKEN);
        await rememberInteraction(user, text, replyText);
        return;
      }
    }

    const chatCapture = await analyzeChatCapture({ userText: text, user });

    if (chatCapture?.capture_type === 'body_metrics') {
      const hasWeight = Number.isFinite(Number(chatCapture?.payload?.weight_kg));
      const hasBodyFat = Number.isFinite(Number(chatCapture?.payload?.body_fat_percent));

      if (hasWeight || hasBodyFat) {
        if (chatCapture.auto_save) {
          const savedReply = await saveBodyMetricsFromPayload(user, chatCapture.payload, text);
          const replyText = prefixWithName(user, savedReply);

          await replyMessage(
            event.replyToken,
            textMessageWithQuickReplies(replyText, ['体重グラフ', '予測', '食事活動グラフ', 'グラフ']),
            env.LINE_CHANNEL_ACCESS_TOKEN
          );
          await rememberInteraction(user, text, replyText);
          return;
        }

        if (chatCapture.needs_confirmation) {
          setRecentCaptureConfirmation(user.line_user_id, {
            capture_type: 'body_metrics',
            payload: chatCapture.payload,
            source_text: text,
          });

          const replyText = prefixWithName(
            user,
            chatCapture.reply_text || 'こちらでこう受け取っています。違っていなければ保存しておきますか？'
          );

          await replyMessage(
            event.replyToken,
            textMessageWithQuickReplies(replyText, ['はい、保存', '修正する', '今回は保存しない']),
            env.LINE_CHANNEL_ACCESS_TOKEN
          );
          await rememberInteraction(user, text, replyText);
          return;
        }
      }
    }
    const earlyParsedMetrics = parseBodyMetricsInput(text);
    if (earlyParsedMetrics.weightKg !== null || earlyParsedMetrics.bodyFatPercent !== null) {
      if (earlyParsedMetrics.weightKg !== null) {
        await saveWeightToLog(user.id, earlyParsedMetrics.weightKg, text);
      }

      if (earlyParsedMetrics.bodyFatPercent !== null) {
        await saveBodyFatToLog(user.id, earlyParsedMetrics.bodyFatPercent, text);
      }

      const statePatch = {
        last_any_log_at: new Date().toISOString(),
      };

      if (earlyParsedMetrics.weightKg !== null) {
        statePatch.last_weight_logged_at = new Date().toISOString();
      }

      if (earlyParsedMetrics.bodyFatPercent !== null) {
        statePatch.last_body_fat_logged_at = new Date().toISOString();
      }

      await saveUserState(user.id, statePatch);

      let diffText = null;
      if (earlyParsedMetrics.weightKg !== null) {
        const recentWeights = await getRecentWeightRows(user.id, 10);
        const latest = recentWeights[0] || { weight_kg: earlyParsedMetrics.weightKg };
        const prev = recentWeights[1] || null;

        diffText = (() => {
          if (!prev || prev.weight_kg == null) return '前回比較はまだありません。';
          const diff = Math.round((Number(latest.weight_kg) - Number(prev.weight_kg)) * 10) / 10;
          if (diff === 0) return '前回から変化はありません。';
          if (diff > 0) return `前回より ${diff}kg 増えています。`;
          return `前回より ${Math.abs(diff)}kg 減っています。`;
        })();
      }

      const lines = [];
      if (earlyParsedMetrics.weightKg !== null && earlyParsedMetrics.bodyFatPercent !== null) {
        lines.push('体重と体脂肪率を保存しました。');
        lines.push(`体重: ${earlyParsedMetrics.weightKg}kg`);
        lines.push(`体脂肪率: ${earlyParsedMetrics.bodyFatPercent}%`);
      } else if (earlyParsedMetrics.weightKg !== null) {
        lines.push('体重を保存しました。');
        lines.push(`今回: ${earlyParsedMetrics.weightKg}kg`);
      } else if (earlyParsedMetrics.bodyFatPercent !== null) {
        lines.push('体脂肪率を保存しました。');
        lines.push(`今回: ${earlyParsedMetrics.bodyFatPercent}%`);
      }

      if (diffText) {
        lines.push(diffText);
      }

      if (earlyParsedMetrics.weightKg !== null && earlyParsedMetrics.bodyFatPercent === null) {
        lines.push('体脂肪率も分かれば、続けてそのまま送ってください。');
      }

      if (earlyParsedMetrics.bodyFatPercent !== null && earlyParsedMetrics.weightKg === null) {
        lines.push('体重も分かれば、続けてそのまま送ってください。');
      }

      const replyText = prefixWithName(user, lines.join('\n'));
      await replyMessage(
        event.replyToken,
        textMessageWithQuickReplies(replyText, ['体重グラフ', '予測', '食事活動グラフ', 'グラフ']),
        env.LINE_CHANNEL_ACCESS_TOKEN
      );
      await rememberInteraction(user, text, replyText);
      return;
    }

    const guideIntent = detectGuideIntent(text);
    if (guideIntent) {
      const guideText = buildGuideReplyByIntent(user, guideIntent);
      if (guideText) {
        await replyMessage(event.replyToken, prefixWithName(user, guideText), env.LINE_CHANNEL_ACCESS_TOKEN);
        return;
      }
    }

    if (isHelpCommand(lower)) {
      await replyMessage(event.replyToken, helpMessage(), env.LINE_CHANNEL_ACCESS_TOKEN);
      return;
    }

    if (await maybeSendDiagnosisTrialFollowup(event, user)) {
      return;
    }

    if (text === '診断スタート') {
      const startedUser = await startDiagnosisForUser(user);
      const state = normalizeDiagnosisState(startedUser);
      const firstQuestion = buildDiagnosisQuestionReply(state);
      await replyMessage(event.replyToken, textMessageWithQuickReplies(firstQuestion.text, firstQuestion.quickReplies), env.LINE_CHANNEL_ACCESS_TOKEN);
      return;
    }

    if (isDiagnosisStartTrigger(text)) {
      const startReply = buildDiagnosisStartReply();
      await replyMessage(event.replyToken, textMessageWithQuickReplies(prefixWithName(user, startReply.text), startReply.quickReplies), env.LINE_CHANNEL_ACCESS_TOKEN);
      return;
    }

    if (isDiagnosisActive(user)) {
      if (text === 'またあとで') {
        const pausedState = { ...normalizeDiagnosisState(user), active: false };
        await saveDiagnosisState(user.id, pausedState);
        const replyText = prefixWithName(user, '大丈夫です。また「無料診断」や「診断スタート」で再開できます。');
        await replyMessage(event.replyToken, replyText, env.LINE_CHANNEL_ACCESS_TOKEN);
        return;
      }

      if (text === '最初からやり直す') {
        const resetUser = await resetDiagnosisForUser(user);
        const state = normalizeDiagnosisState(resetUser);
        const firstQuestion = buildDiagnosisQuestionReply(state);
        await replyMessage(event.replyToken, textMessageWithQuickReplies(firstQuestion.text, firstQuestion.quickReplies), env.LINE_CHANNEL_ACCESS_TOKEN);
        return;
      }

      await handleDiagnosisAnswer(event, user, text);
      return;
    }

    if (text === '7日無料ライト体験へ進む') {
      const trialUser = await startDiagnosisLightTrial(user);
      const payload = buildDiagnosisTrialStartedReply(trialUser);
      await replyMessage(
        event.replyToken,
        textMessageWithQuickReplies(prefixWithName(trialUser, payload.text), payload.quickReplies),
        env.LINE_CHANNEL_ACCESS_TOKEN
      );
      await rememberInteraction(trialUser, text, payload.text);
      return;
    }

    if (text === 'プラン案内を見る') {
      const payload = buildDiagnosisPlanGuideReply();
      await replyMessage(
        event.replyToken,
        textMessageWithQuickReplies(prefixWithName(user, payload.text), payload.quickReplies),
        env.LINE_CHANNEL_ACCESS_TOKEN
      );
      return;
    }

    if (text === 'スペシャル希望') {
      const updatedUser = await saveUserState(user.id, { diagnosis_special_interest: true });
      const payload = buildDiagnosisSpecialReply();
      await replyMessage(
        event.replyToken,
        textMessageWithQuickReplies(prefixWithName(updatedUser || user, payload.text), payload.quickReplies),
        env.LINE_CHANNEL_ACCESS_TOKEN
      );
      return;
    }

    if (isInputHelpIntent(text)) {
      const replyText = prefixWithName(user, buildInputHelpMessage());
      await replyMessage(event.replyToken, replyText, env.LINE_CHANNEL_ACCESS_TOKEN);
      await rememberInteraction(user, text, replyText);
      return;
    }

    if (isPastDateHelpIntent(text)) {
      const replyText = prefixWithName(user, buildPastDateHelpMessage());
      await replyMessage(event.replyToken, replyText, env.LINE_CHANNEL_ACCESS_TOKEN);
      await rememberInteraction(user, text, replyText);
      return;
    }

    if (hasPendingCapture(user) && isRetryIntent(text)) {
      await saveUserState(user.id, {
        pending_capture_type: null,
        pending_capture_status: null,
        pending_capture_payload: null,
        pending_capture_missing_fields: null,
        pending_capture_prompt: null,
        pending_capture_started_at: null,
        pending_capture_source_text: null,
        pending_capture_attempts: 0,
      });

      const replyText = prefixWithName(user, buildRetrySupportMessage());
      await replyMessage(event.replyToken, replyText, env.LINE_CHANNEL_ACCESS_TOKEN);
      await rememberInteraction(user, text, replyText);
      return;
    }

    if (isProfileConfirmCommand(text)) {
      await beginProfileManagementFlow(event, user, 'confirm');
      return;
    }

    if (isProfileEditCommand(text)) {
      await beginProfileManagementFlow(event, user, 'edit');
      return;
    }

    if (isProfileResetCommand(text)) {
      await beginProfileManagementFlow(event, user, 'reset');
      return;
    }

    const smartFlowResult = await handleSmartConversationFlow({ user, text });

    if (smartFlowResult?.next === 'onboarding_start') {
      await handleOnboardingMessage(event, user);
      return;
    }

    if (smartFlowResult?.handled) {
      if (smartFlowResult.next === 'reply_pending_question') {
        await replyMessage(event.replyToken, prefixWithName(user, smartFlowResult.replyText), env.LINE_CHANNEL_ACCESS_TOKEN);
        return;
      }

      if (smartFlowResult.next === 'save_exercise' || smartFlowResult.next === 'save_exercise_from_pending') {
        await saveExerciseSmartPayload(user, smartFlowResult.payload, text);
        await saveUserState(user.id, {
          pending_capture_type: null,
          pending_capture_status: null,
          pending_capture_payload: null,
          pending_capture_missing_fields: null,
          pending_capture_prompt: null,
          pending_capture_started_at: null,
          pending_capture_source_text: null,
          pending_capture_attempts: 0,
          last_checkin_at: new Date().toISOString(),
          last_any_log_at: new Date().toISOString(),
          last_exercise_logged_at: new Date().toISOString(),
        });

        const totals = await getTodayEnergyTotals(user.id);
        const energyText = buildEnergySummaryText({
          estimatedBmr: user.estimated_bmr || 0,
          estimatedTdee: user.estimated_tdee || 0,
          intakeKcal: totals.intake_kcal || 0,
          activityKcal: totals.activity_kcal || 0,
        });

        const replyText = prefixWithName(user, `ありがとうございます。運動記録として残しました。\n\n${energyText}`);
        await replyMessage(event.replyToken, textMessageWithQuickReplies(replyText, [...buildExerciseFollowupQuickReplies(), '予測', 'グラフ']), env.LINE_CHANNEL_ACCESS_TOKEN);
        await rememberInteraction(user, text, replyText);
        return;
      }

      if (smartFlowResult.next === 'save_meal' || smartFlowResult.next === 'save_meal_from_pending') {
        const savedMeal = await saveMealSmartPayload(user, smartFlowResult.payload, text);
        await saveUserState(user.id, {
          pending_capture_type: null,
          pending_capture_status: null,
          pending_capture_payload: null,
          pending_capture_missing_fields: null,
          pending_capture_prompt: null,
          pending_capture_started_at: null,
          pending_capture_source_text: null,
          pending_capture_attempts: 0,
          last_checkin_at: new Date().toISOString(),
          last_any_log_at: new Date().toISOString(),
          last_meal_logged_at: new Date().toISOString(),
        });

        const totals = await getTodayEnergyTotals(user.id);
        const nutritionLines = buildMealNutritionLines(savedMeal);
        const replyText = prefixWithName(
          user,
          [
            'ありがとうございます。食事記録として残しました。',
            `料理: ${savedMeal.meal_label}`,
            savedMeal.estimated_kcal != null ? `今回の推定摂取: ${fmt(savedMeal.estimated_kcal)} kcal` : null,
            nutritionLines.length ? '' : null,
            ...(nutritionLines.length ? nutritionLines : []),
            `本日摂取合計: ${fmt(totals.intake_kcal || 0)} kcal`,
          ].filter(Boolean).join('\n')
        );

        await replyMessage(event.replyToken, textMessageWithQuickReplies(replyText, ['次の食事を記録', '少し歩いた', '予測', 'グラフ']), env.LINE_CHANNEL_ACCESS_TOKEN);
        await rememberInteraction(user, text, replyText);
        return;
      }

      if (smartFlowResult.next === 'save_weight' || smartFlowResult.next === 'save_weight_from_pending') {
        const weightKg = Number(smartFlowResult.payload?.weight_kg);
        await saveWeightToLog(user.id, weightKg, text);
        await saveUserState(user.id, {
          pending_capture_type: null,
          pending_capture_status: null,
          pending_capture_payload: null,
          pending_capture_missing_fields: null,
          pending_capture_prompt: null,
          pending_capture_started_at: null,
          pending_capture_source_text: null,
          pending_capture_attempts: 0,
          last_checkin_at: new Date().toISOString(),
          last_any_log_at: new Date().toISOString(),
          last_weight_logged_at: new Date().toISOString(),
        });

        const recentWeights = await getRecentWeightRows(user.id, 10);
        const latest = recentWeights[0] || { weight_kg: weightKg };
        const prev = recentWeights[1] || null;

        const diffText = (() => {
          if (!prev || prev.weight_kg == null) return '前回比較はまだありません。';
          const diff = Math.round((Number(latest.weight_kg) - Number(prev.weight_kg)) * 10) / 10;
          if (diff === 0) return '前回から変化はありません。';
          if (diff > 0) return `前回より ${diff}kg 増えています。`;
          return `前回より ${Math.abs(diff)}kg 減っています。`;
        })();

        const replyText = prefixWithName(user, `体重を保存しました。\n今回: ${weightKg}kg\n${diffText}`);
        await replyMessage(event.replyToken, textMessageWithQuickReplies(replyText, ['体重グラフ', '予測', '食事活動グラフ', 'グラフ']), env.LINE_CHANNEL_ACCESS_TOKEN);
        await rememberInteraction(user, text, replyText);
        return;
      }

      if (smartFlowResult.next === 'save_body_fat' || smartFlowResult.next === 'save_body_fat_from_pending') {
        const bodyFatPercent = Number(smartFlowResult.payload?.body_fat_percent);
        await saveBodyFatToLog(user.id, bodyFatPercent, text);
        await saveUserState(user.id, {
          pending_capture_type: null,
          pending_capture_status: null,
          pending_capture_payload: null,
          pending_capture_missing_fields: null,
          pending_capture_prompt: null,
          pending_capture_started_at: null,
          pending_capture_source_text: null,
          pending_capture_attempts: 0,
          last_checkin_at: new Date().toISOString(),
          last_any_log_at: new Date().toISOString(),
          last_body_fat_logged_at: new Date().toISOString(),
        });

        const replyText = prefixWithName(user, `ありがとうございます。体脂肪率 ${bodyFatPercent}% を記録しました。`);
        await replyMessage(event.replyToken, replyText, env.LINE_CHANNEL_ACCESS_TOKEN);
        await rememberInteraction(user, text, replyText);
        return;
      }
    }

    if (isOnboardingActive(user) || isOnboardingStartCommand(text) || isIntakeStartCommand(text)) {
      if (isIntakeStartCommand(text)) {
        const session = await startOrResumeIntake(user);
        const msg = renderIntakeStepMessage(session);
        await replyMessage(event.replyToken, textMessageWithQuickReplies(msg.text, msg.quickReplies), env.LINE_CHANNEL_ACCESS_TOKEN);
        return;
      }

      await handleOnboardingMessage(event, user);
      return;
    }

    const openIntake = await getOpenIntakeSession(user.id);
    if (openIntake) {
      if (text === '最初からやり直す') {
        const reset = await updateIntakeSession(openIntake.id, { current_step: 'choose_ai_type', answers_json: createEmptyIntakeAnswers() });
        const msg = renderIntakeStepMessage(reset);
        await replyMessage(event.replyToken, textMessageWithQuickReplies(msg.text, msg.quickReplies), env.LINE_CHANNEL_ACCESS_TOKEN);
        return;
      }

      if (openIntake.current_step === 'confirm_finish' && text === 'この内容で完了') {
        await completeIntakeSession(user, openIntake);

        const refreshedUser = await refreshUserById(supabase, user.id);
        const trialResult = await ensureTrialStartedForUser(refreshedUser || user);
        const finalUser = trialResult.user || refreshedUser || user;
        const completeReplyText = prefixWithName(finalUser, '初回設定が完了しました。ここから一緒に整えていきましょうね。');

        if (trialResult.started) {
          const trialStarted = buildTrialStartedMessage();
          await replyMessage(
            event.replyToken,
            [buildLineTextMessage(completeReplyText), buildMembershipReplyMessage(finalUser, trialStarted)],
            env.LINE_CHANNEL_ACCESS_TOKEN
          );
          await rememberInteraction(finalUser, text, `${completeReplyText}\n\n${trialStarted.text}`);
          return;
        }

        await replyMessage(event.replyToken, completeReplyText, env.LINE_CHANNEL_ACCESS_TOKEN);
        await rememberInteraction(finalUser, text, completeReplyText);
        return;
      }

      const validated = validateIntakeAnswer(openIntake.current_step, text);
      if (validated.ok) {
        const updated = await updateIntakeSession(openIntake.id, {
          current_step: validated.nextStep,
          answers_json: { ...(openIntake.answers_json || {}), ...validated.patch },
        });
        const msg = renderIntakeStepMessage(updated);
        await replyMessage(event.replyToken, textMessageWithQuickReplies(msg.text, msg.quickReplies), env.LINE_CHANNEL_ACCESS_TOKEN);
        return;
      }

      const currentMsg = renderIntakeStepMessage(openIntake);
      await replyMessage(event.replyToken, textMessageWithQuickReplies(currentMsg.text, currentMsg.quickReplies), env.LINE_CHANNEL_ACCESS_TOKEN);
      return;
    }

    if (shouldPromptTrialPlan(user)) {
      await updateUserTrialMembership(user.id, markTrialPlanPromptedPatch());
      const msg = buildTrialReviewMessage(user);
      await replyMessage(event.replyToken, buildMembershipReplyMessage(user, msg), env.LINE_CHANNEL_ACCESS_TOKEN);
      return;
    }

    if (shouldPromptRenewal(user)) {
      await updateUserTrialMembership(user.id, markRenewalPromptedPatch());
      const msg = buildMonthlyRenewalMessage(user);
      await replyMessage(event.replyToken, buildMembershipReplyMessage(user, msg), env.LINE_CHANNEL_ACCESS_TOKEN);
      return;
    }

    if (isTrialStatusIntent(text) || isTrialGuideIntent(text)) {
      const msg = buildTrialStatusMessage(user);
      await replyMessage(event.replyToken, buildMembershipReplyMessage(user, msg), env.LINE_CHANNEL_ACCESS_TOKEN);
      return;
    }

    if (isCurrentPlanIntent(text)) {
      const msg = buildCurrentPlanStatusMessage(user);
      await replyMessage(event.replyToken, buildMembershipReplyMessage(user, msg), env.LINE_CHANNEL_ACCESS_TOKEN);
      return;
    }

    if (isPlanGuideTrigger(text) || ['プラン案内を見る', '別プランも見る', '内容を確認する', 'プラン変更したい', 'プランをもう一度見る', 'プラン再表示'].includes(text)) {
      await saveUserState(user.id, { current_flow: null, membership_note: null });
      const msg = buildPlanGuideMessageV2();
      await replyMessage(event.replyToken, buildMembershipReplyMessage(user, msg), env.LINE_CHANNEL_ACCESS_TOKEN);
      return;
    }

    if (text === '少し休みたい') {
      await saveUserState(user.id, { current_flow: 'membership_pause_reason', membership_note: null });
      const msg = buildPauseReasonPrompt();
      await replyMessage(event.replyToken, buildMembershipReplyMessage(user, msg), env.LINE_CHANNEL_ACCESS_TOKEN);
      return;
    }

    if (text === '解約したい') {
      await saveUserState(user.id, { current_flow: 'membership_cancel_reason', membership_note: null });
      const msg = buildCancelReasonPrompt();
      await replyMessage(event.replyToken, buildMembershipReplyMessage(user, msg), env.LINE_CHANNEL_ACCESS_TOKEN);
      return;
    }

    if ((getMembershipStatus(user) === MEMBERSHIP_STATUS.PAUSED || getMembershipStatus(user) === MEMBERSHIP_STATUS.CANCELLED) && (text === '再開したい' || text === 'また再開したい')) {
      const msg = buildResumeGuideMessage(user);
      await replyMessage(event.replyToken, buildMembershipReplyMessage(user, msg), env.LINE_CHANNEL_ACCESS_TOKEN);
      return;
    }

    if (user.current_flow === 'membership_pause_reason' && (isPauseReasonOption(text) || safeText(text))) {
      await saveUserState(user.id, { current_flow: 'membership_pause_confirm', membership_note: safeText(text) });
      const replyText = prefixWithName(user, [`休止理由: ${safeText(text)}`, '', 'この内容で休止する場合は「この内容で確定」と送ってください。', 'やめる場合は「キャンセル」で大丈夫です。'].join('\n'));
      await replyMessage(event.replyToken, textMessageWithQuickReplies(replyText, ['この内容で確定', 'キャンセル']), env.LINE_CHANNEL_ACCESS_TOKEN);
      return;
    }

    if (user.current_flow === 'membership_cancel_reason' && (isCancelReasonOption(text) || safeText(text))) {
      await saveUserState(user.id, { current_flow: 'membership_cancel_confirm', membership_note: safeText(text) });
      const replyText = prefixWithName(user, [`終了理由: ${safeText(text)}`, '', 'この内容で終了する場合は「この内容で確定」と送ってください。', 'やめる場合は「キャンセル」で大丈夫です。'].join('\n'));
      await replyMessage(event.replyToken, textMessageWithQuickReplies(replyText, ['この内容で確定', 'キャンセル']), env.LINE_CHANNEL_ACCESS_TOKEN);
      return;
    }

    if (user.current_flow === 'membership_pause_confirm') {
      if (isMembershipCancelIntent(text)) {
        await saveUserState(user.id, { current_flow: null, membership_note: null });
        const replyText = prefixWithName(user, buildMembershipCancelMessage());
        await replyMessage(event.replyToken, replyText, env.LINE_CHANNEL_ACCESS_TOKEN);
        return;
      }

      if (isMembershipConfirmIntent(text)) {
        const updated = await updateUserTrialMembership(user.id, {
          ...buildPauseMembershipPatch(new Date(), user.membership_note || ''),
          membership_note: user.membership_note || '',
          current_flow: null,
        });

        await saveMembershipAdminMemo({
          user_name: getUserDisplayName(user) || '利用者',
          action_type: 'pause',
          membership_status: updated?.membership_status || 'paused',
          current_plan: user.current_plan || '',
          target_plan: '',
          note: user.membership_note || '',
          created_at: new Date().toISOString(),
        });

        const replyText = prefixWithName(user, buildMembershipConfirmMessage('pause'));
        await replyMessage(event.replyToken, textMessageWithQuickReplies(replyText, ['また再開したい', 'プラン案内を見る', 'まず相談したい']), env.LINE_CHANNEL_ACCESS_TOKEN);
        await rememberInteraction(user, text, replyText);
        return;
      }
    }

    if (user.current_flow === 'membership_cancel_confirm') {
      if (isMembershipCancelIntent(text)) {
        await saveUserState(user.id, { current_flow: null, membership_note: null });
        const replyText = prefixWithName(user, buildMembershipCancelMessage());
        await replyMessage(event.replyToken, replyText, env.LINE_CHANNEL_ACCESS_TOKEN);
        return;
      }

      if (isMembershipConfirmIntent(text)) {
        const updated = await updateUserTrialMembership(user.id, {
          ...buildCancelMembershipPatch(new Date(), user.membership_note || ''),
          membership_note: user.membership_note || '',
          current_flow: null,
        });

        await saveMembershipAdminMemo({
          user_name: getUserDisplayName(user) || '利用者',
          action_type: 'cancel',
          membership_status: updated?.membership_status || 'cancelled',
          current_plan: user.current_plan || '',
          target_plan: '',
          note: user.membership_note || '',
          created_at: new Date().toISOString(),
        });

        const replyText = prefixWithName(user, buildMembershipConfirmMessage('cancel'));
        await replyMessage(event.replyToken, textMessageWithQuickReplies(replyText, ['また再開したい', 'プラン案内を見る', 'まず相談したい']), env.LINE_CHANNEL_ACCESS_TOKEN);
        await rememberInteraction(user, text, replyText);
        return;
      }
    }

    if (text === 'このまま再開したい') {
      const basePlan = user.current_plan || PLAN_TYPES.BASIC;
      const updated = await updateUserTrialMembership(user.id, { ...buildResumeMembershipPatch(basePlan), current_flow: null });

      await saveMembershipAdminMemo({
        user_name: getUserDisplayName(user) || '利用者',
        action_type: 'resume',
        membership_status: updated?.membership_status || 'active',
        current_plan: basePlan,
        target_plan: basePlan,
        note: '同プラン再開',
        created_at: new Date().toISOString(),
      });

      const rewardText = buildRewardMessage('resumed', { display_name: getUserDisplayName(user) });
      const replyText = prefixWithName(user, `${buildMembershipConfirmMessage('resume', getPlanLabel(basePlan))}\n\n${rewardText}`);
      await replyMessage(event.replyToken, textMessageWithQuickReplies(replyText, ['現在のプラン', 'プラン案内を見る', '今日の記録を始める']), env.LINE_CHANNEL_ACCESS_TOKEN);
      await rememberInteraction(user, text, replyText);
      return;
    }

    if (text === 'プラン変更して再開したい') {
      await saveUserState(user.id, { current_flow: 'membership_resume_plan_select' });
      const msg = buildPlanGuideMessageV2();
      await replyMessage(event.replyToken, buildMembershipReplyMessage(user, msg), env.LINE_CHANNEL_ACCESS_TOKEN);
      return;
    }

    if (text === '今はまだ再開しない') {
      const replyText = prefixWithName(user, '大丈夫です。必要になった時に、またここから再開できます。');
      await replyMessage(event.replyToken, replyText, env.LINE_CHANNEL_ACCESS_TOKEN);
      await rememberInteraction(user, text, replyText);
      return;
    }

    const selectedPlan = normalizePlanSelection(text);
    if (selectedPlan) {
      if (user.current_flow === 'membership_resume_plan_select') {
        const updatedUser = await updateUserTrialMembership(user.id, { ...buildResumeMembershipPatch(selectedPlan), current_flow: null });

        await saveMembershipAdminMemo({
          user_name: getUserDisplayName(user) || '利用者',
          action_type: 'resume_with_plan_change',
          membership_status: updatedUser?.membership_status || 'active',
          current_plan: user.current_plan || '',
          target_plan: selectedPlan,
          note: 'プラン変更して再開',
          created_at: new Date().toISOString(),
        });

        const rewardText = buildRewardMessage('resumed', { display_name: getUserDisplayName(user) });
        const replyText = prefixWithName(user, `${buildMembershipConfirmMessage('resume', getPlanLabel(selectedPlan))}\n\n${rewardText}`);
        await replyMessage(event.replyToken, textMessageWithQuickReplies(replyText, ['現在のプラン', '今日の記録を始める', 'プラン案内を見る']), env.LINE_CHANNEL_ACCESS_TOKEN);
        await rememberInteraction(user, text, replyText);
        return;
      }

      const updatedUser = await updateUserTrialMembership(user.id, activatePlanPatch(selectedPlan));
      const finalUser = updatedUser || user;
      const msg = buildPlanSelectedMessage(selectedPlan);

      await saveMembershipAdminMemo({
        user_name: getUserDisplayName(user) || '利用者',
        action_type: 'plan_selected',
        membership_status: finalUser?.membership_status || 'active',
        current_plan: user.current_plan || '',
        target_plan: selectedPlan,
        note: '',
        created_at: new Date().toISOString(),
      });

      await replyMessage(event.replyToken, buildMembershipReplyMessage(finalUser, msg), env.LINE_CHANNEL_ACCESS_TOKEN);
      await rememberInteraction(finalUser, text, msg.text);
      return;
    }

    if (text === 'このプランで進めたい' || text === '継続したい') {
      const rewardText = buildRewardMessage('membership_started', { display_name: getUserDisplayName(user) });
      const replyText = prefixWithName(user, `ありがとうございます。選んだプランで進めやすい状態にしています。必要ならあとから変更もできます。\n\n${rewardText}`);
      await replyMessage(event.replyToken, replyText, env.LINE_CHANNEL_ACCESS_TOKEN);
      await rememberInteraction(user, text, replyText);
      return;
    }

    if (text === 'まず相談したい') {
      const replyText = prefixWithName(user, 'ありがとうございます。今の使い方や続け方は、無理のない形で一緒に整理できます。気になることをそのまま送ってください。');
      await replyMessage(event.replyToken, replyText, env.LINE_CHANNEL_ACCESS_TOKEN);
      await rememberInteraction(user, text, replyText);
      return;
    }

    if (text === 'もう少し体験したい') {
      const replyText = prefixWithName(user, '大丈夫です。まずは今のやり取りを見ながら、合う続け方を一緒に整えていきましょう。');
      await replyMessage(event.replyToken, replyText, env.LINE_CHANNEL_ACCESS_TOKEN);
      await rememberInteraction(user, text, replyText);
      return;
    }

    if (isProfileCommand(lower)) {
      const payload = buildProfileUpdatePayload(user, text);
      if (!payload) {
        await replyMessage(event.replyToken, profileGuideMessage(), env.LINE_CHANNEL_ACCESS_TOKEN);
        return;
      }

      const { error } = await supabase.from('users').update(payload).eq('id', user.id);
      if (error) throw error;

      const refreshedUser = await refreshUserById(supabase, user.id);
      const replyText = prefixWithName(refreshedUser, buildProfileReply(refreshedUser));
      await replyMessage(event.replyToken, replyText, env.LINE_CHANNEL_ACCESS_TOKEN);
      await rememberInteraction(refreshedUser, text, replyText);
      return;
    }


    const openLabDraft = await getOpenLabDraft(supabase, user.id);
    if (openLabDraft) {
      if (openLabDraft.active_item_name) {
        try {
          const updated = await applyLabCorrection(supabase, openLabDraft, text);
          const msg = buildLabDraftSummaryMessage(updated);
          await replyMessage(event.replyToken, textMessageWithQuickReplies(`ありがとうございます。修正しました。\n\n${msg.text}`, msg.quickReplies), env.LINE_CHANNEL_ACCESS_TOKEN);
          return;
        } catch (error) {
                    if (String(error?.message).includes('INVALID_DATE')) {
            await replyMessage(
              event.replyToken,
              'ありがとうございます。日付のところだけ、こちらでもう少しはっきり受け取りたいです。たとえば 2025/03/12 のように送ってもらえれば大丈夫です。',
              env.LINE_CHANNEL_ACCESS_TOKEN
            );
            return;
          }
          if (String(error?.message).includes('INVALID_NUMBER')) {
            await replyMessage(
              event.replyToken,
              'ありがとうございます。ここは数値のところだけ受け取りたいので、たとえば 138 のようにそのまま数字で送ってもらえれば大丈夫です。',
              env.LINE_CHANNEL_ACCESS_TOKEN
            );
            return;
          }
          throw error;
        }
      }

      const chosenDate = findPanelDateFromInput(openLabDraft, text);
      if (chosenDate && !openLabDraft.selected_date) {
        const { data, error } = await supabase.from('lab_import_sessions').update({ selected_date: chosenDate }).eq('id', openLabDraft.id).select('*').single();
        if (error) throw error;
        const msg = buildLabDraftSummaryMessage(data);
        await replyMessage(event.replyToken, textMessageWithQuickReplies(msg.text, msg.quickReplies), env.LINE_CHANNEL_ACCESS_TOKEN);
        return;
      }

      if (text === 'この内容で保存' || text === 'この日だけ保存') {
        const selectedDate = openLabDraft.selected_date || String(Object.keys(openLabDraft.working_data_json || {}).sort().pop() || '');
        await confirmLabDraftToResults(supabase, openLabDraft, selectedDate);

        const recentRows = await getRecentLabResults(supabase, user.id, 10);
        const savedRow = recentRows.find((r) => formatDateOnly(r.measured_at) === selectedDate) || {
          measured_at: selectedDate,
          ...(openLabDraft.working_data_json?.[selectedDate] || {}),
        };

        const replyText = buildLabSaveMessage(savedRow, recentRows);
        await replyMessage(event.replyToken, replyText, env.LINE_CHANNEL_ACCESS_TOKEN);
        await rememberInteraction(user, text, replyText);
        return;
      }

      if (['読み取れた日付を全部保存', '一括保存', 'まとめて保存', '全部保存'].includes(text)) {
        const savedRows = await confirmAllLabDraftToResults(supabase, openLabDraft);
        const count = Array.isArray(savedRows) ? savedRows.length : 0;
        const replyText = ['読み取れた日付をまとめて保存しました。', count ? `保存件数: ${count}件` : null, '血液検査グラフでも確認できます。'].filter(Boolean).join('\n');
        await replyMessage(event.replyToken, replyText, env.LINE_CHANNEL_ACCESS_TOKEN);
        await rememberInteraction(user, text, replyText);
        return;
      }

      const field = mapCorrectionLabelToField(text);
      if (field) {
        const selectedDate = openLabDraft.selected_date || String(Object.keys(openLabDraft.working_data_json || {}).sort().pop() || '');
        await setActiveLabCorrection(supabase, openLabDraft.id, field, selectedDate);
        await replyMessage(event.replyToken, buildLabCorrectionGuide(field), env.LINE_CHANNEL_ACCESS_TOKEN);
        return;
      }
    }

    const supportContext = getSupportContext(user.line_user_id);
    const contextArea = supportContext?.area || null;

    if (text === '牛込先生に相談したい') {
      clearMealDraft(user.line_user_id);
      const replyText = prefixWithName(user, `ありがとうございます。\n${CONSULT_MESSAGE}`);
      await replyMessage(event.replyToken, replyText, env.LINE_CHANNEL_ACCESS_TOKEN);
      await rememberInteraction(user, text, replyText);
      return;
    }

    if (smartFlowResult?.next === 'consultation_chat') {
      const consultGuide = buildHealthConsultationGuide(text);
      const naturalReply = await defaultChatReply(user, text);
      const replyText = `${naturalReply}\n\n${consultGuide}`;
      await replyMessage(event.replyToken, replyText, env.LINE_CHANNEL_ACCESS_TOKEN);
      await rememberInteraction(user, text, replyText);
      return;
    }

    if (isGraphMenuIntent(text)) {
      await replyMessage(
        event.replyToken,
        textMessageWithQuickReplies(
          prefixWithName(user, '見たいグラフを選んでください。\n体重なら「体重グラフ」\n食事や運動なら「食事活動グラフ」\n血液検査なら「血液検査グラフ」「HbA1cグラフ」「LDLグラフ」で見られます。'),
          buildGraphMenuQuickReplies()
        ),
        env.LINE_CHANNEL_ACCESS_TOKEN
      );
      return;
    }

    if (isWeightGraphIntent(text)) {
      const weightRows = await getRecentWeightRows(user.id, 20);
      const graph = buildWeightGraphMessage(weightRows);
      const messages = [textMessageWithQuickReplies(prefixWithName(user, graph.text), ['食事活動グラフ', '血液検査グラフ', '予測', 'グラフ'])];
      if (graph.messages.length) messages.push(...graph.messages);
      await replyMessage(event.replyToken, messages, env.LINE_CHANNEL_ACCESS_TOKEN);
      return;
    }

    if (isEnergyGraphIntent(text)) {
      const dayRows = await getSevenDayEnergyRows(user.id);
      const graph = buildEnergyGraphMessage(dayRows);
      const messages = [textMessageWithQuickReplies(prefixWithName(user, graph.text), ['体重グラフ', '血液検査グラフ', '予測', '今日はここまで'])];
      if (graph.messages.length) messages.push(...graph.messages);
      await replyMessage(event.replyToken, messages, env.LINE_CHANNEL_ACCESS_TOKEN);
      return;
    }

    if (isHbA1cGraphIntent(text)) {
      const recentRows = await getRecentLabResults(supabase, user.id, 12);
      const graph = buildLabGraphMessage(recentRows, 'hba1c');
      const messages = [textMessageWithQuickReplies(prefixWithName(user, graph.text), ['LDLグラフ', '体重グラフ', '食事活動グラフ', '予測'])];
      if (graph.messages.length) messages.push(...graph.messages);
      await replyMessage(event.replyToken, messages, env.LINE_CHANNEL_ACCESS_TOKEN);
      return;
    }

    if (isLdlGraphIntent(text)) {
      const recentRows = await getRecentLabResults(supabase, user.id, 12);
      const graph = buildLabGraphMessage(recentRows, 'ldl');
      const messages = [textMessageWithQuickReplies(prefixWithName(user, graph.text), ['HbA1cグラフ', '体重グラフ', '食事活動グラフ', '予測'])];
      if (graph.messages.length) messages.push(...graph.messages);
      await replyMessage(event.replyToken, messages, env.LINE_CHANNEL_ACCESS_TOKEN);
      return;
    }

    if (isLabGraphIntent(text)) {
      const recentRows = await getRecentLabResults(supabase, user.id, 12);
      const graph = buildLabGraphMessage(recentRows, 'hba1c');
      const messages = [textMessageWithQuickReplies(prefixWithName(user, graph.text), ['HbA1cグラフ', 'LDLグラフ', '体重グラフ', '食事活動グラフ', '予測'])];
      if (graph.messages.length) messages.push(...graph.messages);
      await replyMessage(event.replyToken, messages, env.LINE_CHANNEL_ACCESS_TOKEN);
      return;
    }

    if (isPredictionIntent(text) || text === '予測') {
      const totals = await getTodayEnergyTotals(user.id);
      const prediction = buildPredictionText({
        estimatedBmr: user.estimated_bmr || 0,
        estimatedTdee: user.estimated_tdee || 0,
        intakeKcal: totals.intake_kcal || 0,
        activityKcal: totals.activity_kcal || 0,
        currentWeightKg: user.weight_kg || null,
      });

      await replyMessage(
        event.replyToken,
        textMessageWithQuickReplies(prefixWithName(user, prediction.text), [...prediction.quickReplies, '体重グラフ', 'グラフ']),
        env.LINE_CHANNEL_ACCESS_TOKEN
      );
      return;
    }

    if (isWeeklyReportRequest(text)) {
      if (!generateWeeklyReportDraft) {
        await replyMessage(event.replyToken, prefixWithName(user, '週間報告の下書き機能はまだ準備中です。report_draft_service.js を追加したあとに使えるようになります。'), env.LINE_CHANNEL_ACCESS_TOKEN);
        return;
      }

      const input = await buildReportDraftInput(user, 'weekly');
      const weeklyDraft = generateWeeklyReportDraft(input);

      if (createReportAdminMemo) {
        const weeklyMemo = createReportAdminMemo({
          user_id: user.id,
          user_name: getUserDisplayName(user) || '利用者',
          created_at: new Date().toISOString(),
          report_type: 'weekly',
          report_period: input.period_label || '',
          summary_text: '週間報告の下書き生成',
          highlights: weeklyDraft?.summary?.highlights || [],
          next_actions: weeklyDraft?.summary?.next_actions || [],
          draft_text: weeklyDraft?.draft_text || '',
        });

        if (isAdminMemoDebugEnabled()) safeConsoleLog('[WEEKLY_REPORT_MEMO]', weeklyMemo?.memo_text || weeklyMemo);
      }

      await replyMessage(
        event.replyToken,
        textMessageWithQuickReplies(prefixWithName(user, `週間報告の下書き確認用です。\n\n${weeklyDraft?.draft_text || '下書き生成に失敗しました。'}`), ['月間報告', '体重グラフ', '食事活動グラフ', 'グラフ']),
        env.LINE_CHANNEL_ACCESS_TOKEN
      );
      return;
    }

    if (isMonthlyReportRequest(text)) {
      if (!generateMonthlyReportDraft) {
        await replyMessage(event.replyToken, prefixWithName(user, '月間報告の下書き機能はまだ準備中です。report_draft_service.js を追加したあとに使えるようになります。'), env.LINE_CHANNEL_ACCESS_TOKEN);
        return;
      }

      const input = await buildReportDraftInput(user, 'monthly');
      const monthlyDraft = generateMonthlyReportDraft(input);

      if (createReportAdminMemo) {
        const monthlyMemo = createReportAdminMemo({
          user_id: user.id,
          user_name: getUserDisplayName(user) || '利用者',
          created_at: new Date().toISOString(),
          report_type: 'monthly',
          report_period: input.period_label || '',
          summary_text: '月間報告の下書き生成',
          highlights: monthlyDraft?.summary?.highlights || [],
          next_actions: monthlyDraft?.summary?.next_actions || [],
          draft_text: monthlyDraft?.draft_text || '',
        });

        if (isAdminMemoDebugEnabled()) safeConsoleLog('[MONTHLY_REPORT_MEMO]', monthlyMemo?.memo_text || monthlyMemo);
      }

      await replyMessage(
        event.replyToken,
        textMessageWithQuickReplies(prefixWithName(user, `月間報告の下書き確認用です。\n\n${monthlyDraft?.draft_text || '下書き生成に失敗しました。'}`), ['週間報告', '体重グラフ', '血液検査グラフ', 'グラフ']),
        env.LINE_CHANNEL_ACCESS_TOKEN
      );
      return;
    }

    if (isVideoIntent(text)) {
      clearMealDraft(user.line_user_id);
      const area = contextArea || detectPainArea(text);
      setSupportContext(user.line_user_id, { area, mode: 'video' });

      const videoResponse = buildVideoSupportResponse(area);
      const replyText = prefixWithName(user, videoResponse.text);
      await replyMessage(event.replyToken, textMessageWithQuickReplies(replyText, videoResponse.quickReplies), env.LINE_CHANNEL_ACCESS_TOKEN);
      await rememberInteraction(user, text, replyText);
      return;
    }

    if (text === '1分メニュー') {
      clearMealDraft(user.line_user_id);
      const area = contextArea || '全身';
      const menu = buildExerciseMenuResponse(area, '1min');
      const replyText = prefixWithName(user, menu.text);
      await replyMessage(event.replyToken, textMessageWithQuickReplies(replyText, menu.quickReplies), env.LINE_CHANNEL_ACCESS_TOKEN);
      await rememberInteraction(user, text, replyText);
      return;
    }

    if (text === '3分メニュー') {
      clearMealDraft(user.line_user_id);
      const area = contextArea || '全身';
      const menu = buildExerciseMenuResponse(area, '3min');
      const replyText = prefixWithName(user, menu.text);
      await replyMessage(event.replyToken, textMessageWithQuickReplies(replyText, menu.quickReplies), env.LINE_CHANNEL_ACCESS_TOKEN);
      await rememberInteraction(user, text, replyText);
      return;
    }

    if (text === 'やさしい版') {
      clearMealDraft(user.line_user_id);
      const area = contextArea || '全身';
      const menu = buildExerciseMenuResponse(area, 'gentle');
      const replyText = prefixWithName(user, menu.text);
      await replyMessage(event.replyToken, textMessageWithQuickReplies(replyText, menu.quickReplies), env.LINE_CHANNEL_ACCESS_TOKEN);
      await rememberInteraction(user, text, replyText);
      return;
    }

    if (text === '説明だけ聞く') {
      clearMealDraft(user.line_user_id);
      const area = contextArea || '全身';
      const menu = buildExerciseMenuResponse(area, 'explain');
      const replyText = prefixWithName(user, menu.text);
      await replyMessage(event.replyToken, textMessageWithQuickReplies(replyText, menu.quickReplies), env.LINE_CHANNEL_ACCESS_TOKEN);
      await rememberInteraction(user, text, replyText);
      return;
    }

    if (isStretchIntent(text) || text === 'ストレッチしたい') {
      clearMealDraft(user.line_user_id);
      const area = contextArea || detectPainArea(text);
      setSupportContext(user.line_user_id, { area, mode: 'stretch' });

      const stretchResponse = buildStretchSupportResponse(area);
      const replyText = prefixWithName(user, stretchResponse.message);
      await replyMessage(event.replyToken, textMessageWithQuickReplies(replyText, [...stretchResponse.quickReplies, '動画で見たい']), env.LINE_CHANNEL_ACCESS_TOKEN);
      await rememberInteraction(user, text, replyText);
      return;
    }

    if (['腰まわりをやる', '股関節もやる', '股関節をゆるめる', 'ふくらはぎを伸ばす', '股関節を開く', 'お尻をゆるめる', '肩まわりをほぐす', '胸を開く', '首肩をゆるめる', '全身軽め', '1分だけやる', '今日は説明だけ'].includes(text)) {
      clearMealDraft(user.line_user_id);
      const area = contextArea || '全身';
      const message = [
        `${text}の流れで大丈夫です。今日は無理なく、小さくで十分です。`,
        area !== '全身' ? `${area}まわりが少し整うと、動きやすさや代謝にもつながりやすいです。` : '軽く動かすだけでも、可動域や代謝の土台につながります。',
        CONSULT_MESSAGE,
      ].join('\n');

      const replyText = prefixWithName(user, message);
      await replyMessage(event.replyToken, textMessageWithQuickReplies(replyText, ['できた', 'まだ少しやる', '動画で見たい', '今日はここまで']), env.LINE_CHANNEL_ACCESS_TOKEN);
      await rememberInteraction(user, text, replyText);
      return;
    }

    if (['朝から重い', '座るとつらい', '少し動くと楽', '歩くとつらい'].includes(text)) {
      clearMealDraft(user.line_user_id);
      const area = contextArea || '全身';
      const followup = buildPainSituationResponse(text, area);
      if (followup) {
        const replyText = prefixWithName(user, followup.message);
        await replyMessage(event.replyToken, textMessageWithQuickReplies(replyText, followup.quickReplies), env.LINE_CHANNEL_ACCESS_TOKEN);
        await rememberInteraction(user, text, replyText);
        return;
      }
    }

    if (isPainLikeText(text) || isExerciseConsultationText(text) || (looksLikePainConsultation && looksLikePainConsultation(text))) {
      clearMealDraft(user.line_user_id);
      const area = detectPainArea(text);
      setSupportContext(user.line_user_id, { area, mode: 'pain' });

      let painResponse = buildPainSupportResponse(text, area);
      let replyText = prefixWithName(user, painResponse.message);

      if (analyzePainText) {
        try {
          const advancedPain = analyzePainText(text);
          if (advancedPain?.reply_text) replyText = prefixWithName(user, advancedPain.reply_text);

          if (createPainAdminMemo && isAdminMemoDebugEnabled()) {
            const painMemoResult = createPainAdminMemo({
              user_id: user.id,
              user_name: getUserDisplayName(user) || '',
              created_at: new Date().toISOString(),
              severity: advancedPain?.severity || 'mild',
              original_text: advancedPain?.original_text || text || '',
              body_part: advancedPain?.primary_part?.label || area || '',
              symptom: advancedPain?.primary_symptom?.label || '',
              mechanisms: (advancedPain?.mechanisms || []).map((v) => v.label),
              red_flags: (advancedPain?.red_flags || []).map((v) => v.label),
              condition_hints: (advancedPain?.condition_hints || []).map((v) => v.label),
              followup_questions: advancedPain?.followup_questions || [],
              self_care_advice: advancedPain?.self_care_advice || [],
            });
            safeConsoleLog('[PAIN_ADMIN_MEMO]', painMemoResult?.memo_text || painMemoResult);
          }
        } catch (advancedPainError) {
          console.error('⚠️ advanced pain analysis failed:', advancedPainError?.message || advancedPainError);
          if (generatePainResponse) {
            try {
              const fallbackReply = generatePainResponse(text);
              if (fallbackReply) replyText = prefixWithName(user, fallbackReply);
            } catch (_e) {}
          }
        }
      } else if (createPainAdminMemo && isAdminMemoDebugEnabled()) {
        const symptomSummary = typeof buildAdminSymptomSummary === 'function' ? buildAdminSymptomSummary(text, area) : null;
        const painMemoResult = createPainAdminMemo({
          user_id: user.id,
          user_name: getUserDisplayName(user) || '',
          created_at: new Date().toISOString(),
          severity: 'mild',
          original_text: text || '',
          body_part: area || '',
          symptom: symptomSummary || '症状相談',
          mechanisms: [],
          red_flags: [],
          condition_hints: [],
          followup_questions: [],
          self_care_advice: [],
        });
        safeConsoleLog('[PAIN_ADMIN_MEMO]', painMemoResult?.memo_text || painMemoResult);
      }

      await saveUserState(user.id, {
        pain_followup_status: 'watching',
        pain_last_noted_at: new Date().toISOString(),
        pain_area_last: area || null,
      });

      await replyMessage(event.replyToken, textMessageWithQuickReplies(replyText, [...painResponse.quickReplies, '動画で見たい']), env.LINE_CHANNEL_ACCESS_TOKEN);
      await rememberInteraction(user, text, replyText);
      return;
    }

    if (['今日はここまで', 'まだ少しやる', 'できた', '次の食事を記録', '少し歩いた', '股関節を整えたい', '腰が重い'].includes(text)) {
      if (text === '今日はここまで') {
        const replyText = prefixWithName(user, '今日はここまでで大丈夫です。小さく続けることが一番力になります。');
        await replyMessage(event.replyToken, replyText, env.LINE_CHANNEL_ACCESS_TOKEN);
        await rememberInteraction(user, text, replyText);
        return;
      }

      if (text === 'できた') {
        const replyText = prefixWithName(user, 'いいですね。その一歩が次につながります。少しずつ整えていきましょう。');
        await replyMessage(event.replyToken, textMessageWithQuickReplies(replyText, ['まだ少しやる', '動画で見たい', '予測', '体重グラフ', 'グラフ', '今日はここまで']), env.LINE_CHANNEL_ACCESS_TOKEN);
        await rememberInteraction(user, text, replyText);
        return;
      }

      if (text === 'まだ少しやる') {
        const replyText = prefixWithName(user, 'いい流れですね。無理なくもう少しだけいきましょう。');
        await replyMessage(event.replyToken, textMessageWithQuickReplies(replyText, ['1分メニュー', '3分メニュー', 'やさしい版', '今日はここまで']), env.LINE_CHANNEL_ACCESS_TOKEN);
        await rememberInteraction(user, text, replyText);
        return;
      }

      if (text === '腰が重い' || text === '股関節を整えたい') {
        clearMealDraft(user.line_user_id);
        const area = text === '腰が重い' ? '腰' : '股関節';
        setSupportContext(user.line_user_id, { area, mode: 'pain' });
        const painResponse = buildPainSupportResponse(text, area);
        const replyText = prefixWithName(user, painResponse.message);
        await replyMessage(event.replyToken, textMessageWithQuickReplies(replyText, [...painResponse.quickReplies, '動画で見たい']), env.LINE_CHANNEL_ACCESS_TOKEN);
        await rememberInteraction(user, text, replyText);
        return;
      }

      if (text === '少し歩いた') {
        const replyText = prefixWithName(user, '少し歩けたのは大事です。そこから代謝や流れが変わっていきます。');
        await replyMessage(event.replyToken, replyText, env.LINE_CHANNEL_ACCESS_TOKEN);
        await rememberInteraction(user, text, replyText);
        return;
      }

      if (text === '次の食事を記録') {
        await replyMessage(event.replyToken, buildMealTextGuide(), env.LINE_CHANNEL_ACCESS_TOKEN);
        return;
      }
    }

    const currentMealDraft = getMealDraft(user.line_user_id);

    if (currentMealDraft && isMealManualEditCommand(text)) {
      markMealDraftAwaitingAdditionalPhoto(user.line_user_id, false);
      await replyMessage(event.replyToken, 'そのまま追加内容や修正内容を文字で送ってください。\n例: 味噌汁追加 / ご飯半分追加 / お茶です / 2個です', env.LINE_CHANNEL_ACCESS_TOKEN);
      return;
    }

    if (currentMealDraft && isMealAddPhotoCommand(text)) {
      markMealDraftAwaitingAdditionalPhoto(user.line_user_id, true);
      await replyMessage(event.replyToken, '追加した写真をそのまま送ってください。次の写真を追加分として反映します。', env.LINE_CHANNEL_ACCESS_TOKEN);
      return;
    }

    if (currentMealDraft && isMealSaveCommand(text)) {
      const savedMeal = await saveMealToLog(user.id, currentMealDraft.meal);
      clearMealDraft(user.line_user_id);

      await saveUserState(user.id, {
        last_any_log_at: new Date().toISOString(),
        last_meal_logged_at: new Date().toISOString(),
      });

      const totals = await getTodayEnergyTotals(user.id);
      const energyText = buildEnergySummaryText({
        estimatedBmr: user.estimated_bmr || 0,
        estimatedTdee: user.estimated_tdee || 0,
        intakeKcal: totals.intake_kcal || 0,
        activityKcal: totals.activity_kcal || 0,
      });

      const nutritionLines = buildMealNutritionLines(savedMeal);
      const saveLines = [
        '食事を保存しました。',
        `料理: ${savedMeal.meal_label}`,
        savedMeal.estimated_kcal != null ? `今回の推定摂取: ${fmt(savedMeal.estimated_kcal)} kcal` : null,
        nutritionLines.length ? '' : null,
        ...(nutritionLines.length ? nutritionLines : []),
        `本日摂取合計: ${fmt(totals.intake_kcal || 0)} kcal`,
      ].filter(Boolean);

      const replyText = prefixWithName(user, `${saveLines.join('\n')}\n\n${energyText}`);
      await replyMessage(event.replyToken, textMessageWithQuickReplies(replyText, ['次の食事を記録', '少し歩いた', 'ストレッチしたい', '予測', '体重グラフ', 'グラフ']), env.LINE_CHANNEL_ACCESS_TOKEN);
      await rememberInteraction(user, text, replyText);
      return;
    }

    if (currentMealDraft && isMealCancelCommand(text)) {
      clearMealDraft(user.line_user_id);
      const replyText = '確認中の食事データを取り消しました。';
      await replyMessage(event.replyToken, replyText, env.LINE_CHANNEL_ACCESS_TOKEN);
      await rememberInteraction(user, text, replyText);
      return;
    }

    if (currentMealDraft && seemsMealCorrectionText(text)) {
      const normalizedCorrectionText = normalizeMealCorrectionText(text);
      const correctedMeal = await applyMealCorrectionPrimary(currentMealDraft.meal, normalizedCorrectionText);
      setMealDraft(user.line_user_id, correctedMeal);
      const replyText = prefixWithName(user, buildMealReplyWithSaveGuide(correctedMeal));
      await replyMessage(event.replyToken, textMessageWithQuickReplies(replyText, buildMealFollowupQuickReplies()), env.LINE_CHANNEL_ACCESS_TOKEN);
      await rememberInteraction(user, text, replyText);
      return;
    }

    if (isMealDesireOrFeelingText(text)) {
      const reply = await defaultChatReply(user, text);
      await replyMessage(event.replyToken, reply, env.LINE_CHANNEL_ACCESS_TOKEN);
      await rememberInteraction(user, text, reply);
      return;
    }

    const detectedIntent = detectMessageIntent(text);
    const shouldOpenMealDraft =
      !shouldAvoidMealExerciseAutoCapture(text) &&
      (
        detectedIntent.type === 'meal_log' ||
        isExplicitMealLogText(text) ||
        seemsMealTextCandidate(text)
      );

    if (shouldOpenMealDraft) {
      const analyzedMeal = await analyzeMealTextPrimary(text);
      if (analyzedMeal?.is_meal || isMeaningfulMealDraft(analyzedMeal)) {
        setMealDraft(user.line_user_id, analyzedMeal);
        const replyText = prefixWithName(user, buildMealReplyWithSaveGuide(analyzedMeal, { textOnly: true }));
        await replyMessage(event.replyToken, textMessageWithQuickReplies(replyText, buildMealFollowupQuickReplies()), env.LINE_CHANNEL_ACCESS_TOKEN);
        await rememberInteraction(user, text, replyText);
        return;
      }
    }

    if (text === '飲み物を訂正' || text === '量を訂正') {
      await replyMessage(event.replyToken, 'そのまま文字で教えてください。例: ジャスミンティーです / お酒ではないです / 大福は2個です', env.LINE_CHANNEL_ACCESS_TOKEN);
      return;
    }

    if (isExplicitMealGuideIntent(text)) {
      await replyMessage(event.replyToken, buildMealTextGuide(), env.LINE_CHANNEL_ACCESS_TOKEN);
      return;
    }

    if (isActivityCommand(lower)) {
      const activity = parseActivity(text, user.weight_kg || 60);
      if (!activity.steps && !activity.walking_minutes && !activity.estimated_activity_kcal && !activity.exercise_summary) {
        await replyMessage(event.replyToken, '例: ジョギング 20分 / ストレッチ 5分 / スクワット 10回 / 少し歩いた', env.LINE_CHANNEL_ACCESS_TOKEN);
        return;
      }

      if (!activity.estimated_activity_kcal) {
        activity.estimated_activity_kcal = estimateActivityKcalWithStrength(
          activity.steps,
          activity.walking_minutes,
          user.weight_kg || 60,
          activity.raw_detail_json || {}
        );
      }

      const insertPayload = {
        user_id: user.id,
        logged_at: toIsoStringInTZ(new Date(), TZ),
        steps: activity.steps,
        walking_minutes: activity.walking_minutes,
        estimated_activity_kcal: activity.estimated_activity_kcal,
        exercise_summary: activity.exercise_summary,
        raw_detail_json: activity.raw_detail_json,
      };

      const { error } = await supabase.from('activity_logs').insert(insertPayload);
      if (error) throw error;

      await saveUserState(user.id, {
        last_any_log_at: new Date().toISOString(),
        last_exercise_logged_at: new Date().toISOString(),
      });

      const totals = await getTodayEnergyTotals(user.id);
      const lines = [
        '活動を記録しました。',
        activity.exercise_summary ? `内容: ${activity.exercise_summary}` : null,
        activity.steps ? `歩数: ${fmt(activity.steps)} 歩` : null,
        activity.walking_minutes ? `歩行・散歩: ${fmt(activity.walking_minutes)} 分` : null,
        activity.estimated_activity_kcal != null ? `推定活動消費: ${fmt(activity.estimated_activity_kcal)} kcal` : null,
        '小さな運動でも、しっかり前進です。',
      ].filter(Boolean);

      const energyText = buildEnergySummaryText({
        estimatedBmr: user.estimated_bmr || 0,
        estimatedTdee: user.estimated_tdee || 0,
        intakeKcal: totals.intake_kcal || 0,
        activityKcal: totals.activity_kcal || 0,
      });

      const replyText = prefixWithName(user, `${lines.join('\n')}\n\n${energyText}`);
      await replyMessage(event.replyToken, textMessageWithQuickReplies(replyText, [...buildExerciseFollowupQuickReplies(), '予測', 'グラフ']), env.LINE_CHANNEL_ACCESS_TOKEN);
      await rememberInteraction(user, text, replyText);
      return;
    }

    const reply = await defaultChatReply(user, text);
    await replyMessage(event.replyToken, reply, env.LINE_CHANNEL_ACCESS_TOKEN);
    await rememberInteraction(user, text, reply);
   } catch (error) {
    console.error('❌ handleTextMessage error:', error?.stack || error?.message || error);
    await replyMessage(
      event.replyToken,
      'ありがとうございます。こちらで少し受け取り方がずれてしまったので、言い方はそのままで大丈夫ですから、もう一度だけ送ってもらえますか。こちらで自然につなげますね。',
      env.LINE_CHANNEL_ACCESS_TOKEN
    );
  }
}

app.listen(PORT, () => {
  console.log(`✅ Server running on port ${PORT}`);
});
