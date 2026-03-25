'use strict';

require('dotenv').config();

const express = require('express');

const { getEnv } = require('./config/env');
const { verifyLineSignature, replyMessage, textMessageWithQuickReplies } = require('./services/line_service');
const { supabase } = require('./services/supabase_service');
const { ensureUser, refreshUserById } = require('./services/user_service');
const {
  analyzeNewCaptureCandidate,
  isOnboardingStart,
  isProfileEditStart,
} = require('./services/capture_router_service');
const {
  createPendingCapture,
  hasPendingCapture,
  mergePendingCaptureReply,
} = require('./services/pending_capture_service');
const { buildConfirmationMessage } = require('./services/record_confirmation_service');
const { analyzeChatCapture } = require('./services/chat_capture_service');
const { buildHealthConsultationGuide } = require('./services/health_consultation_service');
const { buildProfileUpdatePayload, buildProfileReply, profileGuideMessage } = require('./services/profile_service');
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
    const nextUser = createPendingCapture(user, {
      captureType: 'image_context',
      payload: { source_type: 'image', received_at: new Date().toISOString() },
      missingFields: ['image_context'],
      replyText: '画像ありがとうございます。これは 食事 / 血液検査 / 相談 のどれかをそのまま送ってくださいね。',
      sourceText: 'image',
    });
    await updateUserState(user.id, nextUser);

    await replyMessage(
      event.replyToken,
      textMessageWithQuickReplies(
        '画像ありがとうございます。これは 食事 / 血液検査 / 相談 のどれかをそのまま送ってくださいね。',
        ['食事の写真です', '血液検査です', '相談したい']
      ),
      env.LINE_CHANNEL_ACCESS_TOKEN
    );
  }
}

async function handleTextMessage(replyToken, text, user, event = {}) {
  const rawText = String(text || '').trim();
  if (!rawText) return;

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

  if (isProfileEditStart(rawText)) {
    const nextUser = createPendingCapture(user, {
      captureType: 'profile_edit',
      payload: {},
      missingFields: ['profile_value'],
      replyText: 'プロフィール変更ですね。直したい項目をそのまま送ってください。例: 身長 160 / 年齢 55 / 目標体重 58',
      sourceText: rawText,
    });
    await updateUserState(user.id, nextUser);
    await replyMessage(
      replyToken,
      textMessageWithQuickReplies(
        'プロフィール変更ですね。直したい項目をそのまま送ってください。例: 身長 160 / 年齢 55 / 目標体重 58',
        ['身長 160', '年齢 55', '目標体重 58', '活動量 ふつう']
      ),
      env.LINE_CHANNEL_ACCESS_TOKEN
    );
    return;
  }

  if (hasPendingCapture(user)) {
    const pendingResult = mergePendingCaptureReply(user, rawText);
    const captureType = String(pendingResult.captureType || '').trim();

    const looksOffTopic = (captureType === 'weight' || captureType === 'body_metrics')
      && !/(\d+(?:\.\d+)?\s*(kg|ｋｇ|キロ|%|％)|体重|体脂肪)/i.test(rawText);

    const nextUser = looksOffTopic
      ? {
          ...user,
          pending_capture_type: null,
          pending_capture_status: null,
          pending_capture_payload: null,
          pending_capture_missing_fields: null,
          pending_capture_prompt: null,
          pending_capture_started_at: null,
          pending_capture_source_text: null,
          pending_capture_attempts: 0,
        }
      : (pendingResult.userPatch || user);

    await updateUserState(user.id, nextUser);

    if (!looksOffTopic) {
      if (pendingResult.readyToSave) {
        await handleReadyPendingCapture(replyToken, nextUser, pendingResult, user);
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
  }

  const routed = analyzeNewCaptureCandidate(rawText);
  if (routed?.route === 'consultation' || routed?.route === 'memory_question') {
    await replyConsultation(replyToken, rawText, user, 'consultation branch');
    return;
  }

  if (routed?.route === 'body_metrics') {
    await saveBodyMetrics(replyToken, user, routed.payload);
    return;
  }

  if (routed?.route === 'weight_record') {
    await saveBodyMetrics(replyToken, user, routed.payload);
    return;
  }

  if (routed?.route === 'body_fat_record') {
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
      await replyMessage(
        replyToken,
        textMessageWithQuickReplies(routed.replyText, []),
        env.LINE_CHANNEL_ACCESS_TOKEN
      );
      return;
    }
  }

  const captureResult = await analyzeChatCapture({
    text: rawText,
    context: {
      user_id: user.id,
      display_name: user.display_name || '',
      line_user_id: user.line_user_id || '',
    },
  });

  if (captureResult?.route === 'profile_edit_start') {
    const nextUser = createPendingCapture(user, {
      captureType: 'profile_edit',
      payload: {},
      missingFields: ['profile_value'],
      replyText: captureResult.replyText || '直したい項目をそのまま送ってください。',
      sourceText: rawText,
    });
    await updateUserState(user.id, nextUser);
    await replyMessage(
      replyToken,
      textMessageWithQuickReplies(
        captureResult.replyText || '直したい項目をそのまま送ってください。',
        ['身長 160', '年齢 55', '目標体重 58', '活動量 ふつう']
      ),
      env.LINE_CHANNEL_ACCESS_TOKEN
    );
    return;
  }

  if (captureResult?.route === 'body_metrics') {
    await saveBodyMetrics(replyToken, user, captureResult.payload || {});
    return;
  }

  if (captureResult?.route === 'pain_consult' || captureResult?.route === 'consultation') {
    await replyConsultation(replyToken, rawText, user, 'capture consultation branch', captureResult.replyText || '');
    return;
  }

  if (captureResult?.route === 'record_candidate' && captureResult.candidate) {
    const confirm = buildConfirmationMessage(captureResult.candidate);
    await replyMessage(
      replyToken,
      textMessageWithQuickReplies(confirm.text, ['はい', '違います']),
      env.LINE_CHANNEL_ACCESS_TOKEN
    );
    return;
  }

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
      const replyText = String(
        conversation?.replyText || conversation?.reply_text || conversation?.text || ''
      ).trim();
      if (replyText) {
        await replyMessage(
          replyToken,
          textMessageWithQuickReplies(replyText, []),
          env.LINE_CHANNEL_ACCESS_TOKEN
        );
        return;
      }
    } catch (error) {
      console.warn('⚠️ routeConversation failed:', error?.message || error);
    }
  }

  await replyMessage(
    replyToken,
    textMessageWithQuickReplies(
      'ありがとうございます。ちゃんと受け取っています。続けやすいところからそのまま送ってくださいね。',
      []
    ),
    env.LINE_CHANNEL_ACCESS_TOKEN
  );
}

async function replyConsultation(replyToken, rawText, user, logLabel = '', initialReply = '') {
  let replyText = String(initialReply || '').trim();

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
      console.warn(`⚠️ routeConversation failed in ${logLabel}:`, error?.message || error);
    }
  }

  const guide = buildHealthConsultationGuide(rawText);
  const msg = [replyText || '気になっていること、そのまま話してくださいね。', guide].filter(Boolean).join('\n');
  await replyMessage(
    replyToken,
    textMessageWithQuickReplies(msg, []),
    env.LINE_CHANNEL_ACCESS_TOKEN
  );
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

async function handleReadyPendingCapture(replyToken, userAfterClear, pendingResult = {}, originalUser = {}) {
  const type = String(pendingResult.captureType || '').trim();
  const payload = pendingResult.payload || {};

  if (type === 'weight' || type === 'body_metrics') {
    await saveBodyMetrics(replyToken, originalUser, payload);
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

  if (type === 'profile_edit') {
    const updates = payload.updates || null;
    if (!updates) {
      await replyMessage(
        replyToken,
        textMessageWithQuickReplies(`読み取りがまだ足りないので、次のように送ってください。\n${profileGuideMessage()}`, []),
        env.LINE_CHANNEL_ACCESS_TOKEN
      );
      return;
    }

    const mergedUser = { ...originalUser, ...updates };
    const { error } = await supabase.from('users').update(updates).eq('id', originalUser.id);
    if (error) {
      console.warn('⚠️ profile update failed:', error.message);
      await replyMessage(
        replyToken,
        textMessageWithQuickReplies('内容は受け取れました。今は更新で少しつまずいているので、あとで整えますね。', []),
        env.LINE_CHANNEL_ACCESS_TOKEN
      );
      return;
    }

    await updateUserState(originalUser.id, userAfterClear);
    await replyMessage(
      replyToken,
      textMessageWithQuickReplies(buildProfileReply(mergedUser, Object.keys(updates)), []),
      env.LINE_CHANNEL_ACCESS_TOKEN
    );
    return;
  }

  if (type === 'image_context') {
    const imageIntent = String(payload.image_intent || '').trim();
    let text = '画像の受け取りありがとうございます。補足があればそのまま続けてくださいね。';
    if (imageIntent === 'meal_image') {
      text = '食事の写真として受け取りました。何を食べたか、わかる範囲で一言だけ続けてもらえれば次につなげやすいです。';
    } else if (imageIntent === 'blood_test_image') {
      text = '血液検査の画像として受け取りました。日付や気になる項目があれば、そのまま続けて送ってくださいね。';
    } else if (imageIntent === 'consult_image') {
      text = '相談の画像として受け取りました。どこが気になるかを一言だけ続けてくださいね。';
    }

    await replyMessage(
      replyToken,
      textMessageWithQuickReplies(text, []),
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

async function saveBodyMetrics(replyToken, user, payload = {}) {
  const weightKg = payload.weight_kg == null ? null : Number(payload.weight_kg);
  const bodyFatPct = payload.body_fat_pct == null ? null : Number(payload.body_fat_pct);

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
      const { error } = await supabase.from('weight_logs').insert({
        user_id: user.id,
        logged_at: measuredAt,
        weight_kg: weightKg,
        body_fat_pct: Number.isFinite(bodyFatPct) ? bodyFatPct : null,
      });
      if (error) console.warn('⚠️ weight_logs insert failed:', error.message);
    }

    const userPatch = { ...user };
    if (Number.isFinite(weightKg)) userPatch.weight_kg = weightKg;
    if (Number.isFinite(bodyFatPct)) userPatch.body_fat_pct = bodyFatPct;
    await updateUserState(user.id, userPatch);

    if (typeof weightService.buildWeightSaveMessage === 'function' && Number.isFinite(weightKg)) {
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

    const lines = [];
    if (Number.isFinite(weightKg)) lines.push(`体重 ${weightKg}kg を受け取りました。`);
    if (Number.isFinite(bodyFatPct)) lines.push(`体脂肪率 ${bodyFatPct}% も一緒に記録しました。`);
    lines.push('こういう積み重ねが流れを整えてくれます。');
    await replyMessage(
      replyToken,
      textMessageWithQuickReplies(lines.join('\n'), ['体重グラフ', '予測', '食事を記録', '少し歩いた']),
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

  const { error } = await supabase.from('users').update(patch).eq('id', userId);
  if (error) {
    console.warn('⚠️ updateUserState failed:', error.message);
  }
}

app.listen(PORT, () => {
  console.log(`✅ LINE bot server listening on ${PORT}`);
});
