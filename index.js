require('dotenv').config();

const express = require('express');
const crypto = require('crypto');
const axios = require('axios');
const fs = require('fs');
const path = require('path');
const { createClient } = require('@supabase/supabase-js');
const { GoogleGenAI } = require('@google/genai');

const app = express();
const PORT = Number(process.env.PORT || 10000);
const TZ = process.env.APP_TIMEZONE || 'Asia/Tokyo';

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
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});
const genAI = new GoogleGenAI({ apiKey: GEMINI_API_KEY });

const PROMPT_PATH = path.join(__dirname, 'ai_ushigome_prompt.txt');
const BASE_PROMPT = fs.existsSync(PROMPT_PATH)
  ? fs.readFileSync(PROMPT_PATH, 'utf8')
  : 'あなたはAI牛込です。相手を責めず、共感してから必要なら提案してください。';

const AI_TYPE_CONFIG = {
  gentle: {
    label: 'AI牛込 やさしい伴走',
    senderName: 'AI牛込 やさしい伴走',
    extraPrompt:
      '口調はやさしく安心感重視です。寄り添い、急かさず、やわらかく支えてください。絵文字は少しだけ。',
  },
  cheer: {
    label: 'AI牛込 元気応援',
    senderName: 'AI牛込 元気応援',
    extraPrompt:
      '口調は明るく前向きです。褒め上手で、背中を押す表現をやや多めにしてください。うるさくしすぎない。',
  },
  analyze: {
    label: 'AI牛込 分析サポート',
    senderName: 'AI牛込 分析サポート',
    extraPrompt:
      '口調は落ち着いて論理的です。理由や背景を簡潔に添え、納得感を大切にしてください。',
  },
  casual: {
    label: 'AI牛込 気軽トーク',
    senderName: 'AI牛込 気軽トーク',
    extraPrompt:
      '口調は親しみやすく気軽です。ややフランクですが失礼にはならず、話しやすさを重視してください。',
  },
};

app.get('/', (_req, res) => {
  res.status(200).send('Kokokara AI Ushigome is running.');
});

app.post('/webhook', express.raw({ type: '*/*', limit: '20mb' }), async (req, res) => {
  try {
    const signature = req.headers['x-line-signature'];
    const rawBody = req.body;

    if (!verifyLineSignature(rawBody, signature, LINE_CHANNEL_SECRET)) {
      return res.status(401).send('Invalid signature');
    }

    const body = JSON.parse(rawBody.toString('utf8'));
    const events = Array.isArray(body.events) ? body.events : [];

    res.status(200).send('OK');

    for (const event of events) {
      processEvent(event).catch((error) => {
        console.error('❌ Event processing failed:', error?.response?.data || error.message || error);
      });
    }
  } catch (error) {
    console.error('❌ Webhook fatal error:', error);
    if (!res.headersSent) res.status(500).send('Internal Server Error');
  }
});

function verifyLineSignature(rawBody, signature, secret) {
  if (!rawBody || !signature || !secret) return false;
  const expected = crypto.createHmac('sha256', secret).update(rawBody).digest('base64');
  try {
    return crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected));
  } catch {
    return false;
  }
}

async function processEvent(event) {
  if (!event || event.type !== 'message' || !event.message) return;
  const lineUserId = event?.source?.userId;
  if (!lineUserId) return;

  const user = await ensureUser(lineUserId);

  if (event.message.type === 'text') {
    const text = String(event.message.text || '').trim();
    await saveChatLog(user.id, 'user', text, event.message.id);
    await handleTextMessage(event, user, text);
    return;
  }

  if (event.message.type === 'image') {
    await saveChatLog(user.id, 'user', '[image]', event.message.id);
    await handleImageMessage(event, user);
    return;
  }

  await replyMessage(event.replyToken, user.ai_type, '今はテキストと画像に対応しています。');
}

async function ensureUser(lineUserId) {
  const { data, error } = await supabase
    .from('users')
    .select('*')
    .eq('line_user_id', lineUserId)
    .maybeSingle();
  if (error) throw error;
  if (data) return data;

  const { data: created, error: insertError } = await supabase
    .from('users')
    .insert({
      line_user_id: lineUserId,
      timezone: TZ,
      ai_type: 'gentle',
      reminder_level: 'normal',
    })
    .select('*')
    .single();
  if (insertError) throw insertError;
  return created;
}

async function handleTextMessage(event, user, text) {
  const lower = text.toLowerCase();

  try {
    if (isHelpCommand(lower)) {
      return await respond(event.replyToken, user, helpMessage());
    }

    if (isAiTypeChangeCommand(text)) {
      return await handleAiTypeChange(event.replyToken, user, text);
    }

    if (isWeeklyReportCommand(lower)) {
      const summary = await buildWeeklySummary(user.id, nowIso());
      const report = formatWeeklyReply(summary, user);
      return await respond(event.replyToken, user, report);
    }

    if (isMonthlyReportCommand(lower)) {
      const summary = await buildMonthlySummary(user.id, nowIso());
      return await respond(event.replyToken, user, formatMonthlyReply(summary));
    }

    if (isProfileCommand(lower)) {
      return await handleProfileCommand(event.replyToken, user, text);
    }

    if (isWeightCommand(lower)) {
      return await handleWeightCommand(event.replyToken, user, text);
    }

    if (isActivityCommand(lower)) {
      return await handleActivityCommand(event.replyToken, user, text);
    }

    if (isSleepCommand(lower)) {
      return await handleSleepCommand(event.replyToken, user, text);
    }

    if (isHydrationCommand(lower)) {
      return await handleHydrationCommand(event.replyToken, user, text);
    }

    if (isLabCommand(lower)) {
      return await handleLabTextCommand(event.replyToken, user, text);
    }

    await maybeStoreMemoryFromText(user.id, text);
    const reply = await buildNaturalChatReply(user, text);
    return await respond(event.replyToken, user, reply);
  } catch (error) {
    console.error('❌ handleTextMessage error:', error?.response?.data || error.message || error);
    return await respond(event.replyToken, user, 'うまく受け取れませんでした。もう一度ゆっくり送ってくださいね。');
  }
}

async function handleImageMessage(event, user) {
  const replyToken = event.replyToken;
  const messageId = event.message.id;

  try {
    const { buffer, mime } = await getLineImageContent(messageId);
    const classification = await classifyImageWithGemini(buffer, mime);
    const now = nowIso();

    if (classification.image_type === 'meal') {
      const meal = classification.meal || {};
      const row = {
        user_id: user.id,
        source_message_id: messageId,
        eaten_at: now,
        meal_label: safeText(meal.meal_label || inferMealLabelByTime(new Date()), 80),
        dish_name: safeText(meal.dish_name || meal.meal_label || '食事', 200),
        food_items: Array.isArray(meal.food_items) ? meal.food_items : [],
        estimated_kcal: toNumberOrNull(meal.estimated_kcal),
        kcal_min: toNumberOrNull(meal.kcal_min),
        kcal_max: toNumberOrNull(meal.kcal_max),
        protein_g: toNumberOrNull(meal.protein_g),
        fat_g: toNumberOrNull(meal.fat_g),
        carb_g: toNumberOrNull(meal.carb_g),
        confidence: clamp01(toNumberOrNull(meal.confidence)),
        ai_comment: safeText(meal.ai_comment, 1000),
        image_classification: 'meal',
        raw_model_json: classification,
      };
      const { error } = await supabase.from('meal_logs').insert(row);
      if (error) throw error;

      const day = await buildDailySummary(user.id, now.slice(0, 10));
      const lines = [
        '📸 食事を記録しました。',
        `料理: ${row.meal_label}`,
        `推定カロリー: ${formatKcalRange(row.estimated_kcal, row.kcal_min, row.kcal_max)}`,
        `PFC: P${fmt(row.protein_g)}g / F${fmt(row.fat_g)}g / C${fmt(row.carb_g)}g`,
        row.ai_comment ? `ひとこと: ${row.ai_comment}` : null,
        '',
        `本日摂取合計: ${fmt(day.total_intake_kcal)} kcal`,
      ].filter(Boolean);
      return await respond(replyToken, user, lines.join('\n'));
    }

    if (classification.image_type === 'body_scale') {
      const body = classification.body_scale || {};
      const row = {
        user_id: user.id,
        measured_at: now,
        weight_kg: toNumberOrNull(body.weight_kg),
        body_fat_percent: toNumberOrNull(body.body_fat_percent),
        bmi: toNumberOrNull(body.bmi),
        source_message_id: messageId,
        source_type: 'image',
      };
      const { error } = await supabase.from('body_metrics').insert(row);
      if (error) throw error;

      const lines = [
        '⚖️ 体重計の内容を記録しました。',
        row.weight_kg != null ? `体重: ${fmt(row.weight_kg)} kg` : null,
        row.body_fat_percent != null ? `体脂肪率: ${fmt(row.body_fat_percent)} %` : null,
        row.bmi != null ? `BMI: ${fmt(row.bmi)}` : null,
        body.ai_comment ? `ひとこと: ${body.ai_comment}` : null,
      ].filter(Boolean);
      return await respond(replyToken, user, lines.join('\n'));
    }

    if (classification.image_type === 'blood_test') {
      const lab = classification.blood_test || {};
      const row = {
        user_id: user.id,
        measured_at: now,
        hba1c: toNumberOrNull(lab.hba1c),
        fasting_glucose: toNumberOrNull(lab.fasting_glucose),
        ldl: toNumberOrNull(lab.ldl),
        hdl: toNumberOrNull(lab.hdl),
        triglycerides: toNumberOrNull(lab.triglycerides),
        ast: toNumberOrNull(lab.ast),
        alt: toNumberOrNull(lab.alt),
        gamma_gt: toNumberOrNull(lab.gamma_gt),
        uric_acid: toNumberOrNull(lab.uric_acid),
        creatinine: toNumberOrNull(lab.creatinine),
        source_message_id: messageId,
        ai_summary: safeText(lab.ai_summary, 1500),
        raw_model_json: classification,
      };
      const { error } = await supabase.from('lab_results').insert(row);
      if (error) throw error;

      return await respond(
        replyToken,
        user,
        [
          '🧪 血液検査の画像として受け取りました。',
          lab.ai_summary || '数値を記録しました。気になる点があれば次回ポラリス整骨院で牛込先生に相談してくださいね。',
        ].join('\n')
      );
    }

    const other = classification.other || {};
    const chatReply = other.reply_text || '画像ありがとうございます。内容は受け取りました。気になることがあれば、ひとこと添えて送ってくださいね。';
    return await respond(replyToken, user, chatReply);
  } catch (error) {
    console.error('❌ handleImageMessage error:', error?.response?.data || error.message || error);
    return await respond(replyToken, user, '画像の処理でエラーが起きました。もう一度、はっきり写るように送ってください。');
  }
}

async function handleAiTypeChange(replyToken, user, text) {
  const value = normalizeAiType(text);
  if (!value) {
    return await respond(
      replyToken,
      user,
      'AIタイプは次から選べます。\n・やさしい伴走\n・元気応援\n・分析サポート\n・気軽トーク\n例: AIタイプ変更 分析サポート'
    );
  }
  const { data, error } = await supabase
    .from('users')
    .update({ ai_type: value })
    .eq('id', user.id)
    .select('*')
    .single();
  if (error) throw error;
  await respond(replyToken, data, `${AI_TYPE_CONFIG[value].label} に変更しました。いつでも変えられますよ。`);
}

async function handleProfileCommand(replyToken, user, text) {
  const updates = parseProfile(text);
  if (!Object.keys(updates).length) {
    return await respond(replyToken, user, '例: プロフィール 性別 女性 年齢 55 身長 160 体重 63 目標体重 58');
  }
  const { data, error } = await supabase
    .from('users')
    .update(updates)
    .eq('id', user.id)
    .select('*')
    .single();
  if (error) throw error;
  await respond(replyToken, data, 'プロフィールを更新しました。');
}

async function handleWeightCommand(replyToken, user, text) {
  const metric = parseWeightBodyFat(text);
  if (!metric.weight_kg && !metric.body_fat_percent && !metric.bmi) {
    return await respond(replyToken, user, '例: 体重 68.2 体脂肪 24.1 BMI 22.4');
  }
  const row = {
    user_id: user.id,
    measured_at: nowIso(),
    ...metric,
    source_type: 'text',
  };
  const { error } = await supabase.from('body_metrics').insert(row);
  if (error) throw error;
  await respond(
    replyToken,
    user,
    `体重などを記録しました。${row.weight_kg != null ? `体重 ${fmt(row.weight_kg)}kg。` : ''}${row.body_fat_percent != null ? ` 体脂肪率 ${fmt(row.body_fat_percent)}%。` : ''}`
  );
}

async function handleActivityCommand(replyToken, user, text) {
  const activity = parseActivity(text);
  if (!activity.steps && !activity.walking_minutes && !activity.exercise_minutes && !activity.estimated_activity_kcal) {
    return await respond(replyToken, user, '例: 歩数 8234 散歩 45分 運動 筋トレ 15分');
  }
  const currentWeight = await getLatestWeight(user.id, user.weight_kg);
  if (!activity.estimated_activity_kcal) {
    activity.estimated_activity_kcal = estimateActivityKcal(
      activity.steps,
      activity.walking_minutes,
      currentWeight,
      activity.exercise_minutes
    );
  }
  const row = {
    user_id: user.id,
    logged_at: nowIso(),
    ...activity,
  };
  const { error } = await supabase.from('activity_logs').insert(row);
  if (error) throw error;
  await respond(replyToken, user, `活動を記録しました。推定活動消費は ${fmt(row.estimated_activity_kcal)} kcal です。`);
}

async function handleSleepCommand(replyToken, user, text) {
  const sleep = parseSleep(text);
  if (!sleep.sleep_hours && !sleep.sleep_quality) {
    return await respond(replyToken, user, '例: 睡眠 6.5時間 眠り 普通');
  }
  const row = {
    user_id: user.id,
    sleep_date: todayYmd(),
    ...sleep,
  };
  const { error } = await supabase.from('sleep_logs').insert(row);
  if (error) throw error;
  const comment = sleep.sleep_hours != null && sleep.sleep_hours < 6
    ? '睡眠が短めなので、今日は無理しすぎず回復も大切にしてくださいね。'
    : '睡眠を記録しました。';
  await respond(replyToken, user, comment);
}

async function handleHydrationCommand(replyToken, user, text) {
  const hydration = parseHydration(text);
  if (!hydration.water_ml) {
    return await respond(replyToken, user, '例: 水分 1.5L または 水 800ml');
  }
  const row = {
    user_id: user.id,
    logged_at: nowIso(),
    ...hydration,
  };
  const { error } = await supabase.from('hydration_logs').insert(row);
  if (error) throw error;
  await respond(replyToken, user, `水分を記録しました。${fmt(row.water_ml)} ml ですね。こまめに飲めると良いですね。`);
}

async function handleLabTextCommand(replyToken, user, text) {
  const lab = parseLabValues(text);
  if (!Object.keys(lab).length) {
    return await respond(replyToken, user, '例: 血液 HbA1c 6.1 LDL 140 HDL 52 TG 180 AST 28 ALT 35 γGT 40');
  }
  const row = { user_id: user.id, measured_at: nowIso(), ...lab };
  const { error } = await supabase.from('lab_results').insert(row);
  if (error) throw error;
  await respond(replyToken, user, '血液検査の値を記録しました。');
}

async function buildNaturalChatReply(user, userText) {
  const memories = await getTopMemories(user.id, 5);
  const recent = await getRecentChatLogs(user.id, 8);
  const latestStats = await getLatestContextStats(user.id);
  const aiType = AI_TYPE_CONFIG[user.ai_type] ? user.ai_type : 'gentle';

  const systemPrompt = [
    BASE_PROMPT,
    '',
    `現在のAIタイプ: ${AI_TYPE_CONFIG[aiType].label}`,
    AI_TYPE_CONFIG[aiType].extraPrompt,
    '',
    '出力ルール:',
    '- 日本語で自然に返す',
    '- 1〜5文程度を基本に、長すぎない',
    '- まず共感、その次に軽い整理、必要な時だけ小さな提案',
    '- 何でも健康指導に結びつけない',
    '- 断定しない、責めない',
    '- 必要なら知識は軽く補足する',
    '',
    `利用者情報: 年齢=${user.age ?? '不明'} 性別=${user.sex ?? '不明'} 身長=${user.height_cm ?? '不明'} 目標=${user.goal_text ?? '未設定'} 目的=${user.purpose_text ?? '未設定'}`,
    `最近の記録要約: ${JSON.stringify(latestStats)}`,
    `利用者の重要記憶: ${memories.map((m) => `${m.memory_type}:${m.memory_value}`).join(' / ') || 'なし'}`,
    `最近の会話: ${recent.map((x) => `${x.role === 'assistant' ? 'AI' : '利用者'}:${x.message}`).join(' | ') || 'なし'}`,
  ].join('\n');

  const text = await generateTextWithGemini(systemPrompt, userText, 0.7);
  return safeText(text, 3000);
}

async function classifyImageWithGemini(buffer, mimeType) {
  const schema = {
    type: 'object',
    properties: {
      image_type: { type: 'string', enum: ['meal', 'blood_test', 'body_scale', 'other'] },
      meal: {
        type: 'object',
        nullable: true,
        properties: {
          meal_label: { type: 'string' },
          dish_name: { type: 'string' },
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
          carb_g: { type: 'number' },
          confidence: { type: 'number' },
          ai_comment: { type: 'string' },
        },
      },
      body_scale: {
        type: 'object',
        nullable: true,
        properties: {
          weight_kg: { type: 'number' },
          body_fat_percent: { type: 'number' },
          bmi: { type: 'number' },
          ai_comment: { type: 'string' },
        },
      },
      blood_test: {
        type: 'object',
        nullable: true,
        properties: {
          hba1c: { type: 'number' },
          fasting_glucose: { type: 'number' },
          ldl: { type: 'number' },
          hdl: { type: 'number' },
          triglycerides: { type: 'number' },
          ast: { type: 'number' },
          alt: { type: 'number' },
          gamma_gt: { type: 'number' },
          uric_acid: { type: 'number' },
          creatinine: { type: 'number' },
          ai_summary: { type: 'string' },
        },
      },
      other: {
        type: 'object',
        nullable: true,
        properties: {
          summary: { type: 'string' },
          reply_text: { type: 'string' },
        },
      },
    },
    required: ['image_type'],
  };

  const prompt = [
    'あなたはLINE健康伴走AIの画像分類器です。',
    '画像を meal / blood_test / body_scale / other に分類してください。',
    'meal の時だけ食事概算を返してください。',
    'blood_test は血液検査画像として扱い、食事記録にしてはいけません。',
    'body_scale は体重計や体組成計の画面です。',
    'other は一般画像として扱い、自然な会話用の短い返答を作ってください。',
    '必ずJSONだけを返してください。',
  ].join('\n');

  const response = await genAI.models.generateContent({
    model: GEMINI_MODEL,
    contents: [
      {
        role: 'user',
        parts: [
          { text: prompt },
          { inlineData: { mimeType, data: buffer.toString('base64') } },
        ],
      },
    ],
    config: {
      responseMimeType: 'application/json',
      responseJsonSchema: schema,
      temperature: 0.2,
    },
  });

  return safeJsonParse(extractGeminiText(response));
}

async function generateTextWithGemini(systemPrompt, userText, temperature = 0.7) {
  const response = await genAI.models.generateContent({
    model: GEMINI_MODEL,
    contents: [
      {
        role: 'user',
        parts: [{ text: `${systemPrompt}\n\n利用者メッセージ: ${userText}` }],
      },
    ],
    config: {
      temperature,
      maxOutputTokens: 700,
    },
  });
  return extractGeminiText(response);
}

async function getLineImageContent(messageId) {
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
  return {
    buffer: Buffer.from(response.data),
    mime: response.headers['content-type'] || 'image/jpeg',
  };
}

async function replyMessage(replyToken, messages, aiType = 'gentle') {
  const normalized = normalizeLineMessages(messages);
  if (!replyToken || !normalized.length) return;
  await axios.post(
    'https://api.line.me/v2/bot/message/reply',
    { replyToken, messages: normalized },
    {
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${LINE_CHANNEL_ACCESS_TOKEN}`,
      },
      timeout: 30000,
    }
  );
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
      if (msg.type === 'text') {
        return { ...msg, text: String(msg.text || '').slice(0, 5000) };
      }
      return msg;
    });
}

async function respond(replyToken, user, text) {
  await saveChatLog(user.id, 'assistant', text);
  await replyMessage(replyToken, text, user.ai_type);
}

async function saveChatLog(userId, role, message, sourceMessageId = null) {
  const payload = {
    user_id: userId,
    role,
    message: safeText(message, 5000),
    source_message_id: sourceMessageId,
    created_at: nowIso(),
  };
  const { error } = await supabase.from('chat_logs').insert(payload);
  if (error) console.error('⚠️ saveChatLog failed:', error.message);
}

async function maybeStoreMemoryFromText(userId, text) {
  const candidates = extractMemoryCandidates(text);
  for (const item of candidates) {
    const existing = await supabase
      .from('memory_items')
      .select('id, importance_score')
      .eq('user_id', userId)
      .eq('memory_key', item.memory_key)
      .maybeSingle();

    if (existing.error) {
      console.error('⚠️ memory select failed:', existing.error.message);
      continue;
    }

    if (existing.data?.id) {
      await supabase
        .from('memory_items')
        .update({
          memory_value: item.memory_value,
          importance_score: Math.max(existing.data.importance_score || 0, item.importance_score),
          updated_at: nowIso(),
        })
        .eq('id', existing.data.id);
    } else {
      await supabase.from('memory_items').insert({ user_id: userId, ...item });
    }
  }
}

function extractMemoryCandidates(text) {
  const items = [];
  const src = String(text || '');
  if (/甘い物|スイーツ|ケーキ|チョコ/.test(src)) {
    items.push({ memory_type: 'food', memory_key: 'likes_sweets', memory_value: '甘い物が好き', importance_score: 70 });
  }
  if (/散歩が好き|歩くの好き/.test(src)) {
    items.push({ memory_type: 'exercise', memory_key: 'likes_walking', memory_value: '散歩が好き', importance_score: 75 });
  }
  if (/筋トレ.*苦手|運動.*苦手/.test(src)) {
    items.push({ memory_type: 'exercise', memory_key: 'exercise_barrier', memory_value: '運動が苦手', importance_score: 75 });
  }
  if (/孫/.test(src)) {
    items.push({ memory_type: 'life', memory_key: 'family_grandchild', memory_value: 'お孫さんの話題がある', importance_score: 60 });
  }
  if (/仕事.*忙しい|忙しくて/.test(src)) {
    items.push({ memory_type: 'life', memory_key: 'busy_work', memory_value: '仕事が忙しい時期がある', importance_score: 60 });
  }
  if (/落ち込|不安|しんどい/.test(src)) {
    items.push({ memory_type: 'emotion', memory_key: 'recent_emotional_load', memory_value: '最近やや気持ちが重い時がある', importance_score: 65 });
  }
  return items;
}

async function getTopMemories(userId, limit = 5) {
  const { data, error } = await supabase
    .from('memory_items')
    .select('*')
    .eq('user_id', userId)
    .order('importance_score', { ascending: false })
    .limit(limit);
  if (error) {
    console.error('⚠️ getTopMemories failed:', error.message);
    return [];
  }
  return data || [];
}

async function getRecentChatLogs(userId, limit = 8) {
  const { data, error } = await supabase
    .from('chat_logs')
    .select('role, message, created_at')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .limit(limit);
  if (error) {
    console.error('⚠️ getRecentChatLogs failed:', error.message);
    return [];
  }
  return (data || []).reverse();
}

async function getLatestContextStats(userId) {
  const today = todayYmd();
  const [daily, latestWeight, latestSleep, latestWater] = await Promise.all([
    buildDailySummary(userId, today).catch(() => ({ total_intake_kcal: null, total_activity_kcal: null, total_steps: null })),
    getLatestMetricRow(userId),
    getLatestSleep(userId),
    getLatestHydration(userId),
  ]);

  return {
    today_intake_kcal: daily.total_intake_kcal,
    today_activity_kcal: daily.total_activity_kcal,
    today_steps: daily.steps,
    latest_weight_kg: latestWeight?.weight_kg ?? null,
    latest_body_fat_percent: latestWeight?.body_fat_percent ?? null,
    latest_sleep_hours: latestSleep?.sleep_hours ?? null,
    latest_water_ml: latestWater?.water_ml ?? null,
  };
}

async function getLatestMetricRow(userId) {
  const { data } = await supabase
    .from('body_metrics')
    .select('*')
    .eq('user_id', userId)
    .order('measured_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  return data || null;
}

async function getLatestSleep(userId) {
  const { data } = await supabase
    .from('sleep_logs')
    .select('*')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  return data || null;
}

async function getLatestHydration(userId) {
  const { data } = await supabase
    .from('hydration_logs')
    .select('*')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  return data || null;
}

async function getLatestWeight(userId, fallbackWeight) {
  const row = await getLatestMetricRow(userId);
  return row?.weight_kg || fallbackWeight || 60;
}

async function buildDailySummary(userId, dateYmd) {
  const start = `${dateYmd}T00:00:00+09:00`;
  const end = `${dateYmd}T23:59:59+09:00`;
  const [mealsRes, actsRes, waterRes] = await Promise.all([
    supabase.from('meal_logs').select('estimated_kcal').eq('user_id', userId).gte('eaten_at', start).lte('eaten_at', end),
    supabase.from('activity_logs').select('steps, walking_minutes, estimated_activity_kcal').eq('user_id', userId).gte('logged_at', start).lte('logged_at', end),
    supabase.from('hydration_logs').select('water_ml').eq('user_id', userId).gte('logged_at', start).lte('logged_at', end),
  ]);
  if (mealsRes.error) throw mealsRes.error;
  if (actsRes.error) throw actsRes.error;
  if (waterRes.error) throw waterRes.error;

  return {
    total_intake_kcal: round1(sumNumbers((mealsRes.data || []).map((x) => x.estimated_kcal))),
    total_activity_kcal: round1(sumNumbers((actsRes.data || []).map((x) => x.estimated_activity_kcal))),
    steps: Math.round(sumNumbers((actsRes.data || []).map((x) => x.steps))),
    walking_minutes: Math.round(sumNumbers((actsRes.data || []).map((x) => x.walking_minutes))),
    water_ml: Math.round(sumNumbers((waterRes.data || []).map((x) => x.water_ml))),
  };
}

async function buildWeeklySummary(userId, refIso) {
  const d = new Date(refIso);
  const startDate = startOfWeekJST(d);
  const endDate = new Date(startDate);
  endDate.setDate(endDate.getDate() + 6);
  const start = `${formatYmd(startDate)}T00:00:00+09:00`;
  const end = `${formatYmd(endDate)}T23:59:59+09:00`;

  const [mealsRes, actsRes, sleepRes, waterRes, bodyRes] = await Promise.all([
    supabase.from('meal_logs').select('estimated_kcal, eaten_at').eq('user_id', userId).gte('eaten_at', start).lte('eaten_at', end),
    supabase.from('activity_logs').select('steps, walking_minutes, estimated_activity_kcal').eq('user_id', userId).gte('logged_at', start).lte('logged_at', end),
    supabase.from('sleep_logs').select('sleep_hours').eq('user_id', userId).gte('created_at', start).lte('created_at', end),
    supabase.from('hydration_logs').select('water_ml').eq('user_id', userId).gte('logged_at', start).lte('logged_at', end),
    supabase.from('body_metrics').select('weight_kg, measured_at').eq('user_id', userId).gte('measured_at', start).lte('measured_at', end).order('measured_at', { ascending: true }),
  ]);
  if (mealsRes.error) throw mealsRes.error;
  if (actsRes.error) throw actsRes.error;
  if (sleepRes.error) throw sleepRes.error;
  if (waterRes.error) throw waterRes.error;
  if (bodyRes.error) throw bodyRes.error;

  const body = bodyRes.data || [];
  const startWeight = body[0]?.weight_kg ?? null;
  const endWeight = body[body.length - 1]?.weight_kg ?? null;

  return {
    week_start: formatYmd(startDate),
    week_end: formatYmd(endDate),
    total_intake_kcal: round1(sumNumbers((mealsRes.data || []).map((x) => x.estimated_kcal))),
    total_activity_kcal: round1(sumNumbers((actsRes.data || []).map((x) => x.estimated_activity_kcal))),
    avg_steps: round1(sumNumbers((actsRes.data || []).map((x) => x.steps)) / 7),
    avg_walking_minutes: round1(sumNumbers((actsRes.data || []).map((x) => x.walking_minutes)) / 7),
    avg_sleep_hours: round1(sumNumbers((sleepRes.data || []).map((x) => x.sleep_hours)) / Math.max((sleepRes.data || []).length, 1)),
    avg_water_ml: round1(sumNumbers((waterRes.data || []).map((x) => x.water_ml)) / 7),
    meal_count: (mealsRes.data || []).length,
    weight_change_kg: startWeight != null && endWeight != null ? round1(endWeight - startWeight) : null,
  };
}

async function buildMonthlySummary(userId, refIso) {
  const d = new Date(refIso);
  const startDate = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1));
  const endDate = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0));
  const start = `${formatYmd(startDate)}T00:00:00+09:00`;
  const end = `${formatYmd(endDate)}T23:59:59+09:00`;

  const [mealsRes, actsRes, sleepRes, waterRes, bodyRes] = await Promise.all([
    supabase.from('meal_logs').select('estimated_kcal').eq('user_id', userId).gte('eaten_at', start).lte('eaten_at', end),
    supabase.from('activity_logs').select('steps, walking_minutes, estimated_activity_kcal').eq('user_id', userId).gte('logged_at', start).lte('logged_at', end),
    supabase.from('sleep_logs').select('sleep_hours').eq('user_id', userId).gte('created_at', start).lte('created_at', end),
    supabase.from('hydration_logs').select('water_ml').eq('user_id', userId).gte('logged_at', start).lte('logged_at', end),
    supabase.from('body_metrics').select('weight_kg, measured_at').eq('user_id', userId).gte('measured_at', start).lte('measured_at', end).order('measured_at', { ascending: true }),
  ]);
  if (mealsRes.error) throw mealsRes.error;
  if (actsRes.error) throw actsRes.error;
  if (sleepRes.error) throw sleepRes.error;
  if (waterRes.error) throw waterRes.error;
  if (bodyRes.error) throw bodyRes.error;

  return {
    month: `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`,
    total_intake_kcal: round1(sumNumbers((mealsRes.data || []).map((x) => x.estimated_kcal))),
    total_activity_kcal: round1(sumNumbers((actsRes.data || []).map((x) => x.estimated_activity_kcal))),
    avg_steps: round1(sumNumbers((actsRes.data || []).map((x) => x.steps)) / Math.max(daysInMonthJST(d), 1)),
    avg_sleep_hours: round1(sumNumbers((sleepRes.data || []).map((x) => x.sleep_hours)) / Math.max((sleepRes.data || []).length, 1)),
    avg_water_ml: round1(sumNumbers((waterRes.data || []).map((x) => x.water_ml)) / Math.max(daysInMonthJST(d), 1)),
    body_points: bodyRes.data || [],
  };
}

function formatWeeklyReply(summary, user) {
  const lines = [
    `📅 週報 ${summary.week_start}〜${summary.week_end}`,
    `摂取合計: ${fmt(summary.total_intake_kcal)} kcal`,
    `活動消費合計: ${fmt(summary.total_activity_kcal)} kcal`,
    `平均歩数: ${fmt(summary.avg_steps)} 歩/日`,
    `平均散歩時間: ${fmt(summary.avg_walking_minutes)} 分/日`,
    `平均睡眠: ${fmt(summary.avg_sleep_hours)} 時間`,
    `平均水分: ${fmt(summary.avg_water_ml)} ml/日`,
    summary.weight_change_kg != null ? `体重変化: ${summary.weight_change_kg > 0 ? '+' : ''}${fmt(summary.weight_change_kg)} kg` : null,
    '',
    summary.avg_steps >= 7000 ? '良い点: 歩数がしっかり確保できています。' : '良い点: 記録が続いていること自体が大きな前進です。',
    summary.avg_sleep_hours && summary.avg_sleep_hours < 6 ? '気づき: 睡眠が短めなので、体重や食欲に影響しやすいかもしれません。' : null,
    summary.avg_water_ml && summary.avg_water_ml < 1200 ? '気づき: 水分が少なめの日があると、むくみやすさにもつながることがあります。' : null,
    '来週のポイント: 一度に全部ではなく、まず1つだけ整えていきましょう。',
    '',
    'さぁ〜、ここから。',
  ].filter(Boolean);
  return lines.join('\n');
}

function formatMonthlyReply(summary) {
  return [
    `🗓 月報 ${summary.month}`,
    `摂取合計: ${fmt(summary.total_intake_kcal)} kcal`,
    `活動消費合計: ${fmt(summary.total_activity_kcal)} kcal`,
    `平均歩数: ${fmt(summary.avg_steps)} 歩/日`,
    `平均睡眠: ${fmt(summary.avg_sleep_hours)} 時間`,
    `平均水分: ${fmt(summary.avg_water_ml)} ml/日`,
    `体重記録数: ${summary.body_points.length}件`,
    '今月も積み重ねができています。次の1か月も一緒に整えていきましょう。',
  ].join('\n');
}

function helpMessage() {
  return [
    '使い方です。',
    '・食事写真を送る → カロリー概算を記録',
    '・歩数 8234 散歩 45分 → 活動記録',
    '・体重 68.2 体脂肪 24.1 BMI 22.4 → 身体記録',
    '・睡眠 6.5時間 → 睡眠記録',
    '・水分 1.5L → 水分記録',
    '・血液 HbA1c 6.1 LDL 140 HDL 52 TG 180 → 血液記録',
    '・プロフィール 性別 女性 年齢 55 身長 160 体重 63 目標体重 58 → 基本情報更新',
    '・AIタイプ変更 やさしい伴走 → AIタイプ変更',
    '・週報 / 月報',
  ].join('\n');
}

function extractGeminiText(response) {
  if (typeof response?.text === 'function') return response.text();
  if (typeof response?.text === 'string') return response.text;
  const fallback = response?.candidates?.[0]?.content?.parts?.map((p) => p.text || '').join('').trim();
  if (!fallback) throw new Error('Gemini response text not found');
  return fallback;
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

function normalizeAiType(text) {
  const t = String(text || '');
  if (/やさしい伴走|gentle/i.test(t)) return 'gentle';
  if (/元気応援|cheer/i.test(t)) return 'cheer';
  if (/分析サポート|analyze/i.test(t)) return 'analyze';
  if (/気軽トーク|casual/i.test(t)) return 'casual';
  return null;
}

function parseProfile(text) {
  const updates = {
    sex: findEnum(text, [['男性', 'male'], ['女性', 'female']]),
    age: integerOrNull(findNumberAfter(text, ['年齢', '歳', 'age'])),
    height_cm: toNumberOrNull(findNumberAfter(text, ['身長', 'height'])),
    weight_kg: toNumberOrNull(findNumberAfter(text, ['体重', 'weight'])),
    target_weight_kg: toNumberOrNull(findNumberAfter(text, ['目標体重'])),
  };

  const goal = findTextAfter(text, ['目標']);
  const purpose = findTextAfter(text, ['目的']);
  if (goal) updates.goal_text = safeText(goal, 300);
  if (purpose) updates.purpose_text = safeText(purpose, 300);
  return Object.fromEntries(Object.entries(updates).filter(([, v]) => v !== null && v !== undefined && v !== ''));
}

function parseWeightBodyFat(text) {
  return {
    weight_kg: toNumberOrNull(findNumberAfter(text, ['体重', 'weight'])),
    body_fat_percent: toNumberOrNull(findNumberAfter(text, ['体脂肪', '体脂肪率', 'bodyfat'])),
    bmi: toNumberOrNull(findNumberAfter(text, ['bmi', 'BMI'])),
  };
}

function parseActivity(text) {
  const exerciseMatch = text.match(/運動\s*([\p{L}\p{N}ーぁ-んァ-ヶ一-龯]+)?\s*(\d+(?:\.\d+)?)?\s*分?/u);
  return {
    steps: integerOrNull(findNumberAfter(text, ['歩数', 'steps'])),
    walking_minutes: integerOrNull(findNumberAfter(text, ['散歩', '歩行', 'walking', 'walk'])),
    exercise_type: safeText(exerciseMatch?.[1] || '', 100) || null,
    exercise_minutes: integerOrNull(exerciseMatch?.[2] ? Number(exerciseMatch[2]) : null),
    estimated_activity_kcal: toNumberOrNull(findNumberAfter(text, ['消費', 'activity', '運動消費'])),
    note: safeText(text, 500),
  };
}

function parseSleep(text) {
  return {
    sleep_hours: toNumberOrNull(findNumberAfter(text, ['睡眠', 'sleep'])),
    sleep_quality: findSleepQuality(text),
  };
}

function parseHydration(text) {
  const liters = findNumberAfter(text, ['水分', '水', '飲水', 'hydration']);
  let waterMl = null;
  if (liters != null) {
    waterMl = /l\b|L\b|リットル/.test(text) ? Number(liters) * 1000 : Number(liters);
  }
  return {
    water_ml: integerOrNull(waterMl),
    beverage_type: /お茶/.test(text) ? 'tea' : /コーヒー/.test(text) ? 'coffee' : 'water',
  };
}

function parseLabValues(text) {
  const value = (keys) => toNumberOrNull(findNumberAfter(text, keys));
  const obj = {
    hba1c: value(['hba1c', 'HbA1c']),
    fasting_glucose: value(['fasting', '血糖', '空腹時血糖']),
    ast: value(['ast', 'AST', 'got']),
    alt: value(['alt', 'ALT', 'gpt']),
    gamma_gt: value(['γgt', 'γ-GT', 'γgtp', 'γ-GTP', 'ggt', 'GGT']),
    ldl: value(['ldl', 'LDL']),
    hdl: value(['hdl', 'HDL']),
    triglycerides: value(['tg', '中性脂肪', 'triglycerides']),
    uric_acid: value(['尿酸', 'ua', 'UA']),
    creatinine: value(['cre', 'CRE', 'クレアチニン']),
  };
  return Object.fromEntries(Object.entries(obj).filter(([, v]) => v !== null && v !== undefined));
}

function findSleepQuality(text) {
  if (/悪い|浅い/.test(text)) return 'poor';
  if (/普通/.test(text)) return 'normal';
  if (/良い|ぐっすり/.test(text)) return 'good';
  return null;
}

function findNumberAfter(text, keys) {
  for (const key of keys) {
    const escaped = escapeRegExp(key);
    const patterns = [
      new RegExp(`${escaped}\s*[:：]?\s*(-?\d+(?:\.\d+)?)`, 'i'),
      new RegExp(`(-?\d+(?:\.\d+)?)\s*(kg|キロ|%|分|歩|ml|mL|l|L|時間|時)?\s*${escaped}`, 'i'),
    ];
    for (const pattern of patterns) {
      const match = text.match(pattern);
      if (match) return Number(match[1]);
    }
  }
  return null;
}

function findTextAfter(text, keys) {
  for (const key of keys) {
    const escaped = escapeRegExp(key);
    const match = text.match(new RegExp(`${escaped}\s*[:：]?\s*([^\n]+)$`, 'i'));
    if (match) return match[1].trim();
  }
  return null;
}

function findEnum(text, pairs) {
  for (const [needle, value] of pairs) {
    if (text.includes(needle)) return value;
  }
  return null;
}

function isHelpCommand(text) {
  return ['help', 'ヘルプ', '使い方'].includes(text);
}
function isWeeklyReportCommand(text) {
  return ['週報', 'week', 'weekly'].includes(text);
}
function isMonthlyReportCommand(text) {
  return ['月報', 'month', 'monthly'].includes(text);
}
function isWeightCommand(text) {
  return /体重|体脂肪|bmi/i.test(text);
}
function isActivityCommand(text) {
  return /歩数|散歩|歩行|steps|walking|walk|運動|消費/i.test(text);
}
function isSleepCommand(text) {
  return /睡眠|sleep/i.test(text);
}
function isHydrationCommand(text) {
  return /水分|飲水|hydration|\d+\s*(ml|mL|l|L)/i.test(text);
}
function isLabCommand(text) {
  return /hba1c|ldl|hdl|tg|ast|alt|γ|ggt|血液|尿酸|cre|クレアチニン/i.test(text);
}
function isProfileCommand(text) {
  return /プロフィール|性別|年齢|身長|目標体重|目的|目標/i.test(text);
}
function isAiTypeChangeCommand(text) {
  return /AIタイプ変更|aiタイプ変更|タイプ変更/i.test(text);
}

function calculateBMR(user) {
  const sex = user?.sex;
  const age = Number(user?.age);
  const heightCm = Number(user?.height_cm);
  const weightKg = Number(user?.weight_kg);
  if (!sex || !age || !heightCm || !weightKg) return null;
  const base = 10 * weightKg + 6.25 * heightCm - 5 * age;
  const s = sex === 'male' ? 5 : -161;
  return round1(base + s);
}

function estimateActivityKcal(steps, walkingMinutes, weightKg, exerciseMinutes = 0) {
  const s = Number(steps) || 0;
  const m = Number(walkingMinutes) || 0;
  const e = Number(exerciseMinutes) || 0;
  const w = Number(weightKg) || 60;
  const stepKcal = s * (w * 0.0005);
  const walkKcal = m * (w * 0.05);
  const exerciseKcal = e * (w * 0.06);
  return round1(Math.max(stepKcal, walkKcal) + exerciseKcal);
}

function inferMealLabelByTime(date) {
  const hour = Number(
    new Intl.DateTimeFormat('en-US', { timeZone: TZ, hour: '2-digit', hour12: false })
      .format(date)
      .replace(/\D/g, '')
  );
  if (hour < 10) return '朝食';
  if (hour < 15) return '昼食';
  if (hour < 22) return '夕食';
  return '間食';
}

function startOfWeekJST(date) {
  const jst = new Date(date.toLocaleString('en-US', { timeZone: TZ }));
  const day = jst.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  jst.setHours(0, 0, 0, 0);
  jst.setDate(jst.getDate() + diff);
  return new Date(Date.UTC(jst.getFullYear(), jst.getMonth(), jst.getDate()));
}

function formatYmd(date) {
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, '0');
  const d = String(date.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function todayYmd() {
  return nowIso().slice(0, 10);
}

function nowIso() {
  return toIsoStringInTZ(new Date(), TZ);
}

function toIsoStringInTZ(date, timeZone) {
  const parts = new Intl.DateTimeFormat('sv-SE', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).formatToParts(date);
  const map = Object.fromEntries(parts.map((p) => [p.type, p.value]));
  return `${map.year}-${map.month}-${map.day}T${map.hour}:${map.minute}:${map.second}+09:00`;
}

function daysInMonthJST(date) {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0)).getUTCDate();
}

function safeText(value, max = 1000) {
  return String(value || '').trim().slice(0, max);
}
function toNumberOrNull(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}
function integerOrNull(v) {
  const n = Number(v);
  return Number.isFinite(n) ? Math.round(n) : null;
}
function clamp01(v) {
  if (v == null) return null;
  return Math.max(0, Math.min(1, Number(v)));
}
function sumNumbers(arr) {
  return arr.reduce((sum, v) => sum + (Number(v) || 0), 0);
}
function round1(v) {
  return Math.round((Number(v) || 0) * 10) / 10;
}
function fmt(v) {
  if (v === null || v === undefined || Number.isNaN(Number(v))) return '-';
  return new Intl.NumberFormat('ja-JP', { maximumFractionDigits: 1 }).format(Number(v));
}
function formatKcalRange(kcal, min, max) {
  if (min != null && max != null) return `${fmt(kcal)} kcal（${fmt(min)}〜${fmt(max)}）`;
  return `${fmt(kcal)} kcal`;
}
function escapeRegExp(str) {
  return String(str).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

app.listen(PORT, () => {
  console.log(`✅ Server running on port ${PORT}`);
});

