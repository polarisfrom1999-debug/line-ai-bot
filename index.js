'use strict';

require('dotenv').config();

const express = require('express');

const { getEnv } = require('./config/env');
const {
  verifyLineSignature,
  replyMessage,
  textMessageWithQuickReplies,
  getLineImageContent,
} = require('./services/line_service');
const { supabase } = require('./services/supabase_service');
const { ensureUser, refreshUserById } = require('./services/user_service');
const { classifyInput } = require('./services/conversation_orchestrator_service');
const {
  rememberTurn,
  getRecentTurns,
  setImageContext,
  enableProfileMode,
  disableProfileMode,
  buildRememberedHints,
} = require('./services/context_memory_service');
const { routeConversation } = require('./services/chatgpt_conversation_router');
const { buildProfileUpdatePayload, buildProfilePartialReply, profileGuideMessage } = require('./services/profile_service');
const { parseWeightLog, buildWeightSaveMessage } = require('./services/weight_service');
const { parseActivity, estimateActivityKcalWithStrength } = require('./parsers/activity_parser');
const { analyzeMealTextWithAI } = require('./services/meal_ai_service');
const { analyzeMealImageWithAI } = require('./services/meal_image_ai_service');
const { getTodayRows, buildDailySummaryText, currentDateYmdInTZ } = require('./services/daily_summary_service');
const { extractBloodPanelsFromImage, saveBloodPanels, getRecentLabRows, buildSavedLabReply, buildLabAnswer } = require('./services/lab_intake_service');
const { buildWeightGraphMessage, buildEnergyGraphMessage, buildLabGraphMessage } = require('./services/graph_service');

const env = getEnv();
const app = express();
const PORT = env.PORT;
const TZ = env.TZ || 'Asia/Tokyo';

function userKeyFromUser(user = {}) {
  return String(user?.line_user_id || user?.id || 'unknown');
}

function nowInTokyo() {
  return new Date(new Date().toLocaleString('en-US', { timeZone: TZ }));
}

function formatNowTime() {
  const d = nowInTokyo();
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

function formatTodayDateJa() {
  const d = nowInTokyo();
  return `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日`;
}

async function updateUser(userId, patch = {}) {
  const cleanPatch = { ...patch };
  Object.keys(cleanPatch).forEach((key) => {
    if (cleanPatch[key] === undefined) delete cleanPatch[key];
  });
  const { error } = await supabase.from('users').update(cleanPatch).eq('id', userId);
  if (error) throw error;
}

async function saveWeightMetrics(user, payload = {}) {
  const weight = payload.weight_kg != null ? Number(payload.weight_kg) : null;
  const bodyFat = payload.body_fat_pct != null ? Number(payload.body_fat_pct) : null;

  if (!Number.isFinite(weight) && !Number.isFinite(bodyFat)) {
    return { ok: false, text: '体重や体脂肪率の数字が読み取れませんでした。たとえば「62.4kg」「体脂肪率18%」のように送ってくださいね。' };
  }

  const insertPayload = {
    user_id: user.id,
    logged_at: new Date().toISOString(),
    weight_kg: Number.isFinite(weight) ? weight : null,
    body_fat_pct: Number.isFinite(bodyFat) ? bodyFat : null,
  };

  const { error } = await supabase.from('weight_logs').insert(insertPayload);
  if (error) {
    return { ok: false, text: '数字は受け取れましたが、保存で少し詰まっています。もう一度送ってくださいね。' };
  }

  const userPatch = {};
  if (Number.isFinite(weight)) userPatch.weight_kg = weight;
  if (Number.isFinite(bodyFat)) userPatch.body_fat_pct = bodyFat;
  if (Object.keys(userPatch).length) await updateUser(user.id, userPatch);

  return { ok: true, text: buildWeightSaveMessage({ weight_kg: weight, body_fat_pct: bodyFat }).text };
}

async function saveActivityRecord(user, text) {
  const parsed = parseActivity(text, user.weight_kg || 60);
  if (!parsed.exercise_summary && !parsed.steps && !parsed.walking_minutes && !parsed.estimated_activity_kcal) {
    return { ok: false, text: '運動の内容がまだ少し読み取りにくいので、たとえば「ジョギング20分」「スクワット30回」のように送ってくださいね。' };
  }

  if (!parsed.estimated_activity_kcal) {
    parsed.estimated_activity_kcal = estimateActivityKcalWithStrength(parsed.steps, parsed.walking_minutes, user.weight_kg || 60, parsed.raw_detail_json || {});
  }

  const insertPayload = {
    user_id: user.id,
    logged_at: new Date().toISOString(),
    steps: parsed.steps,
    walking_minutes: parsed.walking_minutes,
    estimated_activity_kcal: parsed.estimated_activity_kcal,
    exercise_summary: parsed.exercise_summary,
    raw_detail_json: parsed.raw_detail_json,
  };

  const { error } = await supabase.from('activity_logs').insert(insertPayload);
  if (error) {
    return { ok: false, text: '運動内容は読み取れましたが、保存で少し詰まっています。もう一度だけ送ってくださいね。' };
  }

  const rows = await getTodayRows(user.id);
  return {
    ok: true,
    text: [
      '活動を記録しました。',
      parsed.exercise_summary ? `内容: ${parsed.exercise_summary}` : null,
      parsed.estimated_activity_kcal != null ? `推定活動消費: ${Math.round(parsed.estimated_activity_kcal)} kcal` : null,
      '',
      buildDailySummaryText({ user, rows }),
    ].filter(Boolean).join('\n'),
  };
}

async function saveMealResult(user, meal, sourceText = '') {
  const insertPayload = {
    user_id: user.id,
    eaten_at: new Date().toISOString(),
    meal_label: meal.meal_label || '食事',
    food_items: Array.isArray(meal.food_items) ? meal.food_items : [],
    estimated_kcal: meal.estimated_kcal ?? null,
    kcal_min: meal.kcal_min ?? null,
    kcal_max: meal.kcal_max ?? null,
    protein_g: meal.protein_g ?? null,
    fat_g: meal.fat_g ?? null,
    carbs_g: meal.carbs_g ?? null,
    confidence: meal.confidence ?? null,
    ai_comment: meal.ai_comment || null,
    raw_model_json: { ...meal, source_text: sourceText || null },
  };

  const { error } = await supabase.from('meal_logs').insert(insertPayload);
  if (error) {
    return { ok: false, text: '食事は読み取れましたが、保存で少しつまずいています。もう一度送っても大丈夫です。' };
  }

  const rows = await getTodayRows(user.id);
  return {
    ok: true,
    text: [
      '食事を保存しました。',
      `料理: ${meal.meal_label}`,
      meal.estimated_kcal != null ? `今回の推定: ${Math.round(meal.estimated_kcal)} kcal` : null,
      meal.protein_g != null || meal.fat_g != null || meal.carbs_g != null ? `栄養の目安: たんぱく質 ${meal.protein_g || 0}g / 脂質 ${meal.fat_g || 0}g / 糖質 ${meal.carbs_g || 0}g` : null,
      meal.ai_comment ? `ひとこと: ${meal.ai_comment}` : null,
      '',
      buildDailySummaryText({ user, rows }),
    ].filter(Boolean).join('\n'),
  };
}

async function fetchRecentContext(user) {
  const [latestMealRes, latestWeightRes, profilesRes] = await Promise.all([
    supabase.from('meal_logs').select('meal_label, eaten_at').eq('user_id', user.id).order('eaten_at', { ascending: false }).limit(1),
    supabase.from('weight_logs').select('weight_kg, logged_at').eq('user_id', user.id).order('logged_at', { ascending: false }).limit(1),
    supabase.from('user_profiles').select('*').eq('user_id', user.id).maybeSingle(),
  ]);

  return {
    latestWeight: latestWeightRes.data?.[0]?.weight_kg || user.weight_kg || null,
    lastMealLabel: latestMealRes.data?.[0]?.meal_label || '',
    recentConcern: profilesRes.data?.current_barriers || '',
  };
}

async function buildConversationReply(user, rawText, mode = 'support') {
  const key = userKeyFromUser(user);
  const recentTurns = getRecentTurns(key, 8);
  const extra = await fetchRecentContext(user);
  const routed = await routeConversation({
    currentUserText: rawText,
    text: rawText,
    recentMessages: recentTurns,
    context: { user, extra, mode },
  });
  return String(routed?.replyText || routed?.reply_text || '').trim();
}

async function handleGraphIntent(replyToken, user, rawText) {
  const text = String(rawText || '');
  if (/体重/.test(text)) {
    const { data } = await supabase.from('weight_logs').select('logged_at, weight_kg, body_fat_pct').eq('user_id', user.id).order('logged_at', { ascending: true }).limit(30);
    const graph = buildWeightGraphMessage(data || []);
    const messages = [textMessageWithQuickReplies(graph.text, ['今日のまとめ', '予測'])].concat(graph.messages || []);
    await replyMessage(replyToken, messages, env.LINE_CHANNEL_ACCESS_TOKEN);
    return;
  }

  if (/hba1c/i.test(text)) {
    const rows = await getRecentLabRows(user.id, 20);
    const graph = buildLabGraphMessage(rows, 'hba1c');
    const messages = [textMessageWithQuickReplies(graph.text, ['LDLグラフ', 'HbA1cは？'])].concat(graph.messages || []);
    await replyMessage(replyToken, messages, env.LINE_CHANNEL_ACCESS_TOKEN);
    return;
  }

  if (/ldl/i.test(text)) {
    const rows = await getRecentLabRows(user.id, 20);
    const graph = buildLabGraphMessage(rows, 'ldl');
    const messages = [textMessageWithQuickReplies(graph.text, ['HbA1cグラフ', 'LDLは？'])].concat(graph.messages || []);
    await replyMessage(replyToken, messages, env.LINE_CHANNEL_ACCESS_TOKEN);
    return;
  }

  const rows = await getTodayRows(user.id);
  const energyRows = [];
  for (const meal of rows.meals || []) energyRows.push({ date: meal.eaten_at, intake_kcal: meal.estimated_kcal || 0, activity_minutes: 0 });
  for (const activity of rows.activities || []) energyRows.push({ date: activity.logged_at, intake_kcal: 0, activity_minutes: activity.estimated_activity_kcal || 0 });
  const graph = buildEnergyGraphMessage(energyRows);
  const messages = [textMessageWithQuickReplies(graph.text, ['今日のまとめ', '体重グラフ'])].concat(graph.messages || []);
  await replyMessage(replyToken, messages, env.LINE_CHANNEL_ACCESS_TOKEN);
}

async function handleTextMessage(replyToken, text, user) {
  const rawText = String(text || '').trim();
  if (!rawText) return;

  const key = userKeyFromUser(user);
  rememberTurn(key, 'user', rawText, {});
  const classification = classifyInput({ text: rawText, user, userKey: key });

  try {
    if (classification.intent === 'profile_start') {
      enableProfileMode(key);
      const reply = `プロフィール変更ですね。\n${profileGuideMessage()}\n\n1項目ずつでも大丈夫です。例: 身長160 / 55歳 / 目標体重58`;
      await replyMessage(replyToken, textMessageWithQuickReplies(reply, ['身長160', '55歳', '目標体重58', '活動量 ふつう']), env.LINE_CHANNEL_ACCESS_TOKEN);
      rememberTurn(key, 'assistant', reply);
      return;
    }

    if (classification.intent === 'profile_update') {
      const updatePayload = classification.profilePatch?.estimated_bmr !== undefined ? classification.profilePatch : buildProfileUpdatePayload(user, rawText);
      if (!updatePayload) {
        await replyMessage(replyToken, textMessageWithQuickReplies('更新したい項目だけ、そのまま送ってくださいね。', []), env.LINE_CHANNEL_ACCESS_TOKEN);
        return;
      }
      await updateUser(user.id, updatePayload);
      const reply = buildProfilePartialReply(updatePayload);
      await replyMessage(replyToken, textMessageWithQuickReplies(reply, ['今日のまとめ', '体重を送る']), env.LINE_CHANNEL_ACCESS_TOKEN);
      rememberTurn(key, 'assistant', reply);
      return;
    }

    if (classification.intent === 'daily_summary') {
      const rows = await getTodayRows(user.id);
      const summary = buildDailySummaryText({ user, rows });
      await replyMessage(replyToken, textMessageWithQuickReplies(summary, ['体重グラフ', '予測', '食事を記録']), env.LINE_CHANNEL_ACCESS_TOKEN);
      rememberTurn(key, 'assistant', summary);
      return;
    }

    if (classification.intent === 'time') {
      const reply = `今は ${formatNowTime()} ごろです。`;
      await replyMessage(replyToken, textMessageWithQuickReplies(reply, []), env.LINE_CHANNEL_ACCESS_TOKEN);
      rememberTurn(key, 'assistant', reply);
      return;
    }

    if (classification.intent === 'date') {
      const reply = `今日は ${formatTodayDateJa()} です。`;
      await replyMessage(replyToken, textMessageWithQuickReplies(reply, []), env.LINE_CHANNEL_ACCESS_TOKEN);
      rememberTurn(key, 'assistant', reply);
      return;
    }

    if (classification.intent === 'assistant_name') {
      const reply = '私はAI牛込です。ここから。で、毎日の流れを一緒に見ていく伴走役です。';
      await replyMessage(replyToken, textMessageWithQuickReplies(reply, []), env.LINE_CHANNEL_ACCESS_TOKEN);
      rememberTurn(key, 'assistant', reply);
      return;
    }

    if (classification.intent === 'user_name') {
      const reply = user.display_name ? `${user.display_name}さんとして覚えています。呼び方を変えたければ、そのまま教えてくださいね。` : 'まだ呼び名ははっきり保存できていません。呼んでほしい名前があれば、そのまま送ってください。';
      await replyMessage(replyToken, textMessageWithQuickReplies(reply, []), env.LINE_CHANNEL_ACCESS_TOKEN);
      rememberTurn(key, 'assistant', reply);
      return;
    }

    if (classification.intent === 'memory_recall') {
      const extra = await fetchRecentContext(user);
      const hints = buildRememberedHints(user, extra);
      const reply = hints.length ? `今覚えているのは、\n${hints.map((x) => `・${x}`).join('\n')}\n\n足りないところがあれば、普段の会話の中で少しずつ更新していきますね。` : 'まだ覚えていることは少なめです。呼び名や目標、気になっていることを少しずつ教えてもらえたら、伴走に活かしていきます。';
      await replyMessage(replyToken, textMessageWithQuickReplies(reply, []), env.LINE_CHANNEL_ACCESS_TOKEN);
      rememberTurn(key, 'assistant', reply);
      return;
    }

    if (classification.intent === 'latest_weight') {
      const { data } = await supabase.from('weight_logs').select('weight_kg, body_fat_pct, logged_at').eq('user_id', user.id).order('logged_at', { ascending: false }).limit(1);
      const latest = data?.[0];
      const reply = latest?.weight_kg != null ? `直近の体重は ${latest.weight_kg}kg です。${latest.body_fat_pct != null ? `体脂肪率は ${latest.body_fat_pct}% でした。` : ''}` : 'まだ直近の体重記録が少ないようです。送ってもらえたらすぐ覚えていきます。';
      await replyMessage(replyToken, textMessageWithQuickReplies(reply, ['体重を送る', '体重グラフ']), env.LINE_CHANNEL_ACCESS_TOKEN);
      rememberTurn(key, 'assistant', reply);
      return;
    }

    if (classification.intent === 'graph') {
      await handleGraphIntent(replyToken, user, rawText);
      rememberTurn(key, 'assistant', 'グラフを返した');
      return;
    }

    if (classification.intent === 'prediction') {
      const rows = await getTodayRows(user.id);
      const summary = buildDailySummaryText({ user, rows });
      const reply = `今の記録を見ると、今日は大きく崩れてはいません。\n数日単位の流れを見るときは、体重グラフと一緒に見ると判断しやすいです。\n\n${summary}`;
      await replyMessage(replyToken, textMessageWithQuickReplies(reply, ['体重グラフ', '今日のまとめ']), env.LINE_CHANNEL_ACCESS_TOKEN);
      rememberTurn(key, 'assistant', reply);
      return;
    }

    if (classification.intent === 'body_metrics') {
      disableProfileMode(key);
      const parsed = parseWeightLog(rawText);
      const result = await saveWeightMetrics(user, parsed);
      await replyMessage(replyToken, textMessageWithQuickReplies(result.text, ['今日のまとめ', '体重グラフ', '予測']), env.LINE_CHANNEL_ACCESS_TOKEN);
      rememberTurn(key, 'assistant', result.text);
      return;
    }

    if (classification.intent === 'activity_record') {
      const result = await saveActivityRecord(user, rawText);
      await replyMessage(replyToken, textMessageWithQuickReplies(result.text, ['今日のまとめ', '体重グラフ', '食事を記録']), env.LINE_CHANNEL_ACCESS_TOKEN);
      rememberTurn(key, 'assistant', result.text);
      return;
    }

    if (classification.intent === 'meal_record' || classification.intent === 'meal_followup') {
      const meal = await analyzeMealTextWithAI(rawText);
      const result = await saveMealResult(user, meal, rawText);
      setImageContext(key, 'meal');
      await replyMessage(replyToken, textMessageWithQuickReplies(result.text, ['今日のまとめ', '少し歩いた', '体重を送る']), env.LINE_CHANNEL_ACCESS_TOKEN);
      rememberTurn(key, 'assistant', result.text);
      return;
    }

    if (classification.intent === 'lab_query' || classification.intent === 'lab_followup') {
      const rows = await getRecentLabRows(user.id, 12);
      const reply = /ldl/i.test(rawText) ? buildLabAnswer(rows, 'ldl') : /hdl/i.test(rawText) ? buildLabAnswer(rows, 'hdl') : /中性脂肪/.test(rawText) ? buildLabAnswer(rows, 'triglycerides') : buildLabAnswer(rows, 'hba1c');
      await replyMessage(replyToken, textMessageWithQuickReplies(reply, ['HbA1cグラフ', 'LDLグラフ']), env.LINE_CHANNEL_ACCESS_TOKEN);
      rememberTurn(key, 'assistant', reply);
      return;
    }

    const reply = await buildConversationReply(user, rawText, classification.intent === 'consultation' ? 'consultation' : 'support');
    await replyMessage(replyToken, textMessageWithQuickReplies(reply, []), env.LINE_CHANNEL_ACCESS_TOKEN);
    rememberTurn(key, 'assistant', reply);
  } catch (error) {
    console.error('❌ handleTextMessage error:', error?.stack || error?.message || error);
    const fallback = '少し処理が混み合いました。言い直しでも、続きでも大丈夫です。そのまま送ってくださいね。';
    await replyMessage(replyToken, textMessageWithQuickReplies(fallback, []), env.LINE_CHANNEL_ACCESS_TOKEN);
    rememberTurn(key, 'assistant', fallback);
  }
}

async function handleImageMessage(replyToken, user, event = {}) {
  const key = userKeyFromUser(user);
  try {
    const { buffer, mimeType } = await getLineImageContent(event.message.id, env.LINE_CHANNEL_ACCESS_TOKEN);

    try {
      const meal = await analyzeMealImageWithAI(buffer, mimeType);
      if (meal?.is_meal) {
        const result = await saveMealResult(user, meal, '[image]');
        setImageContext(key, 'meal');
        await replyMessage(replyToken, textMessageWithQuickReplies(result.text, ['今日のまとめ', '半分食べた', '違うところを訂正']), env.LINE_CHANNEL_ACCESS_TOKEN);
        rememberTurn(key, 'assistant', result.text);
        return;
      }
    } catch (mealError) {
      console.warn('⚠️ meal image analysis skipped:', mealError?.message || mealError);
    }

    const extraction = await extractBloodPanelsFromImage(buffer, mimeType);
    if (Array.isArray(extraction?.panels) && extraction.panels.length) {
      const savedRows = await saveBloodPanels(user.id, extraction);
      const reply = buildSavedLabReply(savedRows);
      setImageContext(key, 'lab');
      await replyMessage(replyToken, textMessageWithQuickReplies(reply, ['HbA1cは？', 'LDLは？', 'HbA1cグラフ']), env.LINE_CHANNEL_ACCESS_TOKEN);
      rememberTurn(key, 'assistant', reply);
      return;
    }

    setImageContext(key, 'unknown');
    const reply = '画像は受け取りました。食事写真ならそのまま解析、血液検査なら数値整理につなげます。補足があれば一言だけ続けて送ってください。';
    await replyMessage(replyToken, textMessageWithQuickReplies(reply, ['食事の写真です', '血液検査です', '相談したい']), env.LINE_CHANNEL_ACCESS_TOKEN);
    rememberTurn(key, 'assistant', reply);
  } catch (error) {
    console.error('❌ handleImageMessage error:', error?.stack || error?.message || error);
    const reply = '画像は受け取りましたが、整理で少し詰まっています。もう一度送るか、何の写真か一言だけ教えてくださいね。';
    await replyMessage(replyToken, textMessageWithQuickReplies(reply, ['食事の写真です', '血液検査です']), env.LINE_CHANNEL_ACCESS_TOKEN);
    rememberTurn(key, 'assistant', reply);
  }
}

app.get('/', (_req, res) => {
  res.status(200).send('ok');
});

app.get('/healthz', (_req, res) => {
  res.status(200).json({ ok: true, tz: TZ, now: new Date().toISOString(), ymd: currentDateYmdInTZ() });
});

app.post('/webhook', express.raw({ type: '*/*' }), async (req, res) => {
  const signature = req.headers['x-line-signature'];
  const rawBody = req.body;

  if (!verifyLineSignature(rawBody, signature, env.LINE_CHANNEL_SECRET)) {
    return res.status(401).send('invalid signature');
  }

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
      if (event.type !== 'message' || !event.replyToken) continue;
      const lineUserId = event?.source?.userId;
      if (!lineUserId) continue;
      const user = await ensureUser(supabase, lineUserId, TZ);

      if (event.message?.type === 'text') {
        await handleTextMessage(event.replyToken, event.message.text, user);
      } else if (event.message?.type === 'image') {
        await handleImageMessage(event.replyToken, user, event);
      }
    } catch (error) {
      console.error('❌ processEvent error:', error?.stack || error?.message || error);
    }
  }

  return res.status(200).send('ok');
});

app.listen(PORT, () => {
  console.log(`✅ LINE bot server listening on ${PORT}`);
});
