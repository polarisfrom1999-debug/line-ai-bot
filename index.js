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

let weightService = {};
try {
  weightService = require('./services/weight_service');
} catch (_err) {
  weightService = {};
}

let routeConversation = null;
try {
  ({ routeConversation } = require('./services/chatgpt_conversation_router'));
} catch (_err) {
  routeConversation = null;
}

let graphService = {};
try {
  graphService = require('./services/graph_service');
} catch (_err) {
  graphService = {};
}

let predictionService = {};
try {
  predictionService = require('./services/prediction_service');
} catch (_err) {
  predictionService = {};
}

const env = getEnv();
const app = express();
const PORT = env.PORT;
const TZ = env.TZ;

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
    const nextUser = buildImageContextPendingUser(user);
    await updateUserState(user.id, nextUser);

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

async function handleTextMessage(replyToken, text, user, event = {}) {
  const rawText = String(text || '').trim();
  if (!rawText) return;

  let activeUser = user;

  if (isImageContextPending(activeUser)) {
    const imageFollowup = await tryHandleImageContextReply(replyToken, rawText, activeUser);
    if (imageFollowup.handled) return;
    activeUser = imageFollowup.user || activeUser;
  }

  if (isGraphIntent(rawText)) {
    await replyGraphIntent(replyToken, rawText, activeUser);
    return;
  }

  if (isPredictionIntent(rawText)) {
    await replyPredictionIntent(replyToken, activeUser);
    return;
  }

  const guideIntent = detectGuideIntent(rawText);
  if (guideIntent) {
    await replyGuideIntent(replyToken, guideIntent);
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

  if (hasPendingCapture(activeUser)) {
    const pendingResult = mergePendingCaptureReply(activeUser, rawText);

    const looksOffTopic = pendingResult.captureType === 'weight'
      && !/(\d+(?:\.\d+)?\s*(kg|ｋｇ|キロ|%|％)|体重|体脂肪)/i.test(rawText);

    const nextUser = looksOffTopic ? clearPendingState(activeUser) : (pendingResult.userPatch || activeUser);

    await updateUserState(activeUser.id, nextUser);

    if (!looksOffTopic) {
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
    activeUser = nextUser;
  }

  const routed = analyzeNewCaptureCandidate(rawText);
  if (routed?.route === 'consultation') {
    const replyText = await buildConversationReply(rawText, activeUser, routed.replyText);
    const guide = buildHealthConsultationGuide(rawText);
    const msg = [replyText, guide].filter(Boolean).join('\n');
    await replyMessage(
      replyToken,
      textMessageWithQuickReplies(msg || '大丈夫です。このまま話してくださいね。', []),
      env.LINE_CHANNEL_ACCESS_TOKEN
    );
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
      await replyMessage(
        replyToken,
        textMessageWithQuickReplies(routed.replyText, []),
        env.LINE_CHANNEL_ACCESS_TOKEN
      );
      return;
    }
  }

  const captureResult = await analyzeChatCapture({ text: rawText, context: { user_id: activeUser.id } });
  if (captureResult?.route === 'body_metrics') {
    await saveBodyMetrics(replyToken, activeUser, captureResult.payload || {});
    return;
  }

  if (captureResult?.route === 'pain_consult' || captureResult?.route === 'consultation') {
    const replyText = await buildConversationReply(rawText, activeUser, captureResult.replyText || '');
    const guide = buildHealthConsultationGuide(rawText);
    const msg = [replyText, guide].filter(Boolean).join('\n');
    await replyMessage(
      replyToken,
      textMessageWithQuickReplies(msg || '大丈夫です。このまま話してくださいね。', []),
      env.LINE_CHANNEL_ACCESS_TOKEN
    );
    return;
  }

  if (captureResult?.route === 'graph') {
    await replyGraphIntent(replyToken, rawText, activeUser);
    return;
  }

  const fallbackReply = await buildConversationReply(rawText, activeUser, '');
  await replyMessage(
    replyToken,
    textMessageWithQuickReplies(
      fallbackReply || 'ありがとうございます。このまま続けて教えてくださいね。必要な形はこちらで整えます。',
      []
    ),
    env.LINE_CHANNEL_ACCESS_TOKEN
  );
}

function buildImageContextPendingUser(user = {}) {
  return {
    ...user,
    pending_capture_type: 'image_context',
    pending_capture_status: 'awaiting_clarification',
    pending_capture_payload: { source: 'image', image_context: 'unknown' },
    pending_capture_missing_fields: ['image_context'],
    pending_capture_prompt: '画像の内容を一言だけ教えてください。',
    pending_capture_started_at: new Date().toISOString(),
    pending_capture_source_text: '[image]',
    pending_capture_attempts: 0,
  };
}

function isImageContextPending(user = {}) {
  return user?.pending_capture_type === 'image_context' && user?.pending_capture_status === 'awaiting_clarification';
}

function clearPendingState(user = {}) {
  return {
    ...user,
    pending_capture_type: null,
    pending_capture_status: null,
    pending_capture_payload: null,
    pending_capture_missing_fields: null,
    pending_capture_prompt: null,
    pending_capture_started_at: null,
    pending_capture_source_text: null,
    pending_capture_attempts: 0,
  };
}

function classifyImageFollowup(text = '') {
  const t = normalizeLoose(text);

  if (!t) return '';
  if (/(血液検査|hba1c|ldl|中性脂肪|コレステロール|γgtp|採血)/.test(t)) return 'blood_test';
  if (/(相談したい|痛い|しびれ|違和感|腫れ|腰|膝|肩|首|足|腕|背中)/.test(t)) return 'consultation';
  if (/(食事|料理|ごはん|朝食|昼食|夕食|おやつ|食べ物)/.test(t)) return 'meal';
  return '';
}

async function tryHandleImageContextReply(replyToken, rawText, user) {
  const kind = classifyImageFollowup(rawText);
  if (!kind) {
    const nextUser = clearPendingState(user);
    await updateUserState(user.id, nextUser);
    return { handled: false, user: nextUser };
  }

  const nextUser = clearPendingState(user);
  await updateUserState(user.id, nextUser);

  if (kind === 'meal') {
    await replyMessage(
      replyToken,
      textMessageWithQuickReplies(
        'ありがとうございます。食事の写真として見ていきます。写真だけでも大丈夫ですし、補足があれば一言だけ続けてください。',
        ['朝ごはんです', '昼ごはんです', '夜ごはんです']
      ),
      env.LINE_CHANNEL_ACCESS_TOKEN
    );
    return { handled: true, user: nextUser };
  }

  if (kind === 'blood_test') {
    await replyMessage(
      replyToken,
      textMessageWithQuickReplies(
        'ありがとうございます。血液検査として整理していきます。見づらい所があれば、必要な所だけあとで確認しますね。',
        ['HbA1cを見たい', 'LDLを見たい']
      ),
      env.LINE_CHANNEL_ACCESS_TOKEN
    );
    return { handled: true, user: nextUser };
  }

  await replyMessage(
    replyToken,
    textMessageWithQuickReplies(
      'ありがとうございます。相談の写真として見ます。気になる場所や、いつからかだけ一言もらえると整理しやすいです。',
      []
    ),
    env.LINE_CHANNEL_ACCESS_TOKEN
  );
  return { handled: true, user: nextUser };
}

function normalizeLoose(text = '') {
  return String(text || '')
    .trim()
    .toLowerCase()
    .replace(/[　\s]+/g, '')
    .replace(/[!！?？。、,.]/g, '');
}

function isGraphIntent(text = '') {
  return /(体重グラフ|食事活動グラフ|hba1cグラフ|ldlグラフ|血液検査グラフ|グラフ)/i.test(String(text || ''));
}

function detectGraphType(text = '') {
  const raw = String(text || '');
  if (/食事.*活動|活動.*食事/.test(raw)) return 'energy';
  if (/hba1c/i.test(raw)) return 'hba1c';
  if (/ldl/i.test(raw)) return 'ldl';
  if (/血液検査/.test(raw)) return 'hba1c';
  return 'weight';
}

function isPredictionIntent(text = '') {
  if (typeof predictionService?.isPredictionIntent === 'function') {
    return predictionService.isPredictionIntent(text);
  }
  return /(予測|見通し|このままだとどうなる|体重予測)/.test(String(text || ''));
}

async function replyGraphIntent(replyToken, rawText, user) {
  const graphType = detectGraphType(rawText);

  try {
    if (graphType === 'weight') {
      const { data, error } = await supabase
        .from('weight_logs')
        .select('logged_at, weight_kg, body_fat_pct')
        .eq('user_id', user.id)
        .order('logged_at', { ascending: true })
        .limit(30);

      if (error) throw error;

      const graph = typeof graphService.buildWeightGraphMessage === 'function'
        ? graphService.buildWeightGraphMessage(data || [])
        : { text: '体重グラフです。', messages: [] };

      const messages = [textMessageWithQuickReplies(graph.text || '体重グラフです。', ['予測', '食事活動グラフ'])]
        .concat(Array.isArray(graph.messages) ? graph.messages : []);

      await replyMessage(replyToken, messages, env.LINE_CHANNEL_ACCESS_TOKEN);
      return;
    }

    if (graphType === 'energy') {
      const end = new Date();
      const start = new Date(Date.now() - 6 * 24 * 60 * 60 * 1000);
      const [mealsRes, actsRes] = await Promise.all([
        supabase.from('meal_logs').select('eaten_at, estimated_kcal').eq('user_id', user.id).gte('eaten_at', start.toISOString()).lte('eaten_at', end.toISOString()),
        supabase.from('activity_logs').select('logged_at, estimated_activity_kcal').eq('user_id', user.id).gte('logged_at', start.toISOString()).lte('logged_at', end.toISOString()),
      ]);
      if (mealsRes.error) throw mealsRes.error;
      if (actsRes.error) throw actsRes.error;

      const rows = [];
      for (const row of mealsRes.data || []) {
        rows.push({ date: row.eaten_at, meal_kcal: row.estimated_kcal, exercise_minutes: null });
      }
      for (const row of actsRes.data || []) {
        rows.push({ date: row.logged_at, exercise_minutes: row.estimated_activity_kcal ? Math.round(Number(row.estimated_activity_kcal) / 5) : 0 });
      }

      const graph = typeof graphService.buildEnergyGraphMessage === 'function'
        ? graphService.buildEnergyGraphMessage(rows)
        : { text: '食事活動グラフです。', messages: [] };
      const messages = [textMessageWithQuickReplies(graph.text || '食事活動グラフです。', ['体重グラフ', '予測'])]
        .concat(Array.isArray(graph.messages) ? graph.messages : []);
      await replyMessage(replyToken, messages, env.LINE_CHANNEL_ACCESS_TOKEN);
      return;
    }

    const field = graphType === 'ldl' ? 'ldl' : 'hba1c';
    const { data, error } = await supabase
      .from('lab_results')
      .select('*')
      .eq('user_id', user.id)
      .order('measured_on', { ascending: true })
      .limit(30);
    if (error) throw error;

    const graph = typeof graphService.buildLabGraphMessage === 'function'
      ? graphService.buildLabGraphMessage(data || [], field)
      : { text: `${field.toUpperCase()}グラフです。`, messages: [] };
    const messages = [textMessageWithQuickReplies(graph.text || '血液検査グラフです。', ['HbA1cグラフ', 'LDLグラフ'])]
      .concat(Array.isArray(graph.messages) ? graph.messages : []);
    await replyMessage(replyToken, messages, env.LINE_CHANNEL_ACCESS_TOKEN);
  } catch (error) {
    console.error('❌ replyGraphIntent error:', error?.message || error);
    await replyMessage(
      replyToken,
      textMessageWithQuickReplies(
        'グラフを出そうとしましたが、今は画像の準備で少しつまずいています。記録自体はたまっています。',
        ['体重 62.4', '予測']
      ),
      env.LINE_CHANNEL_ACCESS_TOKEN
    );
  }
}

async function replyPredictionIntent(replyToken, user) {
  try {
    const dateYmd = getTokyoDateYmd();
    const start = `${dateYmd}T00:00:00+09:00`;
    const end = `${dateYmd}T23:59:59+09:00`;

    const [mealsRes, actsRes] = await Promise.all([
      supabase.from('meal_logs').select('estimated_kcal').eq('user_id', user.id).gte('eaten_at', start).lte('eaten_at', end),
      supabase.from('activity_logs').select('estimated_activity_kcal').eq('user_id', user.id).gte('logged_at', start).lte('logged_at', end),
    ]);

    if (mealsRes.error) throw mealsRes.error;
    if (actsRes.error) throw actsRes.error;

    const intakeKcal = sumBy(mealsRes.data || [], 'estimated_kcal');
    const activityKcal = sumBy(actsRes.data || [], 'estimated_activity_kcal');

    const prediction = typeof predictionService.buildPredictionText === 'function'
      ? predictionService.buildPredictionText({
          estimatedBmr: user.estimated_bmr || 0,
          estimatedTdee: user.estimated_tdee || 0,
          intakeKcal,
          activityKcal,
          currentWeightKg: user.weight_kg || null,
        })
      : { text: '今の流れからの見通しを出しますね。', quickReplies: [] };

    await replyMessage(
      replyToken,
      textMessageWithQuickReplies(prediction.text || '今の流れからの見通しを出しますね。', prediction.quickReplies || ['体重グラフ']),
      env.LINE_CHANNEL_ACCESS_TOKEN
    );
  } catch (error) {
    console.error('❌ replyPredictionIntent error:', error?.message || error);
    await replyMessage(
      replyToken,
      textMessageWithQuickReplies(
        '予測を出そうとしましたが、今は集計で少しつまずいています。体重や食事の記録がたまるほど精度は上がります。',
        ['体重グラフ', '体重 62.4']
      ),
      env.LINE_CHANNEL_ACCESS_TOKEN
    );
  }
}

async function buildConversationReply(rawText, user, fallbackText = '') {
  let replyText = String(fallbackText || '').trim();

  if (typeof routeConversation === 'function') {
    try {
      const conversation = await routeConversation({
        currentUserText: rawText,
        text: rawText,
        recentMessages: [],
        context: {
          display_name: user.display_name || '',
          line_user_id: user.line_user_id || '',
        },
      });
      const candidate = String(
        conversation?.replyText || conversation?.reply_text || conversation?.text || ''
      ).trim();
      if (candidate) replyText = candidate;
    } catch (error) {
      console.warn('⚠️ routeConversation failed:', error?.message || error);
    }
  }

  return replyText;
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
    await replyMessage(
      replyToken,
      textMessageWithQuickReplies('運動の内容は受け取れています。このまま今日の記録として残せる形になりました。', []),
      env.LINE_CHANNEL_ACCESS_TOKEN
    );
    return;
  }

  if (type === 'meal') {
    await replyMessage(
      replyToken,
      textMessageWithQuickReplies('食事の内容は受け取れています。ここから整理して扱える形になりました。', []),
      env.LINE_CHANNEL_ACCESS_TOKEN
    );
    return;
  }

  if (type === 'blood_test') {
    await replyMessage(
      replyToken,
      textMessageWithQuickReplies('血液検査の内容は受け取れています。整理を進めやすい形になりました。', []),
      env.LINE_CHANNEL_ACCESS_TOKEN
    );
    return;
  }

  await replyMessage(
    replyToken,
    textMessageWithQuickReplies('ありがとうございます。内容は受け取れています。', []),
    env.LINE_CHANNEL_ACCESS_TOKEN
  );
}

function toFiniteOrNull(value) {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

async function saveBodyMetrics(replyToken, user, payload = {}) {
  const weightKg = toFiniteOrNull(payload.weight_kg);
  const bodyFatPct = toFiniteOrNull(payload.body_fat_pct);

  if (!Number.isFinite(weightKg) && !Number.isFinite(bodyFatPct)) {
    await replyMessage(
      replyToken,
      textMessageWithQuickReplies('体重や体脂肪率の数字が読み取れなかったので、たとえば「62.4kg」や「体脂肪率 18%」のように送ってくださいね。', []),
      env.LINE_CHANNEL_ACCESS_TOKEN
    );
    return;
  }

  try {
    if (Number.isFinite(weightKg)) {
      const measuredAt = new Date().toISOString();
      await supabase.from('weight_logs').insert({
        user_id: user.id,
        logged_at: measuredAt,
        weight_kg: weightKg,
        body_fat_pct: Number.isFinite(bodyFatPct) ? bodyFatPct : null,
      });
    }

    const userPatch = {};
    if (Number.isFinite(weightKg)) userPatch.weight_kg = weightKg;
    if (Number.isFinite(bodyFatPct)) userPatch.body_fat_pct = bodyFatPct;
    if (Object.keys(userPatch).length) {
      await updateUserState(user.id, { ...user, ...userPatch });
    }

    if (Number.isFinite(weightKg) && typeof weightService.buildWeightSaveMessage === 'function') {
      const msg = weightService.buildWeightSaveMessage({
        weight_kg: weightKg,
        body_fat_pct: Number.isFinite(bodyFatPct) ? bodyFatPct : null,
      });
      await replyMessage(
        replyToken,
        textMessageWithQuickReplies(msg.text || '体重を記録しました。', msg.quickReplies || []),
        env.LINE_CHANNEL_ACCESS_TOKEN
      );
      return;
    }

    if (Number.isFinite(bodyFatPct) && typeof weightService.buildBodyFatSaveMessage === 'function') {
      const msg = weightService.buildBodyFatSaveMessage({ body_fat_pct: bodyFatPct });
      await replyMessage(
        replyToken,
        textMessageWithQuickReplies(msg.text || '体脂肪率を記録しました。', msg.quickReplies || []),
        env.LINE_CHANNEL_ACCESS_TOKEN
      );
      return;
    }

    const lines = [];
    if (Number.isFinite(weightKg)) lines.push(`体重 ${weightKg}kg を受け取りました。`);
    if (Number.isFinite(bodyFatPct)) lines.push(`体脂肪率 ${bodyFatPct}% も一緒に記録しました。`);
    lines.push('こういう積み重ねが流れを整えてくれます。');
    await replyMessage(
      replyToken,
      textMessageWithQuickReplies(lines.join('\n'), []),
      env.LINE_CHANNEL_ACCESS_TOKEN
    );
  } catch (error) {
    console.error('❌ saveBodyMetrics error:', error?.message || error);
    await replyMessage(
      replyToken,
      textMessageWithQuickReplies('数字は受け取れました。今は保存で少しつまずいているので、あとで整えますね。', []),
      env.LINE_CHANNEL_ACCESS_TOKEN
    );
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

  if (Object.prototype.hasOwnProperty.call(nextUser, 'weight_kg')) patch.weight_kg = nextUser.weight_kg;
  if (Object.prototype.hasOwnProperty.call(nextUser, 'body_fat_pct')) patch.body_fat_pct = nextUser.body_fat_pct;
  if (Object.prototype.hasOwnProperty.call(nextUser, 'sex')) patch.sex = nextUser.sex;
  if (Object.prototype.hasOwnProperty.call(nextUser, 'age')) patch.age = nextUser.age;
  if (Object.prototype.hasOwnProperty.call(nextUser, 'height_cm')) patch.height_cm = nextUser.height_cm;
  if (Object.prototype.hasOwnProperty.call(nextUser, 'target_weight_kg')) patch.target_weight_kg = nextUser.target_weight_kg;
  if (Object.prototype.hasOwnProperty.call(nextUser, 'activity_level')) patch.activity_level = nextUser.activity_level;
  if (Object.prototype.hasOwnProperty.call(nextUser, 'estimated_bmr')) patch.estimated_bmr = nextUser.estimated_bmr;
  if (Object.prototype.hasOwnProperty.call(nextUser, 'estimated_tdee')) patch.estimated_tdee = nextUser.estimated_tdee;

  const { error } = await supabase.from('users').update(patch).eq('id', userId);
  if (error) {
    console.warn('⚠️ updateUserState failed:', error.message);
  }
}

function sumBy(rows = [], key = '') {
  return (rows || []).reduce((sum, row) => sum + (Number(row?.[key] || 0) || 0), 0);
}

function getTokyoDateYmd() {
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Tokyo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  return formatter.format(new Date());
}

app.listen(PORT, () => {
  console.log(`✅ LINE bot server listening on ${PORT}`);
});
