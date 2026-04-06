'use strict';

const express = require('express');
const conversationRouter = require('../services/chatgpt_conversation_router');
const chatLogService = require('../services/chat_log_service');
const conversationSummaryService = require('../services/conversation_summary_service');
const authService = require('../services/web_portal_auth_service');
const dataService = require('../services/web_portal_data_service');
const realtimeService = require('../services/web_portal_realtime_service');

const router = express.Router();

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
  return user?.display_name || user?.preferred_name || 'ここから。ユーザー';
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
    return `つらさがある中で送ってくれてありがとうございます。まずは「どこが」「いつから」「何をするとつらいか」を一つずつ整理すると、次の見方を作りやすいです。`;
  }
  if (/TG|HbA1c|LDL|HDL|血液|検査/.test(safe)) {
    return '検査の相談を受け取りました。画像や項目を一つずつ見ながら、まずは気になる数値から整理していきましょう。';
  }
  if (/食事|ごはん|朝|昼|夜|カロリー/.test(safe)) {
    return '食事の相談を受け取りました。全部を直そうとせず、まずは一食ぶんの見直しから一緒に整理していけます。';
  }
  return `「${safe.slice(0, 60)}${safe.length > 60 ? '…' : ''}」を受け取りました。今いちばん気になる一点から、一緒に整理していきましょう。`;
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
    res.json({
      ok: true,
      sessionToken: result.sessionToken,
      expiresAt: result.expiresAt,
      profile: {
        userId: result.user.id,
        lineUserId: result.user.line_user_id,
        displayName: result.user.display_name || result.user.preferred_name || 'ここから。ユーザー'
      }
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
  res.json({
    ok: true,
    profile: {
      userId: user.id,
      lineUserId: user.line_user_id,
      displayName: user.display_name || user.preferred_name || 'ここから。ユーザー'
    },
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
    const payload = await dataService.getBootstrapData(user, { since });
    res.json({
      ok: true,
      profile: {
        userId: user.id,
        lineUserId: user.line_user_id,
        displayName: buildDisplayName(user)
      },
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
    res.json({ ok: true, fallback: true, profile: { userId: user.id, lineUserId: user.line_user_id, displayName: buildDisplayName(user) }, session: { expiresAt: req.webSession.session.expires_at }, home: fallback.home, sidebar: dataService.buildFallbackSidebar(user, fallback.home), recordsOverview: fallback.recordsOverview, starters: fallback.starters, sync, supportMode: fallback.home.supportMode, stuckPrompts: fallback.home.stuckPrompts, consultLanes: fallback.home.consultLanes, recentTimeline: fallback.home.recentTimeline, reflection: { headline: 'ここから始められます', body: '接続は通っています。まずは一つだけ相談を送れば大丈夫です。' }, followups: ['今いちばん気になることを一つだけ整理したい'], supportCompass: fallback.home.supportCompass, returnDigest: fallback.home.returnDigest, microStep: fallback.home.microStep, resumePrompts: fallback.home.resumePrompts, conversationBridge: fallback.home.conversationBridge, reentryGuide: fallback.home.reentryGuide, consultationCarry: fallback.home.consultationCarry, returnAnchor: fallback.home.returnAnchor, sinceDigest: fallback.home.sinceDigest });
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
  const message = String(req.body?.message || '').trim();
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
    res.status(500).json({ ok: false, error: 'records_bundle_failed', message: '記録画面の準備でエラーが起きました。' });
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

module.exports = router;
