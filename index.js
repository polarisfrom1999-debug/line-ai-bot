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
  safeText,
  fmt,
} = require('./utils/formatters');
const {
  toIsoStringInTZ,
  currentDateYmdInTZ,
} = require('./utils/dates');

const env = getEnv();
const app = express();
const PORT = env.PORT;
const TZ = env.TZ;

const AI_PROMPT_PATH = './prompts/ai_ushigome_prompt.txt';

// 直近の食事下書き（簡易版）
const recentMealDrafts = new Map();
// 直近の痛み/会話コンテキスト（簡易版）
const recentSupportContexts = new Map();

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

  if (event.message.type === 'image') {
    await handleImageMessage(event, user);
    return;
  }

  await replyMessage(
    event.replyToken,
    '今はテキストと食事写真を中心に対応しています。',
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

function isMealSaveCommand(text) {
  const t = String(text || '').trim();
  return [
    'この内容で食事保存',
    '食事を保存',
    '保存',
    'これで保存',
    'この内容で保存',
  ].includes(t);
}

function isMealCancelCommand(text) {
  const t = String(text || '').trim();
  return [
    '食事をキャンセル',
    '食事やめる',
    'キャンセル',
  ].includes(t);
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
    '・朝食 食パン1枚 チーズ1枚 コーヒー',
    '・大福1個食べた',
    '・ジャスミンティーを飲んだ',
    '・ジャスミンティーです',
    '・お酒ではないです',
    '・大福は2個です',
    '・この内容で食事保存',
    '・食事をキャンセル',
    '・食事写真も送れます',
    '・膝が重いです',
    '・腰が痛いです',
    '・ストレッチしたい',
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
  recentMealDrafts.set(lineUserId, {
    meal: mealResult,
    updatedAt: Date.now(),
  });
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
  recentSupportContexts.set(lineUserId, {
    ...prev,
    ...patch,
    updatedAt: Date.now(),
  });
}

function seemsMealCorrectionText(text) {
  const t = String(text || '').trim();
  if (!t) return false;

  return [
    'です',
    'ではない',
    'じゃない',
    '違います',
    'ちがいます',
    '個です',
    '杯です',
    '本です',
    'お酒ではない',
    'お茶です',
    '水です',
    'ノンアル',
    'ジャスミンティー',
    '烏龍茶',
    'ウーロン茶',
    '緑茶',
    '麦茶',
    '紅茶',
  ].some((w) => t.includes(w));
}

function sumBy(arr, key) {
  return (arr || []).reduce((sum, row) => sum + (Number(row?.[key]) || 0), 0);
}

async function getTodayEnergyTotals(userId) {
  const dateYmd = currentDateYmdInTZ(TZ);
  const start = `${dateYmd}T00:00:00+09:00`;
  const end = `${dateYmd}T23:59:59+09:00`;

  const [mealsRes, actsRes] = await Promise.all([
    supabase
      .from('meal_logs')
      .select('estimated_kcal')
      .eq('user_id', userId)
      .gte('eaten_at', start)
      .lte('eaten_at', end),
    supabase
      .from('activity_logs')
      .select('estimated_activity_kcal')
      .eq('user_id', userId)
      .gte('logged_at', start)
      .lte('logged_at', end),
  ]);

  if (mealsRes.error) throw mealsRes.error;
  if (actsRes.error) throw actsRes.error;

  return {
    intake_kcal: sumBy(mealsRes.data || [], 'estimated_kcal'),
    activity_kcal: sumBy(actsRes.data || [], 'estimated_activity_kcal'),
  };
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
      quickReplies: ['ストレッチしたい', '1分だけやる', '今日はここまで', '牛込先生に相談したい'],
    },
    '歩くとつらい': {
      message: [
        `${area}は歩くとつらいんですね。`,
        '今日は頑張って動くより、まず負担を減らしながら整える方向が良さそうです。',
        CONSULT_MESSAGE,
      ].join('\n'),
      quickReplies: ['ストレッチしたい', '少し動くと楽', '今日は休む', '牛込先生に相談したい'],
    },
    '立ち上がりでつらい': {
      message: [
        `立ち上がりで${area}がつらいんですね。`,
        area === '膝'
          ? '膝だけでなく、股関節や太もも前の硬さも関係しやすいです。'
          : '動き始めの硬さが関係しているかもしれません。',
        'まずは無理なく整える方へいきましょう。',
      ].join('\n'),
      quickReplies: ['股関節をゆるめる', 'ストレッチしたい', '今日はここまで', '牛込先生に相談したい'],
    },
    '朝から重い': {
      message: [
        `${area}が朝から重い感じなんですね。`,
        'まずは強い運動より、軽く動かして流れを作る方が合いそうです。',
        '少し整うだけでも、そのあとの歩きやすさや代謝につながりやすいです。',
      ].join('\n'),
      quickReplies: ['ストレッチしたい', '1分だけやる', '少し動くと楽', '牛込先生に相談したい'],
    },
    '座るとつらい': {
      message: [
        `座ると${area}がつらいんですね。`,
        '同じ姿勢が続いて固まりやすくなっているかもしれません。',
        '今日はやさしく動きを作る方向でいきましょう。',
      ].join('\n'),
      quickReplies: ['ストレッチしたい', '少し動くと楽', '今日はここまで', '牛込先生に相談したい'],
    },
    '開くとつらい': {
      message: [
        `${area}を開くとつらいんですね。`,
        '無理に広げすぎず、やさしく可動域を作る方向が良さそうです。',
        '少しずつ整うと歩きやすさや姿勢にもつながりやすいです。',
      ].join('\n'),
      quickReplies: ['股関節を開く', 'お尻をゆるめる', '今日は説明だけ', '牛込先生に相談したい'],
    },
    '歩幅が出ない': {
      message: [
        '歩幅が出にくいんですね。',
        '股関節やふくらはぎの硬さが関係していることもあります。',
        'そこが少し整うと、歩きやすさや活動量にもつながりやすいです。',
      ].join('\n'),
      quickReplies: ['股関節をゆるめる', 'ふくらはぎを伸ばす', 'ストレッチしたい', '牛込先生に相談したい'],
    },
    '少し硬い': {
      message: [
        `${area}が少し硬い感じなんですね。`,
        '今の段階なら、やさしく動かすだけでも十分変わりやすいです。',
        '可動域が少し広がると、動きやすさや代謝にもつながります。',
      ].join('\n'),
      quickReplies: ['ストレッチしたい', '1分だけやる', '今日は説明だけ', '牛込先生に相談したい'],
    },
    '上げるとつらい': {
      message: [
        `${area}を上げるとつらいんですね。`,
        '今日は無理に頑張らず、肩まわりや胸まわりを少しゆるめる方向が良さそうです。',
        CONSULT_MESSAGE,
      ].join('\n'),
      quickReplies: ['肩まわりをほぐす', '胸を開く', '今日は休む', '牛込先生に相談したい'],
    },
    '後ろに回しづらい': {
      message: [
        `${area}を後ろに回しづらいんですね。`,
        '肩だけでなく胸まわりの硬さも関係しやすいです。',
        'やさしく整えていきましょう。',
      ].join('\n'),
      quickReplies: ['肩まわりをほぐす', '胸を開く', '今日は説明だけ', '牛込先生に相談したい'],
    },
    '重だるい': {
      message: [
        `${area}が重だるい感じなんですね。`,
        '今日は強く頑張るより、軽く動かして流れを作る方が合いそうです。',
        '無理なくいきましょう。',
      ].join('\n'),
      quickReplies: ['ストレッチしたい', '1分だけやる', '今日はここまで', '牛込先生に相談したい'],
    },
    '肩も張る': {
      message: [
        '肩の張りもあるんですね。',
        '首肩だけでなく、胸まわりや呼吸の浅さが関係していることもあります。',
        'やさしくゆるめていきましょう。',
      ].join('\n'),
      quickReplies: ['首肩をゆるめる', '胸を開く', 'ストレッチしたい', '牛込先生に相談したい'],
    },
    '少しつらい': {
      message: [
        `${area}が少しつらいんですね。`,
        '今は無理を重ねず、軽く整える方向が良さそうです。',
        '小さく動けると、そのあとが楽になりやすいです。',
      ].join('\n'),
      quickReplies: ['ストレッチしたい', '少し動くと楽', '今日はここまで', '牛込先生に相談したい'],
    },
    '動くとつらい': {
      message: [
        `動くと${area}がつらいんですね。`,
        '今日は無理に頑張らず、負担を増やさないことを優先しましょう。',
        CONSULT_MESSAGE,
      ].join('\n'),
      quickReplies: ['今日は休む', 'ストレッチしたい', '牛込先生に相談したい'],
    },
  };

  return map[text] || null;
}

async function handleImageMessage(event, user) {
  try {
    const { buffer, mimeType } = await getLineImageContent(
      event.message.id,
      env.LINE_CHANNEL_ACCESS_TOKEN
    );

    const analyzedMeal = await analyzeMealImageWithAI(buffer, mimeType);

    if (!analyzedMeal.is_meal) {
      await replyMessage(
        event.replyToken,
        '食事写真としてはっきり読み取れませんでした。食事なら、もう少し料理や飲み物が見やすい写真を送ってください。',
        env.LINE_CHANNEL_ACCESS_TOKEN
      );
      return;
    }

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
  } catch (error) {
    console.error('❌ handleImageMessage error:', error?.stack || error?.message || error);
    await replyMessage(
      event.replyToken,
      '画像の処理でエラーが起きました。もう一度写真を送るか、食事内容を文章で送ってください。',
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

      await replyMessage(
        event.replyToken,
        textMessageWithQuickReplies(
          prefixWithName(user, `${lines.join('\n')}\n\n${energyText}`),
          buildExerciseFollowupQuickReplies()
        ),
        env.LINE_CHANNEL_ACCESS_TOKEN
      );
      return;
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

      await replyMessage(
        event.replyToken,
        textMessageWithQuickReplies(
          prefixWithName(user, `${saveLines.join('\n')}\n\n${energyText}`),
          ['次の食事を記録', '少し歩いた', 'ストレッチしたい']
        ),
        env.LINE_CHANNEL_ACCESS_TOKEN
      );
      return;
    }

    if (currentMealDraft && isMealCancelCommand(text)) {
      clearMealDraft(user.line_user_id);
      await replyMessage(
        event.replyToken,
        '食事の確認中データを取り消しました。',
        env.LINE_CHANNEL_ACCESS_TOKEN
      );
      return;
    }

    if (currentMealDraft && seemsMealCorrectionText(text)) {
      const correctedMeal = await applyMealCorrection(currentMealDraft.meal, text);
      setMealDraft(user.line_user_id, correctedMeal);

      const needsDrinkCorrection = (correctedMeal.food_items || []).some((x) => x.needs_confirmation);

      await replyMessage(
        event.replyToken,
        textMessageWithQuickReplies(
          prefixWithName(user, buildMealCorrectionConfirmationMessage(correctedMeal)),
          buildMealFollowupQuickReplies(needsDrinkCorrection)
        ),
        env.LINE_CHANNEL_ACCESS_TOKEN
      );
      return;
    }

    if (seemsMealTextCandidate(text)) {
      const analyzedMeal = await analyzeMealTextWithAI(text);
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

    if (text === '飲み物を訂正' || text === '量を訂正') {
      await replyMessage(
        event.replyToken,
        'そのまま文字で教えてください。例: ジャスミンティーです / お酒ではないです / 大福は2個です',
        env.LINE_CHANNEL_ACCESS_TOKEN
      );
      return;
    }

    if (text === '牛込先生に相談したい') {
      await replyMessage(
        event.replyToken,
        `ありがとうございます。\n${CONSULT_MESSAGE}`,
        env.LINE_CHANNEL_ACCESS_TOKEN
      );
      return;
    }

    const supportContext = getSupportContext(user.line_user_id);
    const contextArea = supportContext?.area || null;

    if (isStretchIntent(text) || text === 'ストレッチしたい') {
      const area = contextArea || detectPainArea(text);
      setSupportContext(user.line_user_id, { area, mode: 'stretch' });

      const stretchResponse = buildStretchSupportResponse(area);
      await replyMessage(
        event.replyToken,
        textMessageWithQuickReplies(
          prefixWithName(user, stretchResponse.message),
          stretchResponse.quickReplies
        ),
        env.LINE_CHANNEL_ACCESS_TOKEN
      );
      return;
    }

    if (
      ['腰まわりをやる', '股関節もやる', '股関節をゆるめる', 'ふくらはぎを伸ばす', '股関節を開く', 'お尻をゆるめる', '肩まわりをほぐす', '胸を開く', '首肩をゆるめる', '全身軽め', '1分だけやる', '今日は説明だけ'].includes(text)
    ) {
      const area = contextArea || '全身';
      const message = [
        `${text}の流れで大丈夫です。今日は無理なく、小さくで十分です。`,
        area !== '全身' ? `${area}まわりが少し整うと、動きやすさや代謝にもつながりやすいです。` : '軽く動かすだけでも、可動域や代謝の土台につながります。',
        CONSULT_MESSAGE,
      ].join('\n');

      await replyMessage(
        event.replyToken,
        textMessageWithQuickReplies(
          prefixWithName(user, message),
          ['できた', 'まだ少しやる', '今日はここまで', '牛込先生に相談したい']
        ),
        env.LINE_CHANNEL_ACCESS_TOKEN
      );
      return;
    }

    if (
      ['朝から重い', '座るとつらい', '少し動くと楽', '歩くとつらい', '立ち上がりでつらい', '開くとつらい', '歩幅が出ない', '少し硬い', '上げるとつらい', '後ろに回しづらい', '重だるい', '肩も張る', '少しつらい', '動くとつらい'].includes(text)
    ) {
      const area = contextArea || '全身';
      const followup = buildPainSituationResponse(text, area);

      if (followup) {
        await replyMessage(
          event.replyToken,
          textMessageWithQuickReplies(
            prefixWithName(user, followup.message),
            followup.quickReplies
          ),
          env.LINE_CHANNEL_ACCESS_TOKEN
        );
        return;
      }
    }

    if (isPainLikeText(text)) {
      const area = detectPainArea(text);
      setSupportContext(user.line_user_id, { area, mode: 'pain' });

      const painResponse = buildPainSupportResponse(text, area);
      await replyMessage(
        event.replyToken,
        textMessageWithQuickReplies(
          prefixWithName(user, painResponse.message),
          painResponse.quickReplies
        ),
        env.LINE_CHANNEL_ACCESS_TOKEN
      );
      return;
    }

    if (
      ['今日はここまで', 'まだ少しやる', 'できた', '次の食事を記録', '少し歩いた', '股関節を整えたい', '腰が重い'].includes(text)
    ) {
      if (text === '今日はここまで') {
        await replyMessage(
          event.replyToken,
          prefixWithName(user, '今日はここまでで大丈夫です。小さく続けることが一番力になります。'),
          env.LINE_CHANNEL_ACCESS_TOKEN
        );
        return;
      }

      if (text === 'できた') {
        await replyMessage(
          event.replyToken,
          prefixWithName(user, 'いいですね。その一歩が次につながります。少しずつ整えていきましょう。'),
          env.LINE_CHANNEL_ACCESS_TOKEN
        );
        return;
      }

      if (text === 'まだ少しやる') {
        await replyMessage(
          event.replyToken,
          textMessageWithQuickReplies(
            prefixWithName(user, 'いい流れですね。無理なくもう少しだけいきましょう。'),
            ['1分だけやる', 'ストレッチしたい', '今日はここまで']
          ),
          env.LINE_CHANNEL_ACCESS_TOKEN
        );
        return;
      }

      if (text === '腰が重い' || text === '股関節を整えたい') {
        const area = text === '腰が重い' ? '腰' : '股関節';
        setSupportContext(user.line_user_id, { area, mode: 'pain' });

        const painResponse = buildPainSupportResponse(text, area);
        await replyMessage(
          event.replyToken,
          textMessageWithQuickReplies(
            prefixWithName(user, painResponse.message),
            painResponse.quickReplies
          ),
          env.LINE_CHANNEL_ACCESS_TOKEN
        );
        return;
      }

      if (text === '少し歩いた') {
        await replyMessage(
          event.replyToken,
          prefixWithName(user, '少し歩けたのは大事です。そこから代謝や流れが変わっていきます。'),
          env.LINE_CHANNEL_ACCESS_TOKEN
        );
        return;
      }

      if (text === '次の食事を記録') {
        await replyMessage(
          event.replyToken,
          buildMealTextGuide(),
          env.LINE_CHANNEL_ACCESS_TOKEN
        );
        return;
      }
    }

    if (
      text.includes('食事') ||
      text.includes('食べた') ||
      text.includes('飲んだ')
    ) {
      await replyMessage(
        event.replyToken,
        buildMealTextGuide(),
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