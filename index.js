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
} = require('./utils/dates');

const env = getEnv();
const app = express();
const PORT = env.PORT;
const TZ = env.TZ;

const AI_PROMPT_PATH = './prompts/ai_ushigome_prompt.txt';

const recentMealDrafts = new Map();
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
    '今はテキスト、食事写真、血液検査画像を中心に対応しています。',
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

function helpMessage() {
  return [
    '使い方の例です。',
    '・名前は 牛込',
    '・初回診断',
    '・プロフィール 性別 女性 年齢 55 身長 160 体重 63 目標体重 58 活動量 ふつう',
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

function sumBy(arr, key) {
  return (arr || []).reduce((sum, row) => sum + (Number(row?.[key]) || 0), 0);
}

function buildDailySeries(rows, field, days = 7) {
  const today = new Date();
  const map = new Map();

  for (let i = days - 1; i >= 0; i -= 1) {
    const d = new Date(today);
    d.setDate(today.getDate() - i);
    const ymd = d.toISOString().slice(0, 10);
    map.set(ymd, 0);
  }

  for (const row of rows || []) {
    const dt = String(row?.[field] || '').slice(0, 10);
    if (!map.has(dt)) continue;
    const prev = map.get(dt) || 0;
    map.set(dt, prev + (Number(row?.estimated_kcal || row?.estimated_activity_kcal || 0) || 0));
  }

  return Array.from(map.entries()).map(([date, value]) => ({ date, value }));
}

async function getTodayEnergyTotals(userId) {
  const dateYmd = currentDateYmdInTZ(TZ);
  const start = `${dateYmd}T00:00:00+09:00`;
  const end = `${dateYmd}T23:59:59+09:00`;

  const [mealsRes, actsRes] = await Promise.all([
    supabase.from('meal_logs').select('estimated_kcal').eq('user_id', userId).gte('eaten_at', start).lte('eaten_at', end),
    supabase.from('activity_logs').select('estimated_activity_kcal').eq('user_id', userId).gte('logged_at', start).lte('logged_at', end),
  ]);

  if (mealsRes.error) throw mealsRes.error;
  if (actsRes.error) throw actsRes.error;

  return {
    intake_kcal: sumBy(mealsRes.data || [], 'estimated_kcal'),
    activity_kcal: sumBy(actsRes.data || [], 'estimated_activity_kcal'),
  };
}

async function getSevenDayEnergyRows(userId) {
  const dateTo = currentDateYmdInTZ(TZ);
  const endDate = new Date(`${dateTo}T23:59:59+09:00`);
  const startDate = new Date(endDate);
  startDate.setDate(endDate.getDate() - 6);

  const startIso = startDate.toISOString();
  const endIso = endDate.toISOString();

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

  const intakeSeries = buildDailySeries(mealsRes.data || [], 'eaten_at', 7);
  const activitySeries = buildDailySeries(actsRes.data || [], 'logged_at', 7);

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

      await replyMessage(event.replyToken, `${safeName}さんですね。これからはそうお呼びします。`, env.LINE_CHANNEL_ACCESS_TOKEN);
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
        await replyMessage(
          event.replyToken,
          prefixWithName(user, '初回設定が完了しました。ここから一緒に整えていきましょうね。'),
          env.LINE_CHANNEL_ACCESS_TOKEN
        );
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
      await replyMessage(event.replyToken, prefixWithName(refreshedUser, buildProfileReply(refreshedUser)), env.LINE_CHANNEL_ACCESS_TOKEN);
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

      await replyMessage(
        event.replyToken,
        textMessageWithQuickReplies(prefixWithName(user, `${lines.join('\n')}\n\n${energyText}`), [...buildExerciseFollowupQuickReplies(), '予測', 'グラフ']),
        env.LINE_CHANNEL_ACCESS_TOKEN
      );
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

        await replyMessage(
          event.replyToken,
          buildLabSaveMessage(savedRow, recentRows),
          env.LINE_CHANNEL_ACCESS_TOKEN
        );
        return;
      }

      if (['読み取れた日付を全部保存', '一括保存', 'まとめて保存', '全部保存'].includes(text)) {
        const savedRows = await confirmAllLabDraftToResults(supabase, openLabDraft);
        const count = Array.isArray(savedRows) ? savedRows.length : 0;

        await replyMessage(
          event.replyToken,
          [
            `読み取れた日付をまとめて保存しました。`,
            count ? `保存件数: ${count}件` : null,
            '血液検査グラフでも確認できます。',
          ].filter(Boolean).join('\n'),
          env.LINE_CHANNEL_ACCESS_TOKEN
        );
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
      await replyMessage(event.replyToken, prefixWithName(user, `ありがとうございます。\n${CONSULT_MESSAGE}`), env.LINE_CHANNEL_ACCESS_TOKEN);
      return;
    }

    if (text === 'グラフ') {
      await replyMessage(
        event.replyToken,
        textMessageWithQuickReplies(prefixWithName(user, '見たいグラフを選んでください。'), buildGraphMenuQuickReplies()),
        env.LINE_CHANNEL_ACCESS_TOKEN
      );
      return;
    }

    if (text === '食事活動グラフ') {
      const dayRows = await getSevenDayEnergyRows(user.id);
      const graph = buildEnergyGraphMessage(dayRows);
      const messages = [textMessageWithQuickReplies(prefixWithName(user, graph.text), ['予測', '血液検査グラフ', '今日はここまで'])];
      if (graph.messages.length) messages.push(...graph.messages);
      await replyMessage(event.replyToken, messages, env.LINE_CHANNEL_ACCESS_TOKEN);
      return;
    }

    if (text === '血液検査グラフ' || text === 'HbA1cグラフ' || text === 'LDLグラフ') {
      const recentRows = await getRecentLabResults(supabase, user.id, 12);
      const metric = text === 'LDLグラフ' ? 'ldl' : 'hba1c';
      const graph = buildLabGraphMessage(recentRows, metric);
      const messages = [textMessageWithQuickReplies(prefixWithName(user, graph.text), ['HbA1cグラフ', 'LDLグラフ', '食事活動グラフ', '予測'])];
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
        textMessageWithQuickReplies(prefixWithName(user, prediction.text), [...prediction.quickReplies, 'グラフ']),
        env.LINE_CHANNEL_ACCESS_TOKEN
      );
      return;
    }

    if (text === '体重推移を見たい') {
      await replyMessage(
        event.replyToken,
        prefixWithName(user, '体重グラフは、次に体重履歴保存を入れると見られるようになります。今は血液検査グラフと食事活動グラフが使えます。'),
        env.LINE_CHANNEL_ACCESS_TOKEN
      );
      return;
    }

    if (text === '血液検査の流れを見たい') {
      const recentRows = await getRecentLabResults(supabase, user.id, 12);
      const graph = buildLabGraphMessage(recentRows, 'hba1c');
      const messages = [textMessageWithQuickReplies(prefixWithName(user, graph.text), ['LDLグラフ', '食事活動グラフ', '予測'])];
      if (graph.messages.length) messages.push(...graph.messages);
      await replyMessage(event.replyToken, messages, env.LINE_CHANNEL_ACCESS_TOKEN);
      return;
    }

    if (isVideoIntent(text)) {
      clearMealDraft(user.line_user_id);
      const area = contextArea || detectPainArea(text);
      setSupportContext(user.line_user_id, { area, mode: 'video' });

      const videoResponse = buildVideoSupportResponse(area);
      await replyMessage(
        event.replyToken,
        textMessageWithQuickReplies(prefixWithName(user, videoResponse.text), videoResponse.quickReplies),
        env.LINE_CHANNEL_ACCESS_TOKEN
      );
      return;
    }

    if (text === '1分メニュー') {
      clearMealDraft(user.line_user_id);
      const area = contextArea || '全身';
      const menu = buildExerciseMenuResponse(area, '1min');
      await replyMessage(
        event.replyToken,
        textMessageWithQuickReplies(prefixWithName(user, menu.text), menu.quickReplies),
        env.LINE_CHANNEL_ACCESS_TOKEN
      );
      return;
    }

    if (text === '3分メニュー') {
      clearMealDraft(user.line_user_id);
      const area = contextArea || '全身';
      const menu = buildExerciseMenuResponse(area, '3min');
      await replyMessage(
        event.replyToken,
        textMessageWithQuickReplies(prefixWithName(user, menu.text), menu.quickReplies),
        env.LINE_CHANNEL_ACCESS_TOKEN
      );
      return;
    }

    if (text === 'やさしい版') {
      clearMealDraft(user.line_user_id);
      const area = contextArea || '全身';
      const menu = buildExerciseMenuResponse(area, 'gentle');
      await replyMessage(
        event.replyToken,
        textMessageWithQuickReplies(prefixWithName(user, menu.text), menu.quickReplies),
        env.LINE_CHANNEL_ACCESS_TOKEN
      );
      return;
    }

    if (text === '説明だけ聞く') {
      clearMealDraft(user.line_user_id);
      const area = contextArea || '全身';
      const menu = buildExerciseMenuResponse(area, 'explain');
      await replyMessage(
        event.replyToken,
        textMessageWithQuickReplies(prefixWithName(user, menu.text), menu.quickReplies),
        env.LINE_CHANNEL_ACCESS_TOKEN
      );
      return;
    }

    if (isStretchIntent(text) || text === 'ストレッチしたい') {
      clearMealDraft(user.line_user_id);
      const area = contextArea || detectPainArea(text);
      setSupportContext(user.line_user_id, { area, mode: 'stretch' });

      const stretchResponse = buildStretchSupportResponse(area);
      await replyMessage(
        event.replyToken,
        textMessageWithQuickReplies(prefixWithName(user, stretchResponse.message), [...stretchResponse.quickReplies, '動画で見たい']),
        env.LINE_CHANNEL_ACCESS_TOKEN
      );
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

      await replyMessage(
        event.replyToken,
        textMessageWithQuickReplies(prefixWithName(user, message), ['できた', 'まだ少しやる', '動画で見たい', '今日はここまで']),
        env.LINE_CHANNEL_ACCESS_TOKEN
      );
      return;
    }

    if (['朝から重い', '座るとつらい', '少し動くと楽', '歩くとつらい'].includes(text)) {
      clearMealDraft(user.line_user_id);
      const area = contextArea || '全身';
      const followup = buildPainSituationResponse(text, area);

      if (followup) {
        await replyMessage(
          event.replyToken,
          textMessageWithQuickReplies(prefixWithName(user, followup.message), followup.quickReplies),
          env.LINE_CHANNEL_ACCESS_TOKEN
        );
        return;
      }
    }

    if (isPainLikeText(text)) {
      clearMealDraft(user.line_user_id);
      const area = detectPainArea(text);
      setSupportContext(user.line_user_id, { area, mode: 'pain' });

      const painResponse = buildPainSupportResponse(text, area);
      await replyMessage(
        event.replyToken,
        textMessageWithQuickReplies(prefixWithName(user, painResponse.message), [...painResponse.quickReplies, '動画で見たい']),
        env.LINE_CHANNEL_ACCESS_TOKEN
      );
      return;
    }

    if (['今日はここまで', 'まだ少しやる', 'できた', '次の食事を記録', '少し歩いた', '股関節を整えたい', '腰が重い'].includes(text)) {
      if (text === '今日はここまで') {
        await replyMessage(event.replyToken, prefixWithName(user, '今日はここまでで大丈夫です。小さく続けることが一番力になります。'), env.LINE_CHANNEL_ACCESS_TOKEN);
        return;
      }

      if (text === 'できた') {
        await replyMessage(
          event.replyToken,
          textMessageWithQuickReplies(prefixWithName(user, 'いいですね。その一歩が次につながります。少しずつ整えていきましょう。'), ['まだ少しやる', '動画で見たい', '予測', 'グラフ', '今日はここまで']),
          env.LINE_CHANNEL_ACCESS_TOKEN
        );
        return;
      }

      if (text === 'まだ少しやる') {
        await replyMessage(
          event.replyToken,
          textMessageWithQuickReplies(prefixWithName(user, 'いい流れですね。無理なくもう少しだけいきましょう。'), ['1分メニュー', '3分メニュー', 'やさしい版', '今日はここまで']),
          env.LINE_CHANNEL_ACCESS_TOKEN
        );
        return;
      }

      if (text === '腰が重い' || text === '股関節を整えたい') {
        clearMealDraft(user.line_user_id);
        const area = text === '腰が重い' ? '腰' : '股関節';
        setSupportContext(user.line_user_id, { area, mode: 'pain' });

        const painResponse = buildPainSupportResponse(text, area);
        await replyMessage(
          event.replyToken,
          textMessageWithQuickReplies(prefixWithName(user, painResponse.message), [...painResponse.quickReplies, '動画で見たい']),
          env.LINE_CHANNEL_ACCESS_TOKEN
        );
        return;
      }

      if (text === '少し歩いた') {
        await replyMessage(event.replyToken, prefixWithName(user, '少し歩けたのは大事です。そこから代謝や流れが変わっていきます。'), env.LINE_CHANNEL_ACCESS_TOKEN);
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

      await replyMessage(
        event.replyToken,
        textMessageWithQuickReplies(prefixWithName(user, `${saveLines.join('\n')}\n\n${energyText}`), ['次の食事を記録', '少し歩いた', 'ストレッチしたい', '予測', 'グラフ']),
        env.LINE_CHANNEL_ACCESS_TOKEN
      );
      return;
    }

    if (currentMealDraft && isMealCancelCommand(text)) {
      clearMealDraft(user.line_user_id);
      await replyMessage(event.replyToken, '食事の確認中データを取り消しました。', env.LINE_CHANNEL_ACCESS_TOKEN);
      return;
    }

    if (currentMealDraft && seemsMealCorrectionText(text)) {
      const correctedMeal = await applyMealCorrection(currentMealDraft.meal, text);
      setMealDraft(user.line_user_id, correctedMeal);

      const needsDrinkCorrection = (correctedMeal.food_items || []).some((x) => x.needs_confirmation);

      await replyMessage(
        event.replyToken,
        textMessageWithQuickReplies(prefixWithName(user, buildMealCorrectionConfirmationMessage(correctedMeal)), buildMealFollowupQuickReplies(needsDrinkCorrection)),
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
        textMessageWithQuickReplies(prefixWithName(user, mealMessage), buildMealFollowupQuickReplies(needsDrinkCorrection)),
        env.LINE_CHANNEL_ACCESS_TOKEN
      );
      return;
    }

    if (text === '飲み物を訂正' || text === '量を訂正') {
      await replyMessage(event.replyToken, 'そのまま文字で教えてください。例: ジャスミンティーです / お酒ではないです / 大福は2個です', env.LINE_CHANNEL_ACCESS_TOKEN);
      return;
    }

    if (text.includes('食事') || text.includes('食べた') || text.includes('飲んだ')) {
      await replyMessage(event.replyToken, buildMealTextGuide(), env.LINE_CHANNEL_ACCESS_TOKEN);
      return;
    }

    const reply = await defaultChatReply(user, text);
    await replyMessage(event.replyToken, reply, env.LINE_CHANNEL_ACCESS_TOKEN);
  } catch (error) {
    console.error('❌ handleTextMessage error:', error?.stack || error?.message || error);
    await replyMessage(event.replyToken, '入力の処理でエラーが起きました。もう一度ゆっくり送ってください。', env.LINE_CHANNEL_ACCESS_TOKEN);
  }
}

app.listen(PORT, () => {
  console.log(`✅ Server running on port ${PORT}`);
});
