'use strict';

require('dotenv').config();

const express = require('express');

const { getEnv } = require('./config/env');
const { verifyLineSignature, replyMessage, textMessageWithQuickReplies, getLineImageContent } = require('./services/line_service');
const { supabase } = require('./services/supabase_service');
const { ensureUser, refreshUserById } = require('./services/user_service');
const { analyzeNewCaptureCandidate, looksLikeProfileEditStart, isGraphIntent, isPredictionIntent, extractMinutes } = require('./services/capture_router_service');
const { analyzeChatCapture } = require('./services/chat_capture_service');
const { routeConversation } = require('./services/chatgpt_conversation_router');
const { parseWeightLog, buildWeightSaveMessage } = require('./services/weight_service');
const { buildProfileUpdatePayload, buildPartialProfileReply, profileGuideMessage } = require('./services/profile_service');
const { replyGraphIntent, replyLatestLabMetric, getMealRowsToday, getActivityRowsToday } = require('./services/graph_service');
const { buildPredictionText } = require('./services/prediction_service');
const { buildExerciseAnswer, buildMealTotalAnswer } = require('./services/energy_service');
const { analyzeMealImageWithAI } = require('./services/meal_image_ai_service');
const { analyzeMealTextWithAI, buildMealConfirmationMessage } = require('./services/meal_ai_service');
const { parseActivity, estimateActivityKcalWithStrength } = require('./parsers/activity_parser');
const { toIsoStringInTZ, currentDateYmdInTZ, buildDayRangeIsoInTZ } = require('./utils/dates');

const env = getEnv();
const app = express();
const PORT = env.PORT;
const TZ = env.TZ;

app.get('/', (_req, res) => res.status(200).send('ok'));
app.get('/healthz', (_req, res) => res.status(200).json({ ok: true, tz: TZ, now: new Date().toISOString() }));

app.post('/webhook', express.raw({ type: '*/*' }), async (req, res) => {
  const signature = req.headers['x-line-signature'];
  const rawBody = req.body;
  if (!verifyLineSignature(rawBody, signature, env.LINE_CHANNEL_SECRET)) return res.status(401).send('invalid signature');

  let body;
  try {
    body = JSON.parse(Buffer.from(rawBody).toString('utf8'));
  } catch (error) {
    console.error('❌ invalid webhook json:', error?.message || error);
    return res.status(400).send('invalid json');
  }

  const events = Array.isArray(body?.events) ? body.events : [];
  for (const event of events) {
    try {
      await processEvent(event);
    } catch (error) {
      console.error('❌ processEvent error:', error?.stack || error?.message || error);
    }
  }

  return res.status(200).send('ok');
});

async function processEvent(event = {}) {
  if (event.type !== 'message') return;
  if (!event.replyToken) return;
  const lineUserId = event?.source?.userId;
  if (!lineUserId) return;

  const user = await ensureUser(supabase, lineUserId, TZ);

  if (event.message?.type === 'text') {
    await handleTextMessage(event.replyToken, event.message.text, user, event);
    return;
  }

  if (event.message?.type === 'image') {
    await handleImageMessage(event.replyToken, user, event.message);
  }
}

function quick(text, labels = []) {
  return textMessageWithQuickReplies(text, labels);
}

function nowIso() {
  return toIsoStringInTZ(new Date(), TZ);
}

async function updateUserState(userId, nextUser = {}) {
  const patch = {
    pending_capture_type: nextUser.pending_capture_type ?? null,
    pending_capture_status: nextUser.pending_capture_status ?? null,
    pending_capture_payload: nextUser.pending_capture_payload ?? null,
    pending_capture_missing_fields: nextUser.pending_capture_missing_fields ?? null,
    pending_capture_prompt: nextUser.pending_capture_prompt ?? null,
    pending_capture_started_at: nextUser.pending_capture_started_at ?? null,
    pending_capture_source_text: nextUser.pending_capture_source_text ?? null,
    pending_capture_attempts: Number(nextUser.pending_capture_attempts || 0),
  };

  const extraKeys = ['weight_kg', 'body_fat_pct', 'sex', 'age', 'height_cm', 'target_weight_kg', 'activity_level', 'estimated_bmr', 'estimated_tdee'];
  for (const key of extraKeys) {
    if (Object.prototype.hasOwnProperty.call(nextUser, key)) patch[key] = nextUser[key];
  }

  const { error } = await supabase.from('users').update(patch).eq('id', userId);
  if (error) console.warn('⚠️ updateUserState failed:', error.message);
}

async function handleImageMessage(replyToken, user, message = {}) {
  const nextUser = {
    ...user,
    pending_capture_type: 'image_context',
    pending_capture_status: 'awaiting_clarification',
    pending_capture_payload: { line_message_id: message.id },
    pending_capture_prompt: '画像の種類を選んでください。',
    pending_capture_started_at: nowIso(),
    pending_capture_attempts: 1,
  };
  await updateUserState(user.id, nextUser);
  await replyMessage(replyToken, quick('写真を受け取りました。種類に近いものを選んでください。', ['食事の写真です', '血液検査です', '相談したい']), env.LINE_CHANNEL_ACCESS_TOKEN);
}

async function saveWeightAndBodyFat(user, payload = {}) {
  const weight = Number(payload.weight_kg);
  const bodyFat = payload.body_fat_pct == null ? null : Number(payload.body_fat_pct);

  if (Number.isFinite(weight)) {
    const insertPayload = { user_id: user.id, weight_kg: weight, body_fat_pct: Number.isFinite(bodyFat) ? bodyFat : null };
    insertPayload.logged_at = nowIso();
    let { error } = await supabase.from('weight_logs').insert(insertPayload);
    if (error && /logged_at/i.test(error.message || '')) {
      delete insertPayload.logged_at;
      const retry = await supabase.from('weight_logs').insert(insertPayload);
      error = retry.error;
    }
    if (error) throw error;
  }

  await updateUserState(user.id, {
    ...user,
    ...(Number.isFinite(weight) ? { weight_kg: weight } : {}),
    ...(Number.isFinite(bodyFat) ? { body_fat_pct: bodyFat } : {}),
  });
}

async function saveMealToLog(userId, meal) {
  const insertPayload = {
    user_id: userId,
    eaten_at: nowIso(),
    meal_label: meal.meal_label || '食事',
    food_items: Array.isArray(meal.food_items) ? meal.food_items : [],
    estimated_kcal: meal.estimated_kcal ?? null,
    kcal_min: meal.kcal_min ?? null,
    kcal_max: meal.kcal_max ?? null,
    protein_g: meal.protein_g ?? null,
    fat_g: meal.fat_g ?? null,
    carbs_g: meal.carbs_g ?? null,
    confidence: meal.confidence ?? null,
    ai_comment: meal.ai_comment || '食事を保存しました。',
    raw_model_json: meal,
  };
  const { error } = await supabase.from('meal_logs').insert(insertPayload);
  if (error) throw error;
}

async function saveActivityToLog(user, activity) {
  const insertPayload = {
    user_id: user.id,
    logged_at: nowIso(),
    steps: activity.steps || null,
    walking_minutes: activity.walking_minutes || activity.minutes || null,
    estimated_activity_kcal: activity.estimated_activity_kcal || activity.kcal || null,
    exercise_summary: activity.exercise_summary || activity.summary || null,
    raw_detail_json: activity.raw_detail_json || {},
  };
  const { error } = await supabase.from('activity_logs').insert(insertPayload);
  if (error) throw error;
}

async function todayTotals(userId) {
  const today = currentDateYmdInTZ(TZ);
  const { startIso, endIso } = buildDayRangeIsoInTZ(today, TZ);
  const [mealRows, activityRows] = await Promise.all([
    getMealRowsToday(userId, startIso, endIso),
    getActivityRowsToday(userId, startIso, endIso),
  ]);
  return {
    intakeKcal: mealRows.reduce((sum, row) => sum + (Number(row.estimated_kcal) || 0), 0),
    activityKcal: activityRows.reduce((sum, row) => sum + (Number(row.estimated_activity_kcal) || 0), 0),
  };
}

async function handleImageFollowup(replyToken, user, rawText) {
  const kind = rawText.trim();
  const payload = user.pending_capture_payload || {};
  const messageId = payload.line_message_id;
  if (!messageId) return false;

  if (kind.includes('食事')) {
    try {
      const { buffer, mimeType } = await getLineImageContent(messageId, env.LINE_CHANNEL_ACCESS_TOKEN);
      const meal = await analyzeMealImageWithAI(buffer, mimeType);
      if (!meal?.is_meal) {
        await replyMessage(replyToken, quick('食事写真としては読み取りにくかったので、内容を一言もらえればそのまま整えます。', []), env.LINE_CHANNEL_ACCESS_TOKEN);
      } else {
        await saveMealToLog(user.id, meal);
        await replyMessage(replyToken, quick(buildMealConfirmationMessage(meal), ['今日一日の食事の総カロリー計算して', '違います']), env.LINE_CHANNEL_ACCESS_TOKEN);
      }
    } catch (error) {
      console.error('❌ meal image handling failed:', error?.message || error);
      await replyMessage(replyToken, quick('食事写真は受け取れました。今は画像整理で少しつまずいているので、料理名を一言もらえれば続けます。', []), env.LINE_CHANNEL_ACCESS_TOKEN);
    }
    await updateUserState(user.id, { ...user, pending_capture_type: null, pending_capture_status: null, pending_capture_payload: null, pending_capture_prompt: null, pending_capture_started_at: null, pending_capture_attempts: 0 });
    return true;
  }

  if (kind.includes('血液検査')) {
    await updateUserState(user.id, { ...user, pending_capture_type: 'lab_context', pending_capture_status: 'active', pending_capture_payload: { from_image: true }, pending_capture_prompt: null, pending_capture_started_at: nowIso(), pending_capture_attempts: 0 });
    await replyMessage(replyToken, quick('ありがとうございます。血液検査として見ます。HbA1cやLDLなど、見たい項目をそのまま送ってください。', ['HbA1cグラフ', 'LDLグラフ']), env.LINE_CHANNEL_ACCESS_TOKEN);
    return true;
  }

  if (kind.includes('相談')) {
    await updateUserState(user.id, { ...user, pending_capture_type: null, pending_capture_status: null, pending_capture_payload: null, pending_capture_prompt: null, pending_capture_started_at: null, pending_capture_attempts: 0 });
    await replyMessage(replyToken, quick('ありがとうございます。相談の写真として見ます。気になる場所や、いつからかを一言だけ続けてください。', []), env.LINE_CHANNEL_ACCESS_TOKEN);
    return true;
  }
  return false;
}

async function handleTextMessage(replyToken, text, user, event = {}) {
  const rawText = String(text || '').trim();
  if (!rawText) return;

  const freshUser = await refreshUserById(supabase, user.id).catch(() => user);

  if (freshUser.pending_capture_type === 'image_context') {
    const handled = await handleImageFollowup(replyToken, freshUser, rawText);
    if (handled) return;
  }

  if (freshUser.pending_capture_type === 'profile_edit') {
    if (rawText === '完了') {
      await updateUserState(freshUser.id, { ...freshUser, pending_capture_type: null, pending_capture_status: null, pending_capture_payload: null, pending_capture_prompt: null, pending_capture_started_at: null, pending_capture_attempts: 0 });
      await replyMessage(replyToken, quick('プロフィール変更を閉じました。必要な時にまたそのまま送ってくださいね。', []), env.LINE_CHANNEL_ACCESS_TOKEN);
      return;
    }
    const patch = buildProfileUpdatePayload(freshUser, rawText);
    if (patch) {
      const merged = { ...freshUser, ...patch };
      await updateUserState(freshUser.id, { ...merged, pending_capture_type: 'profile_edit', pending_capture_status: 'active' });
      await replyMessage(replyToken, quick(buildPartialProfileReply(patch, merged), ['完了']), env.LINE_CHANNEL_ACCESS_TOKEN);
      return;
    }
    await replyMessage(replyToken, quick('変えたい項目だけ送ってください。例: 年齢 55 / 目標 58 / 活動量 ふつう', ['完了']), env.LINE_CHANNEL_ACCESS_TOKEN);
    return;
  }

  if (looksLikeProfileEditStart(rawText)) {
    await updateUserState(freshUser.id, { ...freshUser, pending_capture_type: 'profile_edit', pending_capture_status: 'active', pending_capture_prompt: profileGuideMessage(), pending_capture_started_at: nowIso(), pending_capture_attempts: 0 });
    await replyMessage(replyToken, quick(profileGuideMessage(), ['体重 62', '身長 160', '年齢 55', '目標 58', '完了']), env.LINE_CHANNEL_ACCESS_TOKEN);
    return;
  }

  if (/^(hba1c|ldl).*(グラフ)?$/i.test(rawText) || /^(hba1c|ldl)は\??$/i.test(rawText) || /(HbA1c|LDL)は？?/.test(rawText)) {
    if (/グラフ/i.test(rawText) || /グラフ/.test(rawText)) {
      const result = await replyGraphIntent(freshUser, rawText);
      const messages = [quick(result.text, []), ...(result.messages || [])].slice(0, 5);
      await replyMessage(replyToken, messages, env.LINE_CHANNEL_ACCESS_TOKEN);
      return;
    }
    const answer = await replyLatestLabMetric(freshUser, rawText);
    await replyMessage(replyToken, quick(answer, [/hba1c/i.test(rawText) ? 'HbA1cグラフ' : 'LDLグラフ']), env.LINE_CHANNEL_ACCESS_TOKEN);
    return;
  }

  if (isGraphIntent(rawText)) {
    const result = await replyGraphIntent(freshUser, rawText);
    const messages = [quick(result.text, []), ...(result.messages || [])].slice(0, 5);
    await replyMessage(replyToken, messages, env.LINE_CHANNEL_ACCESS_TOKEN);
    return;
  }

  if (isPredictionIntent(rawText)) {
    const totals = await todayTotals(freshUser.id).catch(() => ({ intakeKcal: 0, activityKcal: 0 }));
    const prediction = buildPredictionText({
      estimatedTdee: freshUser.estimated_tdee || 0,
      intakeKcal: totals.intakeKcal,
      activityKcal: totals.activityKcal,
      currentWeightKg: freshUser.weight_kg || null,
    });
    await replyMessage(replyToken, quick(prediction.text, prediction.quickReplies || []), env.LINE_CHANNEL_ACCESS_TOKEN);
    return;
  }

  if (/今日.*食事.*総.*カロリー|総カロリー計算|今日一日.*食事/.test(rawText)) {
    const totals = await todayTotals(freshUser.id).catch(() => ({ intakeKcal: 0 }));
    await replyMessage(replyToken, quick(buildMealTotalAnswer(totals.intakeKcal), []), env.LINE_CHANNEL_ACCESS_TOKEN);
    return;
  }

  if (/何キロカロリー|何kcal|何カロリー/.test(rawText) && /(ジョギング|ランニング|走|歩|ウォーキング)/.test(rawText)) {
    const activity = parseActivity(rawText, freshUser.weight_kg || 60);
    const kcal = activity.estimated_activity_kcal || estimateActivityKcalWithStrength(activity.steps, activity.walking_minutes, freshUser.weight_kg || 60, activity.raw_detail_json || {});
    await replyMessage(replyToken, quick(`今の見立てだと、${activity.exercise_summary || 'その運動'}は ${kcal || 0} kcal 前後です。`, []), env.LINE_CHANNEL_ACCESS_TOKEN);
    return;
  }

  const weightParsed = parseWeightLog(rawText);
  if (weightParsed?.weight_kg != null || weightParsed?.body_fat_pct != null) {
    try {
      await saveWeightAndBodyFat(freshUser, weightParsed);
      const msg = buildWeightSaveMessage(weightParsed);
      await replyMessage(replyToken, quick(msg.text, msg.quickReplies || []), env.LINE_CHANNEL_ACCESS_TOKEN);
      return;
    } catch (error) {
      console.error('❌ saveWeightAndBodyFat error:', error?.message || error);
      await updateUserState(freshUser.id, { ...freshUser, ...(weightParsed.weight_kg != null ? { weight_kg: weightParsed.weight_kg } : {}), ...(weightParsed.body_fat_pct != null ? { body_fat_pct: weightParsed.body_fat_pct } : {}) });
      const msg = buildWeightSaveMessage(weightParsed);
      await replyMessage(replyToken, quick(`数字は受け取れました。保存で少しつまずいているので、まずは\n${msg.text}`, msg.quickReplies || []), env.LINE_CHANNEL_ACCESS_TOKEN);
      return;
    }
  }

  if (/私の体重覚えてる/.test(rawText)) {
    const conversation = await routeConversation({ currentUserText: rawText, text: rawText, context: freshUser });
    await replyMessage(replyToken, quick(conversation.replyText, ['体重グラフ', '予測']), env.LINE_CHANNEL_ACCESS_TOKEN);
    return;
  }

  if (/今日.*ジョギング|ジョギングした|ランニングした|歩いた|ウォーキングした|散歩した|筋トレした|ストレッチした/.test(rawText) && !/[?？]/.test(rawText)) {
    const activity = parseActivity(rawText, freshUser.weight_kg || 60);
    if (!activity.exercise_summary && !activity.walking_minutes && !activity.estimated_activity_kcal) {
      await updateUserState(freshUser.id, { ...freshUser, pending_capture_type: 'exercise_minutes', pending_capture_status: 'active', pending_capture_payload: { source_text: rawText }, pending_capture_started_at: nowIso() });
      await replyMessage(replyToken, quick('運動の内容は受け取れています。時間か距離がわかれば、そのまま続けて教えてくださいね。', []), env.LINE_CHANNEL_ACCESS_TOKEN);
      return;
    }
    activity.estimated_activity_kcal = activity.estimated_activity_kcal || estimateActivityKcalWithStrength(activity.steps, activity.walking_minutes, freshUser.weight_kg || 60, activity.raw_detail_json || {});
    await saveActivityToLog(freshUser, activity);
    await replyMessage(replyToken, quick(buildExerciseAnswer({ summary: activity.exercise_summary, minutes: activity.walking_minutes, kcal: activity.estimated_activity_kcal }), []), env.LINE_CHANNEL_ACCESS_TOKEN);
    return;
  }

  if (freshUser.pending_capture_type === 'exercise_minutes') {
    const minutes = extractMinutes(rawText);
    if (minutes != null) {
      const source = String(freshUser.pending_capture_payload?.source_text || '').trim();
      const activity = parseActivity(`${source} ${minutes}分`, freshUser.weight_kg || 60);
      activity.estimated_activity_kcal = activity.estimated_activity_kcal || estimateActivityKcalWithStrength(activity.steps, activity.walking_minutes, freshUser.weight_kg || 60, activity.raw_detail_json || {});
      await saveActivityToLog(freshUser, activity);
      await updateUserState(freshUser.id, { ...freshUser, pending_capture_type: null, pending_capture_status: null, pending_capture_payload: null, pending_capture_started_at: null });
      await replyMessage(replyToken, quick(buildExerciseAnswer({ summary: activity.exercise_summary, minutes: activity.walking_minutes, kcal: activity.estimated_activity_kcal }), []), env.LINE_CHANNEL_ACCESS_TOKEN);
      return;
    }
  }

  if (/今日.*食事|朝ごはん|昼ごはん|夜ごはん|朝食|昼食|夕食|食べた|飲んだ/.test(rawText) && !/[?？]/.test(rawText)) {
    try {
      const meal = await analyzeMealTextWithAI(rawText);
      await saveMealToLog(freshUser.id, meal);
      await replyMessage(replyToken, quick(buildMealConfirmationMessage(meal), ['今日一日の食事の総カロリー計算して']), env.LINE_CHANNEL_ACCESS_TOKEN);
      return;
    } catch (error) {
      console.error('❌ analyzeMealTextWithAI failed:', error?.message || error);
    }
  }

  const capture = await analyzeChatCapture({ text: rawText, context: freshUser });
  if (capture?.route === 'consultation') {
    const replyText = capture.replyText || '気になっていること、そのまま一つだけでも大丈夫です。いっしょに見ていきましょう。';
    await replyMessage(replyToken, quick(replyText, []), env.LINE_CHANNEL_ACCESS_TOKEN);
    return;
  }

  const conversation = await routeConversation({ currentUserText: rawText, text: rawText, context: freshUser });
  await replyMessage(replyToken, quick(conversation.replyText || 'ありがとうございます。このまま続けて教えてくださいね。', []), env.LINE_CHANNEL_ACCESS_TOKEN);
}

app.listen(PORT, () => {
  console.log(`✅ LINE bot server listening on ${PORT}`);
});
