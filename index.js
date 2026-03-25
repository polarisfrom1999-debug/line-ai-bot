'use strict';

require('dotenv').config();

const express = require('express');

const { getEnv } = require('./config/env');
const { verifyLineSignature, replyMessage, textMessageWithQuickReplies } = require('./services/line_service');
const { supabase } = require('./services/supabase_service');
const { ensureUser, refreshUserById } = require('./services/user_service');
const {
  safeText,
  analyzeNewCaptureCandidate,
  isOnboardingStart,
  parseBodyMetrics,
} = require('./services/capture_router_service');
const {
  createPendingCapture,
  hasPendingCapture,
  mergePendingCaptureReply,
  clearPendingCapture,
} = require('./services/pending_capture_service');
const { analyzeChatCapture } = require('./services/chat_capture_service');
const {
  buildFirstGuideMessage,
  buildFoodGuideMessage,
  buildExerciseGuideMessage,
  buildWeightGuideMessage,
  buildConsultGuideMessage,
  buildLabGuideMessage,
  buildHelpMenuMessage,
  buildFaqMessage,
} = require('./services/user_guide_service');
const weightService = require('./services/weight_service');
const { routeConversation } = require('./services/chatgpt_conversation_router');
const graphService = require('./services/graph_service');
const predictionService = require('./services/prediction_service');
const {
  isProfileEditIntent,
  isProfileEditDoneIntent,
  buildProfileEditStartMessage,
  buildProfileUpdatePayload,
  buildProfilePartialReply,
} = require('./services/profile_service');

const env = getEnv();
const app = express();
const PORT = env.PORT;
const TZ = env.TZ;

const IMAGE_KIND_OPTIONS = ['食事の写真です', '血液検査です', '相談したい'];

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
    const nextUser = createPendingCapture(user, {
      captureType: 'image_context',
      payload: { kind: 'unknown', source: 'image' },
      missingFields: [],
      replyText: '画像の種類を教えてください。',
      sourceText: 'image',
    });
    await updateUserState(user.id, nextUser);

    await replyMessage(
      event.replyToken,
      textMessageWithQuickReplies(
        '写真を受け取りました。食事なら「食事の写真です」、血液検査なら「血液検査です」、体の相談なら「相談したい」と返してくださいね。',
        IMAGE_KIND_OPTIONS
      ),
      env.LINE_CHANNEL_ACCESS_TOKEN
    );
  }
}

async function handleTextMessage(replyToken, text, user, event = {}) {
  const rawText = String(text || '').trim();
  if (!rawText) return;

  let activeUser = user;

  if (isImageContextPending(activeUser)) {
    const handled = await handleImageContext(replyToken, rawText, activeUser);
    if (handled.handled) return;
    activeUser = handled.user || activeUser;
  }

  if (isProfileEditPending(activeUser)) {
    const handled = await handleProfileEditReply(replyToken, rawText, activeUser);
    if (handled.handled) return;
    activeUser = handled.user || activeUser;
  }

  const graphIntent = getGraphIntentType(rawText);
  if (graphIntent) {
    await replyGraphIntent(replyToken, graphIntent, activeUser);
    return;
  }

  if (isPredictionIntent(rawText)) {
    await replyPredictionIntent(replyToken, activeUser);
    return;
  }

  const guideIntent = detectExplicitGuideIntent(rawText);
  if (guideIntent) {
    await replyGuideIntent(replyToken, guideIntent);
    return;
  }

  if (isProfileEditIntent(rawText)) {
    const nextUser = createPendingCapture(activeUser, {
      captureType: 'profile_edit',
      payload: { mode: 'profile_edit' },
      missingFields: [],
      replyText: buildProfileEditStartMessage(),
      sourceText: rawText,
    });
    await updateUserState(activeUser.id, nextUser);
    await replyMessage(replyToken, textMessageWithQuickReplies(buildProfileEditStartMessage(), ['体重 62', '身長 160', '年齢 55', '完了']), env.LINE_CHANNEL_ACCESS_TOKEN);
    return;
  }

  if (isOnboardingStart(rawText)) {
    await replyMessage(
      replyToken,
      textMessageWithQuickReplies(
        buildFirstGuideMessage({ userName: activeUser.display_name || '' }),
        ['食事の送り方', '運動の送り方', '体重の送り方', '相談の送り方']
      ),
      env.LINE_CHANNEL_ACCESS_TOKEN
    );
    return;
  }

  if (hasPendingCapture(activeUser) && isStandardPendingType(activeUser.pending_capture_type)) {
    const pendingResult = mergePendingCaptureReply(activeUser, rawText);
    const looksOffTopic = pendingResult.captureType === 'weight' && !/(\d+(?:\.\d+)?\s*(kg|ｋｇ|キロ|%|％)|体重|体脂肪)/i.test(rawText);
    const nextUser = looksOffTopic ? clearPendingCapture(activeUser) : (pendingResult.userPatch || activeUser);
    await updateUserState(activeUser.id, nextUser);
    if (!looksOffTopic) {
      if (pendingResult.readyToSave) {
        await handleReadyPendingCapture(replyToken, nextUser, pendingResult);
        return;
      }
      await replyMessage(replyToken, textMessageWithQuickReplies(pendingResult.replyText || '不足しているところだけ、そのまま教えてくださいね。', []), env.LINE_CHANNEL_ACCESS_TOKEN);
      return;
    }
    activeUser = nextUser;
  }

  const directMetrics = parseBodyMetrics(rawText) || (weightService.isWeightIntent(rawText) ? weightService.parseWeightLog(rawText) : null);
  if (directMetrics && (Number.isFinite(Number(directMetrics.weight_kg)) || Number.isFinite(Number(directMetrics.body_fat_pct)))) {
    await saveBodyMetrics(replyToken, activeUser, directMetrics);
    return;
  }

  const routed = analyzeNewCaptureCandidate(rawText);
  if (routed?.route === 'consultation') {
    await replyConsultation(replyToken, rawText, activeUser);
    return;
  }

  if (routed?.route === 'body_metrics') {
    await saveBodyMetrics(replyToken, activeUser, routed.payload);
    return;
  }

  if (routed?.route === 'record_candidate') {
    if (Array.isArray(routed.missingFields) && routed.missingFields.length > 0) {
      const nextUser = createPendingCapture(activeUser, {
        captureType: routed.captureType,
        payload: routed.payload,
        missingFields: routed.missingFields,
        replyText: routed.replyText,
        sourceText: rawText,
      });
      await updateUserState(activeUser.id, nextUser);
      await replyMessage(replyToken, textMessageWithQuickReplies(routed.replyText, []), env.LINE_CHANNEL_ACCESS_TOKEN);
      return;
    }
  }

  const captureResult = await analyzeChatCapture({ text: rawText, context: { user_id: activeUser.id } });
  if (captureResult?.route === 'body_metrics') {
    await saveBodyMetrics(replyToken, activeUser, captureResult.payload || {});
    return;
  }

  if (captureResult?.route === 'pain_consult' || captureResult?.route === 'consultation') {
    await replyConsultation(replyToken, rawText, activeUser, captureResult.replyText);
    return;
  }

  const fallback = await buildConversationReply(rawText, activeUser);
  await replyMessage(replyToken, textMessageWithQuickReplies(fallback || 'ありがとうございます。このまま続けて教えてくださいね。必要な形はこちらで整えます。', []), env.LINE_CHANNEL_ACCESS_TOKEN);
}

function isStandardPendingType(type = '') {
  return ['weight', 'body_metrics', 'exercise', 'meal', 'blood_test'].includes(String(type || ''));
}

function isImageContextPending(user = {}) {
  return user?.pending_capture_type === 'image_context';
}

function isProfileEditPending(user = {}) {
  return user?.pending_capture_type === 'profile_edit';
}

function detectExplicitGuideIntent(text = '') {
  const t = safeText(text);
  if (!t) return '';
  if (/^ヘルプ$|^使い方$|^メニュー$/i.test(t)) return 'help';
  if (/食事.*送り方|食事.*使い方/.test(t)) return 'food';
  if (/運動.*送り方|運動.*使い方|ストレッチ.*送り方/.test(t)) return 'exercise';
  if (/体重.*送り方|体脂肪.*送り方/.test(t)) return 'weight';
  if (/相談.*送り方/.test(t)) return 'consult';
  if (/血液検査.*送り方/.test(t)) return 'lab';
  if (/faq|よくある/i.test(t)) return 'faq';
  return '';
}

function isPredictionIntent(text = '') {
  const t = safeText(text);
  return typeof predictionService.isPredictionIntent === 'function'
    ? predictionService.isPredictionIntent(t)
    : /(予測|体重予測|見通し|このまま続けたら)/.test(t);
}

function getGraphIntentType(text = '') {
  const t = safeText(text).toLowerCase();
  if (!t) return '';
  if (/hba1c/.test(t)) return 'hba1c';
  if (/ldl/.test(t)) return 'ldl';
  if (/血液検査.*(見たい|流れ|グラフ)|検査.*グラフ/.test(t)) return 'hba1c';
  if (/食事活動グラフ|食事.*活動.*グラフ|食事と活動/.test(t)) return 'energy';
  if (/体重グラフ|体重推移|体重の流れ/.test(t)) return 'weight';
  return '';
}

async function handleImageContext(replyToken, rawText, user) {
  const text = safeText(rawText);
  const n = text.replace(/\s+/g, '');

  if (/食事/.test(n)) {
    const nextUser = createPendingCapture(clearPendingCapture(user), {
      captureType: 'meal_photo_followup',
      payload: { context: 'meal_photo' },
      missingFields: [],
      replyText: '食事写真として見ていきます。写真だけでも大丈夫ですし、補足があれば一言だけ続けてください。',
      sourceText: rawText,
    });
    await updateUserState(user.id, nextUser);
    await replyMessage(replyToken, textMessageWithQuickReplies('ありがとうございます。食事写真として見ていきます。写真だけでも大丈夫ですし、補足があれば一言だけ続けてください。', ['朝ごはんです', '昼ごはんです', 'このまま見てください']), env.LINE_CHANNEL_ACCESS_TOKEN);
    return { handled: true, user: nextUser };
  }

  if (/血液検査|検査/.test(n)) {
    const nextUser = createPendingCapture(clearPendingCapture(user), {
      captureType: 'blood_test_followup',
      payload: { context: 'blood_test' },
      missingFields: [],
      replyText: 'ありがとうございます。血液検査として整理していきます。見たい項目があれば HbA1c や LDL のようにそのまま送ってください。',
      sourceText: rawText,
    });
    await updateUserState(user.id, nextUser);
    await replyMessage(replyToken, textMessageWithQuickReplies('ありがとうございます。血液検査として整理していきます。見たい項目があれば HbA1c や LDL のようにそのまま送ってください。', ['HbA1cを見たい', 'LDLを見たい']), env.LINE_CHANNEL_ACCESS_TOKEN);
    return { handled: true, user: nextUser };
  }

  if (/相談/.test(n)) {
    const nextUser = createPendingCapture(clearPendingCapture(user), {
      captureType: 'consult_photo_followup',
      payload: { context: 'consult_photo' },
      missingFields: [],
      replyText: 'ありがとうございます。相談の写真として見ます。気になる場所や、いつからかを一言だけ続けてください。',
      sourceText: rawText,
    });
    await updateUserState(user.id, nextUser);
    await replyMessage(replyToken, textMessageWithQuickReplies('ありがとうございます。相談の写真として見ます。気になる場所や、いつからかを一言だけ続けてください。', []), env.LINE_CHANNEL_ACCESS_TOKEN);
    return { handled: true, user: nextUser };
  }

  await updateUserState(user.id, clearPendingCapture(user));
  return { handled: false, user: clearPendingCapture(user) };
}

async function handleProfileEditReply(replyToken, rawText, user) {
  if (isProfileEditDoneIntent(rawText)) {
    const nextUser = clearPendingCapture(user);
    await updateUserState(user.id, nextUser);
    await replyMessage(replyToken, textMessageWithQuickReplies('プロフィール変更を閉じました。必要な時はまた「プロフィール変更」で大丈夫です。', []), env.LINE_CHANNEL_ACCESS_TOKEN);
    return { handled: true, user: nextUser };
  }

  const payload = buildProfileUpdatePayload(user, rawText);
  if (!payload) {
    await replyMessage(replyToken, textMessageWithQuickReplies('変えたい項目だけ送ってください。例: 体重 62 / 身長 160 / 年齢 55 / 目標 58 / 活動量 ふつう', ['体重 62', '身長 160', '年齢 55', '完了']), env.LINE_CHANNEL_ACCESS_TOKEN);
    return { handled: true, user };
  }

  const nextUser = {
    ...user,
    ...payload.userPatch,
    pending_capture_type: 'profile_edit',
    pending_capture_status: 'awaiting_clarification',
    pending_capture_payload: { mode: 'profile_edit' },
    pending_capture_missing_fields: null,
    pending_capture_prompt: buildProfileEditStartMessage(),
    pending_capture_started_at: user.pending_capture_started_at || new Date().toISOString(),
    pending_capture_source_text: user.pending_capture_source_text || 'profile_edit',
    pending_capture_attempts: Number(user.pending_capture_attempts || 0) + 1,
  };

  await updateUserState(user.id, nextUser);
  await replyMessage(replyToken, textMessageWithQuickReplies(buildProfilePartialReply(payload), ['体重 62', '身長 160', '年齢 55', '完了']), env.LINE_CHANNEL_ACCESS_TOKEN);
  return { handled: true, user: nextUser };
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
  const weightKg = Number(payload.weight_kg);
  const bodyFatPct = payload.body_fat_pct == null ? null : Number(payload.body_fat_pct);
  const hasWeight = Number.isFinite(weightKg);
  const hasBodyFat = Number.isFinite(bodyFatPct);

  if (!hasWeight && !hasBodyFat) {
    await replyMessage(replyToken, textMessageWithQuickReplies('体重や体脂肪率の数字が読み取れなかったので、たとえば「62.4kg」や「体脂肪率 18%」のように送ってくださいね。', []), env.LINE_CHANNEL_ACCESS_TOKEN);
    return;
  }

  try {
    if (hasWeight) {
      await insertWeightLog(user.id, { weight_kg: weightKg, body_fat_pct: hasBodyFat ? bodyFatPct : null });
    }

    const userPatch = {};
    if (hasWeight) userPatch.weight_kg = weightKg;
    if (hasBodyFat) userPatch.body_fat_pct = bodyFatPct;
    if (Object.keys(userPatch).length) {
      await updateUserState(user.id, { ...user, ...userPatch });
    }

    const msg = typeof weightService.buildWeightSaveMessage === 'function'
      ? weightService.buildWeightSaveMessage({ weight_kg: hasWeight ? weightKg : null, body_fat_pct: hasBodyFat ? bodyFatPct : null })
      : { text: '体重を記録しました。', quickReplies: [] };

    await replyMessage(replyToken, textMessageWithQuickReplies(msg.text, msg.quickReplies || []), env.LINE_CHANNEL_ACCESS_TOKEN);
  } catch (error) {
    console.error('❌ saveBodyMetrics error:', error?.message || error);
    await replyMessage(replyToken, textMessageWithQuickReplies('数字は受け取れました。今は保存で少しつまずいているので、あとで整えますね。', []), env.LINE_CHANNEL_ACCESS_TOKEN);
  }
}

async function insertWeightLog(userId, payload = {}) {
  const measuredAt = new Date().toISOString();
  const base = {
    user_id: userId,
    weight_kg: payload.weight_kg,
    body_fat_pct: payload.body_fat_pct ?? null,
  };

  const attempts = [
    { ...base, logged_at: measuredAt },
    { ...base, measured_at: measuredAt },
    base,
  ];

  let lastError = null;
  for (const row of attempts) {
    const { error } = await supabase.from('weight_logs').insert(row);
    if (!error) return;
    lastError = error;
  }
  throw lastError;
}

async function replyConsultation(replyToken, rawText, user, preferredText = '') {
  const replyText = preferredText || await buildConversationReply(rawText, user);
  await replyMessage(replyToken, textMessageWithQuickReplies(replyText || '話してくれてありがとうございます。今いちばん気になるところから、一緒に見ていきましょう。', []), env.LINE_CHANNEL_ACCESS_TOKEN);
}

async function buildConversationReply(rawText, user) {
  const context = {
    display_name: user.display_name || '',
    line_user_id: user.line_user_id || '',
    weight_kg: user.weight_kg,
  };
  try {
    const conversation = await routeConversation({ currentUserText: rawText, text: rawText, recentMessages: [], context });
    return String(conversation?.replyText || conversation?.reply_text || conversation?.text || '').trim();
  } catch (error) {
    console.warn('⚠️ routeConversation failed:', error?.message || error);
    return '話してくれてありがとうございます。今いちばん気になるところから、一緒に見ていきましょう。';
  }
}

async function replyGraphIntent(replyToken, graphType, user) {
  try {
    if (graphType === 'weight') {
      const rows = await fetchWeightRows(user.id);
      const result = graphService.buildWeightGraphMessage(rows);
      const messages = [textMessageWithQuickReplies(result.text, graphService.buildGraphMenuQuickReplies()), ...(result.messages || [])].slice(0, 5);
      await replyMessage(replyToken, messages, env.LINE_CHANNEL_ACCESS_TOKEN);
      return;
    }

    if (graphType === 'energy') {
      const rows = await fetchEnergyRows(user.id);
      const result = graphService.buildEnergyGraphMessage(rows);
      const messages = [textMessageWithQuickReplies(result.text, graphService.buildGraphMenuQuickReplies()), ...(result.messages || [])].slice(0, 5);
      await replyMessage(replyToken, messages, env.LINE_CHANNEL_ACCESS_TOKEN);
      return;
    }

    const rows = await fetchLabRows(user.id);
    const field = graphType === 'ldl' ? 'ldl' : 'hba1c';
    const result = graphService.buildLabGraphMessage(rows, field);
    const messages = [textMessageWithQuickReplies(result.text, ['HbA1cグラフ', 'LDLグラフ', '体重グラフ']), ...(result.messages || [])].slice(0, 5);
    await replyMessage(replyToken, messages, env.LINE_CHANNEL_ACCESS_TOKEN);
  } catch (error) {
    console.error('❌ replyGraphIntent error:', error?.message || error);
    await replyMessage(replyToken, textMessageWithQuickReplies('グラフの準備で少しつまずきました。記録自体は見えているので、少し置いてからもう一度送ってみてくださいね。', ['体重グラフ', 'HbA1cグラフ']), env.LINE_CHANNEL_ACCESS_TOKEN);
  }
}

async function fetchWeightRows(userId) {
  const attempts = [
    { select: 'logged_at, weight_kg, body_fat_pct, created_at', order: 'logged_at' },
    { select: 'measured_at, weight_kg, body_fat_pct, created_at', order: 'measured_at' },
    { select: 'weight_kg, body_fat_pct, created_at', order: 'created_at' },
  ];

  for (const attempt of attempts) {
    const res = await supabase.from('weight_logs').select(attempt.select).eq('user_id', userId).order(attempt.order, { ascending: false }).limit(30);
    if (!res.error) return res.data || [];
  }
  return [];
}

async function fetchLabRows(userId) {
  const attempts = [
    { order: 'measured_at' },
    { order: 'created_at' },
  ];
  for (const attempt of attempts) {
    const res = await supabase.from('lab_results').select('*').eq('user_id', userId).order(attempt.order, { ascending: false }).limit(30);
    if (!res.error) return res.data || [];
  }
  return [];
}

async function fetchEnergyRows(userId) {
  const mealAttempts = [
    { order: 'logged_at' },
    { order: 'eaten_at' },
    { order: 'created_at' },
  ];
  const activityAttempts = [
    { order: 'logged_at' },
    { order: 'performed_at' },
    { order: 'created_at' },
  ];

  let meals = [];
  for (const attempt of mealAttempts) {
    const res = await supabase.from('meal_logs').select('*').eq('user_id', userId).order(attempt.order, { ascending: false }).limit(14);
    if (!res.error) {
      meals = res.data || [];
      break;
    }
  }

  let activities = [];
  for (const attempt of activityAttempts) {
    const res = await supabase.from('activity_logs').select('*').eq('user_id', userId).order(attempt.order, { ascending: false }).limit(14);
    if (!res.error) {
      activities = res.data || [];
      break;
    }
  }

  return [...meals, ...activities].sort((a, b) => new Date(b.created_at || b.logged_at || b.eaten_at || 0) - new Date(a.created_at || a.logged_at || a.eaten_at || 0));
}

async function replyPredictionIntent(replyToken, user) {
  try {
    const currentWeight = Number(user.weight_kg);
    const estimatedBmr = Number(user.estimated_bmr || 0);
    const estimatedTdee = Number(user.estimated_tdee || 0);
    const result = predictionService.buildPredictionText({
      estimatedBmr,
      estimatedTdee,
      intakeKcal: 0,
      activityKcal: 0,
      currentWeightKg: Number.isFinite(currentWeight) ? currentWeight : null,
    });
    let text = String(result?.text || '').trim();
    if (!estimatedTdee) {
      text = [
        '予測はできますが、今はプロフィールや記録がまだ足りないのでざっくりになります。',
        Number.isFinite(currentWeight) ? `今見えている体重は ${currentWeight}kg です。` : null,
        '体重・食事・活動が少したまると、ここから先の流れをもっと自然に見やすくできます。',
      ].filter(Boolean).join('\n');
    }
    await replyMessage(replyToken, textMessageWithQuickReplies(text, ['体重グラフ', 'プロフィール変更', '食事を記録']), env.LINE_CHANNEL_ACCESS_TOKEN);
  } catch (error) {
    console.error('❌ replyPredictionIntent error:', error?.message || error);
    await replyMessage(replyToken, textMessageWithQuickReplies('予測は出せますが、今は少し準備でつまずいています。体重や食事の記録がたまると見やすくなります。', ['体重グラフ', 'プロフィール変更']), env.LINE_CHANNEL_ACCESS_TOKEN);
  }
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

  for (const key of ['weight_kg', 'body_fat_pct', 'sex', 'age', 'height_cm', 'target_weight_kg', 'activity_level', 'estimated_bmr', 'estimated_tdee']) {
    if (Object.prototype.hasOwnProperty.call(nextUser, key)) patch[key] = nextUser[key];
  }

  const { error } = await supabase.from('users').update(patch).eq('id', userId);
  if (error) {
    console.warn('⚠️ updateUserState failed:', error.message);
  }
}

app.listen(PORT, () => {
  console.log(`✅ LINE bot server listening on ${PORT}`);
});
