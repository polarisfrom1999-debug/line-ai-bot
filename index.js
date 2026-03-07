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
        headers: {
          Authorization: `Bearer ${LINE_CHANNEL_ACCESS_TOKEN}`,
        },
        timeout: 60000,
        maxContentLength: 20 * 1024 * 1024,
        maxBodyLength: 20 * 1024 * 1024,
      }
    );

    const mimeHeader = response.headers['content-type'] || 'image/jpeg';
    const mime = String(mimeHeader).includes('image/') ? mimeHeader : 'image/jpeg';
    const buffer = Buffer.from(response.data);
    if (!buffer || !buffer.length) {
      throw new Error('LINE image content is empty');
    }
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
  };

  const { data: created, error: insertError } = await supabase
    .from('users')
    .insert(insertPayload)
    .select('*')
    .single();

  if (insertError) throw insertError;
  return created;
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
      ? PFC: P${fmt(mealInsert.protein_g)}g / F${fmt(mealInsert.fat_g)}g / C${fmt(mealInsert.carbs_g)}g
      : null,
    mealInsert.ai_comment ? ひとこと: ${mealInsert.ai_comment} : null,
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

  const workingDa
