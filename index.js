'use strict';

require('dotenv').config();

const express = require('express');

const { getEnv } = require('./config/env');
const { verifyLineSignature, replyMessage, textMessageWithQuickReplies, getLineImageContent } = require('./services/line_service');
const { supabase } = require('./services/supabase_service');
const { ensureUser } = require('./services/user_service');
const { parseBodyMetrics, buildWeightSaveMessage } = require('./services/weight_service');
const { calculateDailyEnergyBalance, buildDailyMealSummaryText } = require('./services/energy_service');
const { buildPredictionText, isPredictionIntent } = require('./services/prediction_service');
const { buildWeightChartMessages, buildLabMetricChartMessages } = require('./services/graph_service');
const { buildProfileUpdatePayload, buildPartialProfileReply } = require('./services/profile_service');
const { analyzeMealTextWithAI } = require('./services/meal_ai_service');
const { analyzeMealImageWithAI } = require('./services/meal_image_ai_service');
const { analyzeLabImage, saveLabRows, buildLabSummaryText } = require('./services/lab_intake_service');
const { routeConversation } = require('./services/chatgpt_conversation_router');

const env = getEnv();
const app = express();
const PORT = env.PORT;
const TZ = env.TZ || 'Asia/Tokyo';

app.get('/', (_req, res) => res.status(200).send('ok'));
app.get('/healthz', (_req, res) => res.status(200).json({ ok: true, now: new Date().toISOString(), tz: TZ }));

app.post('/webhook', express.raw({ type: '*/*' }), async (req, res) => {
  const signature = req.headers['x-line-signature'];
  if (!verifyLineSignature(req.body, signature, env.LINE_CHANNEL_SECRET)) {
    return res.status(401).send('invalid signature');
  }

  let body = {};
  try {
    body = JSON.parse(Buffer.from(req.body).toString('utf8'));
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

function safeText(v, f = '') { return String(v || f).trim(); }
function toNumberOrNull(v) { const n = Number(v); return Number.isFinite(n) ? n : null; }
function nowIso() { return new Date().toISOString(); }
function todayRange() {
  const now = new Date();
  const start = new Date(now); start.setHours(0, 0, 0, 0);
  const end = new Date(now); end.setHours(23, 59, 59, 999);
  return { start: start.toISOString(), end: end.toISOString() };
}
function hasAny(text = '', arr = []) { return arr.some((x) => text.includes(x)); }

async function processEvent(event = {}) {
  if (event.type !== 'message' || !event.replyToken) return;
  const lineUserId = event?.source?.userId;
  if (!lineUserId) return;
  const user = await ensureUser(supabase, lineUserId, TZ);
  if (event.message?.type === 'text') {
    await handleTextMessage(event.replyToken, event.message.text, user, event);
    return;
  }
  if (event.message?.type === 'image') {
    await handleImageMessage(event.replyToken, event.message.id, user);
  }
}

async function handleImageMessage(replyToken, messageId, user) {
  try {
    const { buffer, mimeType } = await getLineImageContent(messageId, env.LINE_CHANNEL_ACCESS_TOKEN);

    // 1) まず食事画像として試す
    let mealResult = null;
    try {
      mealResult = await analyzeMealImageWithAI(buffer, mimeType);
    } catch (error) {
      console.warn('⚠️ meal image analyze failed:', error?.message || error);
    }

    if (mealResult?.is_meal) {
      const saved = await saveMealLog(user.id, mealResult);
      await setUserContext(user, {
        last_image_kind: 'meal',
        last_meal_label: saved.meal_label,
        last_meal_kcal: saved.estimated_kcal,
      });
      const text = buildShortMealReply(saved, true);
      await replyMessage(replyToken, textMessageWithQuickReplies(text, ['今日一日の食事の総カロリー計算して']), env.LINE_CHANNEL_ACCESS_TOKEN);
      return;
    }

    // 2) 血液検査として試す
    let labResult = null;
    try {
      labResult = await analyzeLabImage(buffer, mimeType);
    } catch (error) {
      console.warn('⚠️ lab image analyze failed:', error?.message || error);
    }

    if (labResult?.is_lab_report && Array.isArray(labResult.rows) && labResult.rows.length) {
      await saveLabRows(supabase, user.id, labResult.rows, labResult.raw);
      await setUserContext(user, {
        last_image_kind: 'lab',
        last_lab_metric: 'hba1c',
      });
      const text = `${buildLabSummaryText(labResult)}\n見たい項目があれば「HbA1c」「LDL」「HbA1cグラフ」「LDLグラフ」でそのままどうぞ。`;
      await replyMessage(replyToken, textMessageWithQuickReplies(text, ['HbA1cグラフ', 'LDLグラフ', 'HbA1c', 'LDL']), env.LINE_CHANNEL_ACCESS_TOKEN);
      return;
    }

    await setUserContext(user, { last_image_kind: 'unknown' });
    await replyMessage(replyToken, textMessageWithQuickReplies('写真は受け取りました。食事ならこのままカロリーまで見ますし、血液検査なら数値整理へ進めます。必要なら「食事の写真です」「血液検査です」「相談したい」と返してくださいね。', ['食事の写真です', '血液検査です', '相談したい']), env.LINE_CHANNEL_ACCESS_TOKEN);
  } catch (error) {
    console.error('❌ handleImageMessage error:', error?.stack || error?.message || error);
    await replyMessage(replyToken, textMessageWithQuickReplies('画像は受け取れました。今は整理で少しつまずいているので、続けて「食事の写真です」か「血液検査です」と送ってくださいね。', ['食事の写真です', '血液検査です']), env.LINE_CHANNEL_ACCESS_TOKEN);
  }
}

async function handleTextMessage(replyToken, text, user) {
  const raw = safeText(text);
  if (!raw) return;

  const freshUser = await refreshUser(user.id);
  const lower = raw.toLowerCase();

  if (/^完了$/.test(raw) && freshUser.pending_capture_type === 'profile_edit') {
    await clearPending(freshUser);
    await replyMessage(replyToken, textMessageWithQuickReplies('プロフィール変更を閉じました。必要な時にまたそのまま送ってくださいね。', []), env.LINE_CHANNEL_ACCESS_TOKEN);
    return;
  }

  if (/プロフィール変更/.test(raw)) {
    await setPending(freshUser, 'profile_edit', {});
    await replyMessage(replyToken, textMessageWithQuickReplies('プロフィール変更ですね。\n変えたい項目だけ、そのまま送って大丈夫です。\n例: 体重62 / 身長160 / 年齢55 / 目標58 / 活動量 ふつう\n終わったら「完了」で閉じます。', ['体重62', '身長160', '年齢55', '目標58', '完了']), env.LINE_CHANNEL_ACCESS_TOKEN);
    return;
  }

  if (freshUser.pending_capture_type === 'profile_edit') {
    const updates = buildProfileUpdatePayload(freshUser, raw);
    if (updates && Object.keys(updates).length) {
      const merged = { ...freshUser, ...updates };
      await safeUpdateUser(freshUser.id, updates);
      await replyMessage(replyToken, textMessageWithQuickReplies(buildPartialProfileReply(updates, merged), ['完了']), env.LINE_CHANNEL_ACCESS_TOKEN);
      return;
    }
    await replyMessage(replyToken, textMessageWithQuickReplies('変えたい項目だけ送ってください。例: 年齢55 / 身長160 / 目標58 / 活動量 激しい', ['年齢55', '身長160', '目標58', '活動量 激しい', '完了']), env.LINE_CHANNEL_ACCESS_TOKEN);
    return;
  }

  // 画像フォロー
  if (/食事の写真です/.test(raw) && freshUser.pending_capture_payload?.last_image_kind === 'meal') {
    await replyMessage(replyToken, textMessageWithQuickReplies('食事として保存済みです。今日の合計を見るなら「今日一日の食事の総カロリー計算して」で大丈夫です。', ['今日一日の食事の総カロリー計算して']), env.LINE_CHANNEL_ACCESS_TOKEN);
    return;
  }
  if (/血液検査です/.test(raw) && freshUser.pending_capture_payload?.last_image_kind === 'lab') {
    await replyMessage(replyToken, textMessageWithQuickReplies('血液検査として保存済みです。見たい項目があれば「HbA1c」「LDL」「HbA1cグラフ」「LDLグラフ」でどうぞ。', ['HbA1c', 'LDL', 'HbA1cグラフ', 'LDLグラフ']), env.LINE_CHANNEL_ACCESS_TOKEN);
    return;
  }

  // 時刻・名前・記憶系
  if (/今何時/.test(raw)) {
    const now = new Date();
    const hm = now.toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: TZ });
    await replyMessage(replyToken, textMessageWithQuickReplies(`今は ${hm} ごろです。`, []), env.LINE_CHANNEL_ACCESS_TOKEN);
    return;
  }
  if (/あなたの名前|AIの名前|君の名前/.test(raw)) {
    await replyMessage(replyToken, textMessageWithQuickReplies('私はAI牛込として寄り添います。', []), env.LINE_CHANNEL_ACCESS_TOKEN);
    return;
  }
  if (/私の名前|名前覚えて/.test(raw)) {
    const name = safeText(freshUser.display_name || '');
    const msg = name ? `${name}さんとして見ています。呼び方を変えたい時は、そのまま教えてくださいね。` : 'まだ呼び方ははっきり登録していません。呼ばれたい名前があれば、そのまま教えてくださいね。';
    await replyMessage(replyToken, textMessageWithQuickReplies(msg, []), env.LINE_CHANNEL_ACCESS_TOKEN);
    return;
  }
  if (/私の体重|今の体重/.test(raw)) {
    const latest = await getLatestWeight(freshUser.id);
    if (latest?.weight_kg != null) {
      await replyMessage(replyToken, textMessageWithQuickReplies(`今の記録では ${latest.weight_kg}kg として見ています。流れを見るなら「体重グラフ」でも大丈夫です。`, ['体重グラフ', '予測']), env.LINE_CHANNEL_ACCESS_TOKEN);
    } else {
      await replyMessage(replyToken, textMessageWithQuickReplies('まだ体重記録が見当たらないので、「体重 62.4kg」のように送ってくださいね。', []), env.LINE_CHANNEL_ACCESS_TOKEN);
    }
    return;
  }

  // グラフ・検査値
  if (/^体重グラフ$/.test(raw)) {
    await replyWeightGraph(replyToken, freshUser.id);
    return;
  }
  if (/HbA1cグラフ/i.test(raw)) {
    await replyLabGraph(replyToken, freshUser.id, 'hba1c', 'HbA1cの流れです。', 'HbA1c');
    return;
  }
  if (/LDLグラフ/i.test(raw)) {
    await replyLabGraph(replyToken, freshUser.id, 'ldl', 'LDLの流れです。', 'LDL');
    return;
  }
  if (/^HbA1c$|HbA1cを見たい/i.test(raw)) {
    await replyLatestLabMetric(replyToken, freshUser.id, 'hba1c', 'HbA1c');
    return;
  }
  if (/^LDL$|LDLは|LDLを見たい/i.test(raw)) {
    await replyLatestLabMetric(replyToken, freshUser.id, 'ldl', 'LDL');
    return;
  }

  // 日次サマリー・予測
  if (/今日一日の食事の総カロリー|食事の総まとめ|今日の食事の合計/.test(raw)) {
    await replyTodayMealSummary(replyToken, freshUser.id);
    return;
  }
  if (isPredictionIntent(raw) || /^予測$/.test(raw)) {
    await replyPrediction(replyToken, freshUser);
    return;
  }

  // 運動記録・質問
  const activityResult = parseActivity(raw, freshUser.weight_kg || 60);
  if (activityResult) {
    const saved = await saveActivityLog(freshUser.id, activityResult);
    const text = buildActivityReply(saved, raw.includes('？') || raw.includes('?'));
    await replyMessage(replyToken, textMessageWithQuickReplies(text, []), env.LINE_CHANNEL_ACCESS_TOKEN);
    return;
  }

  // 体重・体脂肪
  const metrics = parseBodyMetrics(raw);
  if (metrics.weight_kg != null || metrics.body_fat_pct != null) {
    await saveBodyMetrics(replyToken, freshUser, metrics);
    return;
  }

  // 食事テキスト
  if (looksLikeMealText(raw)) {
    try {
      const result = await analyzeMealTextWithAI(raw);
      if (result?.meal_label || result?.estimated_kcal != null) {
        const saved = await saveMealLog(freshUser.id, result);
        await setUserContext(freshUser, { last_image_kind: 'meal', last_meal_label: saved.meal_label, last_meal_kcal: saved.estimated_kcal });
        await replyMessage(replyToken, textMessageWithQuickReplies(buildShortMealReply(saved, false), ['今日一日の食事の総カロリー計算して']), env.LINE_CHANNEL_ACCESS_TOKEN);
        return;
      }
    } catch (error) {
      console.error('❌ analyzeMealTextWithAI error:', error?.message || error);
    }
  }

  // 相談・伴走
  const routed = routeConversation({ currentUserText: raw, context: freshUser });
  if (routed?.route === 'support' || routed?.route === 'consultation' || routed?.replyText) {
    const reply = routed.replyText || '気になっていることを、そのまま一つだけでも大丈夫です。いっしょに見ていきましょう。';
    await replyMessage(replyToken, textMessageWithQuickReplies(reply, []), env.LINE_CHANNEL_ACCESS_TOKEN);
    return;
  }

  await replyMessage(replyToken, textMessageWithQuickReplies('ありがとうございます。このまま続けて教えてくださいね。必要な形はこちらで整えます。', []), env.LINE_CHANNEL_ACCESS_TOKEN);
}

function looksLikeMealText(text = '') {
  return /(食べた|飲んだ|朝ごはん|昼ごはん|夜ごはん|朝食|昼食|夕食|ラーメン|ご飯|おにぎり|パン|いちご|味噌)/.test(String(text || ''));
}

function parseActivity(text = '', weightKg = 60) {
  const raw = safeText(text);
  if (!/(ジョギング|ランニング|走|ウォーキング|歩い|散歩|筋トレ|ストレッチ)/.test(raw)) return null;
  const minMatch = raw.match(/(\d+(?:\.\d+)?)\s*分/);
  const minutes = minMatch ? Number(minMatch[1]) : null;
  const label = /(ジョギング|ランニング|走)/.test(raw) ? 'ジョギング' : /(ウォーキング|歩い|散歩)/.test(raw) ? 'ウォーキング' : /(筋トレ)/.test(raw) ? '筋トレ' : 'ストレッチ';
  const met = label === 'ジョギング' ? 7.2 : label === 'ウォーキング' ? 3.5 : label === '筋トレ' ? 4.2 : 2.5;
  const duration = minutes || 10;
  const kcal = Math.round(met * 3.5 * Number(weightKg || 60) / 200 * duration);
  return { exercise_summary: `${label} ${duration}分`, walking_minutes: label === 'ウォーキング' ? duration : null, estimated_activity_kcal: kcal, raw_minutes: duration };
}

function buildActivityReply(activity = {}, includesQuestion = false) {
  const lines = [
    '運動を記録しました。',
    activity.exercise_summary ? `内容: ${activity.exercise_summary}` : null,
    activity.estimated_activity_kcal != null ? `推定活動消費: ${activity.estimated_activity_kcal} kcal` : null,
  ].filter(Boolean);
  if (includesQuestion && activity.estimated_activity_kcal != null) lines.push(`ざっくり ${activity.estimated_activity_kcal} kcal 前後です。`);
  return lines.join('\n');
}

function buildShortMealReply(meal = {}, fromImage = false) {
  const lines = [
    fromImage ? '食事を保存しました。' : '食事内容を整理して保存しました。',
    meal.meal_label ? `料理: ${meal.meal_label}` : null,
    meal.estimated_kcal != null ? `推定カロリー: ${meal.estimated_kcal} kcal` : null,
    meal.protein_g != null ? `たんぱく質: ${meal.protein_g}g / 脂質: ${meal.fat_g || 0}g / 糖質: ${meal.carbs_g || 0}g` : null,
  ].filter(Boolean);
  return lines.join('\n');
}

async function saveMealLog(userId, meal = {}) {
  const payload = {
    user_id: userId,
    eaten_at: nowIso(),
    meal_label: safeText(meal.meal_label || '食事', 100),
    food_items: Array.isArray(meal.food_items) ? meal.food_items : [],
    estimated_kcal: meal.estimated_kcal ?? null,
    kcal_min: meal.kcal_min ?? null,
    kcal_max: meal.kcal_max ?? null,
    protein_g: meal.protein_g ?? null,
    fat_g: meal.fat_g ?? null,
    carbs_g: meal.carbs_g ?? null,
    confidence: meal.confidence ?? null,
    ai_comment: safeText(meal.ai_comment || '', 500),
    raw_model_json: meal,
  };
  const { error } = await supabase.from('meal_logs').insert(payload);
  if (error) throw error;
  return payload;
}

async function saveActivityLog(userId, activity = {}) {
  const payload = {
    user_id: userId,
    logged_at: nowIso(),
    walking_minutes: activity.walking_minutes,
    estimated_activity_kcal: activity.estimated_activity_kcal,
    exercise_summary: activity.exercise_summary,
    raw_detail_json: activity,
  };
  const { error } = await supabase.from('activity_logs').insert(payload);
  if (error) throw error;
  return payload;
}

async function saveBodyMetrics(replyToken, user, metrics = {}) {
  const weightKg = toNumberOrNull(metrics.weight_kg);
  const bodyFatPct = toNumberOrNull(metrics.body_fat_pct);
  try {
    if (weightKg != null) {
      await insertWeightLog(user.id, weightKg, bodyFatPct);
    }
    const patch = {};
    if (weightKg != null) patch.weight_kg = weightKg;
    if (bodyFatPct != null) patch.body_fat_pct = bodyFatPct;
    if (Object.keys(patch).length) await safeUpdateUser(user.id, patch);
    const msg = buildWeightSaveMessage({ weight_kg: weightKg, body_fat_pct: bodyFatPct });
    await replyMessage(replyToken, textMessageWithQuickReplies(msg.text, msg.quickReplies), env.LINE_CHANNEL_ACCESS_TOKEN);
  } catch (error) {
    console.error('❌ saveBodyMetrics error:', error?.message || error);
    const lines = ['数字は受け取れました。保存で少しつまずいているので、まずは'];
    if (weightKg != null) lines.push(`体重は ${weightKg}kg として見ています。`);
    if (bodyFatPct != null) lines.push(`体脂肪率は ${bodyFatPct}% として見ています。`);
    lines.push('流れを見るなら「体重グラフ」、見通しなら「予測」でも大丈夫です。');
    await replyMessage(replyToken, textMessageWithQuickReplies(lines.join('\n'), ['体重グラフ', '予測']), env.LINE_CHANNEL_ACCESS_TOKEN);
  }
}

async function insertWeightLog(userId, weightKg, bodyFatPct) {
  const base = { user_id: userId, logged_at: nowIso(), weight_kg: weightKg };
  if (bodyFatPct != null) {
    let { error } = await supabase.from('weight_logs').insert({ ...base, body_fat_pct: bodyFatPct });
    if (error && /body_fat_pct/.test(error.message || '')) {
      ({ error } = await supabase.from('weight_logs').insert(base));
    }
    if (error) throw error;
    return;
  }
  const { error } = await supabase.from('weight_logs').insert(base);
  if (error) throw error;
}

async function safeUpdateUser(userId, patch = {}) {
  let working = { ...patch };
  while (true) {
    const { error } = await supabase.from('users').update(working).eq('id', userId);
    if (!error) return;
    const msg = String(error.message || '');
    const m = msg.match(/Could not find the '([^']+)' column/);
    if (m && Object.prototype.hasOwnProperty.call(working, m[1])) {
      delete working[m[1]];
      if (!Object.keys(working).length) return;
      continue;
    }
    console.warn('⚠️ safeUpdateUser failed:', msg);
    return;
  }
}

async function refreshUser(userId) {
  const { data } = await supabase.from('users').select('*').eq('id', userId).maybeSingle();
  return data || {};
}

async function setPending(user, type, payload) {
  await safeUpdateUser(user.id, {
    pending_capture_type: type,
    pending_capture_status: 'open',
    pending_capture_payload: payload || {},
    pending_capture_started_at: nowIso(),
  });
}

async function clearPending(user) {
  await safeUpdateUser(user.id, {
    pending_capture_type: null,
    pending_capture_status: null,
    pending_capture_payload: null,
    pending_capture_started_at: null,
  });
}

async function setUserContext(user, payload = {}) {
  const current = user.pending_capture_payload && typeof user.pending_capture_payload === 'object' ? user.pending_capture_payload : {};
  await safeUpdateUser(user.id, {
    pending_capture_type: user.pending_capture_type || 'context',
    pending_capture_status: 'open',
    pending_capture_payload: { ...current, ...payload },
    pending_capture_started_at: nowIso(),
  });
}

async function getLatestWeight(userId) {
  const { data } = await supabase.from('weight_logs').select('logged_at, weight_kg, body_fat_pct').eq('user_id', userId).order('logged_at', { ascending: false }).limit(1);
  return Array.isArray(data) && data[0] ? data[0] : null;
}

async function getTodayMealStats(userId) {
  const { start, end } = todayRange();
  const { data } = await supabase.from('meal_logs').select('meal_label, estimated_kcal, eaten_at').eq('user_id', userId).gte('eaten_at', start).lte('eaten_at', end).order('eaten_at', { ascending: true });
  const rows = Array.isArray(data) ? data : [];
  return {
    intakeKcal: rows.reduce((sum, row) => sum + (toNumberOrNull(row.estimated_kcal) || 0), 0),
    mealCount: rows.length,
    latestMeal: rows.length ? safeText(rows[rows.length - 1].meal_label) : '',
  };
}

async function getTodayActivityStats(userId) {
  const { start, end } = todayRange();
  const { data } = await supabase.from('activity_logs').select('estimated_activity_kcal, exercise_summary, logged_at').eq('user_id', userId).gte('logged_at', start).lte('logged_at', end).order('logged_at', { ascending: true });
  const rows = Array.isArray(data) ? data : [];
  return {
    activityKcal: rows.reduce((sum, row) => sum + (toNumberOrNull(row.estimated_activity_kcal) || 0), 0),
    latestActivity: rows.length ? safeText(rows[rows.length - 1].exercise_summary) : '',
  };
}

async function replyTodayMealSummary(replyToken, userId) {
  const stats = await getTodayMealStats(userId);
  const text = buildDailyMealSummaryText(stats);
  await replyMessage(replyToken, textMessageWithQuickReplies(text, []), env.LINE_CHANNEL_ACCESS_TOKEN);
}

async function replyPrediction(replyToken, user) {
  const meal = await getTodayMealStats(user.id);
  const activity = await getTodayActivityStats(user.id);
  const latest = await getLatestWeight(user.id);
  const msg = buildPredictionText({ estimatedBmr: user.estimated_bmr || 0, estimatedTdee: user.estimated_tdee || 0, intakeKcal: meal.intakeKcal, activityKcal: activity.activityKcal, currentWeightKg: latest?.weight_kg || user.weight_kg || null });
  await replyMessage(replyToken, textMessageWithQuickReplies(msg.text, msg.quickReplies || []), env.LINE_CHANNEL_ACCESS_TOKEN);
}

async function replyWeightGraph(replyToken, userId) {
  const { data } = await supabase.from('weight_logs').select('logged_at, weight_kg').eq('user_id', userId).order('logged_at', { ascending: true }).limit(60);
  const rows = Array.isArray(data) ? data : [];
  if (!rows.length) {
    await replyMessage(replyToken, textMessageWithQuickReplies('まだ体重記録が少ないので、数回たまると流れが見やすくなります。', []), env.LINE_CHANNEL_ACCESS_TOKEN);
    return;
  }
  const messages = [{ type: 'text', text: '体重グラフです。' }, ...buildWeightChartMessages(rows)];
  await replyMessage(replyToken, messages, env.LINE_CHANNEL_ACCESS_TOKEN);
}

async function getLabRows(userId) {
  const { data } = await supabase.from('lab_results').select('measured_at, hba1c, ldl, hdl, triglycerides, fasting_glucose, ast, alt, ggt, uric_acid, creatinine').eq('user_id', userId).order('measured_at', { ascending: true }).limit(100);
  return Array.isArray(data) ? data : [];
}

async function replyLabGraph(replyToken, userId, metricKey, title, label) {
  const rows = await getLabRows(userId);
  const messages = buildLabMetricChartMessages(rows, metricKey, title, label);
  if (!messages.length) {
    await replyMessage(replyToken, textMessageWithQuickReplies(`${label} の記録がまだ少ないので、保存されると流れを見やすく返します。`, []), env.LINE_CHANNEL_ACCESS_TOKEN);
    return;
  }
  await replyMessage(replyToken, [{ type: 'text', text: title }, ...messages], env.LINE_CHANNEL_ACCESS_TOKEN);
}

async function replyLatestLabMetric(replyToken, userId, key, label) {
  const rows = await getLabRows(userId);
  const latest = [...rows].reverse().find((row) => row[key] != null);
  if (!latest) {
    await replyMessage(replyToken, textMessageWithQuickReplies(`${label} の保存がまだ見当たらないので、血液検査画像を送ってくださいね。`, []), env.LINE_CHANNEL_ACCESS_TOKEN);
    return;
  }
  const date = safeText(latest.measured_at).slice(0, 10);
  await replyMessage(replyToken, textMessageWithQuickReplies(`最新の ${label} は ${latest[key]} で、日付は ${date} です。`, [`${label}グラフ`]), env.LINE_CHANNEL_ACCESS_TOKEN);
}

app.listen(PORT, () => {
  console.log(`✅ LINE bot server listening on ${PORT}`);
});
