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
        displayName: user.display_name || user.preferred_name || 'ここから。ユーザー'
      },
      session: {
        expiresAt: req.webSession.session.expires_at
      },
      ...payload
    });
  } catch (error) {
    console.error('[web] bootstrap error:', error?.message || error);
    res.status(500).json({ ok: false, error: 'bootstrap_failed', message: '初期表示の準備でエラーが起きました。' });
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
    res.status(500).json({ ok: false, error: 'home_failed', message: 'ホーム情報を取得できませんでした。' });
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
    res.status(500).json({ ok: false, error: 'chat_bundle_failed', message: '相談画面の準備でエラーが起きました。' });
  }
});

router.post('/chat/send', requireSession, async (req, res) => {
  try {
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

    const result = await conversationRouter.routeConversation(input);
    const replyMessages = Array.isArray(result?.replyMessages) ? result.replyMessages : [];
    const replyText = chatLogService.joinReplyText(replyMessages) || '受け取りました。';

    await chatLogService.logConversationOutcome({ input, result });
    await conversationSummaryService.recordTurn({ input, result });

    dataService.invalidateUserCache(req.webSession.user.id, { reason: 'web_chat', scopes: { chat: true, records: false, home: true } });
    const homeSnapshot = await dataService.getHomeData(req.webSession.user);
    const [recordsOverview, supportCards] = await Promise.all([
      dataService.getRecordsOverview(req.webSession.user),
      dataService.getChatSidebar(req.webSession.user, { home: homeSnapshot })
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
    const conversationBridge = homeSnapshot.conversationBridge || dataService.buildConversationBridge(await dataService.getChatHistory(req.webSession.user, 8), homeSnapshot, recordsOverview);
    const reentryGuide = homeSnapshot.reentryGuide || dataService.buildReentryGuide(homeSnapshot, recordsOverview, homeSnapshot.engagement || {}, homeSnapshot.recentTimeline || []);
    const sync = await dataService.getSyncStatus(req.webSession.user);
    realtimeService.notifyUser(req.webSession.user.id, { userId: req.webSession.user.id, sync, reason: 'web_chat' });

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
      sync
    });
  } catch (error) {
    console.error('[web] chat send error:', error?.message || error);
    res.status(500).json({ ok: false, error: 'chat_send_failed', message: 'チャット送信でエラーが起きました。' });
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
