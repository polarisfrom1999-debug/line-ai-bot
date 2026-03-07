require('dotenv').config();

const fs = require('fs');
const path = require('path');
const express = require('express');
const crypto = require('crypto');
const axios = require('axios');
const { createClient } = require('@supabase/supabase-js');
const { GoogleGenAI } = require('@google/genai');
const {
  LAB_ITEM_LABELS,
  renderPanelSummary,
  buildLabQuickReplyMain,
  createLabDraftSession,
  getOpenLabDraft,
  setActiveLabCorrection,
  applyLabCorrection,
  confirmLabDraftToResults,
} = require('./blood_test_flow_helpers');

const app = express();
const PORT = Number(process.env.PORT || 10000);

// ---------- Environment ----------
const REQUIRED_ENV = [
  'LINE_CHANNEL_ACCESS_TOKEN',
  'LINE_CHANNEL_SECRET',
  'GEMINI_API_KEY',
  'SUPABASE_URL',
  'SUPABASE_SERVICE_ROLE_KEY',
];

const missingEnv = REQUIRED_ENV.filter((key) => !process.env[key]);
if (missingEnv.length > 0) {
  console.error('❌ Missing environment variables:', missingEnv.join(', '));
  process.exit(1);
}

const LINE_CHANNEL_ACCESS_TOKEN = process.env.LINE_CHANNEL_ACCESS_TOKEN;
const LINE_CHANNEL_SECRET = process.env.LINE_CHANNEL_SECRET;
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const GEMINI_MODEL = process.env.GEMINI_MODEL || 'gemini-2.5-flash';
const GEMINI_FALLBACK_MODEL = process.env.GEMINI_FALLBACK_MODEL || 'gemini-2.0-flash';
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const TZ = process.env.APP_TIMEZONE || 'Asia/Tokyo';

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: {
    autoRefreshToken: false,
    persistSession: false,
  },
});

const genAI = new GoogleGenAI({ apiKey: GEMINI_API_KEY });

const AI_PROMPT_PATH = path.join(process.cwd(), 'ai_ushigome_prompt.txt');
const AI_BASE_PROMPT = loadAiPrompt();

const INTAKE_STEPS = [
  'choose_ai_type',
  'choose_main_goal',
  'choose_main_concern',
  'choose_activity_level',
  'choose_sleep_level',
  'choose_support_style',
  'ideal_future_free',
  'confirm_finish',
];

const AI_TYPE_MAP = {
  'やさしい伴走': 'gentle',
  '元気応援': 'energetic',
  '分析サポート': 'analytical',
  '気軽トーク': 'casual',
};

const AI_TYPE_LABEL = {
  gentle: 'やさしい伴走',
  energetic: '元気応援',
  analytical: '分析サポート',
  casual: '気軽トーク',
};

const INTAKE_OPTIONS = {
  choose_ai_type: ['やさしい伴走', '元気応援', '分析サポート', '気軽トーク'],
  choose_main_goal: ['健康改善', '体重管理', '美容も整えたい', '生活習慣改善'],
  choose_main_concern: ['食事', '睡眠', 'むくみ', '姿勢', '血液検査'],
  choose_activity_level: ['ほぼ運動なし', 'たまに動く', '週1〜2回', '週3回以上'],
  choose_sleep_level: ['5時間未満', '5〜6時間', '6〜7時間', '7時間以上'],
  choose_support_style: ['優しく伴走', 'しっかり励ます', '理由も知りたい', '気軽に話したい'],
};

// ---------- Express ----------
app.get('/', (_req, res) => {
  res.status(200).send('AI Ushigome LINE bot is running.');
});

app.post('/webhook', express.raw({ type: '*/*', limit: '20mb' }), async (req, res) => {
  try {
    const signature = req.headers['x-line-signature'];
    const rawBody = req.body;

    if (!verifyLineSignature(rawBody, signature, LINE_CHANNEL_SECRET)) {
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

// ---------- LINE helpers ----------
function verifyLineSignature(rawBody, signature, channelSecret) {
  if (!signature || !rawBody || !channelSecret) return false;
  const expected = crypto
    .createHmac('sha256', channelSecret)
    .update(rawBody)
    .digest('base64');

  try {
    return crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected));
  } catch {
    return false;
  }
}

async function replyMessage(replyToken, messages) {
  if (!replyToken) return;
  const payload = {
    replyToken,
    messages: normalizeLineMessages(messages),
  };

  await axios.post('https://api.line.me/v2/bot/message/reply', payload, {
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${LINE_CHANNEL_ACCESS_TOKEN}`,
    },
    timeout: 30000,
  });
}

function normalizeLineMessages(messages) {
  const list = Array.isArray(messages) ? messages : [messages];
  return list
    .filter(Boolean)
    .slice(0, 5)
    .map((msg) => {
      if (typeof msg === 'string') {
        return { type: 'text', text: msg.slice(0, 5000) };
      }
      if (msg.type === 'text' && typeof msg.text === 'string') {
        return { ...msg, text: msg.text.slice(0, 5000) };
      }
      return msg;
    });
}

function textMessageWithQuickReplies(text, labels) {
  const items = (labels || [])
    .filter(Boolean)
    .slice(0, 13)
    .map((label) => ({
      type: 'action',
      action: { type: 'message', label: String(label).slice(0, 20), text: String(label).slice(0, 300) },
    }));

  if (!items.length) return { type: 'text', text: String(text).slice(0, 5000) };
  return {
    type: 'text',
    text: String(text).slice(0, 5000),
    quickReply: { items },
  };
}

async function getLineImageContent(messageId) {
  return retry(async () => {
    const response = await axios.get(
      `https://api-data.line.me/v2/bot/message/${messageId}/content`,
      {
        responseType: 'arraybuffer',
        headers: { Authorization: `Bearer ${LINE_CHANNEL_ACCESS_TOKEN}` },
        timeout: 60000,
        maxContentLength: 20 * 1024 * 1024,
        maxBodyLength: 20 * 1024 * 1024,
      }
    );

    const mimeHeader = response.headers['content-type'] || 'image/jpeg';
    const mime = String(mimeHeader).includes('image/') ? mimeHeader : 'image/jpeg';
    const buffer = Buffer.from(response.data);
    if (!buffer || !buffer.length) throw new Error('LINE image content is empty');
    return { buffer, mime };
  }, 2, 700);
}

// ---------- Event router ----------
async function processEvent(event) {
  if (!event || event.type !== 'message' || !event.message) return;

  const source = event.source || {};
  const lineUserId = source.userId || null;
  if (!lineUserId) {
    console.warn('⚠️ userId not available. Skipping event.');
    return;
  }

  const user = await ensureUser(lineUserId);

  if (event.message.type === 'image') {
    await handleImageMessage(event, user);
    return;
  }

  if (event.message.type === 'text') {
    await handleTextMessage(event, user);
    return;
  }

  await replyMessage(event.replyToken, '今はテキストと画像に対応しています。');
}

// ---------- User ----------
async function ensureUser(lineUserId) {
  const { data: existing, error: selectError } = await supabase
    .from('users')
    .select('*')
    .eq('line_user_id', lineUserId)
    .maybeSingle();

  if (selectError) throw selectError;
  if (existing) return existing;

  const insertPayload = {
    line_user_id: lineUserId,
    timezone: TZ,
    intake_status: 'not_started',
  };

  const { data: created, error: insertError } = await supabase
    .from('users')
    .insert(insertPayload)
    .select('*')
    .single();

  if (insertError) throw insertError;
  return created;
}

// ---------- Intake flow ----------
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
      answers_json: {},
    })
    .select('*')
    .single();
  if (error) throw error;

  await supabase.from('users').update({ intake_status: 'in_progress' }).eq('id', user.id);
  return data;
}

function renderIntakeStepMessage(session) {
  const step = session.current_step;

  if (step === 'choose_ai_type') {
    return textMessageWithQuickReplies(
      '初回インテークを始めますね。\nまずは、AI牛込の話し方タイプを選んでください。',
      INTAKE_OPTIONS.choose_ai_type
    );
  }

  if (step === 'choose_main_goal') {
    return textMessageWithQuickReplies(
      '今いちばん近い目的を選んでください。',
      INTAKE_OPTIONS.choose_main_goal
    );
  }

  if (step === 'choose_main_concern') {
    return textMessageWithQuickReplies(
      '今、特に気になっていることを1つ選んでください。',
      INTAKE_OPTIONS.choose_main_concern
    );
  }

  if (step === 'choose_activity_level') {
    return textMessageWithQuickReplies(
      '普段の運動量にいちばん近いものを選んでください。',
      INTAKE_OPTIONS.choose_activity_level
    );
  }

  if (step === 'choose_sleep_level') {
    return textMessageWithQuickReplies(
      '最近の睡眠時間にいちばん近いものを選んでください。',
      INTAKE_OPTIONS.choose_sleep_level
    );
  }

  if (step === 'choose_support_style') {
    return textMessageWithQuickReplies(
      'どんな関わり方がいちばん合いそうですか？',
      INTAKE_OPTIONS.choose_support_style
    );
  }

  if (step === 'ideal_future_free') {
    return textMessageWithQuickReplies(
      '理想の未来や、こうなれたら嬉しいということがあれば自由に教えてください。\n思いつかなければ「スキップ」でも大丈夫です。',
      ['スキップ']
    );
  }

  if (step === 'confirm_finish') {
    const a = session.answers_json || {};
    const summary = [
      'ここまでありがとうございます。',
      '',
      `AIタイプ: ${AI_TYPE_LABEL[a.ai_type] || '未設定'}`,
      `目的: ${a.main_goal || '未設定'}`,
      `気になること: ${a.main_concern || '未設定'}`,
      `運動量: ${a.activity_level || '未設定'}`,
      `睡眠: ${a.sleep_level || '未設定'}`,
      `関わり方: ${a.support_style || '未設定'}`,
      a.ideal_future ? `理想の未来: ${a.ideal_future}` : null,
      '',
      'この内容で初回設定を完了しますか？',
    ].filter(Boolean).join('\n');

    return textMessageWithQuickReplies(summary, ['この内容で完了', '最初からやり直す']);
  }

  return textMessageWithQuickReplies('初回インテークを再開します。', ['初回診断を始める']);
}

async function advanceIntakeSession(session, patch, nextStep) {
  const answers = { ...(session.answers_json || {}), ...patch };
  const { data, error } = await supabase
    .from('intake_sessions')
    .update({
      answers_json: answers,
      current_step: nextStep,
    })
    .eq('id', session.id)
    .select('*')
    .single();
  if (error) throw error;
  return data;
}

async function resetIntakeSession(sessionId) {
  const { data, error } = await supabase
    .from('intake_sessions')
    .update({
      current_step: 'choose_ai_type',
      answers_json: {},
    })
    .eq('id', sessionId)
    .select('*')
    .single();
  if (error) throw error;
  return data;
}

async function completeIntakeSession(user, session) {
  const answers = session.answers_json || {};
  const generated = await buildInitialIntakeSummary(answers);

  const profilePayload = {
    user_id: user.id,
    personality_summary: generated.personality_summary,
    encouragement_style: answers.support_style || null,
    conversation_style: AI_TYPE_LABEL[answers.ai_type] || null,
    favorite_exercise: answers.activity_level || null,
    current_barriers: answers.main_concern || null,
    strengths_summary: generated.strengths_summary,
    future_prediction_summary: generated.future_prediction_summary,
    initial_plan_summary: generated.initial_plan_summary,
  };

  const { error: profileError } = await supabase
    .from('user_profiles')
    .upsert(profilePayload, { onConflict: 'user_id' });
  if (profileError) throw profileError;

  const { error: sessionError } = await supabase
    .from('intake_sessions')
    .update({
      status: 'completed',
      current_step: 'confirm_finish',
    })
    .eq('id', session.id);
  if (sessionError) throw sessionError;

  const { error: userError } = await supabase
    .from('users')
    .update({
      ai_type: answers.ai_type || null,
      intake_status: 'completed',
    })
    .eq('id', user.id);
  if (userError) throw userError;

  return generated;
}

async function buildInitialIntakeSummary(answers) {
  const prompt = [
    AI_BASE_PROMPT,
    '以下は初回インテークの回答です。',
    'この人の強み、気をつけたい点、最初の進め方をやさしく整理してください。',
    '必ずJSONだけを返してください。',
    JSON.stringify(answers),
  ].join('\n\n');

  const schema = {
    type: 'object',
    properties: {
      personality_summary: { type: 'string' },
      strengths_summary: { type: 'string' },
      future_prediction_summary: { type: 'string' },
      initial_plan_summary: { type: 'string' },
    },
    required: ['personality_summary', 'strengths_summary', 'future_prediction_summary', 'initial_plan_summary'],
  };

  try {
    const parsed = await generateJsonOnly(prompt, schema, 0.4);
    return {
      personality_summary: safeText(parsed.personality_summary, 1000),
      strengths_summary: safeText(parsed.strengths_summary, 1000),
      future_prediction_summary: safeText(parsed.future_prediction_summary, 1000),
      initial_plan_summary: safeText(parsed.initial_plan_summary, 1000),
    };
  } catch (e) {
    return {
      personality_summary: 'やさしく寄り添いながら、続けやすい形を一緒に探していくのが合いそうです。',
      strengths_summary: '自分の状態を見つめて、良くしたい気持ちを持てていること自体が大きな強みです。',
      future_prediction_summary: '無理をしすぎず、毎日の小さな積み重ねを続けることで、健康と美容の両方に良い変化が出やすそうです。',
      initial_plan_summary: 'まずは生活の記録をシンプルに続けながら、睡眠・水分・食事の土台を整えていきましょう。',
    };
  }
}

async function generateJsonOnly(prompt, schema, temperature = 0.3) {
  const tryModels = [GEMINI_MODEL, GEMINI_FALLBACK_MODEL];
  let lastError;
  for (const model of tryModels) {
    try {
      const response = await retry(async () => genAI.models.generateContent({
        model,
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
        config: {
          responseMimeType: 'application/json',
          responseJsonSchema: schema,
          temperature,
        },
      }), 2, 700);
      return safeJsonParse(extractGeminiText(response));
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError || new Error('Gemini JSON text-only generation failed');
}

async function handleIntakeTextFlow(replyToken, user, text) {
  const trimmed = String(text || '').trim();

  if (trimmed === 'あとで') {
    await replyMessage(replyToken, '大丈夫です。必要な時に「初回診断」と送ってくださいね。');
    return true;
  }

  if (trimmed === '初回診断' || trimmed === '初回診断を始める') {
    const session = await startOrResumeIntake(user);
    await replyMessage(replyToken, renderIntakeStepMessage(session));
    return true;
  }

  const session = await getOpenIntakeSession(user.id);
  if (!session) return false;

  const step = session.current_step;
  let updated;

  if (step === 'choose_ai_type') {
    if (!INTAKE_OPTIONS.choose_ai_type.includes(trimmed)) {
      await replyMessage(replyToken, renderIntakeStepMessage(session));
      return true;
    }
    updated = await advanceIntakeSession(session, { ai_type: AI_TYPE_MAP[trimmed] || 'gentle' }, 'choose_main_goal');
    await supabase.from('users').update({ ai_type: AI_TYPE_MAP[trimmed] || 'gentle', intake_status: 'in_progress' }).eq('id', user.id);
    await replyMessage(replyToken, renderIntakeStepMessage(updated));
    return true;
  }

  if (step === 'choose_main_goal') {
    if (!INTAKE_OPTIONS.choose_main_goal.includes(trimmed)) {
      await replyMessage(replyToken, renderIntakeStepMessage(session));
      return true;
    }
    updated = await advanceIntakeSession(session, { main_goal: trimmed }, 'choose_main_concern');
    await replyMessage(replyToken, renderIntakeStepMessage(updated));
    return true;
  }

  if (step === 'choose_main_concern') {
    if (!INTAKE_OPTIONS.choose_main_concern.includes(trimmed)) {
      await replyMessage(replyToken, renderIntakeStepMessage(session));
      return true;
    }
    updated = await advanceIntakeSession(session, { main_concern: trimmed }, 'choose_activity_level');
    await replyMessage(replyToken, renderIntakeStepMessage(updated));
    return true;
  }

  if (step === 'choose_activity_level') {
    if (!INTAKE_OPTIONS.choose_activity_level.includes(trimmed)) {
      await replyMessage(replyToken, renderIntakeStepMessage(session));
      return true;
    }
    updated = await advanceIntakeSession(session, { activity_level: trimmed }, 'choose_sleep_level');
    await replyMessage(replyToken, renderIntakeStepMessage(updated));
    return true;
  }

  if (step === 'choose_sleep_level') {
    if (!INTAKE_OPTIONS.choose_sleep_level.includes(trimmed)) {
      await replyMessage(replyToken, renderIntakeStepMessage(session));
      return true;
    }
    updated = await advanceIntakeSession(session, { sleep_level: trimmed }, 'choose_support_style');
    await replyMessage(replyToken, renderIntakeStepMessage(updated));
    return true;
  }

  if (step === 'choose_support_style') {
    if (!INTAKE_OPTIONS.choose_support_style.includes(trimmed)) {
      await replyMessage(replyToken, renderIntakeStepMessage(session));
      return true;
    }
    updated = await advanceIntakeSession(session, { support_style: trimmed }, 'ideal_future_free');
    await replyMessage(replyToken, renderIntakeStepMessage(updated));
    return true;
  }

  if (step === 'ideal_future_free') {
    const value = trimmed === 'スキップ' ? '' : trimmed;
    updated = await advanceIntakeSession(session, { ideal_future: value }, 'confirm_finish');
    await replyMessage(replyToken, renderIntakeStepMessage(updated));
    return true;
  }

  if (step === 'confirm_finish') {
    if (trimmed === '最初からやり直す') {
      updated = await resetIntakeSession(session.id);
      await replyMessage(replyToken, renderIntakeStepMessage(updated));
      return true;
    }

    if (trimmed === 'この内容で完了') {
      const generated = await completeIntakeSession(user, session);
      const finalMsg = [
        '初回設定が完了しました。',
        '',
        `あなたの強み: ${generated.strengths_summary}`,
        '',
        `最初の進め方: ${generated.initial_plan_summary}`,
        '',
        'ここから一緒に整えていきましょうね。',
      ].join('\n');
      await replyMessage(replyToken, finalMsg);
      return true;
    }

    await replyMessage(replyToken, renderIntakeStepMessage(session));
    return true;
  }

  return false;
}

async function maybePromptIntake(replyToken, user, text) {
  if (user.intake_status === 'completed') return false;
  const trimmed = String(text || '').trim();
  if (
    trimmed === '初回診断' ||
    trimmed === '初回診断を始める' ||
    isHelpCommand(trimmed.toLowerCase()) ||
    isWeightCommand(trimmed.toLowerCase()) ||
    isActivityCommand(trimmed.toLowerCase()) ||
    isSleepCommand(trimmed.toLowerCase()) ||
    isHydrationCommand(trimmed.toLowerCase()) ||
    isLabCommand(trimmed.toLowerCase()) ||
    isWeeklyReportCommand(trimmed.toLowerCase()) ||
    isMonthlyReportCommand(trimmed.toLowerCase()) ||
    isProfileCommand(trimmed.toLowerCase()) ||
    isBmrCommand(trimmed.toLowerCase())
  ) return false;

  const open = await getOpenIntakeSession(user.id);
  if (open) return false;

  await replyMessage(
    replyToken,
    textMessageWithQuickReplies(
      'よりあなたに合った伴走にするため、最初に1分ほどの初回診断をおすすめしています。始めますか？',
      ['初回診断を始める', 'あとで']
    )
  );
  return true;
}

// ---------- Image flow ----------
async function handleImageMessage(event, user) {
  const replyToken = event.replyToken;
  const messageId = event.message.id;

  try {
    const { buffer, mime } = await getLineImageContent(messageId);
    const imageClass = await classifyImageWithGemini(buffer, mime);

    console.log('🖼 image classification:', imageClass);

    if (imageClass.category === 'meal') {
      await handleMealImage({ replyToken, user, messageId, buffer, mime });
      return;
    }

    if (imageClass.category === 'blood_test') {
      await handleBloodTestImage({ replyToken, user, messageId, buffer, mime });
      return;
    }

    if (imageClass.category === 'body_scale') {
      await handleBodyScaleImage({ replyToken, user, messageId, buffer, mime });
      return;
    }

    await handleOtherImage({ replyToken, user, buffer, mime, hint: imageClass.reasoning || '' });
  } catch (error) {
    console.error('❌ handleImageMessage error:', error?.stack || error?.message || error);
    await replyMessage(
      replyToken,
      '画像の処理で少し不安定な状態になりました。写真をもう一度送っていただくか、内容を文字で送ってください。'
    );
  }
}

async function handleMealImage({ replyToken, user, messageId, buffer, mime }) {
  const analysis = await analyzeMealImageWithGemini(buffer, mime);
  const eatenAt = toIsoStringInTZ(new Date(), TZ);

  const mealInsert = {
    user_id: user.id,
    source_message_id: messageId,
    eaten_at: eatenAt,
    meal_label: safeText(analysis.meal_label || '食事', 100),
    food_items: Array.isArray(analysis.food_items) ? analysis.food_items : [],
    estimated_kcal: toNumberOrNull(analysis.estimated_kcal),
    kcal_min: toNumberOrNull(analysis.kcal_min),
    kcal_max: toNumberOrNull(analysis.kcal_max),
    protein_g: toNumberOrNull(analysis.protein_g),
    fat_g: toNumberOrNull(analysis.fat_g),
    carbs_g: toNumberOrNull(analysis.carbs_g),
    confidence: clamp01(toNumberOrNull(analysis.confidence)),
    ai_comment: safeText(analysis.ai_comment, 1000),
    raw_model_json: analysis,
  };

  const { error: mealError } = await supabase.from('meal_logs').insert(mealInsert);
  if (mealError) throw mealError;

  const daySummary = await buildDailySummary(user.id, eatenAt.slice(0, 10));
  const weekly = await buildWeeklySummary(user.id, eatenAt);

  const lines = [
    '📸 食事を記録しました。',
    `料理: ${mealInsert.meal_label}`,
    `推定カロリー: ${formatKcalRange(mealInsert.estimated_kcal, mealInsert.kcal_min, mealInsert.kcal_max)}`,
    mealInsert.protein_g || mealInsert.fat_g || mealInsert.carbs_g
      ? `PFC: P${fmt(mealInsert.protein_g)}g / F${fmt(mealInsert.fat_g)}g / C${fmt(mealInsert.carbs_g)}g`
      : null,
    mealInsert.ai_comment ? `ひとこと: ${mealInsert.ai_comment}` : null,
    '',
    `本日摂取合計: ${fmt(daySummary.total_intake_kcal)} kcal`,
    `今週摂取合計: ${fmt(weekly.total_intake_kcal)} kcal`,
  ].filter(Boolean);

  await replyMessage(replyToken, lines.join('\n'));
}

async function handleBloodTestImage({ replyToken, user, messageId, buffer, mime }) {
  const extraction = await extractBloodTestDraftWithGemini(buffer, mime);
  const dates = Array.isArray(extraction.dates) ? extraction.dates.filter(Boolean) : [];
  const panels = Array.isArray(extraction.panels) ? extraction.panels : [];

  if (!dates.length || !panels.length) {
    await replyMessage(
      replyToken,
      '🧪 血液検査の画像として受け取りました。少し見えにくい所があるので、もう少しはっきり写るように送っていただけると助かります。'
    );
    return;
  }

  const workingData = {};
  for (const panel of panels) {
    if (!panel || !panel.date) continue;
    workingData[panel.date] = panel.items || {};
  }

  const firstDate = dates[0];
  await createLabDraftSession(supabase, {
    user_id: user.id,
    line_user_id: user.line_user_id,
    line_message_id: messageId,
    status: 'draft',
    detected_dates_json: dates,
    selected_date: dates.length === 1 ? firstDate : null,
    raw_extracted_json: extraction,
    working_data_json: workingData,
    source_image_url: null,
    expires_at: new Date(Date.now() + 30 * 60 * 1000).toISOString(),
  });

  if (dates.length > 1) {
    const chooseText = [
      '🧪 血液検査の画像を読み取りました。',
      'この画像には複数回分の検査結果がありそうです。',
      'まず確認したい日付を選んでください。',
      '',
      ...dates.map((d, i) => `${i + 1}. ${String(d).replace(/-/g, '/')}`),
    ].join('\n');

    await replyMessage(
      replyToken,
      textMessageWithQuickReplies(chooseText, dates.map((d) => d.replace(/-/g, '/')))
    );
    return;
  }

  const items = workingData[firstDate] || {};
  const text = renderPanelSummary(firstDate, items);
  await replyMessage(replyToken, textMessageWithQuickReplies(text, buildLabQuickReplyMain(items)));
}

async function handleBodyScaleImage({ replyToken, user, messageId, buffer, mime }) {
  const analysis = await analyzeBodyScaleImageWithGemini(buffer, mime);
  const insertPayload = {
    user_id: user.id,
    source_message_id: messageId,
    measured_at: toIsoStringInTZ(new Date(), TZ),
    weight_kg: toNumberOrNull(analysis.weight_kg),
    body_fat_percent: toNumberOrNull(analysis.body_fat_percent),
    bmi: toNumberOrNull(analysis.bmi),
    raw_model_json: analysis,
  };

  const { error } = await supabase.from('body_metrics').insert(insertPayload);
  if (error) throw error;

  await replyMessage(
    replyToken,
    [
      '⚖️ 体組成計の画像として記録しました。',
      insertPayload.weight_kg ? `体重: ${fmt(insertPayload.weight_kg)} kg` : null,
      insertPayload.body_fat_percent ? `体脂肪率: ${fmt(insertPayload.body_fat_percent)} %` : null,
      insertPayload.bmi ? `BMI: ${fmt(insertPayload.bmi)}` : null,
      analysis.ai_comment || null,
    ].filter(Boolean).join('\n')
  );
}

async function handleOtherImage({ replyToken, user, buffer, mime, hint }) {
  const comment = await chatAboutOtherImage(user, buffer, mime, hint);
  await replyMessage(replyToken, comment);
}

async function classifyImageWithGemini(buffer, mimeType) {
  const schema = {
    type: 'object',
    properties: {
      category: { type: 'string', enum: ['meal', 'blood_test', 'body_scale', 'other'] },
      confidence: { type: 'number' },
      reasoning: { type: 'string' },
    },
    required: ['category', 'confidence', 'reasoning'],
  };

  const prompt = [
    'あなたはLINEに送られた画像の種類を分類するアシスタントです。',
    '食事写真なら meal、血液検査や健診結果なら blood_test、体重計や体組成計なら body_scale、それ以外は other を返してください。',
    '必ずJSONだけを返してください。',
  ].join('\n');

  const result = await generateJsonWithGemini({
    prompt,
    buffer,
    mimeType,
    schema,
    temperature: 0,
  });

  if (!result || !result.category) {
    return { category: 'other', confidence: 0.1, reasoning: '分類失敗のため other 扱い' };
  }
  return result;
}

async function analyzeMealImageWithGemini(buffer, mimeType) {
  const schema = {
    type: 'object',
    properties: {
      meal_label: { type: 'string' },
      food_items: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            name: { type: 'string' },
            estimated_amount: { type: 'string' },
            estimated_kcal: { type: 'number' },
          },
          required: ['name'],
        },
      },
      estimated_kcal: { type: 'number' },
      kcal_min: { type: 'number' },
      kcal_max: { type: 'number' },
      protein_g: { type: 'number' },
      fat_g: { type: 'number' },
      carbs_g: { type: 'number' },
      confidence: { type: 'number' },
      ai_comment: { type: 'string' },
    },
    required: ['meal_label', 'food_items', 'estimated_kcal', 'kcal_min', 'kcal_max', 'confidence', 'ai_comment'],
  };

  const prompt = [
    'あなたは日本向けの食事カロリー概算アシスタントです。',
    '写真の料理をできるだけ分解して見積もってください。',
    '1品ごとに food_items にまとめてください。',
    '見えない油・ソース・調味料は過小評価しないでください。',
    '不確実な場合は幅(kcal_min, kcal_max)を広めにしてください。',
    'meal_label は短く自然な日本語で返してください。',
    'confidence は 0.0〜1.0 です。',
    '必ずJSONだけを返してください。',
  ].join('\n');

  const parsed = await generateJsonWithGemini({
    prompt,
    buffer,
    mimeType,
    schema,
    temperature: 0.2,
  });

  if (!parsed || typeof parsed !== 'object') {
    throw new Error('Meal analysis JSON is invalid');
  }

  return {
    meal_label: parsed.meal_label || '食事',
    food_items: Array.isArray(parsed.food_items) ? parsed.food_items : [],
    estimated_kcal: toNumberOrNull(parsed.estimated_kcal),
    kcal_min: toNumberOrNull(parsed.kcal_min),
    kcal_max: toNumberOrNull(parsed.kcal_max),
    protein_g: toNumberOrNull(parsed.protein_g),
    fat_g: toNumberOrNull(parsed.fat_g),
    carbs_g: toNumberOrNull(parsed.carbs_g),
    confidence: clamp01(toNumberOrNull(parsed.confidence) ?? 0.5),
    ai_comment: safeText(parsed.ai_comment || '食事を記録しました。', 1000),
  };
}

async function extractBloodTestDraftWithGemini(buffer, mimeType) {
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
                creatinine: { type: 'string' }
              }
            }
          },
          required: ['date', 'items']
        }
      },
      notes: { type: 'string' }
    },
    required: ['dates', 'panels']
  };

  const prompt = [
    'あなたは日本の健診結果・血液検査画像を読み取るアシスタントです。',
    '画像内に複数の日付がある場合は dates にすべて入れてください。',
    'panels には日付ごとの検査結果を入れてください。',
    '読める項目だけ拾ってください。読めない項目は無理に埋めないでください。',
    '数値は文字列で返してください。',
    '対象項目: hba1c, fasting_glucose, ldl, hdl, triglycerides, ast, alt, ggt, uric_acid, creatinine',
    '日付は YYYY-MM-DD に正規化してください。',
    '必ずJSONだけを返してください。'
  ].join('\n');

  const parsed = await generateJsonWithGemini({ prompt, buffer, mimeType, schema, temperature: 0.1 });
  if (!parsed || !Array.isArray(parsed.panels)) {
    throw new Error('Blood test extraction JSON is invalid');
  }
  return parsed;
}

async function analyzeBodyScaleImageWithGemini(buffer, mimeType) {
  const schema = {
    type: 'object',
    properties: {
      weight_kg: { type: 'number' },
      body_fat_percent: { type: 'number' },
      bmi: { type: 'number' },
      ai_comment: { type: 'string' },
    },
    required: ['ai_comment'],
  };

  const prompt = [
    'あなたは体重計・体組成計の画像を読み取るアシスタントです。',
    '見える数値だけ返してください。',
    '必ずJSONだけを返してください。',
  ].join('\n');

  return generateJsonWithGemini({ prompt, buffer, mimeType, schema, temperature: 0 });
}

async function chatAboutOtherImage(user, buffer, mimeType, hint) {
  const aiTypeHint = buildAiTypePrompt(user.ai_type);
  const prompt = [
    AI_BASE_PROMPT,
    aiTypeHint,
    '以下は食事・血液検査・体重計以外の画像です。',
    '相手の気持ちに寄り添い、自然な会話として短く返してください。',
    hint ? `分類ヒント: ${hint}` : '',
  ].filter(Boolean).join('\n\n');

  return generateTextWithGemini({ prompt, buffer, mimeType, temperature: 0.6 });
}

async function generateJsonWithGemini({ prompt, buffer, mimeType, schema, temperature = 0.2 }) {
  const imagePart = {
    inlineData: {
      mimeType,
      data: buffer.toString('base64'),
    },
  };

  const tryModels = [GEMINI_MODEL, GEMINI_FALLBACK_MODEL];
  let lastError;

  for (const model of tryModels) {
    try {
      const response = await retry(async () => genAI.models.generateContent({
        model,
        contents: [{ role: 'user', parts: [{ text: prompt }, imagePart] }],
        config: {
          responseMimeType: 'application/json',
          responseJsonSchema: schema,
          temperature,
        },
      }), 2, 700);

      const text = extractGeminiText(response);
      return safeJsonParse(text);
    } catch (error) {
      lastError = error;
      console.error(`⚠️ generateJsonWithGemini failed on ${model}:`, error?.message || error);
    }
  }

  throw lastError || new Error('Gemini JSON generation failed');
}

async function generateTextWithGemini({ prompt, buffer, mimeType, temperature = 0.6 }) {
  const imagePart = {
    inlineData: {
      mimeType,
      data: buffer.toString('base64'),
    },
  };

  const tryModels = [GEMINI_MODEL, GEMINI_FALLBACK_MODEL];
  let lastError;

  for (const model of tryModels) {
    try {
      const response = await retry(async () => genAI.models.generateContent({
        model,
        contents: [{ role: 'user', parts: [{ text: prompt }, imagePart] }],
        config: { temperature },
      }), 2, 700);
      return safeText(extractGeminiText(response), 1800) || '画像ありがとうございます。気になることがあれば一緒に整理していきましょう。';
    } catch (error) {
      lastError = error;
      console.error(`⚠️ generateTextWithGemini failed on ${model}:`, error?.message || error);
    }
  }

  throw lastError || new Error('Gemini text generation failed');
}

function extractGeminiText(response) {
  const text = response?.text;
  if (typeof text === 'function') return text();
  if (typeof text === 'string') return text;

  const candidateText = response?.candidates?.[0]?.content?.parts
    ?.map((p) => p.text || '')
    .join('')
    .trim();

  if (!candidateText) {
    throw new Error('Gemini response text not found');
  }
  return candidateText;
}

function safeJsonParse(text) {
  try {
    return JSON.parse(text);
  } catch {
    const cleaned = String(text || '')
      .trim()
      .replace(/^```json\s*/i, '')
      .replace(/^```\s*/i, '')
      .replace(/```$/i, '')
      .trim();
    return JSON.parse(cleaned);
  }
}

function normalizeLabQuickReplyInput(text) {
  const t = String(text || '').trim();
  if (/^\d{4}[\/-]\d{1,2}[\/-]\d{1,2}$/.test(t)) return t.replace(/\//g, '-');
  return t;
}

function getPanelDateKeys(session) {
  return Object.keys(session?.working_data_json || {}).sort((a, b) => (a < b ? 1 : -1));
}

function findPanelDateFromInput(session, text) {
  const normalized = normalizeLabQuickReplyInput(text);
  const keys = getPanelDateKeys(session);
  return keys.find((k) => k === normalized) || null;
}

function mapCorrectionLabelToField(text) {
  const t = String(text || '').trim();
  const pairs = {
    '日付を修正': 'measured_at',
    'HbA1cを修正': 'hba1c',
    'LDLを修正': 'ldl',
    'HDLを修正': 'hdl',
    'TGを修正': 'triglycerides',
    'ASTを修正': 'ast',
    'ALTを修正': 'alt',
    'γGTPを修正': 'ggt',
    '血糖を修正': 'fasting_glucose',
    '尿酸を修正': 'uric_acid',
    'クレアチニンを修正': 'creatinine'
  };
  return pairs[t] || null;
}

async function handleLabDraftTextFlow(replyToken, user, text, openDraft) {
  const trimmed = String(text || '').trim();

  if (openDraft?.active_item_name) {
    try {
      const updated = await applyLabCorrection(supabase, openDraft, trimmed);
      const panelDate = updated.selected_date || getPanelDateKeys(updated)[0];
      const items = (updated.working_data_json || {})[panelDate] || {};
      const summary = renderPanelSummary(panelDate, items);
      await replyMessage(
        replyToken,
        textMessageWithQuickReplies(
          `ありがとうございます。修正しました。\n\n${summary}`,
          ['この内容で保存', ...buildLabQuickReplyMain(items).filter((x) => x !== 'この内容で保存')]
        )
      );
      return true;
    } catch (error) {
      if (String(error?.message).includes('INVALID_DATE')) {
        await replyMessage(replyToken, '日付がうまく読み取れませんでした。YYYY/MM/DD の形で送ってください。例: 2025/03/12');
        return true;
      }
      if (String(error?.message).includes('INVALID_NUMBER')) {
        await replyMessage(replyToken, '数値だけを送ってください。例: 138');
        return true;
      }
      throw error;
    }
  }

  if (openDraft && openDraft.status === 'draft') {
    if (getPanelDateKeys(openDraft).length > 1 && !openDraft.selected_date) {
      const chosenDate = findPanelDateFromInput(openDraft, trimmed);
      if (chosenDate) {
        const { data: updated, error } = await supabase
          .from('lab_import_sessions')
          .update({ selected_date: chosenDate })
          .eq('id', openDraft.id)
          .select('*')
          .single();
        if (error) throw error;

        const items = (updated.working_data_json || {})[chosenDate] || {};
        const summary = renderPanelSummary(chosenDate, items);
        await replyMessage(replyToken, textMessageWithQuickReplies(summary, buildLabQuickReplyMain(items)));
        return true;
      }
    }

    const selectedDate = openDraft.selected_date || getPanelDateKeys(openDraft)[0];

    if (trimmed === 'この内容で保存') {
      await confirmLabDraftToResults(supabase, openDraft, selectedDate);
      await replyMessage(replyToken, '保存しました。これで今後の変化も見やすくなりますね。');
      return true;
    }

    const field = mapCorrectionLabelToField(trimmed);
    if (field) {
      await setActiveLabCorrection(supabase, openDraft.id, field, selectedDate);
      const label = LAB_ITEM_LABELS[field] || field;
      const guide = field === 'measured_at'
        ? `${label}を修正します。\nYYYY/MM/DD の形で送ってください。\n例: 2025/03/12`
        : `${label}の値を修正します。\n正しい数値をそのまま送ってください。\n例: 138`;
      await replyMessage(replyToken, guide);
      return true;
    }

    if (trimmed === '他の項目を修正') {
      await replyMessage(replyToken, '修正したい項目名を送ってください。\n例: クレアチニンを修正');
      return true;
    }
  }

  return false;
}

// ---------- Text flow ----------
async function handleTextMessage(event, user) {
  const text = String(event.message.text || '').trim();
  const lower = text.toLowerCase();

  try {
    const openDraft = await getOpenLabDraft(supabase, user.id);
    const consumedByLabFlow = await handleLabDraftTextFlow(event.replyToken, user, text, openDraft);
    if (consumedByLabFlow) return;

    const consumedByIntake = await handleIntakeTextFlow(event.replyToken, user, text);
    if (consumedByIntake) return;

    if (isHelpCommand(lower)) {
      await replyMessage(event.replyToken, helpMessage());
      return;
    }

    if (isWeeklyReportCommand(lower)) {
      const summary = await buildWeeklySummary(user.id, toIsoStringInTZ(new Date(), TZ));
      const assessment = await buildWeeklyAssessment(user.id, summary);
      await replyMessage(event.replyToken, formatWeeklyReply(summary, assessment));
      return;
    }

    if (isMonthlyReportCommand(lower)) {
      const summary = await buildMonthlySummary(user.id, toIsoStringInTZ(new Date(), TZ));
      await replyMessage(event.replyToken, formatMonthlyReply(summary));
      return;
    }

    if (isProfileCommand(lower)) {
      const updates = parseProfile(text);
      if (!Object.keys(updates).length) {
        await replyMessage(event.replyToken, profileGuideMessage());
        return;
      }
      const { error } = await supabase.from('users').update(updates).eq('id', user.id);
      if (error) throw error;
      await replyMessage(event.replyToken, 'プロフィールを更新しました。');
      return;
    }

    if (isWeightCommand(lower)) {
      const metric = parseWeightBodyFat(text);
      if (!metric.weight_kg && !metric.body_fat_percent && !metric.bmi) {
        await replyMessage(event.replyToken, '例: 体重 68.2 体脂肪 24.1 BMI 22.4');
        return;
      }
      metric.user_id = user.id;
      metric.measured_at = toIsoStringInTZ(new Date(), TZ);
      const { error } = await supabase.from('body_metrics').insert(metric);
      if (error) throw error;
      await replyMessage(event.replyToken, '体重・体脂肪率などを記録しました。');
      return;
    }

    if (isActivityCommand(lower)) {
      const activity = parseActivity(text);
      if (!activity.steps && !activity.walking_minutes && !activity.estimated_activity_kcal) {
        await replyMessage(event.replyToken, '例: 歩数 8234 散歩 45分 消費 210');
        return;
      }
      activity.user_id = user.id;
      activity.logged_at = toIsoStringInTZ(new Date(), TZ);
      if (!activity.estimated_activity_kcal) {
        activity.estimated_activity_kcal = estimateActivityKcal(
          activity.steps,
          activity.walking_minutes,
          user.weight_kg
        );
      }
      const { error } = await supabase.from('activity_logs').insert(activity);
      if (error) throw error;
      await replyMessage(
        event.replyToken,
        `活動を記録しました。推定活動消費 ${fmt(activity.estimated_activity_kcal)} kcal です。`
      );
      return;
    }

    if (isSleepCommand(lower)) {
      const sleep = parseSleep(text);
      if (!sleep.sleep_hours) {
        await replyMessage(event.replyToken, '例: 睡眠 6.5時間');
        return;
      }
      sleep.user_id = user.id;
      sleep.sleep_date = currentDateYmdInTZ(TZ);
      const { error } = await supabase.from('sleep_logs').insert(sleep);
      if (error) throw error;
      await replyMessage(event.replyToken, `睡眠を記録しました。${fmt(sleep.sleep_hours)}時間ですね。`);
      return;
    }

    if (isHydrationCommand(lower)) {
      const hydration = parseHydration(text);
      if (!hydration.water_ml) {
        await replyMessage(event.replyToken, '例: 水分 1.5L');
        return;
      }
      hydration.user_id = user.id;
      hydration.logged_at = toIsoStringInTZ(new Date(), TZ);
      const { error } = await supabase.from('hydration_logs').insert(hydration);
      if (error) throw error;
      await replyMessage(event.replyToken, `水分補給を記録しました。${fmt(hydration.water_ml)} ml です。`);
      return;
    }

    if (isLabCommand(lower)) {
      const lab = parseLabValues(text);
      if (Object.keys(lab).length === 0) {
        await replyMessage(
          event.replyToken,
          '例: 血液 HbA1c 6.1 LDL 140 HDL 52 TG 180 AST 28 ALT 35 γGT 40'
        );
        return;
      }
      lab.user_id = user.id;
      lab.measured_at = toIsoStringInTZ(new Date(), TZ);
      const { error } = await supabase.from('lab_results').insert(lab);
      if (error) throw error;
      await replyMessage(event.replyToken, '血液検査の値を記録しました。');
      return;
    }

    if (isBmrCommand(lower)) {
      const bmr = calculateBMR(user);
      if (!bmr) {
        await replyMessage(event.replyToken, '基礎代謝の計算には、性別・年齢・身長・体重の登録が必要です。\n例: プロフィール 性別 女性 年齢 55 身長 160 体重 63');
        return;
      }
      await replyMessage(event.replyToken, `推定基礎代謝は ${fmt(bmr)} kcal/日 です。`);
      return;
    }

    const prompted = await maybePromptIntake(event.replyToken, user, text);
    if (prompted) return;

    await replyMessage(event.replyToken, await defaultChatReply(user, text));
  } catch (error) {
    console.error('❌ handleTextMessage error:', error?.stack || error?.message || error);
    await replyMessage(event.replyToken, '入力の処理でエラーが起きました。もう一度ゆっくり送ってください。');
  }
}

function buildAiTypePrompt(aiType) {
  if (aiType === 'energetic') return '話し方は少し前向きで明るく、背中を押す雰囲気にしてください。';
  if (aiType === 'analytical') return '話し方は落ち着いて、理由や傾向をわかりやすく伝えてください。';
  if (aiType === 'casual') return '話し方は親しみやすく、気軽に話せる雰囲気にしてください。';
  return '話し方はやさしく包み込むように、安心感を大切にしてください。';
}

async function defaultChatReply(user, userText) {
  const memoryHint = await getMemoryHint(user.id);
  const prompt = [
    AI_BASE_PROMPT,
    buildAiTypePrompt(user.ai_type),
    memoryHint ? `利用者について覚えていること: ${memoryHint}` : '',
    '次の利用者メッセージに、自然でやさしく、聞き役として返してください。',
    '強い断定や説教はしないでください。',
    `利用者メッセージ: ${userText}`,
  ].filter(Boolean).join('\n\n');

  const reply = await generateTextOnly(prompt);
  await saveMemoryCandidate(user.id, userText, reply);
  return reply;
}

async function generateTextOnly(prompt) {
  const tryModels = [GEMINI_MODEL, GEMINI_FALLBACK_MODEL];
  let lastError;
  for (const model of tryModels) {
    try {
      const response = await retry(async () => genAI.models.generateContent({
        model,
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
        config: { temperature: 0.7 },
      }), 2, 700);
      return safeText(extractGeminiText(response), 1800) || 'ありがとうございます。もう少し詳しく教えてくださいね。';
    } catch (error) {
      lastError = error;
      console.error(`⚠️ generateTextOnly failed on ${model}:`, error?.message || error);
    }
  }
  throw lastError || new Error('Gemini text-only generation failed');
}

// ---------- Memory ----------
async function getMemoryHint(userId) {
  try {
    const { data } = await supabase
      .from('memory_items')
      .select('memory_type,memory_value')
      .eq('user_id', userId)
      .order('updated_at', { ascending: false })
      .limit(3);

    if (!data || !data.length) return '';
    return data.map((x) => `${x.memory_type}: ${x.memory_value}`).join(' / ');
  } catch {
    return '';
  }
}

async function saveMemoryCandidate(userId, userText, aiReply) {
  const simpleRules = [
    { type: 'food', pattern: /(甘い物|ケーキ|チョコ|お菓子)/, value: '甘い物が好きそう' },
    { type: 'exercise', pattern: /(散歩|ウォーキング)/, value: '散歩・ウォーキングが続きやすそう' },
    { type: 'life', pattern: /(孫|子ども|家族)/, value: '家族の話題を大切にしている' },
    { type: 'emotion', pattern: /(不安|落ち込|疲れ)/, value: '気持ちを丁寧に受け止めると安心しやすい' },
  ];

  for (const rule of simpleRules) {
    if (rule.pattern.test(userText)) {
      try {
        await supabase.from('memory_items').insert({
          user_id: userId,
          memory_type: rule.type,
          memory_key: rule.value,
          memory_value: rule.value,
          importance_score: 0.5,
          source_message: userText.slice(0, 1000),
          last_used_at: null,
        });
      } catch {
        // ignore memory insert failures in v1
      }
      return;
    }
  }
}

// ---------- Aggregation ----------
async function buildDailySummary(userId, dateYmd) {
  const start = `${dateYmd}T00:00:00+09:00`;
  const end = `${dateYmd}T23:59:59+09:00`;

  const [mealsRes, actsRes, latestMetricRes] = await Promise.all([
    supabase.from('meal_logs').select('estimated_kcal').eq('user_id', userId).gte('eaten_at', start).lte('eaten_at', end),
    supabase.from('activity_logs').select('estimated_activity_kcal,steps,walking_minutes').eq('user_id', userId).gte('logged_at', start).lte('logged_at', end),
    supabase.from('body_metrics').select('weight_kg').eq('user_id', userId).order('measured_at', { ascending: false }).limit(1).maybeSingle(),
  ]);

  if (mealsRes.error) throw mealsRes.error;
  if (actsRes.error) throw actsRes.error;
  if (latestMetricRes.error) throw latestMetricRes.error;

  const totalIntake = sumBy(mealsRes.data || [], 'estimated_kcal');
  const totalActivity = sumBy(actsRes.data || [], 'estimated_activity_kcal');
  const steps = sumBy(actsRes.data || [], 'steps');
  const walkingMinutes = sumBy(actsRes.data || [], 'walking_minutes');

  return {
    total_intake_kcal: round1(totalIntake),
    total_activity_kcal: round1(totalActivity),
    steps: round0(steps),
    walking_minutes: round0(walkingMinutes),
    latest_weight_kg: latestMetricRes.data?.weight_kg || null,
  };
}

async function buildWeeklySummary(userId, baseDateIso) {
  const baseDate = new Date(baseDateIso);
  const tokyoDate = toTokyoDate(baseDate);
  const day = tokyoDate.getDay();
  const diffToMonday = (day + 6) % 7;
  const startDate = new Date(tokyoDate);
  startDate.setDate(tokyoDate.getDate() - diffToMonday);
  startDate.setHours(0, 0, 0, 0);
  const endDate = new Date(startDate);
  endDate.setDate(startDate.getDate() + 6);
  endDate.setHours(23, 59, 59, 999);

  const startIso = toIsoStringInTZ(startDate, TZ);
  const endIso = toIsoStringInTZ(endDate, TZ);

  const [mealsRes, actsRes, sleepRes, hydrationRes, metricsRes] = await Promise.all([
    supabase.from('meal_logs').select('estimated_kcal').eq('user_id', userId).gte('eaten_at', startIso).lte('eaten_at', endIso),
    supabase.from('activity_logs').select('estimated_activity_kcal,steps,walking_minutes').eq('user_id', userId).gte('logged_at', startIso).lte('logged_at', endIso),
    supabase.from('sleep_logs').select('sleep_hours').eq('user_id', userId).gte('sleep_date', startIso.slice(0, 10)).lte('sleep_date', endIso.slice(0, 10)),
    supabase.from('hydration_logs').select('water_ml').eq('user_id', userId).gte('logged_at', startIso).lte('logged_at', endIso),
    supabase.from('body_metrics').select('weight_kg').eq('user_id', userId).gte('measured_at', startIso).lte('measured_at', endIso).order('measured_at', { ascending: true }),
  ]);

  if (mealsRes.error) throw mealsRes.error;
  if (actsRes.error) throw actsRes.error;
  if (sleepRes.error) throw sleepRes.error;
  if (hydrationRes.error) throw hydrationRes.error;
  if (metricsRes.error) throw metricsRes.error;

  const mealCount = (mealsRes.data || []).length;
  const intake = sumBy(mealsRes.data || [], 'estimated_kcal');
  const burn = sumBy(actsRes.data || [], 'estimated_activity_kcal');
  const steps = sumBy(actsRes.data || [], 'steps');
  const walking = sumBy(actsRes.data || [], 'walking_minutes');
  const totalSleep = sumBy(sleepRes.data || [], 'sleep_hours');
  const totalWater = sumBy(hydrationRes.data || [], 'water_ml');
  const firstWeight = metricsRes.data?.[0]?.weight_kg || null;
  const lastWeight = metricsRes.data?.[metricsRes.data.length - 1]?.weight_kg || null;

  return {
    week_start: startIso.slice(0, 10),
    week_end: endIso.slice(0, 10),
    total_intake_kcal: round1(intake),
    total_burn_kcal: round1(burn),
    meal_count: mealCount,
    avg_steps: round0((steps || 0) / 7),
    avg_walking_minutes: round1((walking || 0) / 7),
    avg_sleep_hours: round1((totalSleep || 0) / 7),
    avg_water_ml: round0((totalWater || 0) / 7),
    weight_change_kg: firstWeight != null && lastWeight != null ? round1(lastWeight - firstWeight) : null,
  };
}

async function buildMonthlySummary(userId, baseDateIso) {
  const base = toTokyoDate(new Date(baseDateIso));
  const start = new Date(base.getFullYear(), base.getMonth(), 1);
  const end = new Date(base.getFullYear(), base.getMonth() + 1, 0, 23, 59, 59, 999);

  const startIso = toIsoStringInTZ(start, TZ);
  const endIso = toIsoStringInTZ(end, TZ);

  const [mealsRes, actsRes, sleepRes, hydrationRes] = await Promise.all([
    supabase.from('meal_logs').select('estimated_kcal').eq('user_id', userId).gte('eaten_at', startIso).lte('eaten_at', endIso),
    supabase.from('activity_logs').select('estimated_activity_kcal,steps').eq('user_id', userId).gte('logged_at', startIso).lte('logged_at', endIso),
    supabase.from('sleep_logs').select('sleep_hours').eq('user_id', userId).gte('sleep_date', startIso.slice(0, 10)).lte('sleep_date', endIso.slice(0, 10)),
    supabase.from('hydration_logs').select('water_ml').eq('user_id', userId).gte('logged_at', startIso).lte('logged_at', endIso),
  ]);

  if (mealsRes.error) throw mealsRes.error;
  if (actsRes.error) throw actsRes.error;
  if (sleepRes.error) throw sleepRes.error;
  if (hydrationRes.error) throw hydrationRes.error;

  return {
    month_label: `${base.getFullYear()}-${String(base.getMonth() + 1).padStart(2, '0')}`,
    total_intake_kcal: round1(sumBy(mealsRes.data || [], 'estimated_kcal')),
    total_burn_kcal: round1(sumBy(actsRes.data || [], 'estimated_activity_kcal')),
    avg_steps: round0(sumBy(actsRes.data || [], 'steps') / Math.max(daysInMonth(base), 1)),
    avg_sleep_hours: round1(sumBy(sleepRes.data || [], 'sleep_hours') / Math.max(daysInMonth(base), 1)),
    avg_water_ml: round0(sumBy(hydrationRes.data || [], 'water_ml') / Math.max(daysInMonth(base), 1)),
  };
}

async function buildWeeklyAssessment(userId, weeklySummary) {
  const hints = [];
  if (weeklySummary.avg_sleep_hours && weeklySummary.avg_sleep_hours < 6) {
    hints.push('睡眠が少し短めなので、体重の動きや食欲にも影響しやすい週かもしれません。');
  }
  if (weeklySummary.avg_water_ml && weeklySummary.avg_water_ml < 1200) {
    hints.push('水分が少なめなので、むくみや疲れにも少し気をつけたいですね。');
  }
  if (weeklySummary.avg_steps && weeklySummary.avg_steps < 5000) {
    hints.push('歩数はやや少なめなので、短い散歩でも積み重ねられると良さそうです。');
  }

  const memoryHint = await getMemoryHint(userId);
  return {
    summary: hints.join('\n') || '今週も小さな積み重ねができていますね。',
    memory_hint: memoryHint,
  };
}

function formatWeeklyReply(summary, assessment) {
  return [
    `📘 今週のまとめ (${summary.week_start}〜${summary.week_end})`,
    `摂取合計: ${fmt(summary.total_intake_kcal)} kcal`,
    `活動消費合計: ${fmt(summary.total_burn_kcal)} kcal`,
    `平均歩数: ${fmt(summary.avg_steps)} 歩/日`,
    `平均睡眠: ${fmt(summary.avg_sleep_hours)} 時間/日`,
    `平均水分: ${fmt(summary.avg_water_ml)} ml/日`,
    summary.weight_change_kg != null ? `体重変化: ${fmt(summary.weight_change_kg)} kg` : null,
    '',
    assessment.summary,
    assessment.memory_hint ? `覚えていること: ${assessment.memory_hint}` : null,
    '',
    'さぁ〜、ここから。',
  ].filter(Boolean).join('\n');
}

function formatMonthlyReply(summary) {
  return [
    `🗓 月報 (${summary.month_label})`,
    `摂取合計: ${fmt(summary.total_intake_kcal)} kcal`,
    `活動消費合計: ${fmt(summary.total_burn_kcal)} kcal`,
    `平均歩数: ${fmt(summary.avg_steps)} 歩/日`,
    `平均睡眠: ${fmt(summary.avg_sleep_hours)} 時間/日`,
    `平均水分: ${fmt(summary.avg_water_ml)} ml/日`,
  ].join('\n');
}

// ---------- Parsing ----------
function parseProfile(text) {
  const result = {};
  const sex = findOne(text, [/(男性|男)/, /(女性|女)/]);
  if (sex) result.sex = sex.includes('男') ? 'male' : 'female';

  const age = findNumber(text, /年齢\s*([0-9]+(?:\.[0-9]+)?)/i);
  if (age != null) result.age = round0(age);

  const height = findNumber(text, /身長\s*([0-9]+(?:\.[0-9]+)?)/i);
  if (height != null) result.height_cm = round1(height);

  const weight = findNumber(text, /体重\s*([0-9]+(?:\.[0-9]+)?)/i);
  if (weight != null) result.weight_kg = round1(weight);

  const target = findNumber(text, /目標体重\s*([0-9]+(?:\.[0-9]+)?)/i);
  if (target != null) result.target_weight_kg = round1(target);

  return result;
}

function parseWeightBodyFat(text) {
  return {
    weight_kg: toNumberOrNull(findNumber(text, /体重\s*([0-9]+(?:\.[0-9]+)?)/i)),
    body_fat_percent: toNumberOrNull(findNumber(text, /体脂肪\s*([0-9]+(?:\.[0-9]+)?)/i)),
    bmi: toNumberOrNull(findNumber(text, /bmi\s*([0-9]+(?:\.[0-9]+)?)/i)),
  };
}

function parseActivity(text) {
  return {
    steps: toNumberOrNull(findNumber(text, /歩数\s*([0-9]+(?:\.[0-9]+)?)/i)),
    walking_minutes: toNumberOrNull(findNumber(text, /(散歩|歩行|ウォーキング)\s*([0-9]+(?:\.[0-9]+)?)\s*分/i, 2)),
    estimated_activity_kcal: toNumberOrNull(findNumber(text, /(消費|活動消費)\s*([0-9]+(?:\.[0-9]+)?)/i, 2)),
  };
}

function parseSleep(text) {
  return { sleep_hours: toNumberOrNull(findNumber(text, /睡眠\s*([0-9]+(?:\.[0-9]+)?)/i)) };
}

function parseHydration(text) {
  const liter = findNumber(text, /水分\s*([0-9]+(?:\.[0-9]+)?)\s*l/i);
  const ml = findNumber(text, /水分\s*([0-9]+(?:\.[0-9]+)?)\s*ml/i);
  const plain = findNumber(text, /水分\s*([0-9]+(?:\.[0-9]+)?)/i);

  let waterMl = null;
  if (liter != null) waterMl = liter * 1000;
  else if (ml != null) waterMl = ml;
  else if (plain != null) waterMl = plain >= 10 ? plain : plain * 1000;

  return { water_ml: toNumberOrNull(waterMl) };
}

function parseLabValues(text) {
  const map = {
    hba1c: /hba1c\s*([0-9]+(?:\.[0-9]+)?)/i,
    fasting_glucose: /(glu|glucose|血糖)\s*([0-9]+(?:\.[0-9]+)?)/i,
    ldl: /ldl\s*([0-9]+(?:\.[0-9]+)?)/i,
    hdl: /hdl\s*([0-9]+(?:\.[0-9]+)?)/i,
    triglycerides: /(tg|中性脂肪)\s*([0-9]+(?:\.[0-9]+)?)/i,
    ast: /ast\s*([0-9]+(?:\.[0-9]+)?)/i,
    alt: /alt\s*([0-9]+(?:\.[0-9]+)?)/i,
    ggt: /(γgt|ggt|gamma)\s*([0-9]+(?:\.[0-9]+)?)/i,
  };

  const result = {};
  for (const [key, regex] of Object.entries(map)) {
    const value = findNumber(text, regex, regex.source.includes('|') ? 2 : 1);
    if (value != null) result[key] = value;
  }
  return result;
}

// ---------- Commands ----------
function isHelpCommand(text) {
  return ['help', 'ヘルプ', '使い方', 'メニュー'].some((x) => text.includes(x));
}
function isWeeklyReportCommand(text) {
  return ['週報', '今週', 'weekly'].some((x) => text.includes(x));
}
function isMonthlyReportCommand(text) {
  return ['月報', '今月', 'monthly'].some((x) => text.includes(x));
}
function isProfileCommand(text) {
  return text.includes('プロフィール');
}
function isWeightCommand(text) {
  return text.includes('体重') || text.includes('体脂肪') || text.includes('bmi');
}
function isActivityCommand(text) {
  return text.includes('歩数') || text.includes('散歩') || text.includes('ウォーキング') || text.includes('歩行') || text.includes('消費');
}
function isSleepCommand(text) {
  return text.includes('睡眠');
}
function isHydrationCommand(text) {
  return text.includes('水分');
}
function isLabCommand(text) {
  return text.includes('血液') || text.includes('hba1c') || text.includes('ldl') || text.includes('hdl') || text.includes('tg');
}
function isBmrCommand(text) {
  return text.includes('基礎代謝') || text.includes('bmr');
}

function helpMessage() {
  return [
    '使い方の例です。',
    '・初回診断',
    '・体重 68.2',
    '・体重 68.2 体脂肪 24.1 BMI 22.4',
    '・歩数 8234 散歩 45分',
    '・睡眠 6.5時間',
    '・水分 1.5L',
    '・血液 HbA1c 6.1 LDL 140 HDL 52 TG 180',
    '・プロフィール 性別 女性 年齢 55 身長 160 体重 63 目標体重 58',
    '・週報 / 月報',
    '・食事写真 / 血液検査画像 / 体重計画像も送れます',
  ].join('\n');
}

function profileGuideMessage() {
  return '例: プロフィール 性別 女性 年齢 55 身長 160 体重 63 目標体重 58';
}

// ---------- Utilities ----------
function loadAiPrompt() {
  try {
    if (fs.existsSync(AI_PROMPT_PATH)) {
      return fs.readFileSync(AI_PROMPT_PATH, 'utf8');
    }
  } catch (error) {
    console.error('⚠️ Failed to read ai_ushigome_prompt.txt:', error?.message || error);
  }

  return [
    'あなたはAI牛込です。',
    'ポラリス整骨院の牛込先生の雰囲気を持ち、優しく聞き役として寄り添います。',
    '共感、復唱、状況整理、気づき、小さな提案の順番を大切にしてください。',
    '健康知識は自然な会話の中で軽く補足してください。',
    '相手を責めず、断定しすぎず、必要ならポラリス整骨院で牛込先生への相談を勧めてください。',
  ].join('\n');
}

function currentDateYmdInTZ(_tz) {
  return toIsoStringInTZ(new Date(), TZ).slice(0, 10);
}

function toIsoStringInTZ(date, _tz) {
  const d = new Date(date);
  const fmtDate = new Intl.DateTimeFormat('sv-SE', {
    timeZone: TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(d);
  const fmtTime = new Intl.DateTimeFormat('sv-SE', {
    timeZone: TZ,
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).format(d);
  return `${fmtDate}T${fmtTime}+09:00`;
}

function toTokyoDate(date) {
  const str = new Intl.DateTimeFormat('en-CA', {
    timeZone: TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date);
  const [y, m, d] = str.split('-').map(Number);
  return new Date(y, m - 1, d);
}

function daysInMonth(date) {
  return new Date(date.getFullYear(), date.getMonth() + 1, 0).getDate();
}

function estimateActivityKcal(steps, walkingMinutes, weightKg) {
  const weight = weightKg || 60;
  const stepKcal = steps ? steps * 0.04 : 0;
  const walkKcal = walkingMinutes ? walkingMinutes * (weight * 0.035) : 0;
  return round1(Math.max(stepKcal, walkKcal));
}

function calculateBMR(user) {
  if (!user?.sex || !user?.age || !user?.height_cm || !user?.weight_kg) return null;
  const w = Number(user.weight_kg);
  const h = Number(user.height_cm);
  const a = Number(user.age);
  if (user.sex === 'male') return round1(10 * w + 6.25 * h - 5 * a + 5);
  return round1(10 * w + 6.25 * h - 5 * a - 161);
}

function formatKcalRange(mid, min, max) {
  if (min != null && max != null) return `${fmt(mid)} kcal（${fmt(min)}〜${fmt(max)} kcal）`;
  if (mid != null) return `${fmt(mid)} kcal`;
  return '不明';
}

function sumBy(arr, key) {
  return (arr || []).reduce((sum, row) => sum + (Number(row?.[key]) || 0), 0);
}

function fmt(value) {
  if (value == null || Number.isNaN(Number(value))) return '-';
  const n = Number(value);
  return Number.isInteger(n) ? String(n) : n.toFixed(1);
}

function round1(n) {
  if (n == null || Number.isNaN(Number(n))) return null;
  return Math.round(Number(n) * 10) / 10;
}

function round0(n) {
  if (n == null || Number.isNaN(Number(n))) return null;
  return Math.round(Number(n));
}

function toNumberOrNull(v) {
  if (v == null || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function clamp01(v) {
  if (v == null) return null;
  return Math.max(0, Math.min(1, Number(v)));
}

function safeText(v, maxLen = 1000) {
  return String(v || '').trim().slice(0, maxLen);
}

function findNumber(text, regex, groupIndex = 1) {
  const m = String(text || '').match(regex);
  if (!m || !m[groupIndex]) return null;
  const n = Number(String(m[groupIndex]).replace(/,/g, ''));
  return Number.isFinite(n) ? n : null;
}

function findOne(text, regexes) {
  for (const regex of regexes) {
    const m = String(text || '').match(regex);
    if (m?.[0]) return m[0];
  }
  return null;
}

async function retry(fn, retries = 2, delayMs = 500) {
  let lastError;
  for (let i = 0; i <= retries; i += 1) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      if (i === retries) break;
      await new Promise((resolve) => setTimeout(resolve, delayMs * (i + 1)));
    }
  }
  throw lastError;
}

// ---------- Start ----------
app.listen(PORT, () => {
  console.log(`✅ Server running on port ${PORT}`);
});

