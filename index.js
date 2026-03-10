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
  confirmAllLabDraftToResults,
  getRecentLabResults,
  buildPostSaveComparisonMessage,
  buildLabHistoryText,
  formatDateOnly,
} = require('./blood_test_flow_helpers');
const {
  getSoftNudgeMessage,
  getExercisePromptMessage,
  getMealPraiseMessage,
  getMealBalanceComment,
  getMealFutureLink,
  buildBloodExamCommentParts,
  buildExerciseReplySet,
  getDailyMenuSuggestion,
} = require('./ushigome_comment_library');

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

const MEAL_ACTIONS = {
  SINGLE: 'この1枚で食事解析',
  ADD_IMAGE: '食事写真を追加',
  ADD_TEXT: '文章で食事追加',
  CANCEL: '食事をやめる',
  DUPLICATE_ANGLE: '同じ食事の別角度',
  SAME_PHOTO: '同じ写真を送った',
  EXTRA: '追加料理あり',
  SAVE: 'この内容で食事保存',
};

const ACTIVITY_ACTIONS = {
  SAVE: 'この内容で運動保存',
  ADD: '運動を追加',
  CANCEL: '運動をやめる',
};

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

const MEAL_WORD_HINTS = [
  '朝食', '昼食', '夕食', '夜食', '間食', '朝ごはん', '昼ごはん', '晩ごはん',
  'パン', 'ご飯', '米', 'おにぎり', 'うどん', 'そば', 'パスタ', 'ラーメン',
  'サラダ', '卵', '納豆', '豆腐', '味噌汁', 'みそ汁', '焼き魚', '魚', '肉',
  '鶏', '豚', '牛', 'ハンバーグ', 'カレー', 'シチュー', '餃子', '唐揚げ',
  'ケーキ', 'チョコ', 'クッキー', 'アイス', 'ヨーグルト', 'バナナ', 'りんご',
  'コーヒー', '紅茶', 'ラテ', 'ジュース', '牛乳', 'チーズ', '食パン', 'トースト',
  '大福', 'まんじゅう', '饅頭', 'どら焼き', 'たい焼き', 'おはぎ', '羊羹', 'ようかん',
  '最中', 'もなか', '団子', 'だんご', 'せんべい', '煎餅', 'あんみつ', 'ぜんざい',
  '和菓子', 'あんこ', 'もち', '餅', '柏餅', '桜餅', 'みたらし団子',
  'ガパオ', 'パッタイ', 'お好み焼き', '広島焼き', '機内食', '弁当', '定食',
  'スタバ', 'モンスーン', 'コンビニ',
];

const EXERCISE_WORD_HINTS = [
  '歩いた', '歩きました', '歩く', '散歩', 'ウォーキング', '歩行',
  'ジョギング', 'ランニング', 'スロージョギング', '走った', '走りました',
  '階段', '自転車', 'バイク', '筋トレ', '運動', 'ストレッチ',
  'スクワット', '腹筋', '腕立て', '膝つき腕立て', 'プランク',
  'ラジオ体操', '体操', 'ヨガ', '体幹', 'もも上げ', '開脚', '伸ばした',
];

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

function getUserDisplayName(user) {
  const name = String(user?.display_name || '').trim();
  return name || '';
}

function prefixWithName(user, message) {
  const name = getUserDisplayName(user);
  const text = String(message || '').trim();
  if (!text) return text;
  if (!name) return text;
  return `${name}さん、${text}`;
}

function parseDisplayName(text) {
  const trimmed = String(text || '').trim();
  const patterns = [
    /^名前[は：:\s]*([^\s]{1,40})$/i,
    /^名前[：:\s]+([^\s]{1,40})$/i,
    /^ニックネーム[は：:\s]*([^\s]{1,40})$/i,
    /^私は([^\s]{1,40})です$/i,
    /^わたしは([^\s]{1,40})です$/i,
    /^僕は([^\s]{1,40})です$/i,
    /^ぼくは([^\s]{1,40})です$/i,
    /^俺は([^\s]{1,40})です$/i,
  ];

  for (const regex of patterns) {
    const m = trimmed.match(regex);
    if (m?.[1]) return m[1].trim();
  }
  return null;
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
  } catch {
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
    isBmrCommand(trimmed.toLowerCase()) ||
    isLabHistoryCommand(trimmed.toLowerCase()) ||
    isExerciseMenuCommand(trimmed.toLowerCase())
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

// ---------- Meal draft flow ----------
async function getOpenMealDraft(userId) {
  const { data, error } = await supabase
    .from('meal_import_sessions')
    .select('*')
    .in('status', ['draft', 'ready_to_confirm'])
    .eq('user_id', userId)
    .order('updated_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) throw error;
  if (!data) return null;
  if (data.expires_at && new Date(data.expires_at).getTime() < Date.now()) return null;
  return data;
}

async function createMealDraftSession(payload) {
  const { data, error } = await supabase
    .from('meal_import_sessions')
    .insert(payload)
    .select('*')
    .single();
  if (error) throw error;
  return data;
}

async function updateMealDraftSession(sessionId, patch) {
  const { data, error } = await supabase
    .from('meal_import_sessions')
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq('id', sessionId)
    .select('*')
    .single();
  if (error) throw error;
  return data;
}

async function cancelMealDraftSession(sessionId) {
  const { error } = await supabase
    .from('meal_import_sessions')
    .update({
      status: 'cancelled',
      awaiting_action: null,
      updated_at: new Date().toISOString(),
    })
    .eq('id', sessionId);
  if (error) throw error;
}

function normalizeFoodName(name) {
  return String(name || '')
    .toLowerCase()
    .replace(/\s+/g, '')
    .replace(/[　・、,]/g, '')
    .trim();
}

function scoreMealAnalysis(analysis) {
  if (!analysis || typeof analysis !== 'object') return 0;
  const itemCount = Array.isArray(analysis.food_items) ? analysis.food_items.length : 0;
  const confidence = Number(analysis.confidence) || 0;
  const hasRange = analysis.kcal_min != null && analysis.kcal_max != null ? 1 : 0;
  const hasStore = analysis.restaurant_name_candidate ? 1 : 0;
  const hasMenu = analysis.menu_name_candidate ? 1 : 0;
  return itemCount * 10 + confidence * 5 + hasRange + hasStore + hasMenu;
}

function chooseBestMealAnalysis(analyses = []) {
  const valid = (analyses || []).filter(Boolean);
  if (!valid.length) return null;
  return valid.sort((a, b) => scoreMealAnalysis(b) - scoreMealAnalysis(a))[0];
}

function buildMealFingerprint(analysis) {
  if (!analysis) return '';
  const label = normalizeFoodName(analysis.meal_label);
  const items = (analysis.food_items || [])
    .map((x) => normalizeFoodName(x?.name))
    .filter(Boolean)
    .sort()
    .join('|');
  const kcal = Math.round(Number(analysis.estimated_kcal) || 0);
  return `${label}__${items}__${kcal}`;
}

function mergeMealAnalyses(analyses = []) {
  const valid = (analyses || []).filter(Boolean);
  if (!valid.length) return null;
  if (valid.length === 1) return valid[0];

  const foodMap = new Map();
  let estimatedKcal = 0;
  let kcalMin = 0;
  let kcalMax = 0;
  let protein = 0;
  let fat = 0;
  let carbs = 0;
  let confidenceSum = 0;
  const labels = [];
  const menuCandidates = [];
  const restaurantCandidates = [];
  const evidenceList = [];
  let cuisineType = '';

  for (const analysis of valid) {
    if (analysis.meal_label) labels.push(String(analysis.meal_label).trim());
    if (analysis.menu_name_candidate) menuCandidates.push(String(analysis.menu_name_candidate).trim());
    if (analysis.restaurant_name_candidate) restaurantCandidates.push(String(analysis.restaurant_name_candidate).trim());
    if (analysis.visual_evidence) evidenceList.push(String(analysis.visual_evidence).trim());
    if (!cuisineType && analysis.cuisine_type) cuisineType = analysis.cuisine_type;

    estimatedKcal += Number(analysis.estimated_kcal) || 0;
    kcalMin += Number(analysis.kcal_min) || 0;
    kcalMax += Number(analysis.kcal_max) || 0;
    protein += Number(analysis.protein_g) || 0;
    fat += Number(analysis.fat_g) || 0;
    carbs += Number(analysis.carbs_g) || 0;
    confidenceSum += Number(analysis.confidence) || 0;

    const items = Array.isArray(analysis.food_items) ? analysis.food_items : [];
    for (const item of items) {
      const key = normalizeFoodName(item?.name);
      if (!key) continue;
      const prev = foodMap.get(key);
      if (!prev) {
        foodMap.set(key, {
          name: item.name,
          estimated_amount: item.estimated_amount || '',
          estimated_kcal: Number(item.estimated_kcal) || null,
        });
      } else {
        const prevKcal = Number(prev.estimated_kcal) || 0;
        const addKcal = Number(item.estimated_kcal) || 0;
        prev.estimated_kcal = prevKcal + addKcal || prev.estimated_kcal;
        if (item.estimated_amount && !String(prev.estimated_amount || '').includes(String(item.estimated_amount))) {
          prev.estimated_amount = [prev.estimated_amount, item.estimated_amount].filter(Boolean).join(' + ');
        }
      }
    }
  }

  const uniqueLabels = [...new Set(labels.filter(Boolean))];
  const uniqueMenus = [...new Set(menuCandidates.filter(Boolean))];
  const uniqueRestaurants = [...new Set(restaurantCandidates.filter(Boolean))];
  const uniqueEvidence = [...new Set(evidenceList.filter(Boolean))];

  return {
    meal_label: uniqueLabels.join(' + ') || '食事',
    menu_name_candidate: uniqueMenus[0] || null,
    restaurant_name_candidate: uniqueRestaurants[0] || null,
    visual_evidence: uniqueEvidence.slice(0, 3).join(' / ') || null,
    cuisine_type: cuisineType || null,
    food_items: [...foodMap.values()],
    estimated_kcal: round1(estimatedKcal),
    kcal_min: round1(kcalMin),
    kcal_max: round1(kcalMax),
    protein_g: round1(protein),
    fat_g: round1(fat),
    carbs_g: round1(carbs),
    confidence: clamp01(round1(confidenceSum / Math.max(valid.length, 1))),
    ai_comment: '複数の食事情報をまとめて推定しました。',
  };
}

function getDuplicateMealSignal(baseAnalysis, newAnalysis) {
  if (!baseAnalysis || !newAnalysis) return { isDuplicateLike: false, isSamePhotoLike: false };

  const labelA = normalizeFoodName(baseAnalysis.meal_label);
  const labelB = normalizeFoodName(newAnalysis.meal_label);
  const itemsA = new Set((baseAnalysis.food_items || []).map((x) => normalizeFoodName(x?.name)).filter(Boolean));
  const itemsB = new Set((newAnalysis.food_items || []).map((x) => normalizeFoodName(x?.name)).filter(Boolean));

  let overlap = 0;
  for (const name of itemsA) {
    if (itemsB.has(name)) overlap += 1;
  }

  const smaller = Math.max(Math.min(itemsA.size || 1, itemsB.size || 1), 1);
  const overlapRatio = overlap / smaller;
  const kcalA = Number(baseAnalysis.estimated_kcal) || 0;
  const kcalB = Number(newAnalysis.estimated_kcal) || 0;
  const kcalRatio = kcalA > 0 && kcalB > 0 ? Math.min(kcalA, kcalB) / Math.max(kcalA, kcalB) : 0;

  const fpA = buildMealFingerprint(baseAnalysis);
  const fpB = buildMealFingerprint(newAnalysis);
  const sameFingerprint = fpA && fpB && fpA === fpB;

  const isSamePhotoLike = sameFingerprint && overlapRatio >= 0.8 && kcalRatio >= 0.9;
  const isDuplicateLike =
    isSamePhotoLike ||
    (labelA && labelB && labelA === labelB && overlapRatio >= 0.5) ||
    (overlapRatio >= 0.7 && kcalRatio >= 0.65);

  return { isDuplicateLike, isSamePhotoLike };
}

function extractMealAnalysesFromSession(session) {
  const entries = Array.isArray(session?.images_json) ? session.images_json : [];
  return entries.map((x) => x.analysis).filter(Boolean);
}

function summarizeMealAnalysis(analysis) {
  if (!analysis) return '食事内容をまとめました。';

  const praise = getMealPraiseMessage();
  const balanceComment = (Number(analysis.confidence) || 0) < 0.5
    ? getMealBalanceComment('careful')
    : getMealBalanceComment('positive');
  const futureLink = getMealFutureLink();

  const lines = [
    praise,
    analysis.restaurant_name_candidate ? `候補のお店: ${safeText(analysis.restaurant_name_candidate, 80)}` : null,
    analysis.menu_name_candidate ? `候補メニュー: ${safeText(analysis.menu_name_candidate, 80)}` : null,
    `料理: ${safeText(analysis.meal_label || '食事', 80)}`,
    `推定カロリー: ${formatKcalRange(analysis.estimated_kcal, analysis.kcal_min, analysis.kcal_max)}`,
    analysis.protein_g || analysis.fat_g || analysis.carbs_g
      ? `PFC: P${fmt(analysis.protein_g)}g / F${fmt(analysis.fat_g)}g / C${fmt(analysis.carbs_g)}g`
      : null,
    Array.isArray(analysis.food_items) && analysis.food_items.length
      ? `内容: ${(analysis.food_items || []).slice(0, 8).map((x) => x.name).filter(Boolean).join(' / ')}`
      : null,
    analysis.visual_evidence ? `読み取り根拠: ${safeText(analysis.visual_evidence, 150)}` : null,
    balanceComment,
    futureLink,
  ].filter(Boolean);

  return lines.join('\n');
}

function mealConfirmButtonsForStage(stage = 'single', samePhotoLike = false) {
  if (stage === 'duplicate') {
    return samePhotoLike
      ? [MEAL_ACTIONS.SAME_PHOTO, MEAL_ACTIONS.DUPLICATE_ANGLE, MEAL_ACTIONS.EXTRA, MEAL_ACTIONS.CANCEL]
      : [MEAL_ACTIONS.DUPLICATE_ANGLE, MEAL_ACTIONS.EXTRA, MEAL_ACTIONS.CANCEL];
  }
  if (stage === 'ready_to_confirm') {
    return [MEAL_ACTIONS.SAVE, MEAL_ACTIONS.ADD_IMAGE, MEAL_ACTIONS.ADD_TEXT, MEAL_ACTIONS.CANCEL];
  }
  return [MEAL_ACTIONS.SINGLE, MEAL_ACTIONS.ADD_IMAGE, MEAL_ACTIONS.ADD_TEXT, MEAL_ACTIONS.CANCEL];
}

async function saveMealDraftToLog(session, user) {
  const analysis = session?.merged_analysis_json || chooseBestMealAnalysis(extractMealAnalysesFromSession(session));
  if (!analysis) throw new Error('Meal draft analysis not found');

  const insertPayload = {
    user_id: user.id,
    source_message_id: Array.isArray(session.source_message_ids) ? session.source_message_ids[0] || null : null,
    eaten_at: toIsoStringInTZ(new Date(), TZ),
    meal_label: safeText(analysis.meal_label || '食事', 100),
    food_items: Array.isArray(analysis.food_items) ? analysis.food_items : [],
    estimated_kcal: toNumberOrNull(analysis.estimated_kcal),
    kcal_min: toNumberOrNull(analysis.kcal_min),
    kcal_max: toNumberOrNull(analysis.kcal_max),
    protein_g: toNumberOrNull(analysis.protein_g),
    fat_g: toNumberOrNull(analysis.fat_g),
    carbs_g: toNumberOrNull(analysis.carbs_g),
    confidence: clamp01(toNumberOrNull(analysis.confidence)),
    ai_comment: safeText(analysis.ai_comment || '食事を記録しました。', 1000),
    raw_model_json: analysis,
    import_session_id: session.id,
    source_image_count: Number(session.image_count) || 1,
  };

  const { error } = await supabase.from('meal_logs').insert(insertPayload);
  if (error) throw error;

  await updateMealDraftSession(session.id, {
    status: 'confirmed',
    awaiting_action: null,
  });

  return insertPayload;
}

async function analyzeMealTextWithGemini(text) {
  const schema = {
    type: 'object',
    properties: {
      restaurant_name_candidate: { type: 'string' },
      restaurant_confidence: { type: 'number' },
      menu_name_candidate: { type: 'string' },
      menu_confidence: { type: 'number' },
      cuisine_type: { type: 'string' },
      visual_evidence: { type: 'string' },
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
    'ユーザーが文章で食事内容を送ってきます。',
    '文章から食べた内容を整理し、概算カロリーとPFCを推定してください。',
    '特に日本の単品食品、和菓子、洋菓子、飲み物、軽食を見落とさないでください。',
    '例: 大福, どら焼き, たい焼き, 羊羹, 団子, まんじゅう, せんべい, あんみつ, ぜんざい。',
    '店名やチェーン名、メニュー名が含まれていれば候補として出してください。',
    '食べた物が短文でも、1品だけでも、食品として自然なら食事項目として扱ってください。',
    'meal_label は短く自然な日本語にしてください。',
    'food_items には重複なくまとめてください。',
    '必ずJSONだけを返してください。',
    '',
    `食事文章: ${text}`,
  ].join('\n');

  const parsed = await generateJsonOnly(prompt, schema, 0.2);

  const fallbackFoods = [
    '大福', 'まんじゅう', '饅頭', 'どら焼き', 'たい焼き', 'おはぎ', '羊羹', 'ようかん',
    '最中', 'もなか', '団子', 'だんご', 'せんべい', '煎餅', 'あんみつ', 'ぜんざい',
    '和菓子', 'あんこ', 'もち', '餅', '柏餅', '桜餅', 'みたらし団子',
    'ケーキ', 'チョコ', 'クッキー', 'アイス', 'ヨーグルト', 'バナナ', 'りんご',
  ];

  if ((!parsed.food_items || parsed.food_items.length === 0) && String(text || '').trim()) {
    const hit = fallbackFoods.find((x) => String(text).includes(x));
    if (hit) {
      return {
        restaurant_name_candidate: null,
        restaurant_confidence: null,
        menu_name_candidate: hit,
        menu_confidence: 0.7,
        cuisine_type: '間食',
        visual_evidence: '文章内の食品名から推定',
        meal_label: hit,
        food_items: [{ name: hit, estimated_amount: '1個', estimated_kcal: hit === '大福' ? 120 : 100 }],
        estimated_kcal: hit === '大福' ? 120 : 100,
        kcal_min: hit === '大福' ? 90 : 70,
        kcal_max: hit === '大福' ? 180 : 150,
        protein_g: null,
        fat_g: null,
        carbs_g: null,
        confidence: 0.6,
        ai_comment: `${hit}として読み取りました。`,
      };
    }
  }

  return {
    restaurant_name_candidate: safeText(parsed.restaurant_name_candidate, 80) || null,
    restaurant_confidence: toNumberOrNull(parsed.restaurant_confidence),
    menu_name_candidate: safeText(parsed.menu_name_candidate, 80) || null,
    menu_confidence: toNumberOrNull(parsed.menu_confidence),
    cuisine_type: safeText(parsed.cuisine_type, 50) || null,
    visual_evidence: safeText(parsed.visual_evidence, 150) || '文章内の内容から推定',
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

function seemsMealTextCandidate(text) {
  const t = String(text || '').trim();
  if (!t) return false;
  if (isHelpCommand(t.toLowerCase()) || isProfileCommand(t.toLowerCase())) return false;
  if (t.startsWith('名前') || t.startsWith('プロフィール')) return false;
  if (/(食べた|食べました|飲んだ|飲みました|朝食|昼食|夕食|間食)/.test(t)) return true;
  return MEAL_WORD_HINTS.some((w) => t.includes(w));
}

async function appendMealTextToDraft(openMealDraft, text) {
  const analysis = await analyzeMealTextWithGemini(text);
  const entry = {
    kind: 'text',
    rawText: text,
    receivedAt: new Date().toISOString(),
    analysis,
  };

  const existingEntries = Array.isArray(openMealDraft.images_json) ? openMealDraft.images_json : [];
  const allEntries = [...existingEntries, entry];
  const allAnalyses = allEntries.map((x) => x.analysis).filter(Boolean);

  const baseAnalysis = openMealDraft.merged_analysis_json || chooseBestMealAnalysis(extractMealAnalysesFromSession(openMealDraft));
  const duplicateSignal = getDuplicateMealSignal(baseAnalysis, analysis);

  if (duplicateSignal.isDuplicateLike) {
    return updateMealDraftSession(openMealDraft.id, {
      images_json: allEntries,
      image_count: allEntries.length,
      awaiting_action: 'awaiting_duplicate_decision',
      duplicate_candidate: true,
      duplicate_same_photo_candidate: false,
      status: 'draft',
      merged_analysis_json: chooseBestMealAnalysis(allAnalyses),
    });
  }

  const merged = mergeMealAnalyses(allAnalyses);
  return updateMealDraftSession(openMealDraft.id, {
    images_json: allEntries,
    image_count: allEntries.length,
    awaiting_action: 'ready_to_confirm',
    duplicate_candidate: false,
    duplicate_same_photo_candidate: false,
    status: 'ready_to_confirm',
    selected_mode: 'merge_text',
    merged_analysis_json: merged,
  });
}

async function handleMealDraftTextFlow(replyToken, user, text, openMealDraft) {
  const trimmed = String(text || '').trim();
  if (!openMealDraft) return false;

  if (trimmed === MEAL_ACTIONS.CANCEL || trimmed === 'やめる') {
    await cancelMealDraftSession(openMealDraft.id);
    await replyMessage(replyToken, '食事の下書きは取り消しました。またいつでも送ってくださいね。');
    return true;
  }

  if (trimmed === MEAL_ACTIONS.ADD_IMAGE || trimmed === '食事を追加' || trimmed === 'もう1枚追加') {
    await updateMealDraftSession(openMealDraft.id, {
      awaiting_action: 'waiting_more_image',
      status: 'draft',
    });
    await replyMessage(replyToken, 'ありがとうございます。追加の食事写真を送ってください。');
    return true;
  }

  if (trimmed === MEAL_ACTIONS.ADD_TEXT) {
    await updateMealDraftSession(openMealDraft.id, {
      awaiting_action: 'waiting_more_text',
      status: 'draft',
    });
    await replyMessage(replyToken, 'ありがとうございます。追加で食べた内容を文章で送ってください。例: ケーキ1個 / 大福1個 / 食パン1枚とチーズ1枚');
    return true;
  }

  if (trimmed === MEAL_ACTIONS.SINGLE || trimmed === 'この1枚で解析') {
    const analysis =
      openMealDraft.merged_analysis_json ||
      chooseBestMealAnalysis(extractMealAnalysesFromSession(openMealDraft));
    const updated = await updateMealDraftSession(openMealDraft.id, {
      merged_analysis_json: analysis,
      awaiting_action: 'ready_to_confirm',
      status: 'ready_to_confirm',
      selected_mode: 'single',
      duplicate_candidate: false,
      duplicate_same_photo_candidate: false,
    });
    await replyMessage(
      replyToken,
      textMessageWithQuickReplies(
        `食事内容をまとめました。\n\n${summarizeMealAnalysis(updated.merged_analysis_json)}`,
        mealConfirmButtonsForStage('ready_to_confirm')
      )
    );
    return true;
  }

  if (trimmed === MEAL_ACTIONS.SAME_PHOTO) {
    const entries = Array.isArray(openMealDraft.images_json) ? [...openMealDraft.images_json] : [];
    if (entries.length >= 2) entries.pop();
    const analyses = entries.map((x) => x.analysis).filter(Boolean);
    const analysis = chooseBestMealAnalysis(analyses);
    const updated = await updateMealDraftSession(openMealDraft.id, {
      images_json: entries,
      source_message_ids: (openMealDraft.source_message_ids || []).slice(0, Math.max((openMealDraft.source_message_ids || []).length - 1, 1)),
      image_count: entries.length || 1,
      merged_analysis_json: analysis,
      awaiting_action: 'ready_to_confirm',
      status: 'ready_to_confirm',
      selected_mode: 'same_photo_ignored',
      duplicate_candidate: false,
      duplicate_same_photo_candidate: false,
    });
    await replyMessage(
      replyToken,
      textMessageWithQuickReplies(
        `同じ写真の再送として処理しました。\n\n${summarizeMealAnalysis(updated.merged_analysis_json)}`,
        mealConfirmButtonsForStage('ready_to_confirm')
      )
    );
    return true;
  }

  if (trimmed === MEAL_ACTIONS.DUPLICATE_ANGLE || trimmed === '別角度です') {
    const analyses = extractMealAnalysesFromSession(openMealDraft);
    const analysis = chooseBestMealAnalysis(analyses);
    const updated = await updateMealDraftSession(openMealDraft.id, {
      merged_analysis_json: analysis,
      awaiting_action: 'ready_to_confirm',
      status: 'ready_to_confirm',
      selected_mode: 'duplicate_angle',
      duplicate_candidate: false,
      duplicate_same_photo_candidate: false,
    });
    await replyMessage(
      replyToken,
      textMessageWithQuickReplies(
        `同じ食事の別角度としてまとめました。\n\n${summarizeMealAnalysis(updated.merged_analysis_json)}`,
        mealConfirmButtonsForStage('ready_to_confirm')
      )
    );
    return true;
  }

  if (trimmed === MEAL_ACTIONS.EXTRA || trimmed === '追加料理あり') {
    const merged = mergeMealAnalyses(extractMealAnalysesFromSession(openMealDraft));
    const updated = await updateMealDraftSession(openMealDraft.id, {
      merged_analysis_json: merged,
      awaiting_action: 'ready_to_confirm',
      status: 'ready_to_confirm',
      selected_mode: 'merge',
      duplicate_candidate: false,
      duplicate_same_photo_candidate: false,
    });
    await replyMessage(
      replyToken,
      textMessageWithQuickReplies(
        `複数の食事情報をまとめました。\n\n${summarizeMealAnalysis(updated.merged_analysis_json)}`,
        mealConfirmButtonsForStage('ready_to_confirm')
      )
    );
    return true;
  }

  if (trimmed === MEAL_ACTIONS.SAVE || trimmed === 'この内容で食事保存') {
    const saved = await saveMealDraftToLog(openMealDraft, user);
    const daySummary = await buildDailySummary(user.id, saved.eaten_at.slice(0, 10));
    const weekly = await buildWeeklySummary(user.id, saved.eaten_at);

    const lines = [
      getMealPraiseMessage(),
      '📸 食事を記録しました。',
      `料理: ${saved.meal_label}`,
      `推定カロリー: ${formatKcalRange(saved.estimated_kcal, saved.kcal_min, saved.kcal_max)}`,
      saved.protein_g || saved.fat_g || saved.carbs_g
        ? `PFC: P${fmt(saved.protein_g)}g / F${fmt(saved.fat_g)}g / C${fmt(saved.carbs_g)}g`
        : null,
      getMealFutureLink(),
      '',
      `本日摂取合計: ${fmt(daySummary.total_intake_kcal)} kcal`,
      `今週摂取合計: ${fmt(weekly.total_intake_kcal)} kcal`,
    ].filter(Boolean);

    await replyMessage(replyToken, prefixWithName(user, lines.join('\n')));
    return true;
  }

  if (openMealDraft.awaiting_action === 'waiting_more_text' || seemsMealTextCandidate(trimmed)) {
    if (!seemsMealTextCandidate(trimmed)) {
      if (openMealDraft.awaiting_action === 'waiting_more_text') {
        await replyMessage(replyToken, '追加の食事内容が読み取れませんでした。例: ケーキ1個 / 大福1個 / 食パン1枚とチーズ1枚');
        return true;
      }
      return false;
    }

    const updated = await appendMealTextToDraft(openMealDraft, trimmed);

    if (updated.awaiting_action === 'awaiting_duplicate_decision') {
      await replyMessage(
        replyToken,
        textMessageWithQuickReplies(
          '追加した文章は、今の食事と重なっている可能性があります。どれに近いですか？',
          mealConfirmButtonsForStage('duplicate', false)
        )
      );
      return true;
    }

    await replyMessage(
      replyToken,
      textMessageWithQuickReplies(
        `追加の食事内容を反映しました。\n\n${summarizeMealAnalysis(updated.merged_analysis_json)}`,
        mealConfirmButtonsForStage('ready_to_confirm')
      )
    );
    return true;
  }

  if (openMealDraft.awaiting_action === 'waiting_more_image') {
    await replyMessage(replyToken, '追加の食事写真を待っています。写真を送るか、「文章で食事追加」「この内容で食事保存」「食事をやめる」を選んでください。');
    return true;
  }

  return false;
}

// ---------- Activity draft flow ----------
async function getOpenActivityDraft(userId) {
  const { data, error } = await supabase
    .from('activity_import_sessions')
    .select('*')
    .eq('user_id', userId)
    .eq('status', 'draft')
    .order('updated_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) throw error;
  if (!data) return null;
  if (data.expires_at && new Date(data.expires_at).getTime() < Date.now()) return null;
  return data;
}

async function createActivityDraftSession(payload) {
  const { data, error } = await supabase
    .from('activity_import_sessions')
    .insert(payload)
    .select('*')
    .single();
  if (error) throw error;
  return data;
}

async function updateActivityDraftSession(sessionId, patch) {
  const { data, error } = await supabase
    .from('activity_import_sessions')
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq('id', sessionId)
    .select('*')
    .single();
  if (error) throw error;
  return data;
}

async function cancelActivityDraftSession(sessionId) {
  const { error } = await supabase
    .from('activity_import_sessions')
    .update({
      status: 'cancelled',
      awaiting_action: null,
      updated_at: new Date().toISOString(),
    })
    .eq('id', sessionId);
  if (error) throw error;
}

function normalizeExerciseKey(label) {
  return String(label || '').toLowerCase().replace(/\s+/g, '').trim();
}

function summarizeActivityPhrases(summary) {
  return String(summary || '')
    .split(' / ')
    .map((x) => x.trim())
    .filter(Boolean);
}

function dedupeActivityPhrases(phrases = []) {
  const seen = new Set();
  const out = [];
  for (const p of phrases) {
    const key = p.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(p);
  }
  return out;
}

function mergeActivityDetails(base = [], extra = []) {
  const merged = [...(base || [])];
  for (const item of extra || []) {
    const idx = merged.findIndex((x) => normalizeExerciseKey(x?.label) === normalizeExerciseKey(item?.label));
    if (idx === -1) {
      merged.push(item);
      continue;
    }
    const prev = merged[idx];
    merged[idx] = {
      label: prev.label || item.label,
      minutes: round1((Number(prev.minutes) || 0) + (Number(item.minutes) || 0)) || null,
      reps: round0((Number(prev.reps) || 0) + (Number(item.reps) || 0)) || null,
      kcal: round1((Number(prev.kcal) || 0) + (Number(item.kcal) || 0)) || null,
    };
  }
  return merged;
}

function mergeActivityPayload(base = {}, extra = {}) {
  const mergedDetails = mergeActivityDetails(
    base.raw_detail_json?.activity_items || [],
    extra.raw_detail_json?.activity_items || []
  );

  const summarySet = dedupeActivityPhrases([
    ...summarizeActivityPhrases(base.exercise_summary),
    ...summarizeActivityPhrases(extra.exercise_summary),
  ]);

  return {
    steps: round0((Number(base.steps) || 0) + (Number(extra.steps) || 0)) || null,
    walking_minutes: round1((Number(base.walking_minutes) || 0) + (Number(extra.walking_minutes) || 0)) || null,
    estimated_activity_kcal: null,
    exercise_summary: summarySet.length ? summarySet.join(' / ') : null,
    raw_detail_json: {
      activity_items: mergedDetails,
    },
  };
}

function formatActivityDraftSummary(activity) {
  const items = Array.isArray(activity?.raw_detail_json?.activity_items)
    ? activity.raw_detail_json.activity_items
    : [];

  const detailLines = items
    .slice(0, 8)
    .map((item) => {
      if (item.minutes != null) return `${item.label}: ${fmt(item.minutes)}分`;
      if (item.reps != null) return `${item.label}: ${fmt(item.reps)}回`;
      return item.label;
    });

  const lines = [
    '今日の運動内容をまとめました。',
    activity.steps ? `歩数: ${fmt(activity.steps)} 歩` : null,
    activity.walking_minutes ? `歩行・散歩: ${fmt(activity.walking_minutes)} 分` : null,
    activity.exercise_summary ? `運動メモ: ${activity.exercise_summary}` : null,
    detailLines.length ? `内訳: ${detailLines.join(' / ')}` : null,
    activity.estimated_activity_kcal != null ? `推定活動消費: ${fmt(activity.estimated_activity_kcal)} kcal` : null,
    '',
    'この内容で保存しますか？追加があれば続けて送れます。',
  ].filter(Boolean);

  return lines.join('\n');
}

async function saveActivityDraftToLog(session, user) {
  const pending = session?.pending_activity_json || {};
  const insertPayload = {
    user_id: user.id,
    logged_at: toIsoStringInTZ(new Date(), TZ),
    steps: toNumberOrNull(pending.steps),
    walking_minutes: toNumberOrNull(pending.walking_minutes),
    estimated_activity_kcal: toNumberOrNull(pending.estimated_activity_kcal),
    exercise_summary: safeText(pending.exercise_summary || '', 1000) || null,
    raw_detail_json: pending.raw_detail_json || null,
  };

  const { error } = await supabase.from('activity_logs').insert(insertPayload);
  if (error) throw error;

  await updateActivityDraftSession(session.id, {
    status: 'confirmed',
    awaiting_action: null,
  });

  return insertPayload;
}

function calcGenericExerciseKcal(label, minutes, reps, weightKg) {
  const weight = Number(weightKg) || 60;
  const lower = String(label || '').toLowerCase();

  if (minutes != null) {
    if (lower.includes('ジョギング') || lower.includes('ランニング')) return round1(minutes * weight * 0.09);
    if (lower.includes('ウォーキング') || lower.includes('散歩') || lower.includes('歩行')) return round1(minutes * weight * 0.035);
    if (lower.includes('自転車')) return round1(minutes * weight * 0.06);
    if (lower.includes('階段')) return round1(minutes * weight * 0.08);
    if (lower.includes('ストレッチ') || lower.includes('ヨガ') || lower.includes('体操')) return round1(minutes * weight * 0.025);
    if (lower.includes('プランク') || lower.includes('体幹')) return round1(minutes * weight * 0.05);
    return round1(minutes * weight * 0.045);
  }

  if (reps != null) {
    if (lower.includes('スクワット')) return round1(reps * 0.32);
    if (lower.includes('腹筋')) return round1(reps * 0.25);
    if (lower.includes('膝つき腕立て')) return round1(reps * 0.28);
    if (lower.includes('腕立て')) return round1(reps * 0.4);
    if (lower.includes('もも上げ')) return round1(reps * 0.18);
    if (lower.includes('開脚')) return round1(reps * 0.08);
    if (lower.includes('階段')) return round1(reps * 0.45);
    return round1(reps * 0.15);
  }

  return null;
}

function parseGenericActivityItems(text, weightKg) {
  const t = String(text || '');
  const items = [];

  const minutePatterns = [
    { regex: /(スロージョギング)\s*([0-9]+(?:\.[0-9]+)?)\s*分/i },
    { regex: /(ジョギング)\s*([0-9]+(?:\.[0-9]+)?)\s*分/i },
    { regex: /(ランニング)\s*([0-9]+(?:\.[0-9]+)?)\s*分/i },
    { regex: /(散歩)\s*([0-9]+(?:\.[0-9]+)?)\s*分/i },
    { regex: /(ウォーキング)\s*([0-9]+(?:\.[0-9]+)?)\s*分/i },
    { regex: /(歩行)\s*([0-9]+(?:\.[0-9]+)?)\s*分/i },
    { regex: /(自転車)\s*([0-9]+(?:\.[0-9]+)?)\s*分/i },
    { regex: /(階段)\s*([0-9]+(?:\.[0-9]+)?)\s*分/i },
    { regex: /(ストレッチ)\s*([0-9]+(?:\.[0-9]+)?)\s*分/i },
    { regex: /(ヨガ)\s*([0-9]+(?:\.[0-9]+)?)\s*分/i },
    { regex: /(ラジオ体操)\s*([0-9]+(?:\.[0-9]+)?)\s*分/i },
    { regex: /(体操)\s*([0-9]+(?:\.[0-9]+)?)\s*分/i },
    { regex: /(プランク)\s*([0-9]+(?:\.[0-9]+)?)\s*分/i },
    { regex: /(体幹)\s*([0-9]+(?:\.[0-9]+)?)\s*分/i },
  ];

  for (const p of minutePatterns) {
    const m = t.match(p.regex);
    if (!m) continue;
    const label = String(m[1]).trim();
    const minutes = toNumberOrNull(m[2]);
    items.push({
      label,
      minutes,
      reps: null,
      kcal: calcGenericExerciseKcal(label, minutes, null, weightKg),
    });
  }

  const repPatterns = [
    { regex: /(スクワット)\s*([0-9]+(?:\.[0-9]+)?)\s*回/i },
    { regex: /(腹筋)\s*([0-9]+(?:\.[0-9]+)?)\s*回/i },
    { regex: /(膝つき腕立て)\s*([0-9]+(?:\.[0-9]+)?)\s*回/i },
    { regex: /(腕立て)\s*([0-9]+(?:\.[0-9]+)?)\s*回/i },
    { regex: /(もも上げ)\s*([0-9]+(?:\.[0-9]+)?)\s*回/i },
    { regex: /(開脚)\s*([0-9]+(?:\.[0-9]+)?)\s*回/i },
    { regex: /(階段)\s*([0-9]+(?:\.[0-9]+)?)\s*段/i },
  ];

  for (const p of repPatterns) {
    const m = t.match(p.regex);
    if (!m) continue;
    const label = String(m[1]).trim();
    const reps = toNumberOrNull(m[2]);
    items.push({
      label,
      minutes: null,
      reps,
      kcal: calcGenericExerciseKcal(label, null, reps, weightKg),
    });
  }

  if (!items.length) {
    if (/少し歩/i.test(t) || /ちょっと歩/i.test(t) || /買い物で.*歩/i.test(t) || /結構歩/i.test(t)) {
      items.push({
        label: '歩行',
        minutes: 10,
        reps: null,
        kcal: calcGenericExerciseKcal('歩行', 10, null, weightKg),
      });
    } else if (/階段を使/i.test(t)) {
      items.push({
        label: '階段',
        minutes: 3,
        reps: null,
        kcal: calcGenericExerciseKcal('階段', 3, null, weightKg),
      });
    } else if (/ストレッチした|伸ばした|ほぐした/i.test(t)) {
      items.push({
        label: 'ストレッチ',
        minutes: 5,
        reps: null,
        kcal: calcGenericExerciseKcal('ストレッチ', 5, null, weightKg),
      });
    } else if (/ヨガした/i.test(t)) {
      items.push({
        label: 'ヨガ',
        minutes: 10,
        reps: null,
        kcal: calcGenericExerciseKcal('ヨガ', 10, null, weightKg),
      });
    } else if (/プランクした/i.test(t)) {
      items.push({
        label: 'プランク',
        minutes: 1,
        reps: null,
        kcal: calcGenericExerciseKcal('プランク', 1, null, weightKg),
      });
    } else if (/ジョギングした|走った/i.test(t)) {
      items.push({
        label: 'ジョギング',
        minutes: 10,
        reps: null,
        kcal: calcGenericExerciseKcal('ジョギング', 10, null, weightKg),
      });
    } else if (/スクワットした/i.test(t)) {
      items.push({
        label: 'スクワット',
        minutes: null,
        reps: 5,
        kcal: calcGenericExerciseKcal('スクワット', null, 5, weightKg),
      });
    } else if (/腹筋した/i.test(t)) {
      items.push({
        label: '腹筋',
        minutes: null,
        reps: 5,
        kcal: calcGenericExerciseKcal('腹筋', null, 5, weightKg),
      });
    } else if (/腕立てした/i.test(t)) {
      items.push({
        label: '腕立て',
        minutes: null,
        reps: 3,
        kcal: calcGenericExerciseKcal('腕立て', null, 3, weightKg),
      });
    }
  }

  return items;
}

function parseActivity(text, weightKg = 60) {
  const steps = toNumberOrNull(findNumber(text, /歩数\s*([0-9]+(?:\.[0-9]+)?)/i));
  const walkingMinutes = toNumberOrNull(findNumber(text, /(散歩|歩行|ウォーキング)\s*([0-9]+(?:\.[0-9]+)?)\s*分/i, 2));
  const explicitKcal = toNumberOrNull(findNumber(text, /(消費|活動消費)\s*([0-9]+(?:\.[0-9]+)?)/i, 2));

  const activityItems = parseGenericActivityItems(text, weightKg);
  const summary = activityItems
    .map((x) => x.minutes != null ? `${x.label} ${fmt(x.minutes)}分` : x.reps != null ? `${x.label} ${fmt(x.reps)}回` : x.label)
    .filter(Boolean)
    .join(' / ');

  const itemKcal = activityItems.reduce((sum, x) => sum + (Number(x.kcal) || 0), 0);

  return {
    steps,
    walking_minutes: walkingMinutes,
    estimated_activity_kcal: explicitKcal != null ? explicitKcal : round1(itemKcal || 0) || null,
    exercise_summary: summary || null,
    raw_detail_json: {
      activity_items: activityItems,
    },
  };
}

function estimateActivityKcal(steps, walkingMinutes, weightKg) {
  const weight = weightKg || 60;
  const stepKcal = steps ? Number(steps) * 0.04 : 0;
  const walkKcal = walkingMinutes ? Number(walkingMinutes) * (weight * 0.035) : 0;
  return round1(Math.max(stepKcal, walkKcal));
}

function estimateActivityKcalWithStrength(steps, walkingMinutes, weightKg, rawDetail = {}) {
  const base = Number(estimateActivityKcal(steps, walkingMinutes, weightKg)) || 0;
  const items = Array.isArray(rawDetail?.activity_items) ? rawDetail.activity_items : [];
  const detailKcal = items.reduce((sum, item) => sum + (Number(item?.kcal) || 0), 0);
  return round1(base + detailKcal);
}

async function handleActivityDraftTextFlow(replyToken, user, text, openActivityDraft) {
  const trimmed = String(text || '').trim();

  if (!openActivityDraft) return false;

  if (trimmed === ACTIVITY_ACTIONS.CANCEL || trimmed === 'やめる') {
    await cancelActivityDraftSession(openActivityDraft.id);
    await replyMessage(replyToken, '運動の下書きは取り消しました。またできた時に教えてくださいね。');
    return true;
  }

  if (trimmed === ACTIVITY_ACTIONS.ADD || trimmed === '追加あり') {
    await updateActivityDraftSession(openActivityDraft.id, { awaiting_action: 'waiting_more_input' });
    await replyMessage(replyToken, 'ありがとうございます。追加の運動内容を送ってください。例: ジョギング 10分 / ストレッチ 5分 / スクワット 5回');
    return true;
  }

  if (trimmed === ACTIVITY_ACTIONS.SAVE || trimmed === '今日ここまでで保存') {
    const saved = await saveActivityDraftToLog(openActivityDraft, user);
    const level = chooseExerciseLevel(saved);
    const replySet = buildExerciseReplySet({
      aiType: user.ai_type || 'gentle',
      category: chooseExercisePraiseCategory(saved),
      level,
    });

    await replyMessage(
      replyToken,
      prefixWithName(user, [
        replySet.praise,
        '活動を記録しました。',
        saved.exercise_summary ? `内容: ${saved.exercise_summary}` : null,
        saved.steps ? `歩数: ${fmt(saved.steps)} 歩` : null,
        saved.walking_minutes ? `歩行・散歩: ${fmt(saved.walking_minutes)} 分` : null,
        saved.estimated_activity_kcal != null ? `推定活動消費: ${fmt(saved.estimated_activity_kcal)} kcal` : null,
        replySet.blood,
        replySet.progress,
      ].filter(Boolean).join('\n'))
    );
    return true;
  }

  if (openActivityDraft.awaiting_action === 'waiting_more_input' || isActivityCommand(trimmed.toLowerCase())) {
    const extra = parseActivity(trimmed, user.weight_kg || 60);
    const hasExtra =
      extra.steps != null ||
      extra.walking_minutes != null ||
      extra.estimated_activity_kcal != null ||
      extra.exercise_summary;

    if (!hasExtra) {
      if (openActivityDraft.awaiting_action === 'waiting_more_input') {
        await replyMessage(replyToken, '追加の運動内容が読み取れませんでした。例: ジョギング 10分 / ストレッチ 5分 / スクワット 5回 / 少し歩いた');
        return true;
      }
      return false;
    }

    const current = openActivityDraft.pending_activity_json || {};
    const merged = mergeActivityPayload(current, extra);

    const recalculated = estimateActivityKcalWithStrength(
      merged.steps,
      merged.walking_minutes,
      user.weight_kg || 60,
      merged.raw_detail_json || {}
    );

    merged.estimated_activity_kcal = round1(Math.max(recalculated || 0, 0));

    const updated = await updateActivityDraftSession(openActivityDraft.id, {
      pending_activity_json: merged,
      awaiting_action: null,
    });

    await replyMessage(
      replyToken,
      textMessageWithQuickReplies(
        formatActivityDraftSummary(updated.pending_activity_json),
        [ACTIVITY_ACTIONS.SAVE, ACTIVITY_ACTIONS.ADD, ACTIVITY_ACTIONS.CANCEL]
      )
    );
    return true;
  }

  return false;
}

// ---------- Blood support ----------
function evaluateBloodTrendMode(savedRow, recentRows) {
  const previous = (recentRows || []).find((r) => formatDateOnly(r.measured_at) !== formatDateOnly(savedRow.measured_at));
  if (!previous) return 'stable';

  const rules = [
    { key: 'hba1c', better: 'lower' },
    { key: 'ldl', better: 'lower' },
    { key: 'fasting_glucose', better: 'lower' },
    { key: 'triglycerides', better: 'lower' },
    { key: 'uric_acid', better: 'lower' },
    { key: 'creatinine', better: 'lower' },
    { key: 'hdl', better: 'higher' },
  ];

  let improved = 0;
  let worsened = 0;

  for (const rule of rules) {
    const curr = toNumberOrNull(savedRow?.[rule.key]);
    const prev = toNumberOrNull(previous?.[rule.key]);
    if (curr == null || prev == null || curr === prev) continue;

    if (rule.better === 'lower') {
      if (curr < prev) improved += 1;
      else worsened += 1;
    } else {
      if (curr > prev) improved += 1;
      else worsened += 1;
    }
  }

  if (improved > worsened) return 'positive';
  if (worsened > improved) return 'careful';
  return 'stable';
}

function buildEnhancedBloodSaveMessage(savedRow, recentRows) {
  const comparisonText = buildPostSaveComparisonMessage(savedRow, recentRows);
  const mode = evaluateBloodTrendMode(savedRow, recentRows);
  const parts = buildBloodExamCommentParts(mode);

  return [
    parts.opening,
    '',
    comparisonText,
    '',
    parts.body,
    parts.medical,
    parts.daily,
    parts.future1,
    parts.future3,
    parts.next,
  ].filter(Boolean).join('\n');
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
  const nowIso = new Date().toISOString();
  const currentImage = {
    kind: 'image',
    messageId,
    receivedAt: nowIso,
    analysis,
  };

  const openMealDraft = await getOpenMealDraft(user.id);

  if (!openMealDraft) {
    const session = await createMealDraftSession({
      user_id: user.id,
      line_user_id: user.line_user_id,
      status: 'draft',
      awaiting_action: 'initial_decision',
      selected_mode: null,
      source_message_ids: [messageId],
      images_json: [currentImage],
      merged_analysis_json: analysis,
      image_count: 1,
      duplicate_candidate: false,
      duplicate_same_photo_candidate: false,
      expires_at: new Date(Date.now() + 30 * 60 * 1000).toISOString(),
    });

    await replyMessage(
      replyToken,
      textMessageWithQuickReplies(
        `${prefixWithName(user, '食事写真を受け取りました。')}\n\n${summarizeMealAnalysis(session.merged_analysis_json)}\n\n今回の食事はこの1枚ですか？`,
        mealConfirmButtonsForStage('single')
      )
    );
    return;
  }

  const existingEntries = Array.isArray(openMealDraft.images_json) ? openMealDraft.images_json : [];
  const allEntries = [...existingEntries, currentImage];
  const allAnalyses = allEntries.map((x) => x.analysis).filter(Boolean);
  const baseAnalysis = openMealDraft.merged_analysis_json || chooseBestMealAnalysis(extractMealAnalysesFromSession(openMealDraft));
  const duplicateSignal = getDuplicateMealSignal(baseAnalysis, analysis);

  if (duplicateSignal.isDuplicateLike) {
    await updateMealDraftSession(openMealDraft.id, {
      images_json: allEntries,
      source_message_ids: [...new Set([...(openMealDraft.source_message_ids || []), messageId])],
      image_count: allEntries.length,
      awaiting_action: 'awaiting_duplicate_decision',
      duplicate_candidate: true,
      duplicate_same_photo_candidate: duplicateSignal.isSamePhotoLike,
      status: 'draft',
      merged_analysis_json: chooseBestMealAnalysis(allAnalyses),
    });

    const duplicateGuide = duplicateSignal.isSamePhotoLike
      ? '追加の写真は、同じ写真の再送か同じ食事の別角度の可能性があります。どれに近いですか？'
      : '追加の写真は、同じ食事の別角度の可能性があります。どれに近いですか？';

    await replyMessage(
      replyToken,
      textMessageWithQuickReplies(
        `${prefixWithName(user, '追加の食事写真を受け取りました。')}\n${duplicateGuide}`,
        mealConfirmButtonsForStage('duplicate', duplicateSignal.isSamePhotoLike)
      )
    );
    return;
  }

  const merged = mergeMealAnalyses(allAnalyses);
  const updated = await updateMealDraftSession(openMealDraft.id, {
    images_json: allEntries,
    source_message_ids: [...new Set([...(openMealDraft.source_message_ids || []), messageId])],
    image_count: allEntries.length,
    awaiting_action: 'ready_to_confirm',
    duplicate_candidate: false,
    duplicate_same_photo_candidate: false,
    status: 'ready_to_confirm',
    selected_mode: 'merge',
    merged_analysis_json: merged,
  });

  await replyMessage(
    replyToken,
    textMessageWithQuickReplies(
      `${prefixWithName(user, '追加の食事写真をまとめました。')}\n\n${summarizeMealAnalysis(updated.merged_analysis_json)}`,
      mealConfirmButtonsForStage('ready_to_confirm')
    )
  );
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
  await replyMessage(
    replyToken,
    textMessageWithQuickReplies(
      text,
      buildLabQuickReplyMain(items, dates.length > 1)
    )
  );
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
    prefixWithName(user, [
      '⚖️ 体組成計の画像として記録しました。',
      insertPayload.weight_kg ? `体重: ${fmt(insertPayload.weight_kg)} kg` : null,
      insertPayload.body_fat_percent ? `体脂肪率: ${fmt(insertPayload.body_fat_percent)} %` : null,
      insertPayload.bmi ? `BMI: ${fmt(insertPayload.bmi)}` : null,
      analysis.ai_comment || null,
    ].filter(Boolean).join('\n'))
  );
}

async function handleOtherImage({ replyToken, user, buffer, mime, hint }) {
  const comment = await chatAboutOtherImage(user, buffer, mime, hint);
  await replyMessage(replyToken, prefixWithName(user, comment));
}

// ---------- Gemini ----------
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
      restaurant_name_candidate: { type: 'string' },
      restaurant_confidence: { type: 'number' },
      menu_name_candidate: { type: 'string' },
      menu_confidence: { type: 'number' },
      cuisine_type: { type: 'string' },
      visual_evidence: { type: 'string' },
      brand_text_detected: { type: 'string' },
      portion_comment: { type: 'string' },
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
    '写真の料理を、主食・主菜・副菜・飲み物・調味料に分ける意識でできるだけ分解して見積もってください。',
    'food_items には、見えている料理や食材を重複なく整理してください。',
    '同じ写真内の同じ料理を二重計上しないでください。',
    '店名ロゴ、皿の文字、パッケージ文字、特徴的な盛り付け、料理の構成から、店名候補やメニュー候補があれば出してください。',
    '店名候補やメニュー候補は断定ではなく候補として返してください。',
    'visual_evidence には、そう判断した根拠を短く書いてください。',
    '食器サイズ、トレー、カトラリー、手などから量の目安を推定してください。',
    '見えにくい油・ソース・ドレッシング・砂糖入り飲料は過小評価しないでください。',
    '外食・揚げ物・炒め物は、kcal_min と kcal_max をやや広めに取ってください。',
    'meal_label は短く自然な日本語で返してください。',
    'confidence は 0.0〜1.0 です。',
    'ai_comment は利用者向けにやさしく一言で返してください。',
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
    restaurant_name_candidate: safeText(parsed.restaurant_name_candidate, 80) || null,
    restaurant_confidence: toNumberOrNull(parsed.restaurant_confidence),
    menu_name_candidate: safeText(parsed.menu_name_candidate, 80) || null,
    menu_confidence: toNumberOrNull(parsed.menu_confidence),
    cuisine_type: safeText(parsed.cuisine_type, 50) || null,
    visual_evidence: safeText(parsed.visual_evidence || parsed.brand_text_detected || parsed.portion_comment, 180) || null,
    brand_text_detected: safeText(parsed.brand_text_detected, 80) || null,
    portion_comment: safeText(parsed.portion_comment, 80) || null,
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
                creatinine: { type: 'string' },
              },
            },
          },
          required: ['date', 'items'],
        },
      },
      notes: { type: 'string' },
    },
    required: ['dates', 'panels'],
  };

  const prompt = [
    'あなたは日本の健診結果・血液検査画像を読み取るアシスタントです。',
    '画像内に複数の日付がある場合は dates にすべて入れてください。',
    'panels には日付ごとの検査結果を入れてください。',
    '読める項目だけ拾ってください。読めない項目は無理に埋めないでください。',
    '数値は文字列で返してください。',
    '対象項目: hba1c, fasting_glucose, ldl, hdl, triglycerides, ast, alt, ggt, uric_acid, creatinine',
    '日付は YYYY-MM-DD に正規化してください。',
    '必ずJSONだけを返してください。',
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

// ---------- Lab flow ----------
function normalizeLabQuickReplyInput(text) {
  const t = String(text || '').trim();
  if (/^\d{4}[/-]\d{1,2}[/-]\d{1,2}$/.test(t)) return t.replace(/\//g, '-');
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
    'クレアチニンを修正': 'creatinine',
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
      const hasMultipleDates = getPanelDateKeys(updated).length > 1;
      const saveLabel = hasMultipleDates ? 'この日だけ保存' : 'この内容で保存';

      await replyMessage(
        replyToken,
        textMessageWithQuickReplies(
          `ありがとうございます。修正しました。\n\n${summary}`,
          [saveLabel, ...buildLabQuickReplyMain(items, hasMultipleDates).filter((x) => x !== saveLabel)]
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
        const hasMultipleDates = getPanelDateKeys(updated).length > 1;

        await replyMessage(
          replyToken,
          textMessageWithQuickReplies(
            summary,
            buildLabQuickReplyMain(items, hasMultipleDates)
          )
        );
        return true;
      }
    }

    const selectedDate = openDraft.selected_date || getPanelDateKeys(openDraft)[0];

    if (trimmed === 'この内容で保存' || trimmed === 'この日だけ保存') {
      await confirmLabDraftToResults(supabase, openDraft, selectedDate);

      const recentRows = await getRecentLabResults(supabase, user.id, 10);
      const savedRow =
        recentRows.find((r) => String(r.measured_at).slice(0, 10) === String(selectedDate).slice(0, 10)) || {
          measured_at: selectedDate,
          ...(openDraft.working_data_json?.[selectedDate] || {}),
        };

      const message = buildEnhancedBloodSaveMessage(savedRow, recentRows);
      await replyMessage(
        replyToken,
        textMessageWithQuickReplies(
          message,
          ['HbA1c推移', 'LDL推移', '血糖推移', '尿酸推移', 'クレアチニン推移']
        )
      );
      return true;
    }

    if (trimmed === '読み取れた日付を全部保存') {
      await confirmAllLabDraftToResults(supabase, openDraft);

      const totalCount = Object.keys(openDraft.working_data_json || {}).length;
      await replyMessage(
        replyToken,
        textMessageWithQuickReplies(
          `読み取れた ${totalCount} 件の日付をまとめて保存しました。\nこれで過去からの流れも見やすくなりますね。`,
          ['HbA1c推移', 'LDL推移', '血糖推移', '尿酸推移', 'クレアチニン推移']
        )
      );
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

// ---------- Draft priority ----------
function getDraftTimestamp(draft) {
  if (!draft) return 0;
  return new Date(draft.updated_at || draft.created_at || 0).getTime();
}

function chooseActiveDraftType(text, drafts) {
  const trimmed = String(text || '').trim();

  if (
    [
      MEAL_ACTIONS.SINGLE,
      MEAL_ACTIONS.ADD_IMAGE,
      MEAL_ACTIONS.ADD_TEXT,
      MEAL_ACTIONS.CANCEL,
      MEAL_ACTIONS.DUPLICATE_ANGLE,
      MEAL_ACTIONS.SAME_PHOTO,
      MEAL_ACTIONS.EXTRA,
      MEAL_ACTIONS.SAVE,
    ].includes(trimmed)
  ) return 'meal';

  if (
    [
      ACTIVITY_ACTIONS.SAVE,
      ACTIVITY_ACTIONS.ADD,
      ACTIVITY_ACTIONS.CANCEL,
    ].includes(trimmed)
  ) return 'activity';

  if (trimmed === '追加あり' || trimmed === 'やめる') {
    const mealTs = getDraftTimestamp(drafts.meal);
    const activityTs = getDraftTimestamp(drafts.activity);
    if (activityTs >= mealTs) return drafts.activity ? 'activity' : drafts.meal ? 'meal' : null;
    return drafts.meal ? 'meal' : drafts.activity ? 'activity' : null;
  }

  if (drafts.lab?.active_item_name) return 'lab';

  const candidates = [
    drafts.lab ? { type: 'lab', ts: getDraftTimestamp(drafts.lab) } : null,
    drafts.meal ? { type: 'meal', ts: getDraftTimestamp(drafts.meal) } : null,
    drafts.activity ? { type: 'activity', ts: getDraftTimestamp(drafts.activity) } : null,
  ].filter(Boolean);

  if (!candidates.length) return null;

  candidates.sort((a, b) => b.ts - a.ts);
  return candidates[0].type;
}

// ---------- Parse / commands ----------
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
    uric_acid: /(尿酸|ua)\s*([0-9]+(?:\.[0-9]+)?)/i,
    creatinine: /(クレアチニン|creatinine|cre)\s*([0-9]+(?:\.[0-9]+)?)/i,
  };

  const result = {};
  for (const [key, regex] of Object.entries(map)) {
    const value = findNumber(text, regex, regex.source.includes('|') ? 2 : 1);
    if (value != null) result[key] = value;
  }
  return result;
}

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
  return EXERCISE_WORD_HINTS.some((w) => text.includes(w)) || text.includes('歩数') || text.includes('消費');
}
function isSleepCommand(text) {
  return text.includes('睡眠');
}
function isHydrationCommand(text) {
  return text.includes('水分');
}
function isLabCommand(text) {
  return text.includes('血液') || text.includes('hba1c') || text.includes('ldl') || text.includes('hdl') || text.includes('tg') || text.includes('尿酸') || text.includes('クレアチニン');
}
function isBmrCommand(text) {
  return text.includes('基礎代謝') || text.includes('bmr');
}
function isLabHistoryCommand(text) {
  return ['hba1c推移', 'ldl推移', '血糖推移', '尿酸推移', 'クレアチニン推移'].some((x) => text.includes(x));
}
function isExerciseMenuCommand(text) {
  return text.includes('運動メニュー') || text.includes('今日の運動') || text.includes('運動提案');
}

function getLabHistoryConfig(text) {
  const normalized = String(text || '').trim().toLowerCase();
  if (normalized.includes('hba1c推移')) return { key: 'hba1c', label: 'HbA1c' };
  if (normalized.includes('ldl推移')) return { key: 'ldl', label: 'LDL' };
  if (normalized.includes('血糖推移')) return { key: 'fasting_glucose', label: '血糖' };
  if (normalized.includes('尿酸推移')) return { key: 'uric_acid', label: '尿酸' };
  if (normalized.includes('クレアチニン推移')) return { key: 'creatinine', label: 'クレアチニン' };
  return null;
}

function helpMessage() {
  return [
    '使い方の例です。',
    '・名前 牛込公一',
    '・初回診断',
    '・体重 68.2',
    '・体重 68.2 体脂肪 24.1 BMI 22.4',
    '・ジョギング 20分',
    '・ストレッチ 5分',
    '・プランク 1分',
    '・スクワット 10回',
    '・腹筋 5回',
    '・膝つき腕立て 3回',
    '・歩数 8234 散歩 45分',
    '・少し歩いた',
    '・睡眠 6.5時間',
    '・水分 1.5L',
    '・血液 HbA1c 6.1 LDL 140 HDL 52 TG 180 尿酸 5.8 クレアチニン 0.78',
    '・朝食 食パン1枚 チーズ1枚 コーヒー',
    '・大福1個食べた',
    '・HbA1c推移 / LDL推移 / 血糖推移 / 尿酸推移 / クレアチニン推移',
    '・運動メニュー',
    '・プロフィール 性別 女性 年齢 55 身長 160 体重 63 目標体重 58',
    '・週報 / 月報',
    '・食事写真 / 血液検査画像 / 体重計画像も送れます',
  ].join('\n');
}

function profileGuideMessage() {
  return '例: プロフィール 性別 女性 年齢 55 身長 160 体重 63 目標体重 58';
}

// ---------- Text flow ----------
async function handleTextMessage(event, user) {
  const text = String(event.message.text || '').trim();
  const lower = text.toLowerCase();

  try {
    const parsedName = parseDisplayName(text);
    if (parsedName) {
      const { error } = await supabase
        .from('users')
        .update({ display_name: parsedName })
        .eq('id', user.id);
      if (error) throw error;
      await replyMessage(event.replyToken, `${parsedName}さんですね。これからはそうお呼びします。`);
      return;
    }

    const openLabDraft = await getOpenLabDraft(supabase, user.id);
    const openMealDraft = await getOpenMealDraft(user.id);
    const openActivityDraft = await getOpenActivityDraft(user.id);

    const activeDraftType = chooseActiveDraftType(text, {
      lab: openLabDraft,
      meal: openMealDraft,
      activity: openActivityDraft,
    });

    if (activeDraftType === 'lab') {
      const consumed = await handleLabDraftTextFlow(event.replyToken, user, text, openLabDraft);
      if (consumed) return;
    }

    if (activeDraftType === 'meal') {
      const consumed = await handleMealDraftTextFlow(event.replyToken, user, text, openMealDraft);
      if (consumed) return;
    }

    if (activeDraftType === 'activity') {
      const consumed = await handleActivityDraftTextFlow(event.replyToken, user, text, openActivityDraft);
      if (consumed) return;
    }

    const consumedByIntake = await handleIntakeTextFlow(event.replyToken, user, text);
    if (consumedByIntake) return;

    if (isExerciseMenuCommand(lower)) {
      const prompt = getExercisePromptMessage(user.ai_type || 'gentle');
      const menu = getDailyMenuSuggestion(guessExerciseMenuLevel(user));
      await replyMessage(event.replyToken, prefixWithName(user, [prompt, menu].filter(Boolean).join('\n')));
      return;
    }

    if (text === '運動してない' || text === '今日は運動してない') {
      await replyMessage(event.replyToken, prefixWithName(user, getSoftNudgeMessage(user.ai_type || 'gentle')));
      return;
    }

    if (isLabHistoryCommand(lower)) {
      const historyConfig = getLabHistoryConfig(text);
      if (!historyConfig) {
        await replyMessage(
          event.replyToken,
          '使い方の例:\n・HbA1c推移\n・LDL推移\n・血糖推移\n・尿酸推移\n・クレアチニン推移'
        );
        return;
      }

      const rows = await getRecentLabResults(supabase, user.id, 10);
      const historyText = buildLabHistoryText(rows, historyConfig.key, historyConfig.label);
      await replyMessage(event.replyToken, historyText);
      return;
    }

    if (isHelpCommand(lower)) {
      await replyMessage(event.replyToken, helpMessage());
      return;
    }

    if (isWeeklyReportCommand(lower)) {
      const summary = await buildWeeklySummary(user.id, toIsoStringInTZ(new Date(), TZ));
      const assessment = await buildWeeklyAssessment(user.id, summary);
      await replyMessage(event.replyToken, prefixWithName(user, formatWeeklyReply(summary, assessment)));
      return;
    }

    if (isMonthlyReportCommand(lower)) {
      const summary = await buildMonthlySummary(user.id, toIsoStringInTZ(new Date(), TZ));
      await replyMessage(event.replyToken, prefixWithName(user, formatMonthlyReply(summary)));
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
      await replyMessage(event.replyToken, prefixWithName(user, 'プロフィールを更新しました。'));
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
      await replyMessage(event.replyToken, prefixWithName(user, '体重・体脂肪率などを記録しました。'));
      return;
    }

    if (isActivityCommand(lower)) {
      const activity = parseActivity(text, user.weight_kg || 60);
      if (
        !activity.steps &&
        !activity.walking_minutes &&
        !activity.estimated_activity_kcal &&
        !activity.exercise_summary
      ) {
        await replyMessage(event.replyToken, '例: ジョギング 20分 / ストレッチ 5分 / スクワット 10回 / 少し歩いた');
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

      const draft = await createActivityDraftSession({
        user_id: user.id,
        line_user_id: user.line_user_id,
        status: 'draft',
        awaiting_action: null,
        source_message_ids: [],
        pending_activity_json: activity,
        expires_at: new Date(Date.now() + 12 * 60 * 60 * 1000).toISOString(),
      });

      await replyMessage(
        event.replyToken,
        textMessageWithQuickReplies(
          formatActivityDraftSummary(draft.pending_activity_json),
          [ACTIVITY_ACTIONS.SAVE, ACTIVITY_ACTIONS.ADD, ACTIVITY_ACTIONS.CANCEL]
        )
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
      sleep.sleep_date = currentDateYmdInTZ();
      const { error } = await supabase.from('sleep_logs').insert(sleep);
      if (error) throw error;
      await replyMessage(event.replyToken, prefixWithName(user, `睡眠を記録しました。${fmt(sleep.sleep_hours)}時間ですね。`));
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
      await replyMessage(event.replyToken, prefixWithName(user, `水分補給を記録しました。${fmt(hydration.water_ml)} ml です。`));
      return;
    }

    if (isLabCommand(lower)) {
      const lab = parseLabValues(text);
      if (Object.keys(lab).length === 0) {
        await replyMessage(
          event.replyToken,
          '例: 血液 HbA1c 6.1 LDL 140 HDL 52 TG 180 AST 28 ALT 35 γGT 40 尿酸 5.8 クレアチニン 0.78'
        );
        return;
      }
      lab.user_id = user.id;
      lab.measured_at = toIsoStringInTZ(new Date(), TZ);
      const { error } = await supabase.from('lab_results').insert(lab);
      if (error) throw error;
      await replyMessage(
        event.replyToken,
        textMessageWithQuickReplies(prefixWithName(user, '血液検査の値を記録しました。'), ['HbA1c推移', 'LDL推移', '血糖推移', '尿酸推移', 'クレアチニン推移'])
      );
      return;
    }

    if (isBmrCommand(lower)) {
      const bmr = calculateBMR(user);
      if (!bmr) {
        await replyMessage(event.replyToken, '基礎代謝の計算には、性別・年齢・身長・体重の登録が必要です。\n例: プロフィール 性別 女性 年齢 55 身長 160 体重 63');
        return;
      }
      await replyMessage(event.replyToken, prefixWithName(user, `推定基礎代謝は ${fmt(bmr)} kcal/日 です。`));
      return;
    }

    if (seemsMealTextCandidate(text)) {
      const analysis = await analyzeMealTextWithGemini(text);
      const session = await createMealDraftSession({
        user_id: user.id,
        line_user_id: user.line_user_id,
        status: 'ready_to_confirm',
        awaiting_action: 'ready_to_confirm',
        selected_mode: 'text_only',
        source_message_ids: [],
        images_json: [{
          kind: 'text',
          rawText: text,
          receivedAt: new Date().toISOString(),
          analysis,
        }],
        merged_analysis_json: analysis,
        image_count: 1,
        duplicate_candidate: false,
        duplicate_same_photo_candidate: false,
        expires_at: new Date(Date.now() + 30 * 60 * 1000).toISOString(),
      });

      await replyMessage(
        event.replyToken,
        textMessageWithQuickReplies(
          `${prefixWithName(user, '食事内容を読み取りました。')}\n\n${summarizeMealAnalysis(session.merged_analysis_json)}`,
          mealConfirmButtonsForStage('ready_to_confirm')
        )
      );
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

// ---------- Utility prompts ----------
function buildAiTypePrompt(aiType) {
  if (aiType === 'energetic') return '話し方は少し前向きで明るく、背中を押す雰囲気にしてください。';
  if (aiType === 'analytical') return '話し方は落ち着いて、理由や傾向をわかりやすく伝えてください。';
  if (aiType === 'casual') return '話し方は親しみやすく、気軽に話せる雰囲気にしてください。';
  return '話し方はやさしく包み込むように、安心感を大切にしてください。';
}

// ---------- General chat ----------
async function defaultChatReply(user, userText) {
  const memoryHint = await getMemoryHint(user.id);
  const name = getUserDisplayName(user);
  const prompt = [
    AI_BASE_PROMPT,
    buildAiTypePrompt(user.ai_type),
    name ? `利用者の呼び名: ${name}さん` : '',
    memoryHint ? `利用者について覚えていること: ${memoryHint}` : '',
    '次の利用者メッセージに、自然でやさしく、聞き役として返してください。',
    '強い断定や説教はしないでください。',
    `利用者メッセージ: ${userText}`,
  ].filter(Boolean).join('\n\n');

  const reply = await generateTextOnly(prompt);
  await saveMemoryCandidate(user.id, userText);
  return prefixWithName(user, reply);
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

async function saveMemoryCandidate(userId, userText) {
  const simpleRules = [
    { type: 'food', pattern: /(甘い物|ケーキ|チョコ|お菓子|大福|どら焼き)/, value: '甘い物が好きそう' },
    { type: 'exercise', pattern: /(散歩|ウォーキング|スクワット|腹筋|腕立て|ジョギング|ランニング|ストレッチ)/, value: '運動を少しずつ続けられそう' },
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
        // ignore
      }
      return;
    }
  }
}

// ---------- Misc helpers ----------
function chooseExercisePraiseCategory(activity) {
  const total = (Number(activity.steps) || 0) + (Number(activity.walking_minutes) || 0) + (Number(activity.estimated_activity_kcal) || 0);
  if (activity.exercise_summary && total > 0) return 'praise_done';
  if (activity.exercise_summary || (Number(activity.walking_minutes) || 0) > 0) return 'praise_small';
  return 'praise_done';
}

function chooseExerciseLevel(activity) {
  const steps = Number(activity.steps) || 0;
  const walk = Number(activity.walking_minutes) || 0;
  const kcal = Number(activity.estimated_activity_kcal) || 0;
  const hasStrength = !!activity.exercise_summary;

  if (steps >= 8000 || walk >= 30 || kcal >= 250) return 'active';
  if (steps >= 4000 || walk >= 15 || kcal >= 120 || hasStrength) return 'moderate';
  if (steps >= 1500 || walk >= 5) return 'easy';
  return 'starter';
}

function guessExerciseMenuLevel(user) {
  if (!user) return 'starter';
  if (user.ai_type === 'energetic') return 'easy';
  return 'starter';
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

function currentDateYmdInTZ() {
  return toIsoStringInTZ(new Date()).slice(0, 10);
}

function toIsoStringInTZ(date) {
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

// ---------- Reports ----------
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

  return {
    total_intake_kcal: round1(sumBy(mealsRes.data || [], 'estimated_kcal')),
    total_activity_kcal: round1(sumBy(actsRes.data || [], 'estimated_activity_kcal')),
    steps: round0(sumBy(actsRes.data || [], 'steps')),
    walking_minutes: round0(sumBy(actsRes.data || [], 'walking_minutes')),
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

  const startIso = toIsoStringInTZ(startDate);
  const endIso = toIsoStringInTZ(endDate);

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

  const startIso = toIsoStringInTZ(start);
  const endIso = toIsoStringInTZ(end);

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

// ---------- Prompt load ----------
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

// ---------- Retry ----------
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
