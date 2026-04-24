'use strict';

const express = require('express');
const multer = require('multer');
const conversationRouter = require('../services/chatgpt_conversation_router');
const chatLogService = require('../services/chat_log_service');
const conversationSummaryService = require('../services/conversation_summary_service');
const authService = require('../services/web_portal_auth_service');
const dataService = require('../services/web_portal_data_service');
const realtimeService = require('../services/web_portal_realtime_service');
const featureFlags = require('../config/feature_flags');
const athleteSupportService = require('../services/athlete_support_service');
const athleteSupportExtendedService = require('../services/athlete_support_extended_service');
const { getTokyoDayEnergyBalance } = require('../services/daily_balance_query_service');
const { getTokyoWeekEnergyBalance } = require('../services/weekly_balance_query_service');
const { getTokyoMonthEnergyBalance } = require('../services/monthly_balance_query_service');
const webAdminRepository = require('../repositories/web_admin_repository');
const webAdminResponseBuilder = require('../services/web_admin_response_builder_service');
const aiChatService = require('../services/ai_chat_service');
let line = null;
try {
  line = require('@line/bot-sdk');
} catch (_e) {
  line = null;
}
const router = express.Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { files: 5, fileSize: 12 * 1024 * 1024 } });

function getBearerToken(req) {
  const auth = String(req.headers.authorization || '');
  if (!auth.startsWith('Bearer ')) return '';
  return auth.slice(7).trim();
}

function getSessionToken(req) {
  const bearer = getBearerToken(req);
  if (bearer) return bearer;
  return String(req.query?.token || '').trim();
}


function looksAuthFailure(error) {
  const safe = String(error?.message || error || '').toLowerCase();
  return [
    'invalid_token',
    'invalid_signature',
    'token_expired',
    'unsupported_token_version',
    'invalid_token_type'
  ].some((part) => safe.includes(part));
}


function buildDisplayName(user) {
  const raw = String(user?.display_name || user?.preferred_name || '').trim();
  if (!raw) return 'ここから。ユーザー';
  if (/今日|昨日|明日|暖か|眠い|しんど|痛い|なりそう|です$|ます$/.test(raw)) return 'ここから。ユーザー';
  return raw;
}

async function refreshLineDisplayName(lineUserId) {
  const uid = String(lineUserId || '').trim();
  const token = process.env.LINE_CHANNEL_ACCESS_TOKEN;
  if (!uid || !line || !token) return { ok: false };
  try {
    const client = new line.messagingApi.MessagingApiClient({ channelAccessToken: token });
    const profile = await client.getProfile(uid);
    const displayName = String(profile?.displayName || '').trim();
    if (!displayName) return { ok: false };
    return webAdminRepository.syncLineDisplayName(uid, displayName);
  } catch (_e) {
    return { ok: false };
  }
}

function buildFallbackHomeResponse(user, message) {
  const home = dataService.buildFallbackHomeData(user, { message });
  const recordsOverview = dataService.buildFallbackRecordsOverview(user, home);
  const starters = dataService.buildStarterPrompts(home, recordsOverview);
  return { home, recordsOverview, starters };
}

function buildFallbackChatResponse(user, message) {
  const home = dataService.buildFallbackHomeData(user, { message });
  return {
    messages: [{ role: 'assistant', text: '接続はできています。いまは表示を整えながら、相談はこのまま始められます。', sourceChannel: 'web', createdAt: new Date().toISOString() }],
    sidebar: dataService.buildFallbackSidebar(user, home),
    consultLanes: home.consultLanes || [],
    recentTimeline: home.recentTimeline || [],
    reflection: { headline: 'ここから始められます', body: '一つだけ相談したいことを送れば大丈夫です。' },
    followups: ['今いちばん気になることを一つだけ整理したい'],
    actionPlan: home.actionPlan || [],
    supportMode: home.supportMode || {},
    supportCompass: home.supportCompass || {},
    returnDigest: home.returnDigest || {},
    sinceDigest: home.sinceDigest || {},
    microStep: home.microStep || {},
    consultationCarry: home.consultationCarry || {},
    returnAnchor: home.returnAnchor || {},
    resumePrompts: home.resumePrompts || [],
    reentryGuide: home.reentryGuide || {},
    conversationBridge: home.conversationBridge || {},
    homeSnapshot: home,
    recordsOverview: dataService.buildFallbackRecordsOverview(user, home),
    starters: dataService.buildStarterPrompts(home, dataService.buildFallbackRecordsOverview(user, home)),
    sync: { version: new Date().toISOString(), scopeVersions: { chat: '', records: '', home: '' } }
  };
}

function buildWebFallbackReply(message) {
  const safe = String(message || '').trim();
  if (/痛い|痛み|しんどい|つらい|違和感/.test(safe)) {
    return 'しんどいね。どこが・いつ頃から・何をするときついか、分かる範囲で一言ずつ送ってくれるかな。';
  }
  if (/TG|HbA1c|LDL|HDL|血液|検査/.test(safe)) {
    return '検査の話、いいよ。気になる数値か画像を1つずつ送ってくれるかな。';
  }
  if (/食事|ごはん|朝|昼|夜|カロリー/.test(safe)) {
    return '食事の話、いいよ。いまは一食ぶんだけ見てもらう感じで。';
  }
  return `「${safe.slice(0, 60)}${safe.length > 60 ? '…' : ''}」、受け取った。いちばん気になるところからでいいよ。`;
}

async function uploadAdminAttachment(file, lineUserId) {
  let supabase = null;
  try {
    ({ supabase } = require('../services/supabase_service'));
  } catch (_e) {
    supabase = null;
  }
  if (!supabase) throw new Error('storage_unavailable');
  const now = Date.now();
  const safeName = String(file.originalname || `file-${now}`).replace(/[^\w.\-]/g, '_');
  const path = `web-admin/${String(lineUserId || 'unknown')}/${now}-${safeName}`;
  const bucket = process.env.WEB_ATTACHMENT_BUCKET || 'web_uploads';
  const { error } = await supabase.storage.from(bucket).upload(path, file.buffer, {
    contentType: file.mimetype || 'application/octet-stream',
    upsert: false
  });
  if (error) throw error;
  const pub = supabase.storage.from(bucket).getPublicUrl(path);
  return {
    file_type: /^image\//.test(file.mimetype || '') ? 'image' : 'video',
    mime_type: file.mimetype || '',
    file_name: file.originalname || '',
    file_size: Number(file.size || 0),
    file_url: pub?.data?.publicUrl || '',
    storage_path: path,
    thumbnail_url: '',
    created_at: new Date().toISOString()
  };
}

async function requireSession(req, res, next) {
  try {
    const token = getSessionToken(req);
    if (!token) return res.status(401).json({ ok: false, error: 'not_authenticated', message: '接続が必要です。もう一度コードを入力してください。' });
    const session = await authService.getSessionByToken(token);
    if (!session?.user) return res.status(401).json({ ok: false, error: 'invalid_session', message: '接続の有効期限が切れています。' });
    req.webSession = session;
    req.webToken = token;
    next();
  } catch (error) {
    console.error('[web] requireSession error:', error?.message || error);
    if (looksAuthFailure(error)) {
      return res.status(401).json({ ok: false, error: 'invalid_session', message: '接続の有効期限が切れているか、接続情報が古くなっています。もう一度コードを入力してください。' });
    }
    res.status(500).json({ ok: false, error: 'session_error', message: '接続確認でエラーが起きました。' });
  }
}

router.get('/version', (_req, res) => {
  res.json({ ok: true, version: 'phase12-root-rebuild', authMode: 'signed-prefixed' });
});

router.post('/link/request', async (req, res) => {
  try {
    const { lineUserId, userId } = req.body || {};
    const data = await authService.requestLinkCode({ lineUserId, userId });
    res.json({
      ok: true,
      code: data.code,
      expiresAt: data.expiresAt,
      lineUserId: data.user?.line_user_id || null
    });
  } catch (error) {
    res.status(400).json({ ok: false, error: 'request_failed', message: error?.message || '接続コードを発行できませんでした。' });
  }
});

router.post('/link/confirm', async (req, res) => {
  try {
    const { code } = req.body || {};
    const result = await authService.consumeLinkCode(code, {
      userAgent: req.headers['user-agent'] || '',
      ipAddress: req.ip || req.headers['x-forwarded-for'] || ''
    });
    const profile = await dataService.getProfileEnvelope(result.user);
    res.json({
      ok: true,
      sessionToken: result.sessionToken,
      expiresAt: result.expiresAt,
      profile
    });
  } catch (error) {
    res.status(400).json({ ok: false, error: 'confirm_failed', message: error?.message || '接続コードを確認できませんでした。phase12 のコードか、自動接続URLをそのまま貼り付けてください。' });
  }
});

router.post('/logout', requireSession, async (req, res) => {
  try {
    await authService.revokeSession(req.webToken);
    res.json({ ok: true });
  } catch (error) {
    res.status(400).json({ ok: false, error: 'logout_failed', message: error?.message || 'ログアウトできませんでした。' });
  }
});

router.get('/me', requireSession, async (req, res) => {
  const user = req.webSession.user;
  const profile = await dataService.getProfileEnvelope(user);
  res.json({
    ok: true,
    profile,
    session: {
      expiresAt: req.webSession.session.expires_at
    }
  });
});

router.get('/events', requireSession, async (req, res) => {
  try {
    const sync = await dataService.getSyncStatus(req.webSession.user);
    realtimeService.openStream({
      userId: req.webSession.user.id,
      res,
      initialSync: sync,
      sessionExpiresAt: req.webSession.session.expires_at
    });
  } catch (error) {
    console.error('[web] events error:', error?.message || error);
    if (!res.headersSent) res.status(500).json({ ok: false, error: 'events_failed', message: 'ライブ同期を開始できませんでした。' });
  }
});


router.get('/sync/status', requireSession, async (req, res) => {
  try {
    const sync = await dataService.getSyncStatus(req.webSession.user);
    res.json({ ok: true, ...sync });
  } catch (error) {
    console.error('[web] sync status error:', error?.message || error);
    res.status(500).json({ ok: false, error: 'sync_status_failed', message: '同期状態を確認できませんでした。' });
  }
});

router.get('/bootstrap', requireSession, async (req, res) => {
  try {
    const user = req.webSession.user;
    const since = req.query.since ? String(req.query.since) : undefined;
    const rangeDays = Math.min(90, Math.max(7, Number(req.query.days || req.query.range || 30)));
    const payload = await dataService.getBootstrapData(user, { since, rangeDays });
    const profile = await dataService.getProfileEnvelope(user);
    res.json({
      ok: true,
      profile,
      session: {
        expiresAt: req.webSession.session.expires_at
      },
      ...payload
    });
  } catch (error) {
    console.error('[web] bootstrap error:', error?.message || error);
    const user = req.webSession.user;
    const fallback = buildFallbackHomeResponse(user, '初期表示を整えながら接続しています。');
    const sync = { version: new Date().toISOString(), scopeVersions: { chat: '', records: '', home: '' } };
    const profile = await dataService.getProfileEnvelope(user);
    res.json({ ok: true, fallback: true, profile, session: { expiresAt: req.webSession.session.expires_at }, home: fallback.home, sidebar: dataService.buildFallbackSidebar(user, fallback.home), recordsOverview: fallback.recordsOverview, starters: fallback.starters, sync, supportMode: fallback.home.supportMode, stuckPrompts: fallback.home.stuckPrompts, consultLanes: fallback.home.consultLanes, recentTimeline: fallback.home.recentTimeline, reflection: { headline: 'ここから始められます', body: '接続は通っています。まずは一つだけ相談を送れば大丈夫です。' }, followups: ['今いちばん気になることを一つだけ整理したい'], supportCompass: fallback.home.supportCompass, returnDigest: fallback.home.returnDigest, microStep: fallback.home.microStep, resumePrompts: fallback.home.resumePrompts, conversationBridge: fallback.home.conversationBridge, reentryGuide: fallback.home.reentryGuide, consultationCarry: fallback.home.consultationCarry, returnAnchor: fallback.home.returnAnchor, sinceDigest: fallback.home.sinceDigest });
  }
});

router.get('/home', requireSession, async (req, res) => {
  try {
    const since = req.query.since ? String(req.query.since) : undefined;
    const home = await dataService.getHomeData(req.webSession.user, { since });
    const overview = await dataService.getRecordsOverview(req.webSession.user);
    const starters = dataService.buildStarterPrompts(home, overview);
    res.json({ ok: true, ...home, starters, recordsOverview: overview });
  } catch (error) {
    console.error('[web] home error:', error?.message || error);
    const fallback = buildFallbackHomeResponse(req.webSession.user, 'ホームの一部を整えながら表示しています。');
    res.json({ ok: true, fallback: true, ...fallback.home, starters: fallback.starters, recordsOverview: fallback.recordsOverview });
  }
});

router.get('/chat/history', requireSession, async (req, res) => {
  try {
    const limit = Number(req.query.limit || 40);
    const messages = await dataService.getChatHistory(req.webSession.user, limit);
    res.json({ ok: true, messages });
  } catch (error) {
    console.error('[web] chat history error:', error?.message || error);
    res.status(500).json({ ok: false, error: 'chat_history_failed', message: '会話履歴を取得できませんでした。' });
  }
});

router.get('/chat/sidebar', requireSession, async (req, res) => {
  try {
    const sidebar = await dataService.getChatSidebar(req.webSession.user);
    res.json({ ok: true, ...sidebar });
  } catch (error) {
    console.error('[web] chat sidebar error:', error?.message || error);
    res.status(500).json({ ok: false, error: 'chat_sidebar_failed', message: '補助情報を取得できませんでした。' });
  }
});

router.get('/chat/bundle', requireSession, async (req, res) => {
  try {
    const limit = Number(req.query.limit || 40);
    const since = req.query.since ? String(req.query.since) : undefined;
    const payload = await dataService.getChatBundle(req.webSession.user, { limit, since });
    res.json({ ok: true, ...payload });
  } catch (error) {
    console.error('[web] chat bundle error:', error?.message || error);
    const fallback = buildFallbackChatResponse(req.webSession.user, '相談画面を整えながら表示しています。');
    res.json({ ok: true, fallback: true, ...fallback });
  }
});

router.post('/chat/send', requireSession, async (req, res) => {
  const message = String(req.body?.message || req.body?.text || '').trim();
  if (!message) return res.status(400).json({ ok: false, error: 'empty_message', message: 'メッセージを入力してください。' });

  const input = {
    userId: req.webSession.lineUserId,
    lineUserId: req.webSession.lineUserId,
    sourceChannel: 'web',
    sourceType: 'web',
    messageType: 'text',
    rawText: message,
    timestamp: Date.now(),
    replyToken: null,
    originalEvent: null,
    relatedEventId: null,
    messageId: null,
    traceId: chatLogService.buildTraceId()
  };

  let result = null;
  let replyMessages = [];
  let replyText = '';
  try {
    result = await conversationRouter.routeConversation(input);
    replyMessages = Array.isArray(result?.replyMessages) ? result.replyMessages : [];
    replyText = chatLogService.joinReplyText(replyMessages) || buildWebFallbackReply(message);
  } catch (error) {
    console.error('[web] chat conversation error:', error?.message || error);
    replyText = buildWebFallbackReply(message);
    replyMessages = [{ type: 'text', text: replyText }];
    result = { ok: true, replyMessages, internal: { intentType: 'web_fallback', responseMode: 'fallback' } };
  }

  try { await chatLogService.logConversationOutcome({ input, result }); } catch (error) { console.error('[web] chat log error:', error?.message || error); }
  try { await conversationSummaryService.recordTurn({ input, result }); } catch (error) { console.error('[web] chat summary error:', error?.message || error); }
  try { dataService.invalidateUserCache(req.webSession.user.id, { reason: 'web_chat', scopes: { chat: true, records: false, home: true } }); } catch (error) { console.error('[web] cache invalidate error:', error?.message || error); }

  let payload = null;
  try {
    const homeSnapshot = await dataService.getHomeData(req.webSession.user);
    const [recordsOverview, supportCards, chatHistory] = await Promise.all([
      dataService.getRecordsOverview(req.webSession.user),
      dataService.getChatSidebar(req.webSession.user, { home: homeSnapshot }),
      dataService.getChatHistory(req.webSession.user, 8)
    ]);
    const starters = dataService.buildStarterPrompts(homeSnapshot, recordsOverview);
    const reflection = dataService.buildChatReflection(homeSnapshot, recordsOverview, replyText);
    const followups = dataService.buildFollowupPrompts(homeSnapshot, recordsOverview, replyText);
    const actionPlan = homeSnapshot.actionPlan || [];
    const supportMode = homeSnapshot.supportMode || dataService.buildSupportMode(homeSnapshot, recordsOverview, homeSnapshot.engagement || {}, homeSnapshot.recentTimeline || []);
    const stuckPrompts = homeSnapshot.stuckPrompts || dataService.buildStuckPrompts(homeSnapshot, recordsOverview, homeSnapshot.engagement || {}, homeSnapshot.recentTimeline || []);
    const supportCompass = homeSnapshot.supportCompass || dataService.buildSupportCompass(req.webSession.user, homeSnapshot, recordsOverview, homeSnapshot.engagement || {}, homeSnapshot.recentTimeline || []);
    const returnDigest = homeSnapshot.returnDigest || dataService.buildReturnDigest(homeSnapshot, recordsOverview, homeSnapshot.engagement || {}, homeSnapshot.recentTimeline || []);
    const microStep = homeSnapshot.microStep || dataService.buildMicroStep(homeSnapshot, recordsOverview, homeSnapshot.engagement || {}, homeSnapshot.recentTimeline || []);
    const consultationCarry = homeSnapshot.consultationCarry || dataService.buildConsultationCarry(homeSnapshot, recordsOverview, homeSnapshot.engagement || {}, homeSnapshot.recentTimeline || [], replyText);
    const returnAnchor = homeSnapshot.returnAnchor || dataService.buildReturnAnchor(homeSnapshot, recordsOverview, homeSnapshot.engagement || {}, homeSnapshot.recentTimeline || []);
    const resumePrompts = homeSnapshot.resumePrompts || dataService.buildResumePrompts(homeSnapshot.recentTimeline || [], homeSnapshot, recordsOverview);
    const conversationBridge = homeSnapshot.conversationBridge || dataService.buildConversationBridge(chatHistory, homeSnapshot, recordsOverview);
    const reentryGuide = homeSnapshot.reentryGuide || dataService.buildReentryGuide(homeSnapshot, recordsOverview, homeSnapshot.engagement || {}, homeSnapshot.recentTimeline || []);
    const sync = await dataService.getSyncStatus(req.webSession.user);
    try { realtimeService.notifyUser(req.webSession.user.id, { userId: req.webSession.user.id, sync, reason: 'web_chat' }); } catch (error) { console.error('[web] notify error:', error?.message || error); }
    payload = { supportCards, homeSnapshot, recordsOverview, starters, reflection, followups, actionPlan, supportMode, stuckPrompts, supportCompass, returnDigest, microStep, consultationCarry, returnAnchor, resumePrompts, conversationBridge, reentryGuide, sync };
  } catch (error) {
    console.error('[web] chat payload error:', error?.message || error);
    const fallback = buildFallbackChatResponse(req.webSession.user, 'チャットは続けられます。補助情報は整えながら表示しています。');
    payload = { supportCards: fallback.sidebar, homeSnapshot: fallback.homeSnapshot, recordsOverview: fallback.recordsOverview, starters: fallback.starters, reflection: fallback.reflection, followups: fallback.followups, actionPlan: fallback.actionPlan, supportMode: fallback.supportMode, stuckPrompts: fallback.homeSnapshot?.stuckPrompts || [], supportCompass: fallback.supportCompass, returnDigest: fallback.returnDigest, microStep: fallback.microStep, consultationCarry: fallback.consultationCarry, returnAnchor: fallback.returnAnchor, resumePrompts: fallback.resumePrompts, conversationBridge: fallback.conversationBridge, reentryGuide: fallback.reentryGuide, sync: fallback.sync, fallback: true };
  }

  res.json({
    ok: true,
    reply: replyText,
    replyMessages,
    assistantMessage: {
      text: replyText,
      createdAt: new Date().toISOString(),
      sourceChannel: 'web'
    },
    internal: result?.internal || {},
    ...payload
  });
});

router.post('/chat/upload', requireSession, upload.array('files', 5), async (req, res) => {
  try {
    const files = Array.isArray(req.files) ? req.files : [];
    const text = String(req.body?.message || req.body?.text || '').trim();
    if (!files.length) {
      return res.status(400).json({ ok: false, error: 'empty_files', message: '添付がありません。' });
    }

    const firstImage = files.find((file) => /^image\//.test(String(file.mimetype || '')));
    if (!firstImage?.buffer) {
      return res.status(400).json({
        ok: false,
        error: 'no_image',
        message: '画像（jpg / png / webp）を1枚選んでください。',
      });
    }

    const input = {
      userId: req.webSession.lineUserId,
      lineUserId: req.webSession.lineUserId,
      sourceChannel: 'web',
      sourceType: 'web',
      messageType: 'image',
      rawText: text,
      webImagePayload: { buffer: firstImage.buffer, mimeType: firstImage.mimetype || 'image/jpeg' },
      timestamp: Date.now(),
      replyToken: null,
      originalEvent: null,
      relatedEventId: null,
      messageId: null,
      traceId: chatLogService.buildTraceId(),
    };

    let result = null;
    let replyMessages = [];
    let replyText = '';
    try {
      result = await conversationRouter.routeConversation(input);
      replyMessages = Array.isArray(result?.replyMessages) ? result.replyMessages : [];
      replyText = chatLogService.joinReplyText(replyMessages) || '画像を受け取りました。';
    } catch (error) {
      console.error('[web] upload conversation error:', error?.message || error);
      replyText = '画像の処理中にエラーが出ました。通信を確認して、もう一度送ってください。';
      replyMessages = [{ type: 'text', text: replyText }];
      result = { ok: true, replyMessages, internal: { intentType: 'web_upload_fallback', responseMode: 'fallback' } };
    }

    try {
      await chatLogService.logConversationOutcome({ input, result });
    } catch (e) {
      console.error(e);
    }
    try {
      await conversationSummaryService.recordTurn({ input, result });
    } catch (e) {
      console.error(e);
    }
    try {
      dataService.invalidateUserCache(req.webSession.user.id, { reason: 'web_upload', scopes: { chat: true, records: true, home: true } });
    } catch (e) {
      console.error(e);
    }

    let payload = null;
    try {
      const homeSnapshot = await dataService.getHomeData(req.webSession.user);
      const [recordsOverview, supportCards, chatHistory] = await Promise.all([
        dataService.getRecordsOverview(req.webSession.user),
        dataService.getChatSidebar(req.webSession.user, { home: homeSnapshot }),
        dataService.getChatHistory(req.webSession.user, 8),
      ]);
      const starters = dataService.buildStarterPrompts(homeSnapshot, recordsOverview);
      const reflection = dataService.buildChatReflection(homeSnapshot, recordsOverview, replyText);
      const followups = dataService.buildFollowupPrompts(homeSnapshot, recordsOverview, replyText);
      const actionPlan = homeSnapshot.actionPlan || [];
      const supportMode = homeSnapshot.supportMode || dataService.buildSupportMode(homeSnapshot, recordsOverview, homeSnapshot.engagement || {}, homeSnapshot.recentTimeline || []);
      const stuckPrompts = homeSnapshot.stuckPrompts || dataService.buildStuckPrompts(homeSnapshot, recordsOverview, homeSnapshot.engagement || {}, homeSnapshot.recentTimeline || []);
      const supportCompass = homeSnapshot.supportCompass || dataService.buildSupportCompass(req.webSession.user, homeSnapshot, recordsOverview, homeSnapshot.engagement || {}, homeSnapshot.recentTimeline || []);
      const returnDigest = homeSnapshot.returnDigest || dataService.buildReturnDigest(homeSnapshot, recordsOverview, homeSnapshot.engagement || {}, homeSnapshot.recentTimeline || []);
      const microStep = homeSnapshot.microStep || dataService.buildMicroStep(homeSnapshot, recordsOverview, homeSnapshot.engagement || {}, homeSnapshot.recentTimeline || []);
      const consultationCarry = homeSnapshot.consultationCarry || dataService.buildConsultationCarry(homeSnapshot, recordsOverview, homeSnapshot.engagement || {}, homeSnapshot.recentTimeline || [], replyText);
      const returnAnchor = homeSnapshot.returnAnchor || dataService.buildReturnAnchor(homeSnapshot, recordsOverview, homeSnapshot.engagement || {}, homeSnapshot.recentTimeline || []);
      const resumePrompts = homeSnapshot.resumePrompts || dataService.buildResumePrompts(homeSnapshot.recentTimeline || [], homeSnapshot, recordsOverview);
      const conversationBridge = homeSnapshot.conversationBridge || dataService.buildConversationBridge(chatHistory, homeSnapshot, recordsOverview);
      const reentryGuide = homeSnapshot.reentryGuide || dataService.buildReentryGuide(homeSnapshot, recordsOverview, homeSnapshot.engagement || {}, homeSnapshot.recentTimeline || []);
      const sync = await dataService.getSyncStatus(req.webSession.user);
      try {
        realtimeService.notifyUser(req.webSession.user.id, { userId: req.webSession.user.id, sync, reason: 'web_upload' });
      } catch (e) {
        console.error(e);
      }
      payload = {
        supportCards,
        homeSnapshot,
        recordsOverview,
        starters,
        reflection,
        followups,
        actionPlan,
        supportMode,
        stuckPrompts,
        supportCompass,
        returnDigest,
        microStep,
        consultationCarry,
        returnAnchor,
        resumePrompts,
        conversationBridge,
        reentryGuide,
        sync,
        chatHistory,
      };
    } catch (error) {
      console.error('[web] upload payload error:', error?.message || error);
      const fallback = buildFallbackChatResponse(req.webSession.user, 'チャットは続けられます。補助情報は整えながら表示しています。');
      payload = {
        supportCards: fallback.sidebar,
        homeSnapshot: fallback.homeSnapshot,
        recordsOverview: fallback.recordsOverview,
        starters: fallback.starters,
        reflection: fallback.reflection,
        followups: fallback.followups,
        actionPlan: fallback.actionPlan,
        supportMode: fallback.supportMode,
        stuckPrompts: fallback.homeSnapshot?.stuckPrompts || [],
        supportCompass: fallback.supportCompass,
        returnDigest: fallback.returnDigest,
        microStep: fallback.microStep,
        consultationCarry: fallback.consultationCarry,
        returnAnchor: fallback.returnAnchor,
        resumePrompts: fallback.resumePrompts,
        conversationBridge: fallback.conversationBridge,
        reentryGuide: fallback.reentryGuide,
        sync: fallback.sync,
        fallback: true,
      };
    }

    res.json({
      ok: true,
      reply: replyText,
      replyMessages,
      assistantMessage: {
        text: replyText,
        createdAt: new Date().toISOString(),
        sourceChannel: 'web',
      },
      internal: result?.internal || {},
      ...payload,
    });
  } catch (error) {
    console.error('[web] chat upload error:', error?.message || error);
    return res.status(500).json({ ok: false, error: 'upload_failed', message: '添付の処理に失敗しました。通信を確認して再送してください。' });
  }
});

router.get('/records/overview', requireSession, async (req, res) => {
  try {
    const overview = await dataService.getRecordsOverview(req.webSession.user);
    res.json({ ok: true, ...overview });
  } catch (error) {
    console.error('[web] records overview error:', error?.message || error);
    res.status(500).json({ ok: false, error: 'records_overview_failed', message: '記録の概要を取得できませんでした。' });
  }
});

router.get('/records/bundle', requireSession, async (req, res) => {
  try {
    const range = String(req.query.range || '30d');
    const labsLimit = Number(req.query.labsLimit || 10);
    const since = req.query.since ? String(req.query.since) : undefined;
    const payload = await dataService.getRecordsBundle(req.webSession.user, { range, labsLimit, since });
    res.json({ ok: true, ...payload });
  } catch (error) {
    console.error('[web] records bundle error:', error?.message || error);
    const fallback = buildFallbackHomeResponse(req.webSession.user, '記録画面を整えながら表示しています。');
    res.json({ ok: true, fallback: true, overview: fallback.recordsOverview, meals: [], weights: { latest: null, series: [], trend: null }, labs: [], homeSnapshot: fallback.home, message: '記録画面を整えながら表示しています。' });
  }
});

router.get('/records/meals', requireSession, async (req, res) => {
  try {
    const date = String(req.query.date || dataService.dateYmdInTokyo());
    const meals = await dataService.getMealsList(req.webSession.user, { from: date, to: date, limit: 20 });
    res.json({ ok: true, date, meals });
  } catch (error) {
    console.error('[web] records meals error:', error?.message || error);
    res.status(500).json({ ok: false, error: 'records_meals_failed', message: '食事記録を取得できませんでした。' });
  }
});

router.get('/records/meals/list', requireSession, async (req, res) => {
  try {
    const from = req.query.from ? String(req.query.from) : undefined;
    const to = req.query.to ? String(req.query.to) : undefined;
    const limit = Number(req.query.limit || 50);
    const items = await dataService.getMealsList(req.webSession.user, { from, to, limit });
    res.json({ ok: true, items });
  } catch (error) {
    console.error('[web] records meals list error:', error?.message || error);
    res.status(500).json({ ok: false, error: 'records_meals_list_failed', message: '食事履歴を取得できませんでした。' });
  }
});

router.get('/records/weights', requireSession, async (req, res) => {
  try {
    const range = String(req.query.range || '30d');
    const payload = await dataService.getWeightsSeries(req.webSession.user, range);
    res.json({ ok: true, ...payload });
  } catch (error) {
    console.error('[web] records weights error:', error?.message || error);
    res.status(500).json({ ok: false, error: 'records_weights_failed', message: '体重推移を取得できませんでした。' });
  }
});

router.get('/records/labs/latest', requireSession, async (req, res) => {
  try {
    const latest = await dataService.getLabsLatest(req.webSession.user);
    res.json({ ok: true, latest });
  } catch (error) {
    console.error('[web] records labs latest error:', error?.message || error);
    res.status(500).json({ ok: false, error: 'records_labs_latest_failed', message: '血液検査の最新情報を取得できませんでした。' });
  }
});

router.get('/records/labs/list', requireSession, async (req, res) => {
  try {
    const limit = Number(req.query.limit || 10);
    const items = await dataService.getLabsList(req.webSession.user, limit);
    res.json({ ok: true, items });
  } catch (error) {
    console.error('[web] records labs list error:', error?.message || error);
    res.status(500).json({ ok: false, error: 'records_labs_list_failed', message: '血液検査一覧を取得できませんでした。' });
  }
});

// ===== Web Admin Console APIs =====
router.get('/admin/users', requireSession, async (req, res) => {
  try {
    const q = String(req.query.q || '');
    const items = await webAdminRepository.getManagedUsers({
      query: q,
      limit: Number(req.query.limit || 80),
      adminUserId: req.webSession.user?.id || ''
    });
    console.info('[phasee-new] web_user_list_context', { admin_user_id: req.webSession.user?.id || '', count: items.length, query: q.slice(0, 40) });
    res.json({ ok: true, items });
  } catch (error) {
    res.status(500).json({ ok: false, error: 'web_user_list_failed', message: '利用者一覧を取得できませんでした。' });
  }
});

router.post('/admin/users/refresh-display-name', requireSession, async (req, res) => {
  try {
    const lineUserId = String(req.body?.lineUserId || '').trim();
    if (!lineUserId) return res.status(400).json({ ok: false, error: 'invalid_user' });
    const out = await refreshLineDisplayName(lineUserId);
    return res.json({ ok: Boolean(out?.ok) });
  } catch (_e) {
    return res.status(500).json({ ok: false, error: 'refresh_display_name_failed' });
  }
});

router.post('/admin/thread/read', requireSession, async (req, res) => {
  try {
    const lineUserId = String(req.body?.lineUserId || '').trim();
    const lastReadMessageAt = String(req.body?.lastReadMessageAt || '').trim();
    if (!lineUserId) {
      return res.status(400).json({ ok: false, error: 'invalid_user', message: '対象ユーザーが不正です。' });
    }
    const out = await webAdminRepository.markThreadRead({
      adminUserId: req.webSession.user?.id || '',
      lineUserId,
      lastReadMessageAt
    });
    if (!out?.ok) {
      return res.status(500).json({ ok: false, error: 'mark_read_failed', message: '既読更新に失敗しました。' });
    }
    return res.json({ ok: true });
  } catch (_e) {
    return res.status(500).json({ ok: false, error: 'mark_read_failed', message: '既読更新に失敗しました。' });
  }
});

router.get('/admin/chat/history', requireSession, async (req, res) => {
  try {
    const lineUserId = String(req.query.lineUserId || '');
    const items = await webAdminRepository.getUserChatHistory(lineUserId, { limit: Number(req.query.limit || 300) });
    console.info('[phasee-new] web_chat_history_context', { admin_user_id: req.webSession.user?.id || '', user_id: lineUserId, count: items.length });
    res.json({ ok: true, items });
  } catch (_e) {
    res.status(500).json({ ok: false, error: 'web_chat_history_failed', message: 'チャット履歴を取得できませんでした。' });
  }
});

router.post('/admin/attachments/upload', requireSession, upload.array('files', 5), async (req, res) => {
  try {
    const lineUserId = String(req.body?.lineUserId || '').trim();
    const files = Array.isArray(req.files) ? req.files : [];
    if (!lineUserId || !files.length) {
      return res.status(400).json({ ok: false, error: 'invalid_upload', message: '対象ユーザーまたは添付が不足しています。' });
    }
    const allow = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp', 'video/mp4', 'video/quicktime'];
    for (const f of files) {
      if (!allow.includes(String(f.mimetype || '').toLowerCase())) {
        return res.status(400).json({ ok: false, error: 'unsupported_mime', message: '対応形式は jpg/jpeg/png/webp/mp4/mov です。' });
      }
    }
    const uploaded = [];
    for (const file of files) {
      uploaded.push(await uploadAdminAttachment(file, lineUserId));
    }
    console.info('[phasee-new] web_attachment_upload_context', {
      admin_user_id: req.webSession.user?.id || '',
      user_id: lineUserId,
      attachment_count: uploaded.length,
      attachment_types: uploaded.map((x) => x.file_type),
      attachment_sizes: uploaded.map((x) => x.file_size)
    });
    res.json({ ok: true, attachments: uploaded });
  } catch (error) {
    res.status(500).json({ ok: false, error: 'web_attachment_upload_failed', message: '添付アップロードに失敗しました。' });
  }
});

router.post('/admin/chat/send', requireSession, async (req, res) => {
  try {
    const lineUserId = String(req.body?.lineUserId || '').trim();
    const text = String(req.body?.text || '').trim();
    const attachments = Array.isArray(req.body?.attachments) ? req.body.attachments : [];
    if (!lineUserId || (!text && !attachments.length)) {
      return res.status(400).json({ ok: false, error: 'invalid_send', message: '送信内容がありません。' });
    }
    const out = await webAdminRepository.insertAdminMessage({
      lineUserId,
      text,
      attachments,
      adminUserId: req.webSession.user?.id || ''
    });
    if (!out?.ok) {
      return res.status(500).json({ ok: false, error: 'web_chat_send_failed', message: '管理者返信を保存できませんでした。' });
    }
    const history = await webAdminRepository.getUserChatHistory(lineUserId, { limit: 300 });
    console.info('[phasee-new] web_chat_send_context', {
      admin_user_id: req.webSession.user?.id || '',
      user_id: lineUserId,
      text_len: text.length,
      attachment_count: attachments.length
    });
    res.json({ ok: true, items: history });
  } catch (_e) {
    res.status(500).json({ ok: false, error: 'web_chat_send_failed', message: '返信送信に失敗しました。' });
  }
});

router.get('/admin/summary/daily', requireSession, async (req, res) => {
  try {
    const lineUserId = String(req.query.lineUserId || '').trim();
    const day = await getTokyoDayEnergyBalance(lineUserId, null);
    console.info('[phasee-new] web_daily_summary_context', { user_id: lineUserId, period: day?.dateYmd || '', intake: day?.intakeKcal || 0, activity: day?.activityKcal || 0, net: day?.netKcal || 0, mealCount: day?.mealCount || 0, correctionEventCount: day?.totalCorrectionEventCount || 0 });
    res.json({ ok: true, summary: day });
  } catch (_e) {
    res.status(500).json({ ok: false, error: 'web_daily_summary_failed', message: '今日サマリを取得できませんでした。' });
  }
});

router.get('/admin/summary/weekly', requireSession, async (req, res) => {
  try {
    const lineUserId = String(req.query.lineUserId || '').trim();
    const week = await getTokyoWeekEnergyBalance(lineUserId, null);
    console.info('[phasee-new] web_weekly_summary_context', { user_id: lineUserId, period: week ? `${week.fromYmd}..${week.toYmd}` : '', intake: week?.totals?.weekIntakeKcal || 0, activity: week?.totals?.weekActivityKcal || 0, net: week?.totals?.weekNetKcal || 0, mealCount: week?.totals?.weekMealCount || 0, correctionEventCount: week?.totals?.weekCorrectionEventCount || 0 });
    res.json({ ok: true, summary: week });
  } catch (_e) {
    res.status(500).json({ ok: false, error: 'web_weekly_summary_failed', message: '今週サマリを取得できませんでした。' });
  }
});

router.get('/admin/summary/monthly', requireSession, async (req, res) => {
  try {
    const lineUserId = String(req.query.lineUserId || '').trim();
    const month = await getTokyoMonthEnergyBalance(lineUserId, null);
    console.info('[phasee-new] web_monthly_summary_context', { user_id: lineUserId, period: month ? `${month.fromYmd}..${month.toYmd}` : '', intake: month?.totals?.monthIntakeKcal || 0, activity: month?.totals?.monthActivityKcal || 0, net: month?.totals?.monthNetKcal || 0, mealCount: month?.totals?.monthMealCount || 0, correctionEventCount: month?.totals?.monthCorrectionEventCount || 0 });
    res.json({ ok: true, summary: month });
  } catch (_e) {
    res.status(500).json({ ok: false, error: 'web_monthly_summary_failed', message: '今月サマリを取得できませんでした。' });
  }
});

router.post('/admin/consult', requireSession, async (req, res) => {
  try {
    const lineUserId = String(req.body?.lineUserId || '').trim();
    const prompt = String(req.body?.prompt || '').trim();
    const reportType = String(req.body?.reportType || 'weekly').trim();
    if (!lineUserId || !prompt) {
      return res.status(400).json({ ok: false, error: 'invalid_consult', message: '対象ユーザーと相談文が必要です。' });
    }
    const today = await getTokyoDayEnergyBalance(lineUserId, null);
    const week = await getTokyoWeekEnergyBalance(lineUserId, null);
    const month = await getTokyoMonthEnergyBalance(lineUserId, null);
    const history = await webAdminRepository.getUserChatHistory(lineUserId, { limit: 40 });
    const recentHistory = history.slice(-16).map((m) => `${m.role === 'user' ? '利用者' : '返信'}: ${String(m.text || '').slice(0, 160)}`).join('\n');
    const contextBlock = [
      `対象: ${lineUserId}`,
      `[今日サマリ] intake=${today?.intakeKcal || 0}, activity=${today?.activityKcal || 0}, net=${today?.netKcal || 0}, mealCount=${today?.mealCount || 0}, correctionCount=${today?.totalCorrectionEventCount || 0}`,
      `[今週サマリ] intake=${week?.totals?.weekIntakeKcal || 0}, activity=${week?.totals?.weekActivityKcal || 0}, net=${week?.totals?.weekNetKcal || 0}, mealCount=${week?.totals?.weekMealCount || 0}, correctionCount=${week?.totals?.weekCorrectionEventCount || 0}`,
      `[今月サマリ] intake=${month?.totals?.monthIntakeKcal || 0}, activity=${month?.totals?.monthActivityKcal || 0}, net=${month?.totals?.monthNetKcal || 0}, mealCount=${month?.totals?.monthMealCount || 0}, correctionCount=${month?.totals?.monthCorrectionEventCount || 0}`,
      recentHistory ? `[直近チャット]\n${recentHistory}` : ''
    ].filter(Boolean).join('\n');
    const userInput = [
      'あなたは管理者向けのレポート作成アシスタントです。',
      '利用者へ直接送る文ではなく、管理者の検討メモとして回答してください。',
      `出力用途: ${reportType === 'monthly' ? '月間報告' : '週間報告'}`,
      '依頼:',
      prompt
    ].join('\n');
    const answer = await aiChatService.generateNaturalResponse(userInput, {
      intentType: 'admin_consult',
      responseMode: 'guided',
      recentMessages: []
    }, {
      draftReply: contextBlock,
      hasStructuredData: true
    });
    return res.json({
      ok: true,
      answer: String(answer || '').trim() || '相談文を生成できませんでした。再度お試しください。',
      context: { today, week, month, recentCount: history.length }
    });
  } catch (_e) {
    return res.status(500).json({ ok: false, error: 'admin_consult_failed', message: 'AI相談に失敗しました。' });
  }
});

router.post('/admin/report-draft/generate', requireSession, async (req, res) => {
  try {
    const lineUserId = String(req.body?.lineUserId || '').trim();
    const reportType = String(req.body?.reportType || '').trim();
    if (!lineUserId || !['weekly', 'monthly'].includes(reportType)) {
      return res.status(400).json({ ok: false, error: 'invalid_report_type', message: 'reportType は weekly/monthly を指定してください。' });
    }
    const summary = reportType === 'weekly'
      ? await getTokyoWeekEnergyBalance(lineUserId, null)
      : await getTokyoMonthEnergyBalance(lineUserId, null);
    const draftText = reportType === 'weekly'
      ? webAdminResponseBuilder.buildWeeklyDraft(summary)
      : webAdminResponseBuilder.buildMonthlyDraft(summary);
    console.info('[phasee-new] web_report_draft_context', { mode: 'generate', user_id: lineUserId, report_type: reportType, period: summary ? `${summary.fromYmd}..${summary.toYmd}` : '' });
    res.json({ ok: true, draftText, summary });
  } catch (_e) {
    res.status(500).json({ ok: false, error: 'web_report_generate_failed', message: '下書き生成に失敗しました。' });
  }
});

router.post('/admin/report-draft/save', requireSession, async (req, res) => {
  try {
    const lineUserId = String(req.body?.lineUserId || '').trim();
    const reportType = String(req.body?.reportType || '').trim();
    const periodStart = String(req.body?.periodStart || '').trim();
    const periodEnd = String(req.body?.periodEnd || '').trim();
    const draftText = String(req.body?.draftText || '');
    const editedText = String(req.body?.editedText || '');
    const sourceSummaryJson = req.body?.sourceSummaryJson || {};
    const out = await webAdminRepository.upsertDraft({
      user_id: lineUserId,
      report_type: reportType,
      period_start: periodStart,
      period_end: periodEnd,
      source_summary_json: sourceSummaryJson,
      draft_text: draftText,
      edited_text: editedText,
      status: 'saved'
    });
    if (!out?.ok) return res.status(500).json({ ok: false, error: 'web_report_save_failed', message: '下書きを保存できませんでした。' });
    console.info('[phasee-new] web_report_draft_context', { mode: 'save', user_id: lineUserId, report_type: reportType, period: `${periodStart}..${periodEnd}` });
    res.json({ ok: true });
  } catch (_e) {
    res.status(500).json({ ok: false, error: 'web_report_save_failed', message: '下書き保存に失敗しました。' });
  }
});

router.get('/admin/report-draft', requireSession, async (req, res) => {
  try {
    const item = await webAdminRepository.getDraft(
      String(req.query.lineUserId || '').trim(),
      String(req.query.reportType || '').trim(),
      String(req.query.periodStart || '').trim(),
      String(req.query.periodEnd || '').trim()
    );
    console.info('[phasee-new] web_report_draft_context', { mode: 'reload', user_id: String(req.query.lineUserId || ''), report_type: String(req.query.reportType || '') });
    res.json({ ok: true, item });
  } catch (_e) {
    res.status(500).json({ ok: false, error: 'web_report_get_failed', message: '保存済み下書きを取得できませんでした。' });
  }
});

router.get('/admin/theme', requireSession, async (req, res) => {
  const item = await webAdminRepository.getThemeByAdmin(req.webSession.user?.id || '');
  res.json({ ok: true, item });
});

router.post('/admin/theme', requireSession, async (req, res) => {
  const out = await webAdminRepository.upsertTheme({
    adminUserId: req.webSession.user?.id || '',
    themeId: String(req.body?.themeId || ''),
    accentColor: String(req.body?.accentColor || '')
  });
  if (!out?.ok) return res.status(500).json({ ok: false, error: 'web_theme_save_failed', message: 'テーマ保存に失敗しました。' });
  res.json({ ok: true });
});

function athleteSupportEnabled() {
  return Boolean(featureFlags.ENABLE_ATHLETE_SUPPORT_WEB);
}

router.get('/athlete-support/status', requireSession, (req, res) => {
  res.json({
    ok: true,
    enabled: athleteSupportEnabled(),
    mode: 'athlete_support_j1_female_800_1500_tokyo'
  });
});

router.get('/athlete-support/home', requireSession, async (req, res) => {
  if (!athleteSupportEnabled()) {
    return res.status(404).json({ ok: false, error: 'feature_disabled', message: 'この機能はまだ有効になっていません。' });
  }
  try {
    const userId = req.webSession.user.id;
    const date = req.query.date ? String(req.query.date) : undefined;
    const home = await athleteSupportService.getHome(userId, { date });
    res.json({ ok: true, ...home });
  } catch (error) {
    console.error('[web] athlete-support home error:', error?.message || error);
    res.status(500).json({ ok: false, error: 'athlete_support_home_failed', message: '伴走データの取得に失敗しました。' });
  }
});

router.post('/athlete-support/profile', requireSession, async (req, res) => {
  if (!athleteSupportEnabled()) {
    return res.status(404).json({ ok: false, error: 'feature_disabled', message: 'この機能はまだ有効になっていません。' });
  }
  try {
    const userId = req.webSession.user.id;
    const home = await athleteSupportService.saveProfile(userId, req.body || {});
    res.json({ ok: true, ...home });
  } catch (error) {
    console.error('[web] athlete-support profile error:', error?.message || error);
    res.status(500).json({ ok: false, error: 'athlete_support_profile_failed', message: 'プロフィールの保存に失敗しました。' });
  }
});

router.post('/athlete-support/daily-condition', requireSession, async (req, res) => {
  if (!athleteSupportEnabled()) {
    return res.status(404).json({ ok: false, error: 'feature_disabled', message: 'この機能はまだ有効になっていません。' });
  }
  try {
    const userId = req.webSession.user.id;
    const home = await athleteSupportService.saveDailyCondition(userId, req.body || {});
    res.json({ ok: true, ...home });
  } catch (error) {
    console.error('[web] athlete-support condition error:', error?.message || error);
    res.status(500).json({ ok: false, error: 'athlete_support_condition_failed', message: '体調の保存に失敗しました。' });
  }
});

router.post('/athlete-support/training-log', requireSession, async (req, res) => {
  if (!athleteSupportEnabled()) {
    return res.status(404).json({ ok: false, error: 'feature_disabled', message: 'この機能はまだ有効になっていません。' });
  }
  try {
    const userId = req.webSession.user.id;
    const home = await athleteSupportService.saveTrainingLog(userId, req.body || {});
    res.json({ ok: true, ...home });
  } catch (error) {
    console.error('[web] athlete-support training error:', error?.message || error);
    res.status(500).json({ ok: false, error: 'athlete_support_training_failed', message: '練習ログの保存に失敗しました。' });
  }
});

router.get('/athlete-support/bundle', requireSession, async (req, res) => {
  if (!athleteSupportEnabled()) {
    return res.status(404).json({ ok: false, error: 'feature_disabled', message: 'この機能はまだ有効になっていません。' });
  }
  try {
    const userId = req.webSession.user.id;
    const date = req.query.date ? String(req.query.date) : undefined;
    const home = await athleteSupportService.getHome(userId, { date });
    const state = await athleteSupportExtendedService.load(userId);
    const parentNotesSafe = (state.parentNotesForAthlete || []).slice(-15).map((n) => ({
      id: n.id,
      summaryForAthlete: n.summaryForAthlete,
      showToAthlete: n.showToAthlete,
      createdAt: n.createdAt,
      usedAi: n.usedAi
    }));
    res.json({
      ok: true,
      home,
      parent: athleteSupportExtendedService.buildParentDashboard(state, home.date),
      trainer: athleteSupportExtendedService.buildTrainerDashboard(state, home.date),
      race: await athleteSupportExtendedService.getRaceDialogue(userId),
      labs: {
        records: state.labRecords || [],
        compare: athleteSupportExtendedService.labCompare(state)
      },
      reminders: athleteSupportExtendedService.buildReminders(state, home.date),
      highlights: (state.successHighlights || []).slice(-40),
      parentMonthlyByMonth: state.parentMonthlyByMonth || {},
      trainerMonthlyByMonth: state.trainerMonthlyByMonth || {},
      parentNotesForAthlete: parentNotesSafe
    });
  } catch (error) {
    console.error('[web] athlete-support bundle error:', error?.message || error);
    res.status(500).json({ ok: false, error: 'athlete_support_bundle_failed', message: '伴走データの一括取得に失敗しました。' });
  }
});

router.post('/athlete-support/parent/daily', requireSession, async (req, res) => {
  if (!athleteSupportEnabled()) return res.status(404).json({ ok: false, error: 'feature_disabled' });
  try {
    const out = await athleteSupportExtendedService.saveParentDaily(req.webSession.user.id, req.body || {});
    res.json(out);
  } catch (error) {
    console.error('[web] athlete-support parent daily:', error?.message || error);
    res.status(500).json({ ok: false, error: 'parent_daily_failed' });
  }
});

router.post('/athlete-support/parent/monthly', requireSession, async (req, res) => {
  if (!athleteSupportEnabled()) return res.status(404).json({ ok: false, error: 'feature_disabled' });
  try {
    const out = await athleteSupportExtendedService.saveParentMonthly(req.webSession.user.id, req.body || {});
    res.json(out);
  } catch (error) {
    console.error('[web] athlete-support parent monthly:', error?.message || error);
    res.status(500).json({ ok: false, error: 'parent_monthly_failed' });
  }
});

router.post('/athlete-support/parent/translate', requireSession, async (req, res) => {
  if (!athleteSupportEnabled()) return res.status(404).json({ ok: false, error: 'feature_disabled' });
  try {
    const out = await athleteSupportExtendedService.translateParentNoteForAthlete(req.webSession.user.id, req.body || {});
    res.json(out);
  } catch (error) {
    console.error('[web] athlete-support translate:', error?.message || error);
    res.status(500).json({ ok: false, error: 'translate_failed' });
  }
});

router.post('/athlete-support/trainer/monthly', requireSession, async (req, res) => {
  if (!athleteSupportEnabled()) return res.status(404).json({ ok: false, error: 'feature_disabled' });
  try {
    const out = await athleteSupportExtendedService.saveTrainerMonthly(req.webSession.user.id, req.body || {});
    res.json(out);
  } catch (error) {
    console.error('[web] athlete-support trainer monthly:', error?.message || error);
    res.status(500).json({ ok: false, error: 'trainer_monthly_failed' });
  }
});

router.post('/athlete-support/trainer/weights', requireSession, async (req, res) => {
  if (!athleteSupportEnabled()) return res.status(404).json({ ok: false, error: 'feature_disabled' });
  try {
    const out = await athleteSupportExtendedService.saveWeeklyWeights(req.webSession.user.id, req.body || {});
    res.json(out);
  } catch (error) {
    console.error('[web] athlete-support weights:', error?.message || error);
    res.status(500).json({ ok: false, error: 'weights_failed' });
  }
});

router.post('/athlete-support/lab/save', requireSession, async (req, res) => {
  if (!athleteSupportEnabled()) return res.status(404).json({ ok: false, error: 'feature_disabled' });
  try {
    const out = await athleteSupportExtendedService.saveLabRecord(req.webSession.user.id, req.body || {});
    res.json(out);
  } catch (error) {
    console.error('[web] athlete-support lab save:', error?.message || error);
    res.status(500).json({ ok: false, error: 'lab_save_failed' });
  }
});

router.delete('/athlete-support/lab/:id', requireSession, async (req, res) => {
  if (!athleteSupportEnabled()) return res.status(404).json({ ok: false, error: 'feature_disabled' });
  try {
    const out = await athleteSupportExtendedService.deleteLabRecord(req.webSession.user.id, String(req.params.id || ''));
    res.json(out);
  } catch (error) {
    console.error('[web] athlete-support lab del:', error?.message || error);
    res.status(500).json({ ok: false, error: 'lab_delete_failed' });
  }
});

router.post('/athlete-support/race-dialogue', requireSession, async (req, res) => {
  if (!athleteSupportEnabled()) return res.status(404).json({ ok: false, error: 'feature_disabled' });
  try {
    const out = await athleteSupportExtendedService.saveRaceDialogue(req.webSession.user.id, req.body || {});
    res.json({ ok: true, ...out });
  } catch (error) {
    console.error('[web] athlete-support race:', error?.message || error);
    res.status(500).json({ ok: false, error: 'race_dialogue_failed' });
  }
});

router.post('/athlete-support/success/highlight', requireSession, async (req, res) => {
  if (!athleteSupportEnabled()) return res.status(404).json({ ok: false, error: 'feature_disabled' });
  try {
    const out = await athleteSupportExtendedService.addSuccessHighlight(req.webSession.user.id, req.body || {});
    res.json(out);
  } catch (error) {
    console.error('[web] athlete-support success:', error?.message || error);
    res.status(500).json({ ok: false, error: 'success_failed' });
  }
});

router.get('/athlete-support/export/monthly', requireSession, async (req, res) => {
  if (!athleteSupportEnabled()) return res.status(404).send('disabled');
  try {
    const state = await athleteSupportExtendedService.load(req.webSession.user.id);
    const html = athleteSupportExtendedService.buildMonthlyPrintHtml(req.webSession.user.id, state);
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.send(html);
  } catch (error) {
    console.error('[web] athlete-support export:', error?.message || error);
    res.status(500).send('export failed');
  }
});

router.use((error, _req, res, next) => {
  if (!error) return next();
  if (error instanceof multer.MulterError) {
    if (error.code === 'LIMIT_FILE_SIZE') {
      return res.status(400).json({
        ok: false,
        error: 'file_too_large',
        message: '添付サイズが大きすぎます。1ファイル 12MB 以下で送ってください。'
      });
    }
    if (error.code === 'LIMIT_FILE_COUNT') {
      return res.status(400).json({
        ok: false,
        error: 'too_many_files',
        message: '添付は一度に5ファイルまでです。'
      });
    }
    return res.status(400).json({
      ok: false,
      error: 'upload_invalid',
      message: '添付の受け取りに失敗しました。画像を選び直して再送してください。'
    });
  }
  return next(error);
});

module.exports = router;
