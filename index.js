'use strict';

require('dotenv').config();

const express = require('express');

const { getEnv } = require('./config/env');
const { verifyLineSignature, replyMessage, textMessageWithQuickReplies } = require('./services/line_service');
const { supabase } = require('./services/supabase_service');
const { ensureUser } = require('./services/user_service');
const { analyzeNewCaptureCandidate, isOnboardingStart } = require('./services/capture_router_service');
const {
  createPendingCapture,
  hasPendingCapture,
  mergePendingCaptureReply,
} = require('./services/pending_capture_service');
const { buildConfirmationMessage } = require('./services/record_confirmation_service');
const { analyzeChatCapture } = require('./services/chat_capture_service');
const { buildHealthConsultationGuide } = require('./services/health_consultation_service');
const {
  detectGuideIntent,
  buildFirstGuideMessage,
  buildFoodGuideMessage,
  buildExerciseGuideMessage,
  buildWeightGuideMessage,
  buildConsultGuideMessage,
  buildLabGuideMessage,
  buildHelpMenuMessage,
  buildFaqMessage,
} = require('./services/user_guide_service');
const {
  buildWeightSaveMessage,
  buildBodyFatSaveMessage,
} = require('./services/weight_service');
const {
  buildProfileUpdatePayload,
  buildPartialProfileReply,
  profileGuideMessage,
} = require('./services/profile_service');
const {
  buildGraphMenuQuickReplies,
  buildWeightGraphMessage,
  buildEnergyGraphMessage,
  buildLabGraphMessage,
} = require('./services/graph_service');
const {
  buildPredictionText,
  isPredictionIntent,
} = require('./services/prediction_service');

let routeConversation = null;
try {
  ({ routeConversation } = require('./services/chatgpt_conversation_router'));
} catch (_err) {
  routeConversation = null;
}

const env = getEnv();
const app = express();
const PORT = env.PORT;
const TZ = env.TZ;
const imageContextByLineUserId = new Map();
const profileEditByLineUserId = new Map();

app.get('/', (_req, res) => {
  res.status(200).send('ok');
});

app.get('/healthz', (_req, res) => {
  res.status(200).json({ ok: true, tz: TZ, now: new Date().toISOString() });
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
    setImageContext(lineUserId, 'unknown');
    await replyMessage(
      event.replyToken,
      textMessageWithQuickReplies(
        '写真を受け取りました。食事なら「食事の写真です」、血液検査なら「血液検査です」、体の相談なら「相談したい」と返してくださいね。',
        ['食事の写真です', '血液検査です', '相談したい']
      ),
      env.LINE_CHANNEL_ACCESS_TOKEN
    );
  }
}

function normalizeText(text = '') {
  return String(text || '')
    .trim()
    .toLowerCase()
    .replace(/[　\s]+/g, '')
    .replace(/[!！?？。、,.]/g, '');
}

function setImageContext(lineUserId, kind = 'unknown') {
  imageContextByLineUserId.set(String(lineUserId), { kind, at: Date.now() });
}

function getImageContext(lineUserId) {
  const item = imageContextByLineUserId.get(String(lineUserId));
  if (!item) return null;
  if (Date.now() - Number(item.at || 0) > 20 * 60 * 1000) {
    imageContextByLineUserId.delete(String(lineUserId));
    return null;
  }
  return item;
}

function clearImageContext(lineUserId) {
  imageContextByLineUserId.delete(String(lineUserId));
}

function isProfileEditMode(lineUserId) {
  return !!profileEditByLineUserId.get(String(lineUserId));
}

function setProfileEditMode(lineUserId, enabled = true) {
  if (enabled) profileEditByLineUserId.set(String(lineUserId), { at: Date.now() });
  else profileEditByLineUserId.delete(String(lineUserId));
}

async function handleTextMessage(replyToken, text, user, event = {}) {
  const rawText = String(text || '').trim();
  const lineUserId = user.line_user_id || event?.source?.userId || '';
  if (!rawText) return;

  if (await handleMemoryIntent(replyToken, rawText, user)) return;
  if (await handleImageFollowupIntent(replyToken, rawText, user, lineUserId)) return;
  if (await handleProfileIntent(replyToken, rawText, user, lineUserId)) return;
  if (await handleGraphAndPredictionIntent(replyToken, rawText, user)) return;

  const guideIntent = detectGuideIntent(rawText);
  if (guideIntent) {
    await replyGuideIntent(replyToken, guideIntent);
    return;
  }

  if (isOnboardingStart(rawText)) {
    await replyMessage(
      replyToken,
      textMessageWithQuickReplies(
        buildFirstGuideMessage({ userName: user.display_name || '' }),
        ['食事の送り方', '運動の送り方', '体重の送り方', '相談の送り方']
      ),
      env.LINE_CHANNEL_ACCESS_TOKEN
    );
    return;
  }

  if (hasPendingCapture(user)) {
    const pendingResult = mergePendingCaptureReply(user, rawText);
    const nextUser = pendingResult.userPatch || user;
    await updateUserState(user.id, nextUser);

    if (pendingResult.readyToSave) {
      await handleReadyPendingCapture(replyToken, nextUser, pendingResult);
      return;
    }

    await replyMessage(
      replyToken,
      textMessageWithQuickReplies(
        pendingResult.replyText || '不足しているところだけ、そのまま教えてくださいね。',
        []
      ),
      env.LINE_CHANNEL_ACCESS_TOKEN
    );
    return;
  }

  const routed = analyzeNewCaptureCandidate(rawText);
  if (routed?.route === 'consultation') {
    await replyConsultation(replyToken, rawText, user);
    return;
  }

  if (routed?.route === 'body_metrics') {
    await saveBodyMetrics(replyToken, user, routed.payload);
    return;
  }

  if (routed?.route === 'record_candidate') {
    if (Array.isArray(routed.missingFields) && routed.missingFields.length > 0) {
      const nextUser = createPendingCapture(user, {
        captureType: routed.captureType,
        payload: routed.payload,
        missingFields: routed.missingFields,
        replyText: routed.replyText,
        sourceText: rawText,
      });
      await updateUserState(user.id, nextUser);
      await replyMessage(replyToken, textMessageWithQuickReplies(routed.replyText, []), env.LINE_CHANNEL_ACCESS_TOKEN);
      return;
    }
  }

  const captureResult = await analyzeChatCapture({ text: rawText, context: { user_id: user.id, line_user_id: lineUserId } });
  if (captureResult?.route === 'body_metrics') {
    await saveBodyMetrics(replyToken, user, captureResult.payload || {});
    return;
  }

  if (captureResult?.route === 'pain_consult' || captureResult?.route === 'consultation') {
    await replyConsultation(replyToken, rawText, user, captureResult.replyText);
    return;
  }

  if (captureResult?.route === 'record_candidate' && captureResult.candidate) {
    const confirm = buildConfirmationMessage(captureResult.candidate);
    await replyMessage(replyToken, textMessageWithQuickReplies(confirm.text, ['はい', '違います']), env.LINE_CHANNEL_ACCESS_TOKEN);
    return;
  }

  if (typeof routeConversation === 'function') {
    try {
      const conversation = await routeConversation({
        currentUserText: rawText,
        text: rawText,
        recentMessages: [],
        context: { display_name: user.display_name || '', line_user_id: lineUserId },
      });
      const replyText = String(conversation?.replyText || conversation?.reply_text || conversation?.text || '').trim();
      if (replyText) {
        await replyMessage(replyToken, textMessageWithQuickReplies(replyText, []), env.LINE_CHANNEL_ACCESS_TOKEN);
        return;
      }
    } catch (error) {
      console.warn('⚠️ routeConversation failed:', error?.message || error);
    }
  }

  await replyMessage(
    replyToken,
    textMessageWithQuickReplies('ありがとうございます。このまま続けて教えてくださいね。必要な形はこちらで整えます。', []),
    env.LINE_CHANNEL_ACCESS_TOKEN
  );
}

async function handleMemoryIntent(replyToken, rawText, user) {
  const normalized = normalizeText(rawText);
  if (normalized.includes('名前覚えてる')) {
    const name = String(user.display_name || '').trim();
    const text = name ? `${name}さんとして見ています。呼び方を変えたい時は、そのまま教えてくださいね。` : '今はお名前を見ながら伴走しています。呼ばれ方を決めたい時は、そのまま教えてくださいね。';
    await replyMessage(replyToken, textMessageWithQuickReplies(text, []), env.LINE_CHANNEL_ACCESS_TOKEN);
    return true;
  }
  if (normalized.includes('体重覚えてる')) {
    const weight = user.weight_kg != null ? Number(user.weight_kg) : null;
    const text = Number.isFinite(weight)
      ? `今の記録では ${weight}kg として見ています。流れを見たければ「体重グラフ」でも大丈夫です。`
      : '今の体重はまだはっきり残っていないので、数字を送ってもらえればすぐ見られるようにします。';
    await replyMessage(replyToken, textMessageWithQuickReplies(text, ['体重グラフ', '予測']), env.LINE_CHANNEL_ACCESS_TOKEN);
    return true;
  }
  return false;
}

async function handleProfileIntent(replyToken, rawText, user, lineUserId) {
  const normalized = normalizeText(rawText);
  if (normalized === 'プロフィール変更') {
    setProfileEditMode(lineUserId, true);
    await replyMessage(replyToken, textMessageWithQuickReplies(`プロフィール変更ですね。\n${profileGuideMessage()}`, ['体重 62', '身長 160', '年齢 55', '目標 58', '完了']), env.LINE_CHANNEL_ACCESS_TOKEN);
    return true;
  }

  if (isProfileEditMode(lineUserId)) {
    if (normalized === '完了') {
      setProfileEditMode(lineUserId, false);
      await replyMessage(replyToken, textMessageWithQuickReplies('プロフィール変更を閉じました。必要な時にまたそのまま送ってくださいね。', []), env.LINE_CHANNEL_ACCESS_TOKEN);
      return true;
    }

    const updatePayload = buildProfileUpdatePayload(user, rawText);
    if (!updatePayload) {
      await replyMessage(replyToken, textMessageWithQuickReplies('変えたい項目だけ送ってください。例: 体重 62 / 身長 160 / 年齢 55 / 目標 58 / 活動量 ふつう', ['体重 62', '身長 160', '年齢 55', '目標 58', '完了']), env.LINE_CHANNEL_ACCESS_TOKEN);
      return true;
    }

    const patch = {
      sex: updatePayload.sex,
      age: updatePayload.age,
      height_cm: updatePayload.height_cm,
      weight_kg: updatePayload.weight_kg,
      target_weight_kg: updatePayload.target_weight_kg,
      activity_level: updatePayload.activity_level,
      estimated_bmr: updatePayload.estimated_bmr,
      estimated_tdee: updatePayload.estimated_tdee,
    };
    await updateUserProfile(user.id, patch);
    await replyMessage(replyToken, textMessageWithQuickReplies(buildPartialProfileReply(updatePayload), ['完了']), env.LINE_CHANNEL_ACCESS_TOKEN);
    return true;
  }

  return false;
}

async function handleImageFollowupIntent(replyToken, rawText, user, lineUserId) {
  const imageContext = getImageContext(lineUserId);
  const normalized = normalizeText(rawText);

  if (normalized === '食事の写真です') {
    setImageContext(lineUserId, 'meal');
    await replyMessage(replyToken, textMessageWithQuickReplies('ありがとうございます。食事写真として見ていきます。料理名や量の補足があれば一言だけ続けてください。', ['このまま見て', '量は少なめ', '量は普通']), env.LINE_CHANNEL_ACCESS_TOKEN);
    return true;
  }

  if (normalized === '血液検査です') {
    setImageContext(lineUserId, 'lab');
    await replyMessage(replyToken, textMessageWithQuickReplies('ありがとうございます。血液検査として整理していきます。見たい項目があればそのまま送ってください。', ['HbA1cを見たい', 'LDLを見たい', '血液検査グラフ']), env.LINE_CHANNEL_ACCESS_TOKEN);
    return true;
  }

  if (normalized === '相談したい') {
    setImageContext(lineUserId, 'consult');
    await replyMessage(replyToken, textMessageWithQuickReplies('ありがとうございます。相談の写真として見ます。気になる場所や、いつからかを一言だけ続けてください。', []), env.LINE_CHANNEL_ACCESS_TOKEN);
    return true;
  }

  if (imageContext?.kind === 'lab' && (normalized.includes('hba1c') || normalized.includes('ldl') || normalized.includes('血液検査グラフ'))) {
    await replyLabIntent(replyToken, rawText, user);
    return true;
  }

  if (imageContext?.kind === 'consult' && /しびれ|痺れ|痛い|相談|肩|腰|膝|足|脚/.test(rawText)) {
    await replyConsultation(replyToken, rawText, user);
    return true;
  }

  if (imageContext?.kind === 'meal' && normalized.includes('写真')) {
    await replyMessage(replyToken, textMessageWithQuickReplies('食事写真として受け取っています。料理名や量の補足があれば一言だけ続けてください。', []), env.LINE_CHANNEL_ACCESS_TOKEN);
    return true;
  }

  return false;
}

async function handleGraphAndPredictionIntent(replyToken, rawText, user) {
  const normalized = normalizeText(rawText);

  if (normalized === 'グラフ') {
    await replyMessage(replyToken, textMessageWithQuickReplies('見たいグラフを選んでください。', buildGraphMenuQuickReplies()), env.LINE_CHANNEL_ACCESS_TOKEN);
    return true;
  }

  if (normalized === '体重グラフ') {
    try {
      const rows = await getRecentWeightLogsSafe(user.id, 14);
      const graph = buildWeightGraphMessage(rows);
      const messages = [textMessageWithQuickReplies(graph.text, ['予測', '食事活動グラフ', 'HbA1cグラフ'])];
      if (graph.messages.length) messages.push(...graph.messages);
      await replyMessage(replyToken, messages, env.LINE_CHANNEL_ACCESS_TOKEN);
    } catch (error) {
      console.error('❌ replyGraphIntent error:', error?.message || error);
      await replyMessage(replyToken, textMessageWithQuickReplies('体重グラフを出そうとしましたが、今は画像の準備で少しつまずいています。記録自体は見ています。', ['予測']), env.LINE_CHANNEL_ACCESS_TOKEN);
    }
    return true;
  }

  if (normalized === '食事活動グラフ') {
    try {
      const rows = await getSevenDayEnergyRows(user.id);
      const graph = buildEnergyGraphMessage(rows);
      const messages = [textMessageWithQuickReplies(graph.text, ['予測', '体重グラフ', 'HbA1cグラフ'])];
      if (graph.messages.length) messages.push(...graph.messages);
      await replyMessage(replyToken, messages, env.LINE_CHANNEL_ACCESS_TOKEN);
    } catch (error) {
      console.error('❌ energy graph error:', error?.message || error);
      await replyMessage(replyToken, textMessageWithQuickReplies('食事活動グラフは今少し準備でつまずいています。記録自体はたまっています。', ['予測']), env.LINE_CHANNEL_ACCESS_TOKEN);
    }
    return true;
  }

  if (normalized === 'hba1cグラフ' || normalized === 'ldlグラフ' || normalized === '血液検査グラフ') {
    await replyLabIntent(replyToken, rawText, user);
    return true;
  }

  if (normalized === 'hba1cを見たい' || normalized === 'ldlを見たい') {
    await replyLabIntent(replyToken, rawText, user);
    return true;
  }

  if (isPredictionIntent(rawText) || normalized === '予測' || normalized === '体重予測') {
    try {
      const totals = await getTodayEnergyTotals(user.id);
      const prediction = buildPredictionText({
        estimatedBmr: user.estimated_bmr || 0,
        estimatedTdee: user.estimated_tdee || 0,
        intakeKcal: totals.intake_kcal || 0,
        activityKcal: totals.activity_kcal || 0,
        currentWeightKg: user.weight_kg || null,
      });
      await replyMessage(replyToken, textMessageWithQuickReplies(prediction.text, [...(prediction.quickReplies || []), '体重グラフ']), env.LINE_CHANNEL_ACCESS_TOKEN);
    } catch (error) {
      console.error('❌ prediction error:', error?.message || error);
      await replyMessage(replyToken, textMessageWithQuickReplies('予測は今少し準備でつまずいていますが、体重や食事の流れは見ています。', ['体重グラフ']), env.LINE_CHANNEL_ACCESS_TOKEN);
    }
    return true;
  }

  return false;
}

async function replyLabIntent(replyToken, rawText, user) {
  const normalized = normalizeText(rawText);
  try {
    const rows = await getRecentLabResults(user.id, 12);
    const field = normalized.includes('ldl') ? 'ldl' : 'hba1c';
    const graph = buildLabGraphMessage(rows, field);
    const latest = rows[0] || null;
    let extra = '';
    if (latest) {
      if (field === 'hba1c' && latest.hba1c != null) extra = `最新の HbA1c は ${latest.hba1c} です。`;
      if (field === 'ldl' && latest.ldl != null) extra = `最新の LDL は ${latest.ldl} です。`;
    }
    const text = [extra, graph.text].filter(Boolean).join('\n');
    const messages = [textMessageWithQuickReplies(text || '血液検査の流れを見ていきます。', ['HbA1cグラフ', 'LDLグラフ', '体重グラフ'])];
    if (graph.messages.length) messages.push(...graph.messages);
    await replyMessage(replyToken, messages, env.LINE_CHANNEL_ACCESS_TOKEN);
  } catch (error) {
    console.error('❌ lab intent error:', error?.message || error);
    await replyMessage(replyToken, textMessageWithQuickReplies('血液検査の流れを見ようとしましたが、今は少しつまずいています。保存された値自体は確認していきます。', []), env.LINE_CHANNEL_ACCESS_TOKEN);
  }
}

async function replyConsultation(replyToken, rawText, user, preferredText = '') {
  let replyText = String(preferredText || '').trim();
  if (!replyText && typeof routeConversation === 'function') {
    try {
      const conversation = await routeConversation({
        currentUserText: rawText,
        text: rawText,
        recentMessages: [],
        context: { display_name: user.display_name || '', line_user_id: user.line_user_id || '' },
      });
      replyText = String(conversation?.replyText || conversation?.reply_text || conversation?.text || '').trim();
    } catch (error) {
      console.warn('⚠️ routeConversation failed in consultation branch:', error?.message || error);
    }
  }
  const guide = buildHealthConsultationGuide(rawText);
  const msg = [replyText || '気になっていることを、そのまま一つだけでも大丈夫です。いっしょに見ていきましょう。', guide].filter(Boolean).join('\n');
  await replyMessage(replyToken, textMessageWithQuickReplies(msg, []), env.LINE_CHANNEL_ACCESS_TOKEN);
}

async function replyGuideIntent(replyToken, guideIntent = '') {
  let text = buildHelpMenuMessage();
  if (guideIntent === 'food') text = buildFoodGuideMessage();
  else if (guideIntent === 'exercise') text = buildExerciseGuideMessage();
  else if (guideIntent === 'weight') text = buildWeightGuideMessage();
  else if (guideIntent === 'consult') text = buildConsultGuideMessage();
  else if (guideIntent === 'lab') text = buildLabGuideMessage();
  else if (guideIntent === 'faq') text = buildFaqMessage();
  else if (guideIntent === 'help') text = buildHelpMenuMessage();
  await replyMessage(replyToken, textMessageWithQuickReplies(text, []), env.LINE_CHANNEL_ACCESS_TOKEN);
}

async function handleReadyPendingCapture(replyToken, user, pendingResult = {}) {
  const type = String(pendingResult.captureType || '').trim();
  const payload = pendingResult.payload || {};

  if (type === 'weight' || type === 'body_metrics') {
    await saveBodyMetrics(replyToken, user, payload);
    return;
  }

  if (type === 'exercise') {
    await replyMessage(replyToken, textMessageWithQuickReplies('運動の内容は受け取れています。このまま今日の記録として残せる形になりました。', []), env.LINE_CHANNEL_ACCESS_TOKEN);
    return;
  }

  if (type === 'meal') {
    await replyMessage(replyToken, textMessageWithQuickReplies('食事の内容は受け取れています。ここから整理して扱える形になりました。', []), env.LINE_CHANNEL_ACCESS_TOKEN);
    return;
  }

  if (type === 'blood_test') {
    await replyMessage(replyToken, textMessageWithQuickReplies('血液検査の内容は受け取れています。整理を進めやすい形になりました。', []), env.LINE_CHANNEL_ACCESS_TOKEN);
    return;
  }

  await replyMessage(replyToken, textMessageWithQuickReplies('ありがとうございます。内容は受け取れています。', []), env.LINE_CHANNEL_ACCESS_TOKEN);
}

async function saveBodyMetrics(replyToken, user, payload = {}) {
  const weightKg = payload.weight_kg == null ? null : Number(payload.weight_kg);
  const bodyFatPct = payload.body_fat_pct == null ? null : Number(payload.body_fat_pct);

  if (!Number.isFinite(weightKg) && !Number.isFinite(bodyFatPct)) {
    await replyMessage(replyToken, textMessageWithQuickReplies('体重や体脂肪率の数字が読み取れなかったので、たとえば「62.4kg」や「体脂肪率 18%」のように送ってくださいね。', []), env.LINE_CHANNEL_ACCESS_TOKEN);
    return;
  }

  try {
    if (Number.isFinite(weightKg)) {
      await insertWeightLogSafe(user.id, {
        weight_kg: Math.round(weightKg * 10) / 10,
        body_fat_pct: Number.isFinite(bodyFatPct) ? Math.round(bodyFatPct * 10) / 10 : null,
      });
    }

    const userPatch = {};
    if (Number.isFinite(weightKg)) userPatch.weight_kg = Math.round(weightKg * 10) / 10;
    if (Number.isFinite(bodyFatPct)) userPatch.body_fat_pct = Math.round(bodyFatPct * 10) / 10;
    if (Object.keys(userPatch).length) await updateUserProfile(user.id, userPatch);

    const message = Number.isFinite(weightKg)
      ? buildWeightSaveMessage({ weight_kg: userPatch.weight_kg, body_fat_pct: Object.prototype.hasOwnProperty.call(userPatch, 'body_fat_pct') ? userPatch.body_fat_pct : null })
      : buildBodyFatSaveMessage({ body_fat_pct: userPatch.body_fat_pct });

    await replyMessage(replyToken, textMessageWithQuickReplies(message.text || '数字を受け取りました。', message.quickReplies || []), env.LINE_CHANNEL_ACCESS_TOKEN);
  } catch (error) {
    console.error('❌ saveBodyMetrics error:', error?.message || error);
    await replyMessage(replyToken, textMessageWithQuickReplies('数字は受け取れました。今は保存で少しつまずいているので、あとで整えますね。', []), env.LINE_CHANNEL_ACCESS_TOKEN);
  }
}

async function getRecentWeightLogsSafe(userId, limit = 14) {
  const attempts = [
    { select: 'measured_at, weight_kg, body_fat_pct', order: 'measured_at', mapDate: 'measured_at' },
    { select: 'logged_at, weight_kg, body_fat_pct', order: 'logged_at', mapDate: 'logged_at' },
    { select: 'created_at, weight_kg, body_fat_pct', order: 'created_at', mapDate: 'created_at' },
  ];
  for (const attempt of attempts) {
    const { data, error } = await supabase.from('weight_logs').select(attempt.select).eq('user_id', userId).order(attempt.order, { ascending: false }).limit(limit);
    if (!error) return (data || []).map((row) => ({ ...row, date: row[attempt.mapDate] || row.date || null }));
  }
  return [];
}

async function insertWeightLogSafe(userId, payload = {}) {
  const nowIso = new Date().toISOString();
  const attempts = [
    { user_id: userId, measured_at: nowIso, weight_kg: payload.weight_kg, body_fat_pct: payload.body_fat_pct },
    { user_id: userId, logged_at: nowIso, weight_kg: payload.weight_kg, body_fat_pct: payload.body_fat_pct },
    { user_id: userId, weight_kg: payload.weight_kg, body_fat_pct: payload.body_fat_pct },
  ];
  let lastError = null;
  for (const attempt of attempts) {
    const { error } = await supabase.from('weight_logs').insert(attempt);
    if (!error) return true;
    lastError = error;
  }
  throw lastError || new Error('weight log insert failed');
}

async function getTodayEnergyTotals(userId) {
  const dateYmd = currentDateYmdInTZ(TZ);
  const start = `${dateYmd}T00:00:00+09:00`;
  const end = `${dateYmd}T23:59:59+09:00`;
  const [mealsRes, actsRes] = await Promise.all([
    supabase.from('meal_logs').select('estimated_kcal').eq('user_id', userId).gte('eaten_at', start).lte('eaten_at', end),
    supabase.from('activity_logs').select('estimated_activity_kcal').eq('user_id', userId).gte('logged_at', start).lte('logged_at', end),
  ]);
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
    supabase.from('meal_logs').select('eaten_at, estimated_kcal').eq('user_id', userId).gte('eaten_at', startIso).lte('eaten_at', endIso),
    supabase.from('activity_logs').select('logged_at, estimated_activity_kcal').eq('user_id', userId).gte('logged_at', startIso).lte('logged_at', endIso),
  ]);
  const intakeSeries = buildDailySeries(mealsRes.data || [], 'eaten_at', 'estimated_kcal', 7);
  const activitySeries = buildDailySeries(actsRes.data || [], 'logged_at', 'estimated_activity_kcal', 7);
  return intakeSeries.map((row, idx) => ({
    date: row.date,
    intake_kcal: row.value,
    activity_kcal: activitySeries[idx]?.value || 0,
    net_kcal: row.value - (activitySeries[idx]?.value || 0),
  }));
}

async function getRecentLabResults(userId, limit = 12) {
  const { data, error } = await supabase.from('lab_results').select('*').eq('user_id', userId).order('measured_at', { ascending: false }).limit(limit);
  if (error) throw error;
  return Array.isArray(data) ? data : [];
}

function sumBy(rows = [], key = '') {
  return (Array.isArray(rows) ? rows : []).reduce((sum, row) => sum + (Number(row?.[key] || 0) || 0), 0);
}

function currentDateYmdInTZ() {
  const d = new Date();
  const local = new Date(d.toLocaleString('en-US', { timeZone: TZ }));
  const y = local.getFullYear();
  const m = String(local.getMonth() + 1).padStart(2, '0');
  const day = String(local.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function buildDailySeries(rows = [], dateKey = 'created_at', valueKey = 'value', days = 7) {
  const end = new Date(new Date().toLocaleString('en-US', { timeZone: TZ }));
  const map = new Map();
  const labels = [];
  for (let i = days - 1; i >= 0; i -= 1) {
    const d = new Date(end);
    d.setDate(end.getDate() - i);
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    const key = `${y}-${m}-${day}`;
    labels.push(key);
    map.set(key, 0);
  }
  for (const row of Array.isArray(rows) ? rows : []) {
    const raw = String(row?.[dateKey] || '');
    const key = raw.slice(0, 10);
    if (!map.has(key)) continue;
    map.set(key, (map.get(key) || 0) + (Number(row?.[valueKey] || 0) || 0));
  }
  return labels.map((date) => ({ date, value: map.get(date) || 0 }));
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
  if (Object.prototype.hasOwnProperty.call(nextUser, 'weight_kg')) patch.weight_kg = nextUser.weight_kg;
  if (Object.prototype.hasOwnProperty.call(nextUser, 'body_fat_pct')) patch.body_fat_pct = nextUser.body_fat_pct;
  const { error } = await supabase.from('users').update(patch).eq('id', userId);
  if (error) console.warn('⚠️ updateUserState failed:', error.message);
}

async function updateUserProfile(userId, patch = {}) {
  const payload = {};
  const allowed = ['sex', 'age', 'height_cm', 'weight_kg', 'target_weight_kg', 'activity_level', 'estimated_bmr', 'estimated_tdee', 'body_fat_pct'];
  for (const key of allowed) {
    if (Object.prototype.hasOwnProperty.call(patch, key) && patch[key] !== undefined) payload[key] = patch[key];
  }
  if (!Object.keys(payload).length) return;
  const { error } = await supabase.from('users').update(payload).eq('id', userId);
  if (error) {
    console.warn('⚠️ updateUserProfile failed:', error.message);
    throw error;
  }
}

app.listen(PORT, () => {
  console.log(`✅ LINE bot server listening on ${PORT}`);
});
