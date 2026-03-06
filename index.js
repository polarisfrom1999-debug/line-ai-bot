require('dotenv').config();

const fs = require('fs');
const path = require('path');
const express = require('express');
const crypto = require('crypto');
const axios = require('axios');
const { createClient } = require('@supabase/supabase-js');
const { GoogleGenAI } = require('@google/genai');

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
  const analysis = await analyzeBloodTestImageWithGemini(buffer, mime);
  const measuredAt = toIsoStringInTZ(new Date(), TZ);

  const insertPayload = {
    user_id: user.id,
    source_message_id: messageId,
    measured_at: measuredAt,
    hba1c: toNumberOrNull(analysis.hba1c),
    fasting_glucose: toNumberOrNull(analysis.fasting_glucose),
    ldl: toNumberOrNull(analysis.ldl),
    hdl: toNumberOrNull(analysis.hdl),
    triglycerides: toNumberOrNull(analysis.triglycerides),
    ast: toNumberOrNull(analysis.ast),
    alt: toNumberOrNull(analysis.alt),
    ggt: toNumberOrNull(analysis.ggt),
    ai_summary: safeText(analysis.ai_summary, 2000),
    raw_model_json: analysis,
  };

  const { error } = await supabase.from('lab_results').insert(insertPayload);
  if (error) throw error;

  const reply = [
    '🧪 血液検査の画像として受け取りました。',
    analysis.ai_summary || '内容を記録しました。気になる点があれば、次回ポラリス整骨院で牛込先生にも気軽に相談してくださいね。',
  ].join('\n');

  await replyMessage(replyToken, reply);
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

async function handleOtherImage({ replyToken, buffer, mime, hint }) {
  const comment = await chatAboutOtherImage(buffer, mime, hint);
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

async function analyzeBloodTestImageWithGemini(buffer, mimeType) {
  const schema = {
    type: 'object',
    properties: {
      hba1c: { type: 'number' },
      fasting_glucose: { type: 'number' },
      ldl: { type: 'number' },
      hdl: { type: 'number' },
      triglycerides: { type: 'number' },
      ast: { type: 'number' },
      alt: { type: 'number' },
      ggt: { type: 'number' },
      ai_summary: { type: 'string' },
    },
    required: ['ai_summary'],
  };

  const prompt = [
    'あなたは血液検査画像を読み取り、一般的な範囲で分かりやすく整理するアシスタントです。',
    '読める項目だけ拾ってください。読めない項目は無理に埋めないでください。',
    '診断の断定はせず、生活改善の一般的なコメントを短くまとめてください。',
    '必ずJSONだけを返してください。',
  ].join('\n');

  return generateJsonWithGemini({ prompt, buffer, mimeType, schema, temperature: 0.1 });
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

async function chatAboutOtherImage(buffer, mimeType, hint) {
  const prompt = [
    AI_BASE_PROMPT,
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

// ---------- Text flow ----------
async function handleTextMessage(event, user) {
  const text = String(event.message.text || '').trim();
  const lower = text.toLowerCase();

  try {
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

    await replyMessage(event.replyToken, await defaultChatReply(user, text));
  } catch (error) {
    console.error('❌ handleTextMessage error:', error?.stack || error?.message || error);
    await replyMessage(event.replyToken, '入力の処理でエラーが起きました。もう一度ゆっくり送ってください。');
  }
}

async function defaultChatReply(user, userText) {
  const memoryHint = await getMemoryHint(user.id);
  const prompt = [
    AI_BASE_PROMPT,
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
  return {
    sleep_hours: toNumberOrNull(findNumber(text, /睡眠\s*([0-9]+(?:\.[0-9]+)?)/i)),
  };
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

