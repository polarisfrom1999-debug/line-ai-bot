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
  safeText,
  fmt,
} = require('./utils/formatters');
const {
  toIsoStringInTZ,
} = require('./utils/dates');

const env = getEnv();
const app = express();
const PORT = env.PORT;
const TZ = env.TZ;

const AI_PROMPT_PATH = './prompts/ai_ushigome_prompt.txt';

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

const AI_BASE_PROMPT = loadAiPrompt();

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

  await replyMessage(
    event.replyToken,
    '今は新しい整理版の準備中のため、まずはテキストを中心に対応しています。',
    env.LINE_CHANNEL_ACCESS_TOKEN
  );
}

function prefixWithName(user, message) {
  const name = getUserDisplayName(user);
  const text = String(message || '').trim();

  if (!text) return text;
  if (!name) return text;

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

function helpMessage() {
  return [
    '使い方の例です。',
    '・名前は 牛込',
    '・プロフィール 性別 女性 年齢 55 身長 160 体重 63 目標体重 58 活動量 ふつう',
    '・ジョギング 20分',
    '・ストレッチ 5分',
    '・スクワット 10回',
    '・腹筋 5回',
    '・膝つき腕立て 3回',
    '・歩数 8234 散歩 45分',
    '・少し歩いた',
  ].join('\n');
}

function buildAiTypePrompt(aiType) {
  if (aiType === 'energetic') return '話し方は少し前向きで明るく、背中を押す雰囲気にしてください。';
  if (aiType === 'analytical') return '話し方は落ち着いて、理由や傾向をわかりやすく伝えてください。';
  if (aiType === 'casual') return '話し方は親しみやすく、気軽に話せる雰囲気にしてください。';
  return '話し方はやさしく包み込むように、安心感を大切にしてください。';
}

async function defaultChatReply(user, userText) {
  const name = getUserDisplayName(user);
  const prompt = [
    AI_BASE_PROMPT,
    buildAiTypePrompt(user.ai_type),
    name ? `利用者の呼び名: ${name}さん` : '',
    '次の利用者メッセージに、自然でやさしく、聞き役として返してください。',
    '強い断定や説教はしないでください。',
    `利用者メッセージ: ${userText}`,
  ].filter(Boolean).join('\n\n');

  const reply = await generateTextOnly(prompt, 0.7);
  return prefixWithName(user, safeText(reply, 1800) || 'ありがとうございます。もう少し詳しく教えてくださいね。');
}

async function handleTextMessage(event, user) {
  const text = String(event.message.text || '').trim();
  const lower = text.toLowerCase();

  try {
    const parsedName = parseDisplayName(text);
    if (parsedName) {
      const safeName = normalizeStoredDisplayName(parsedName);

      if (!safeName) {
        await replyMessage(
          event.replyToken,
          'お名前の受け取りが少しあいまいでした。たとえば「名前は牛込です」のように送ってください。',
          env.LINE_CHANNEL_ACCESS_TOKEN
        );
        return;
      }

      const { error } = await supabase
        .from('users')
        .update({ display_name: safeName })
        .eq('id', user.id);

      if (error) throw error;

      await replyMessage(
        event.replyToken,
        `${safeName}さんですね。これからはそうお呼びします。`,
        env.LINE_CHANNEL_ACCESS_TOKEN
      );
      return;
    }

    if (isHelpCommand(lower)) {
      await replyMessage(event.replyToken, helpMessage(), env.LINE_CHANNEL_ACCESS_TOKEN);
      return;
    }

    if (isProfileCommand(lower)) {
      const payload = buildProfileUpdatePayload(user, text);

      if (!payload) {
        await replyMessage(event.replyToken, profileGuideMessage(), env.LINE_CHANNEL_ACCESS_TOKEN);
        return;
      }

      const { error } = await supabase
        .from('users')
        .update(payload)
        .eq('id', user.id);

      if (error) throw error;

      const refreshedUser = await refreshUserById(supabase, user.id);

      await replyMessage(
        event.replyToken,
        prefixWithName(refreshedUser, buildProfileReply(refreshedUser)),
        env.LINE_CHANNEL_ACCESS_TOKEN
      );
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
        await replyMessage(
          event.replyToken,
          '例: ジョギング 20分 / ストレッチ 5分 / スクワット 10回 / 少し歩いた',
          env.LINE_CHANNEL_ACCESS_TOKEN
        );
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

      const lines = [
        '活動を記録しました。',
        activity.exercise_summary ? `内容: ${activity.exercise_summary}` : null,
        activity.steps ? `歩数: ${fmt(activity.steps)} 歩` : null,
        activity.walking_minutes ? `歩行・散歩: ${fmt(activity.walking_minutes)} 分` : null,
        activity.estimated_activity_kcal != null ? `推定活動消費: ${fmt(activity.estimated_activity_kcal)} kcal` : null,
        '小さな運動でも、しっかり前進です。',
      ].filter(Boolean);

      await replyMessage(
        event.replyToken,
        prefixWithName(user, lines.join('\n')),
        env.LINE_CHANNEL_ACCESS_TOKEN
      );
      return;
    }

    const reply = await defaultChatReply(user, text);
    await replyMessage(event.replyToken, reply, env.LINE_CHANNEL_ACCESS_TOKEN);
  } catch (error) {
    console.error('❌ handleTextMessage error:', error?.stack || error?.message || error);
    await replyMessage(
      event.replyToken,
      '入力の処理でエラーが起きました。もう一度ゆっくり送ってください。',
      env.LINE_CHANNEL_ACCESS_TOKEN
    );
  }
}

app.listen(PORT, () => {
  console.log(`✅ Server running on port ${PORT}`);
});