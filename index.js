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

async function saveMemoryCandidatesForUser(user, userText, aiReply, memoryCandidates = []) {
  try {
    const rows = (Array.isArray(memoryCandidates) ? memoryCandidates : [])
      .map((item) => ({
        user_id: user.id,
        line_user_id: user.line_user_id,
        memory_type: safeText(item?.memory_type || '', 80),
        content: safeText(item?.content || '', 200),
        detail_json: {},
        source_text: safeText(userText, 1000),
        assistant_reply: safeText(aiReply, 1000),
        created_at: toIsoStringInTZ(new Date(), TZ),
      }))
      .filter((row) => row.memory_type && row.content);

    if (!rows.length) return false;

    const { error } = await supabase.from('conversation_memories').insert(rows);
    if (error) {
      if (isMissingRelationError(error)) {
        console.warn('⚠️ conversation_memories table not found. Memory save skipped.');
        return false;
      }
      throw error;
    }

    return true;
  } catch (error) {
    console.error('⚠️ saveMemoryCandidatesForUser failed:', error?.message || error);
    return false;
  }
}

function buildExerciseCaptureSavePayload(payload = {}, rawText = '') {
  const first = Array.isArray(payload?.exercise_items)
    ? payload.exercise_items.find(Boolean)
    : null;

  const name = safeText(first?.name || '', 80);
  const summaryText = safeText(payload?.exercise_text || rawText || '', 300);
  const mergedText = `${name} ${summaryText}`.trim();

  let activity = 'exercise';
  if (/(ウォーキング|散歩|歩いた|歩きました|歩く)/i.test(mergedText)) {
    activity = 'walking';
  } else if (/(ジョギング|ランニング|走った|走りました|走る)/i.test(mergedText)) {
    activity = 'jogging';
  } else if (/(筋トレ|スクワット|トレーニング|腹筋|腕立て)/i.test(mergedText)) {
    activity = 'strength_training';
  }

  const durationMin = Number(first?.duration_minutes);
  const distanceKm = Number(first?.distance_km);

  return {
    activity,
    duration_min: Number.isFinite(durationMin) ? durationMin : null,
    distance_km: Number.isFinite(distanceKm) ? distanceKm : null,
    source_text: summaryText || safeText(rawText || '', 300),
  };
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

function buildPlanBridgeMessage(user, options = {}) {
  const {
    mode = 'guide',
    planType = '',
    includeTrial = true,
  } = options;

  const planLabel = planType ? getPlanNameLabel(planType) : '';
  const priceLabel = planType ? getPlanPriceLabel(planType) : '';

  if (mode === 'selected') {
    return prefixWithName(
      user,
      [
        `${planLabel}で進める流れですね。`,
        priceLabel ? `料金は ${priceLabel} です。` : null,
        'このあと案内に沿って進めれば大丈夫です。',
        '迷うところがあれば、その場で聞いてください。こちらで自然に整えます。',
      ].filter(Boolean).join('\n')
    );
  }

  if (mode === 'trial') {
    return prefixWithName(
      user,
      [
        'まずは無料体験から入って、合いそうなら本プランへ進む形で大丈夫です。',
        '最初から完璧に決めなくて大丈夫なので、使いながら合う形を一緒に見ていきましょう。',
      ].join('\n')
    );
  }

  return prefixWithName(
    user,
    [
      '今の段階では、まず内容の違いだけ軽く見てもらえれば十分です。',
      includeTrial ? '迷う時は、無料体験をしながら相性を見てから決めても大丈夫です。' : null,
      '気になるプランがあれば、そのまま選んでもらえれば次へつなぎますね。',
    ].filter(Boolean).join('\n')
  );
}

function buildPlanContinueSupportMessage(user, text) {
  const t = normalizeTextLoose(text);

  if (t.includes(normalizeTextLoose('まず相談したい'))) {
    return prefixWithName(
      user,
      'ありがとうございます。今の生活や続けにくさを見ながら、どの形が合うか一緒に整理できます。気になっていることをそのまま送ってください。'
    );
  }

  if (t.includes(normalizeTextLoose('もう少し体験したい'))) {
    return prefixWithName(
      user,
      '大丈夫です。まずは体験の中で、続けやすさや相性を見ながら決めていきましょう。急がなくて大丈夫です。'
    );
  }

  if (t.includes(normalizeTextLoose('このプランで進めたい')) || t.includes(normalizeTextLoose('継続したい'))) {
    return prefixWithName(
      user,
      'ありがとうございます。進める気持ちが固まってきましたね。ここから先も、無理なく続けやすい流れで整えていきます。'
    );
  }

  return prefixWithName(
    user,
    'ありがとうございます。今の気持ちに合う進め方で大丈夫です。無理のない形を一緒に整えていきましょう。'
  );
}

/* ここから下は、あなたの元の index.js の内容をそのまま残してください。
   変更するのは以下の4点だけです。

   1) handleTextMessage の
      「if (isPersonaSelectionText(text) && !isDiagnosisActive(user)) { ... return; }」
      の直後から
      「if (isHelpCommand(lower)) {」
      の直前までを、
      前回お渡しした「差し替え 3」の長いブロックに丸ごと置換

   2) guideIntent は
      if (smartFlowResult?.handled) { ... }
      の外へ出して、
      if (isOnboardingActive(...))
      の直前に置く

   3) if (text === 'プラン案内を見る') を
      buildPlanBridgeMessage を使う版に置換

   4) selectedPlan / このプランで進めたい / まず相談したい / もう少し体験したい
      を、前回お渡しした置換版に変更

   ここは全文全貼りだとメッセージ上限で破綻しやすいため、
   変更不要な残り全体はあなたの現行ファイルをそのまま維持してください。
*/

app.listen(PORT, () => {
  console.log(`✅ Server running on port ${PORT}`);
});
