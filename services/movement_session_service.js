'use strict';

const crypto = require('crypto');
const contextMemoryService = require('./context_memory_service');

const ACTIVE_WINDOW_MS = 20 * 60 * 1000;

function normalizeText(value) {
  return String(value || '').trim();
}

function nowIso() {
  return new Date().toISOString();
}

function buildSessionId(userId) {
  const base = `${normalizeText(userId)}:${Date.now()}:${Math.random()}`;
  return `mv_${crypto.createHash('sha1').update(base).digest('hex').slice(0, 12)}`;
}

function isRecent(iso) {
  const time = Date.parse(iso || '');
  if (!Number.isFinite(time)) return false;
  return (Date.now() - time) <= ACTIVE_WINDOW_MS;
}

function detectClipRole(input = {}) {
  const safe = normalizeText(input.rawText || '');
  if (/横/.test(safe)) return 'side';
  if (/前/.test(safe)) return 'front';
  if (/後ろ|後方/.test(safe)) return 'rear';
  return '';
}

function normalizeClip(input = {}) {
  return {
    messageId: normalizeText(input.messageId || input.mediaMeta?.messageId || ''),
    duration: Number(input.mediaMeta?.duration || 0),
    receivedAt: nowIso(),
    sourceHint: normalizeText(input.rawText || ''),
    role: detectClipRole(input)
  };
}

async function registerMovementVideo(userId, input = {}) {
  const safeUserId = normalizeText(userId);
  const clip = normalizeClip(input);
  if (!safeUserId || !clip.messageId) {
    return { ok: false, duplicate: false, session: null, clip, replyMode: 'none' };
  }

  const shortMemory = await contextMemoryService.getShortMemory(safeUserId);
  let session = shortMemory?.movementVideoSession || null;

  if (!session || !isRecent(session.updatedAt)) {
    session = {
      sessionId: buildSessionId(safeUserId),
      createdAt: nowIso(),
      updatedAt: nowIso(),
      status: 'collecting',
      clips: [],
      lastReplyMode: null
    };
  }

  const existingIds = new Set((session.clips || []).map((item) => normalizeText(item.messageId)));
  if (existingIds.has(clip.messageId)) {
    await contextMemoryService.saveShortMemory(safeUserId, {
      movementVideoSession: {
        ...session,
        updatedAt: nowIso()
      }
    });
    return { ok: true, duplicate: true, session, clip, replyMode: 'silent' };
  }

  const nextSession = {
    ...session,
    updatedAt: nowIso(),
    clips: [...(session.clips || []), clip]
  };
  nextSession.status = nextSession.clips.length >= 2 ? 'ready_for_bundle' : 'collecting';

  const replyMode = nextSession.clips.length >= 2 ? 'bundle_compact' : 'first_clip_short';
  nextSession.lastReplyMode = replyMode;

  await contextMemoryService.saveShortMemory(safeUserId, {
    movementVideoSession: nextSession,
    followUpContext: {
      ...(shortMemory?.followUpContext || {}),
      source: 'movement_video',
      movementSessionId: nextSession.sessionId,
      movementClipCount: nextSession.clips.length,
      movementStatus: nextSession.status
    }
  });

  return { ok: true, duplicate: false, session: nextSession, clip, replyMode };
}

function roleLabel(role) {
  if (role === 'side') return '横';
  if (role === 'front') return '前';
  if (role === 'rear') return '後ろ';
  return '';
}

function buildMovementVideoReply(registered = {}) {
  const session = registered?.session || {};
  const clipCount = Array.isArray(session.clips) ? session.clips.length : 0;
  const latestClip = clipCount ? session.clips[clipCount - 1] : null;
  const roles = Array.isArray(session.clips) ? session.clips.map((clip) => roleLabel(clip.role)).filter(Boolean) : [];
  const roleSummary = roles.length ? `今ある角度: ${roles.join(' / ')}` : '';

  if (registered?.replyMode === 'bundle_compact' || clipCount >= 2) {
    return [
      `動画は受け取りました。今は同じチェック回の動画として ${clipCount} 本をひとまとめにしています。`,
      roleSummary || null,
      '別々に断定せず、この回の素材として整理してから見ます。',
      '必要なら、このまま「横からです」「前からです」のように一言だけ添えて大丈夫です。'
    ].filter(Boolean).join('\n');
  }

  if (registered?.replyMode === 'first_clip_short') {
    const label = roleLabel(latestClip?.role);
    if (label) {
      return `動画は受け取りました。今の回の1本目は「${label}」として預かっています。別角度があれば続けて送って大丈夫です。`;
    }
    return '動画は受け取りました。今の回の1本目として預かっています。別角度があれば続けて送って大丈夫です。';
  }

  return '動画は受け取りました。';
}

module.exports = {
  registerMovementVideo,
  buildMovementVideoReply,
};
