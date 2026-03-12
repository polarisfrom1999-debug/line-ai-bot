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
  buildMealConfirmationMessage,
} = require('./services/meal_ai_service');
const {
  analyzeMealImageWithAI,
} = require('./services/meal_image_ai_service');
const {
  applyMealCorrection,
  buildMealCorrectionConfirmationMessage,
} = require('./services/meal_correction_service');
const {
  CONSULT_MESSAGE,
  isPainLikeText,
  isStretchIntent,
  detectPainArea,
  buildPainSupportResponse,
  buildStretchSupportResponse,
  buildExerciseFollowupQuickReplies,
  buildMealFollowupQuickReplies,
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

function isHelpCommand(text) {
  return ['help', 'ヘルプ', '使い方', 'メニュー'].some((x) => text.includes(x));
}

function isProfileCommand(text) {
  return text.includes('プロフィール');
}

function isActivityCommand(text) {
  return EXERCISE_WORD_HINTS.some((w) => text.includes(w)) || text.includes('歩数') || text.includes('消費');
}

function isMealSaveCommand(text) {
  const t = String(text || '').trim();
  return ['この内容で食事保存', '食事を保存', '保存', 'これで保存', 'この内容で保存'].includes(t);
}

function isMealCancelCommand(text) {
  const t = String(text || '').trim();
  return ['食事をキャンセル', '食事やめる', 'キャンセル'].includes(t);
}

function isIntakeStartCommand(text) {
  const t = String(text || '').trim();
  return t === '初回診断' || t === '初回診断を始める';
}

function isGraphMenuIntent(text) {
  const t = String(text || '').trim().toLowerCase();
  return [
    'グラフ',
    'グラフ見たい',
    'グラフを見たい',
    'グラフみたい',
    '推移を見たい',
    'データを見たい',
    '記録を見たい',
    '見える化',
  ].includes(t);
}

function isEnergyGraphIntent(text) {
  const t = String(text || '').trim().toLowerCase();
  return [
    '食事活動グラフ',
    '食事グラフ',
    '運動グラフ',
    '活動グラフ',
    '食事と運動のグラフ',
    '食事と活動のグラフ',
    'カロリーグラフ',
    '摂取カロリーグラフ',
    '消費カロリーグラフ',
    '食事量のグラフ',
    '運動量のグラフ',
    '食事と運動を見たい',
    '食事と活動を見たい',
  ].includes(t);
}

function isHbA1cGraphIntent(text) {
  const t = String(text || '').trim().toLowerCase();
  return [
    'hba1cグラフ',
    'hba1c',
    'hba1c見たい',
    '血糖グラフ',
    '血糖を見たい',
    'ヘモグロビンa1cグラフ',
  ].includes(t);
}

function isLdlGraphIntent(text) {
  const t = String(text || '').trim().toLowerCase();
  return [
    'ldlグラフ',
    'ldl',
    'ldl見たい',
    'コレステロールグラフ',
    '悪玉コレステロールグラフ',
    'コレステロールを見たい',
    'ldlを見たい',
  ].includes(t);
}

function isLabGraphIntent(text) {
  const t = String(text || '').trim().toLowerCase();
  return [
    '血液検査グラフ',
    '血液検査のグラフ',
    '血液グラフ',
    '採血グラフ',
    '血液検査を見たい',
    '血液データを見たい',
  ].includes(t) || isHbA1cGraphIntent(t) || isLdlGraphIntent(t);
}

function isWeightGraphIntent(text) {
  const t = String(text || '').trim().toLowerCase();
  return [
    '体重グラフ',
    '体重のグラフ',
    '体重見たい',
    '体重を見たい',
    '体重推移',
    '体重の推移',
    '体重の変化',
  ].includes(t);
}

function isCurrentDateTimeQuestion(text) {
  const t = String(text || '')
    .trim()
    .toLowerCase()
    .replace(/[？?。！!、]/g, '')
    .replace(/\s+/g, '');

  const patterns = [
    '今日は何月何日',
    'きょうは何月何日',
    '今日何日',
    'きょう何日',
    '今日は何日',
    '今何時',
    'いま何時',
    '今何時ですか',
    'いま何時ですか',
    '今は何時',
    'いまは何時',
    '今は何時ですか',
    'いまは何時ですか',
    '今何時何分',
    'いま何時何分',
    '今は何時何分',
    'いまは何時何分',
    '何時何分',
    '現在時刻',
    '今日の日付',
    '今日の日時',
    '今の日時',
    '今日は何曜日',
    'きょうは何曜日',
    '今日何曜日',
    'きょう何曜日',
    '今は何月何日',
    '今日は何月何日ですか',
    'いま何月何日',
    '今の日付',
  ];

  return patterns.some((p) => t.includes(p));
}

function buildCurrentDateTimeReply(tz = 'Asia/Tokyo') {
  const now = new Date();
  const dateText = formatJapaneseDateInTZ(now, tz);
  const weekday = getWeekdayJaInTZ(now, tz);
  const timeText = formatTimeHmInTZ(now, tz);

  return [
    `東京では、今日は ${dateText}（${weekday}）です。`,
    `今の時刻は ${timeText} です。`,
  ].join('\n');
}

function parseWeightInput(text) {
  const raw = String(text || '').trim();

  if (/^(体重|今朝の体重|本日の体重|今日の体重)/.test(raw)) {
    const m = raw.match(/-?\d+(?:\.\d+)?/);
    if (!m) return null;
    const value = Number(m[0]);
    if (!Number.isFinite(value)) return null;
    if (value < 20 || value > 300) return null;
    return value;
  }

  if (/^-?\d+(?:\.\d+)?\s*kg$/i.test(raw)) {
    const value = Number(raw.replace(/kg/i, '').trim());
    if (!Number.isFinite(value)) return null;
    if (value < 20 || value > 300) return null;
    return value;
  }

  return null;
}

function helpMessage() {
  return [
    '使い方の例です。',
    '・名前は 牛込',
    '・初回診断',
    '・プロフィール 性別 女性 年齢 55 身長 160 体重 63 目標体重 58 活動量 ふつう',
    '・体重 63.2',
    '・ジョギング 20分',
    '・ストレッチ 5分',
    '・スクワット 10回',
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
    '・食事写真も送れます',
    '・血液検査画像も送れます',
  ].join('\n');
}

function buildAiTypePrompt(aiType) {
  if (aiType === 'energetic') return '話し方は少し前向きで明るく、背中を押す雰囲気にしてください。';
  if (aiType === 'analytical') return '話し方は落ち着いて、理由や傾向をわかりやすく伝えてください。';
  if (aiType === 'casual') return '話し方は親しみやすく、気軽に話せる雰囲気にしてください。';
  return '話し方はやさしく包み込むように、安心感を大切にしてください。';
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

function setMealDraft(lineUserId, mealResult) {
  recentMealDrafts.set(lineUserId, { meal: mealResult, updatedAt: Date.now() });
}

function clearMealDraft(lineUserId) {
  recentMealDrafts.delete(lineUserId);
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

function seemsMealCorrectionText(text) {
  const t = String(text || '').trim();
  if (!t) return false;
  return [
    'です', 'ではない', 'じゃない', '違います', 'ちがいます', '個です', '杯です', '本です',
    'お酒ではない', 'お茶です', '水です', 'ノンアル', 'ジャスミンティー', '烏龍茶',
    'ウーロン茶', '緑茶', '麦茶', '紅茶',
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
    '食べたい',
    '飲みたい',
    'お腹いっぱい食べたい',
    'おなかいっぱい食べたい',
    'お腹一杯食べたい',
    'おなか一杯食べたい',
    'いっぱい食べたい',
    '甘いもの食べたい',
    '何か食べたい',
    '食欲がある',
    '食欲がない',
    '食欲あります',
    '食欲ない',
    'お腹すいた',
    'おなかすいた',
    '食べたくなる',
    '食べてしまいそう',
    '食べそう',
    '飲みたくなる',
    '食欲が止まらない',
    '食欲がすごい',
    '食べすぎそう',
    '食べ過ぎそう',
    '食べすぎたくなる',
    '甘いものが止まらない',
    'お腹いっぱい食べれる',
    'おなかいっぱい食べれる',
  ];

  if (patterns.some((p) => t.includes(p))) {
    return true;
  }

  if ((t.includes('食べ') || t.includes('飲み')) && t.includes('たい')) {
    return true;
  }

  return false;
}

function isExplicitMealLogText(text) {
  const t = normalizeMealIntentText(text);
  if (!t) return false;
  if (isMealDesireOrFeelingText(t)) return false;

  const directPatterns = [
    '食べた',
    '飲んだ',
    '食べました',
    '飲みました',
    '食べたよ',
    '飲んだよ',
    '食べたです',
    '朝食',
    '昼食',
    '夕食',
    '朝ごはん',
    '昼ごはん',
    '夜ごはん',
    '晩ごはん',
    '朝飯',
    '昼飯',
    '夜飯',
  ];

  if (directPatterns.some((p) => t.includes(p))) {
    return true;
  }

  const hasMealVerb = /食べた|飲んだ|食べました|飲みました/.test(t);
  const hasFoodLikeWord = /ラーメン|ご飯|ごはん|パン|おにぎり|うどん|そば|パスタ|カレー|寿司|すし|肉|魚|卵|サラダ|スープ|味噌汁|みそ汁|コーヒー|お茶|ジュース|ビール|お酒|ケーキ|チョコ|アイス/.test(t);

  return hasMealVerb || hasFoodLikeWord;
}

function isExplicitMealGuideIntent(text) {
  const t = String(text || '').trim();
  return [
    '食事を記録したい',
    '食事記録したい',
    '食事を登録したい',
    '食事の記録方法',
    '食事の保存方法',
    '食事を入力したい',
    '食べたものを記録したい',
    '飲んだものを記録したい',
  ].includes(t);
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
    const duplicate = result.some((saved) => {
      return saved.memory_type === row.memory_type && isMemoryContentNear(saved.content, row.content);
    });

    if (!duplicate) {
      result.push(row);
    }
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

  if (!normalized.should_save || !normalized.memories.length) {
    return [];
  }

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
      if (isMissingRelationError(error)) {
        return [];
      }
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
      if (!followUps.some((x) => isMemoryContentNear(x, content))) {
        followUps.push(content);
      }
      continue;
    }

    if (!grouped.has(type)) grouped.set(type, []);
    const list = grouped.get(type);

    if (!list.some((x) => isMemoryContentNear(x, content))) {
      list.push(content);
    }
  }

  return {
    followUps: followUps.slice(0, 4),
    grouped,
  };
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
    goal: '目標',
    concern: '気がかり',
    anxiety: '不安',
    mood_pattern: '気分の傾向',
    craving_pattern: '食欲の傾向',
    snacking_pattern: '間食傾向',
    eating_pattern: '食習慣',
    routine_pattern: '生活リズム',
    exercise_pattern: '運動傾向',
    pain_pattern: '痛み傾向',
    symptom_pattern: '症状傾向',
    medical_attention: '医療注意',
    motivation_barrier: 'やる気の壁',
    continuation_barrier: '継続の壁',
    lifestyle_context: '生活背景',
    work_context: '仕事背景',
    family_context: '家庭背景',
    emotional_trigger: '気持ちの引き金',
    helpful_support_style: '合う声かけ',
    disliked_support_style: '合わない声かけ',
    value: '大切にしていること',
    preference: '好み',
    personality_tendency: '性格傾向',
    sleep_pattern: '睡眠傾向',
    time_of_day_pattern: '時間帯傾向',
    other: 'その他',
  };

  const preferredOrder = [
    'goal',
    'concern',
    'anxiety',
    'craving_pattern',
    'eating_pattern',
    'exercise_pattern',
    'pain_pattern',
    'continuation_barrier',
    'helpful_support_style',
    'time_of_day_pattern',
    'work_context',
    'family_context',
    'medical_attention',
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
    followUpText: followUps.length
      ? followUps.map((x) => `- ${x}`).join('\n')
      : '特に優先フォローはまだありません。',
    memoryText: memoryLines.length
      ? memoryLines.join('\n')
      : '過去記憶はまだありません。',
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
    const duplicate = (recentRows || []).some((recent) => {
      return recent.memory_type === row.memory_type && isMemoryContentNear(recent.content, row.content);
    });
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
  if (firstBreak > 0 && firstBreak < max) {
    return normalized.slice(0, firstBreak).trim();
  }

  const cut = normalized.slice(0, max);
  const lastPunc = Math.max(cut.lastIndexOf('。'), cut.lastIndexOf('！'), cut.lastIndexOf('？'), cut.lastIndexOf('\n'));
  if (lastPunc >= 40) {
    return cut.slice(0, lastPunc + 1).trim();
  }
  return cut.trim();
}

function postProcessAiReply(user, rawReply) {
  let text = normalizeAiReplyText(rawReply);
  text = cleanupAiPhrases(text);
  text = limitReplyQuestions(text, 1);
  text = trimReplyLength(text, 420);
  text = safeText(text, 600);

  if (!text) {
    text = '今日はそんな感じなんですね。ここからまた整えていきましょう。';
  }

  return prefixWithName(user, text);
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
    supabase
      .from('meal_logs')
      .select('eaten_at, estimated_kcal')
      .eq('user_id', userId)
      .gte('eaten_at', startIso)
      .lte('eaten_at', endIso),
    supabase
      .from('activity_logs')
      .select('logged_at, estimated_activity_kcal')
      .eq('user_id', userId)
      .gte('logged_at', startIso)
      .lte('logged_at', endIso),
  ]);

  if (mealsRes.error) throw mealsRes.error;
  if (actsRes.error) throw actsRes.error;

  const intakeSeries = buildDailySeries(mealsRes.data || [], 'eaten_at', dateKeys);
  const activitySeries = buildDailySeries(actsRes.data || [], 'logged_at', dateKeys);

  return intakeSeries.map((row, idx) => {
    const activity = activitySeries[idx]?.value || 0;
    return {
      date: row.date,
      intake_kcal: row.value,
      activity_kcal: activity,
      net_kcal: row.value - activity,
    };
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

async function defaultChatReply(user, userText) {
  const name = getUserDisplayName(user);
  const recentMemories = await getRecentConversationMemories(user.id, 40);
  const { followUpText, memoryText } = buildMemorySummary(recentMemories);

  const prompt = [
    AI_BASE_PROMPT,
    buildAiTypePrompt(user.ai_type),
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
  const imagePart = {
    inlineData: {
      mimeType,
      data: buffer.toString('base64'),
    },
  };

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
    .insert({
      user_id: user.id,
      status: 'draft',
      current_step: 'choose_ai_type',
      answers_json: createEmptyIntakeAnswers(),
    })
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
    .update({
      ...userPatch,
      intake_status: 'completed',
    })
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
  if (profileError) throw profileError;

  const { error: sessionError } = await supabase
    .from('intake_sessions')
    .update({ status: 'completed' })
    .eq('id', session.id);
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

async function handleImageMessage(event, user) {
  try {
    const { buffer, mimeType } = await getLineImageContent(event.message.id, env.LINE_CHANNEL_ACCESS_TOKEN);

    const analyzedMeal = await analyzeMealImageWithAI(buffer, mimeType);

    if (analyzedMeal.is_meal) {
      setMealDraft(user.line_user_id, analyzedMeal);
      const needsDrinkCorrection = (analyzedMeal.food_items || []).some((x) => x.needs_confirmation);
      const mealMessage = `${buildMealConfirmationMessage(analyzedMeal)}\n\n合っていれば保存、違うところがあればボタンか文字で訂正してください。`;

      await replyMessage(
        event.replyToken,
        textMessageWithQuickReplies(
          prefixWithName(user, mealMessage),
          buildMealFollowupQuickReplies(needsDrinkCorrection)
        ),
        env.LINE_CHANNEL_ACCESS_TOKEN
      );
      return;
    }

    const extraction = await extractBloodTestDraftFromImage(buffer, mimeType);
    const dates = Array.isArray(extraction?.dates) ? extraction.dates.filter(Boolean) : [];
    const panels = Array.isArray(extraction?.panels) ? extraction.panels : [];

    if (!dates.length || !panels.length) {
      await replyMessage(
        event.replyToken,
        '画像を読み取りましたが、食事写真や血液検査画像としてはっきり判定できませんでした。もう少し見やすい写真を送ってください。',
        env.LINE_CHANNEL_ACCESS_TOKEN
      );
      return;
    }

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
      raw_extracted_json: extraction,
      working_data_json: workingData,
      source_image_url: null,
      expires_at: new Date(Date.now() + 30 * 60 * 1000).toISOString(),
    });

    if (dates.length > 1) {
      const msg = buildLabDateChoiceMessage({ working_data_json: workingData });
      await replyMessage(
        event.replyToken,
        textMessageWithQuickReplies(msg.text, msg.quickReplies),
        env.LINE_CHANNEL_ACCESS_TOKEN
      );
      return;
    }

    const msg = buildLabDraftSummaryMessage({ working_data_json: workingData, selected_date: dates[0] });
    await replyMessage(
      event.replyToken,
      textMessageWithQuickReplies(msg.text, msg.quickReplies),
      env.LINE_CHANNEL_ACCESS_TOKEN
    );
  } catch (error) {
    console.error('❌ handleImageMessage error:', error?.stack || error?.message || error);
    await replyMessage(
      event.replyToken,
      '画像の処理でエラーが起きました。もう一度写真を送ってください。',
      env.LINE_CHANNEL_ACCESS_TOKEN
    );
  }
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

    if (isHelpCommand(lower)) {
      await replyMessage(event.replyToken, helpMessage(), env.LINE_CHANNEL_ACCESS_TOKEN);
      return;
    }

    if (isIntakeStartCommand(text)) {
      const session = await startOrResumeIntake(user);
      const msg = renderIntakeStepMessage(session);
      await replyMessage(
        event.replyToken,
        textMessageWithQuickReplies(msg.text, msg.quickReplies),
        env.LINE_CHANNEL_ACCESS_TOKEN
      );
      return;
    }

    const openIntake = await getOpenIntakeSession(user.id);
    if (openIntake) {
      if (text === '最初からやり直す') {
        const reset = await updateIntakeSession(openIntake.id, {
          current_step: 'choose_ai_type',
          answers_json: createEmptyIntakeAnswers(),
        });
        const msg = renderIntakeStepMessage(reset);
        await replyMessage(
          event.replyToken,
          textMessageWithQuickReplies(msg.text, msg.quickReplies),
          env.LINE_CHANNEL_ACCESS_TOKEN
        );
        return;
      }

      if (openIntake.current_step === 'confirm_finish' && text === 'この内容で完了') {
        await completeIntakeSession(user, openIntake);
        const replyText = prefixWithName(user, '初回設定が完了しました。ここから一緒に整えていきましょうね。');
        await replyMessage(event.replyToken, replyText, env.LINE_CHANNEL_ACCESS_TOKEN);
        await rememberInteraction(user, text, replyText);
        return;
      }

      const validated = validateIntakeAnswer(openIntake.current_step, text);
      if (validated.ok) {
        const updated = await updateIntakeSession(openIntake.id, {
          current_step: validated.nextStep,
          answers_json: {
            ...(openIntake.answers_json || {}),
            ...validated.patch,
          },
        });
        const msg = renderIntakeStepMessage(updated);
        await replyMessage(
          event.replyToken,
          textMessageWithQuickReplies(msg.text, msg.quickReplies),
          env.LINE_CHANNEL_ACCESS_TOKEN
        );
        return;
      }

      const currentMsg = renderIntakeStepMessage(openIntake);
      await replyMessage(
        event.replyToken,
        textMessageWithQuickReplies(currentMsg.text, currentMsg.quickReplies),
        env.LINE_CHANNEL_ACCESS_TOKEN
      );
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

    const parsedWeight = parseWeightInput(text);
    if (parsedWeight !== null) {
      await saveWeightToLog(user.id, parsedWeight, text);

      const recentWeights = await getRecentWeightRows(user.id, 10);
      const latest = recentWeights[0] || { weight_kg: parsedWeight };
      const prev = recentWeights[1] || null;

      const diffText = (() => {
        if (!prev || prev.weight_kg == null) return '前回比較はまだありません。';
        const diff = Math.round((Number(latest.weight_kg) - Number(prev.weight_kg)) * 10) / 10;
        if (diff === 0) return '前回から変化はありません。';
        if (diff > 0) return `前回より ${diff}kg 増えています。`;
        return `前回より ${Math.abs(diff)}kg 減っています。`;
      })();

      const replyText = prefixWithName(user, `体重を保存しました。\n今回: ${parsedWeight}kg\n${diffText}`);
      await replyMessage(
        event.replyToken,
        textMessageWithQuickReplies(replyText, ['体重グラフ', '予測', '食事活動グラフ', 'グラフ']),
        env.LINE_CHANNEL_ACCESS_TOKEN
      );
      await rememberInteraction(user, text, replyText);
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

      await replyMessage(
        event.replyToken,
        textMessageWithQuickReplies(replyText, [...buildExerciseFollowupQuickReplies(), '予測', 'グラフ']),
        env.LINE_CHANNEL_ACCESS_TOKEN
      );
      await rememberInteraction(user, text, replyText);
      return;
    }

    const openLabDraft = await getOpenLabDraft(supabase, user.id);
    if (openLabDraft) {
      if (openLabDraft.active_item_name) {
        try {
          const updated = await applyLabCorrection(supabase, openLabDraft, text);
          const msg = buildLabDraftSummaryMessage(updated);
          await replyMessage(
            event.replyToken,
            textMessageWithQuickReplies(`ありがとうございます。修正しました。\n\n${msg.text}`, msg.quickReplies),
            env.LINE_CHANNEL_ACCESS_TOKEN
          );
          return;
        } catch (error) {
          if (String(error?.message).includes('INVALID_DATE')) {
            await replyMessage(event.replyToken, '日付がうまく読み取れませんでした。YYYY/MM/DD の形で送ってください。例: 2025/03/12', env.LINE_CHANNEL_ACCESS_TOKEN);
            return;
          }
          if (String(error?.message).includes('INVALID_NUMBER')) {
            await replyMessage(event.replyToken, '数値だけを送ってください。例: 138', env.LINE_CHANNEL_ACCESS_TOKEN);
            return;
          }
          throw error;
        }
      }

      const chosenDate = findPanelDateFromInput(openLabDraft, text);
      if (chosenDate && !openLabDraft.selected_date) {
        const { data, error } = await supabase
          .from('lab_import_sessions')
          .update({ selected_date: chosenDate })
          .eq('id', openLabDraft.id)
          .select('*')
          .single();
        if (error) throw error;

        const msg = buildLabDraftSummaryMessage(data);
        await replyMessage(
          event.replyToken,
          textMessageWithQuickReplies(msg.text, msg.quickReplies),
          env.LINE_CHANNEL_ACCESS_TOKEN
        );
        return;
      }

      if (text === 'この内容で保存' || text === 'この日だけ保存') {
        const selectedDate = openLabDraft.selected_date || String(Object.keys(openLabDraft.working_data_json || {}).sort().pop() || '');
        await confirmLabDraftToResults(supabase, openLabDraft, selectedDate);

        const recentRows = await getRecentLabResults(supabase, user.id, 10);
        const savedRow =
          recentRows.find((r) => formatDateOnly(r.measured_at) === selectedDate) || {
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

        const replyText = [
          '読み取れた日付をまとめて保存しました。',
          count ? `保存件数: ${count}件` : null,
          '血液検査グラフでも確認できます。',
        ].filter(Boolean).join('\n');

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

    if (isGraphMenuIntent(text)) {
      await replyMessage(
        event.replyToken,
        textMessageWithQuickReplies(
          prefixWithName(
            user,
            '見たいグラフを選んでください。\n体重なら「体重グラフ」\n食事や運動なら「食事活動グラフ」\n血液検査なら「血液検査グラフ」「HbA1cグラフ」「LDLグラフ」で見られます。'
          ),
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

    if (text === '体重推移を見たい') {
      const weightRows = await getRecentWeightRows(user.id, 20);
      const graph = buildWeightGraphMessage(weightRows);
      await replyMessage(
        event.replyToken,
        textMessageWithQuickReplies(prefixWithName(user, graph.text), ['食事活動グラフ', '血液検査グラフ', '予測', 'グラフ']),
        env.LINE_CHANNEL_ACCESS_TOKEN
      );
      return;
    }

    if (text === '血液検査の流れを見たい') {
      const recentRows = await getRecentLabResults(supabase, user.id, 12);
      const graph = buildLabGraphMessage(recentRows, 'hba1c');
      const messages = [textMessageWithQuickReplies(prefixWithName(user, graph.text), ['LDLグラフ', '体重グラフ', '食事活動グラフ', '予測'])];
      if (graph.messages.length) messages.push(...graph.messages);
      await replyMessage(event.replyToken, messages, env.LINE_CHANNEL_ACCESS_TOKEN);
      return;
    }

    if (isVideoIntent(text)) {
      clearMealDraft(user.line_user_id);
      const area = contextArea || detectPainArea(text);
      setSupportContext(user.line_user_id, { area, mode: 'video' });

      const videoResponse = buildVideoSupportResponse(area);
      const replyText = prefixWithName(user, videoResponse.text);
      await replyMessage(
        event.replyToken,
        textMessageWithQuickReplies(replyText, videoResponse.quickReplies),
        env.LINE_CHANNEL_ACCESS_TOKEN
      );
      await rememberInteraction(user, text, replyText);
      return;
    }

    if (text === '1分メニュー') {
      clearMealDraft(user.line_user_id);
      const area = contextArea || '全身';
      const menu = buildExerciseMenuResponse(area, '1min');
      const replyText = prefixWithName(user, menu.text);
      await replyMessage(
        event.replyToken,
        textMessageWithQuickReplies(replyText, menu.quickReplies),
        env.LINE_CHANNEL_ACCESS_TOKEN
      );
      await rememberInteraction(user, text, replyText);
      return;
    }

    if (text === '3分メニュー') {
      clearMealDraft(user.line_user_id);
      const area = contextArea || '全身';
      const menu = buildExerciseMenuResponse(area, '3min');
      const replyText = prefixWithName(user, menu.text);
      await replyMessage(
        event.replyToken,
        textMessageWithQuickReplies(replyText, menu.quickReplies),
        env.LINE_CHANNEL_ACCESS_TOKEN
      );
      await rememberInteraction(user, text, replyText);
      return;
    }

    if (text === 'やさしい版') {
      clearMealDraft(user.line_user_id);
      const area = contextArea || '全身';
      const menu = buildExerciseMenuResponse(area, 'gentle');
      const replyText = prefixWithName(user, menu.text);
      await replyMessage(
        event.replyToken,
        textMessageWithQuickReplies(replyText, menu.quickReplies),
        env.LINE_CHANNEL_ACCESS_TOKEN
      );
      await rememberInteraction(user, text, replyText);
      return;
    }

    if (text === '説明だけ聞く') {
      clearMealDraft(user.line_user_id);
      const area = contextArea || '全身';
      const menu = buildExerciseMenuResponse(area, 'explain');
      const replyText = prefixWithName(user, menu.text);
      await replyMessage(
        event.replyToken,
        textMessageWithQuickReplies(replyText, menu.quickReplies),
        env.LINE_CHANNEL_ACCESS_TOKEN
      );
      await rememberInteraction(user, text, replyText);
      return;
    }

    if (isStretchIntent(text) || text === 'ストレッチしたい') {
      clearMealDraft(user.line_user_id);
      const area = contextArea || detectPainArea(text);
      setSupportContext(user.line_user_id, { area, mode: 'stretch' });

      const stretchResponse = buildStretchSupportResponse(area);
      const replyText = prefixWithName(user, stretchResponse.message);
      await replyMessage(
        event.replyToken,
        textMessageWithQuickReplies(replyText, [...stretchResponse.quickReplies, '動画で見たい']),
        env.LINE_CHANNEL_ACCESS_TOKEN
      );
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
      await replyMessage(
        event.replyToken,
        textMessageWithQuickReplies(replyText, ['できた', 'まだ少しやる', '動画で見たい', '今日はここまで']),
        env.LINE_CHANNEL_ACCESS_TOKEN
      );
      await rememberInteraction(user, text, replyText);
      return;
    }

    if (['朝から重い', '座るとつらい', '少し動くと楽', '歩くとつらい'].includes(text)) {
      clearMealDraft(user.line_user_id);
      const area = contextArea || '全身';
      const followup = buildPainSituationResponse(text, area);

      if (followup) {
        const replyText = prefixWithName(user, followup.message);
        await replyMessage(
          event.replyToken,
          textMessageWithQuickReplies(replyText, followup.quickReplies),
          env.LINE_CHANNEL_ACCESS_TOKEN
        );
        await rememberInteraction(user, text, replyText);
        return;
      }
    }

    if (isPainLikeText(text)) {
      clearMealDraft(user.line_user_id);
      const area = detectPainArea(text);
      setSupportContext(user.line_user_id, { area, mode: 'pain' });

      const painResponse = buildPainSupportResponse(text, area);
      const replyText = prefixWithName(user, painResponse.message);
      await replyMessage(
        event.replyToken,
        textMessageWithQuickReplies(replyText, [...painResponse.quickReplies, '動画で見たい']),
        env.LINE_CHANNEL_ACCESS_TOKEN
      );
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
        await replyMessage(
          event.replyToken,
          textMessageWithQuickReplies(replyText, ['まだ少しやる', '動画で見たい', '予測', '体重グラフ', 'グラフ', '今日はここまで']),
          env.LINE_CHANNEL_ACCESS_TOKEN
        );
        await rememberInteraction(user, text, replyText);
        return;
      }

      if (text === 'まだ少しやる') {
        const replyText = prefixWithName(user, 'いい流れですね。無理なくもう少しだけいきましょう。');
        await replyMessage(
          event.replyToken,
          textMessageWithQuickReplies(replyText, ['1分メニュー', '3分メニュー', 'やさしい版', '今日はここまで']),
          env.LINE_CHANNEL_ACCESS_TOKEN
        );
        await rememberInteraction(user, text, replyText);
        return;
      }

      if (text === '腰が重い' || text === '股関節を整えたい') {
        clearMealDraft(user.line_user_id);
        const area = text === '腰が重い' ? '腰' : '股関節';
        setSupportContext(user.line_user_id, { area, mode: 'pain' });

        const painResponse = buildPainSupportResponse(text, area);
        const replyText = prefixWithName(user, painResponse.message);
        await replyMessage(
          event.replyToken,
          textMessageWithQuickReplies(replyText, [...painResponse.quickReplies, '動画で見たい']),
          env.LINE_CHANNEL_ACCESS_TOKEN
        );
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

    if (currentMealDraft && isMealSaveCommand(text)) {
      const savedMeal = await saveMealToLog(user.id, currentMealDraft.meal);
      clearMealDraft(user.line_user_id);

      const totals = await getTodayEnergyTotals(user.id);
      const energyText = buildEnergySummaryText({
        estimatedBmr: user.estimated_bmr || 0,
        estimatedTdee: user.estimated_tdee || 0,
        intakeKcal: totals.intake_kcal || 0,
        activityKcal: totals.activity_kcal || 0,
      });

      const saveLines = [
        '食事を保存しました。',
        `料理: ${savedMeal.meal_label}`,
        savedMeal.estimated_kcal != null ? `今回の推定摂取: ${fmt(savedMeal.estimated_kcal)} kcal` : null,
        `本日摂取合計: ${fmt(totals.intake_kcal || 0)} kcal`,
      ].filter(Boolean);

      const replyText = prefixWithName(user, `${saveLines.join('\n')}\n\n${energyText}`);

      await replyMessage(
        event.replyToken,
        textMessageWithQuickReplies(replyText, ['次の食事を記録', '少し歩いた', 'ストレッチしたい', '予測', '体重グラフ', 'グラフ']),
        env.LINE_CHANNEL_ACCESS_TOKEN
      );
      await rememberInteraction(user, text, replyText);
      return;
    }

    if (currentMealDraft && isMealCancelCommand(text)) {
      clearMealDraft(user.line_user_id);
      const replyText = '食事の確認中データを取り消しました。';
      await replyMessage(event.replyToken, replyText, env.LINE_CHANNEL_ACCESS_TOKEN);
      await rememberInteraction(user, text, replyText);
      return;
    }

    if (currentMealDraft && seemsMealCorrectionText(text)) {
      const correctedMeal = await applyMealCorrection(currentMealDraft.meal, text);
      setMealDraft(user.line_user_id, correctedMeal);

      const needsDrinkCorrection = (correctedMeal.food_items || []).some((x) => x.needs_confirmation);
      const replyText = prefixWithName(user, buildMealCorrectionConfirmationMessage(correctedMeal));

      await replyMessage(
        event.replyToken,
        textMessageWithQuickReplies(replyText, buildMealFollowupQuickReplies(needsDrinkCorrection)),
        env.LINE_CHANNEL_ACCESS_TOKEN
      );
      await rememberInteraction(user, text, replyText);
      return;
    }

    if (isMealDesireOrFeelingText(text)) {
      const reply = await defaultChatReply(user, text);
      await replyMessage(event.replyToken, reply, env.LINE_CHANNEL_ACCESS_TOKEN);
      await rememberInteraction(user, text, reply);
      return;
    }

    if (isExplicitMealLogText(text) || seemsMealTextCandidate(text)) {
      const analyzedMeal = await analyzeMealTextWithAI(text);
      setMealDraft(user.line_user_id, analyzedMeal);

      const needsDrinkCorrection = (analyzedMeal.food_items || []).some((x) => x.needs_confirmation);
      const mealMessage = `${buildMealConfirmationMessage(analyzedMeal)}\n\n合っていれば保存、違うところがあればボタンか文字で訂正してください。`;
      const replyText = prefixWithName(user, mealMessage);

      await replyMessage(
        event.replyToken,
        textMessageWithQuickReplies(replyText, buildMealFollowupQuickReplies(needsDrinkCorrection)),
        env.LINE_CHANNEL_ACCESS_TOKEN
      );
      await rememberInteraction(user, text, replyText);
      return;
    }

    if (text === '飲み物を訂正' || text === '量を訂正') {
      const replyText = 'そのまま文字で教えてください。例: ジャスミンティーです / お酒ではないです / 大福は2個です';
      await replyMessage(event.replyToken, replyText, env.LINE_CHANNEL_ACCESS_TOKEN);
      return;
    }

    if (isExplicitMealGuideIntent(text)) {
      await replyMessage(event.replyToken, buildMealTextGuide(), env.LINE_CHANNEL_ACCESS_TOKEN);
      return;
    }

    const reply = await defaultChatReply(user, text);
    await replyMessage(event.replyToken, reply, env.LINE_CHANNEL_ACCESS_TOKEN);
    await rememberInteraction(user, text, reply);
  } catch (error) {
    console.error('❌ handleTextMessage error:', error?.stack || error?.message || error);
    await replyMessage(event.replyToken, '入力の処理でエラーが起きました。もう一度ゆっくり送ってください。', env.LINE_CHANNEL_ACCESS_TOKEN);
  }
}

app.listen(PORT, () => {
  console.log(`✅ Server running on port ${PORT}`);
});
