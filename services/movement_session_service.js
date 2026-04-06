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

function normalizeClip(input = {}) {
  return {
    messageId: normalizeText(input.messageId || input.mediaMeta?.messageId || ''),
    duration: Number(input.mediaMeta?.duration || 0),
    receivedAt: nowIso(),
    sourceHint: normalizeText(input.rawText || ''),
  };
}

async function registerMovementVideo(userId, input = {}) {
  const safeUserId = normalizeText(userId);
  const clip = normalizeClip(input);
  if (!safeUserId || !clip.messageId) {
    return { ok: false, duplicate: false, session: null, clip };
  }

  const shortMemory = await contextMemoryService.getShortMemory(safeUserId);
  let session = shortMemory?.movementVideoSession || null;

  if (!session || !isRecent(session.updatedAt)) {
    session = {
      sessionId: buildSessionId(safeUserId),
      createdAt: nowIso(),
      updatedAt: nowIso(),
      status: 'collecting',
      clips: []
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
    return { ok: true, duplicate: true, session, clip };
  }

  const nextSession = {
    ...session,
    updatedAt: nowIso(),
    clips: [...(session.clips || []), clip],
  };
  nextSession.status = nextSession.clips.length >= 2 ? 'ready_for_bundle' : 'collecting';

  await contextMemoryService.saveShortMemory(safeUserId, {
    movementVideoSession: nextSession,
    followUpContext: {
      ...(shortMemory?.followUpContext || {}),
      source: 'movement_video',
      movementSessionId: nextSession.sessionId,
      movementClipCount: nextSession.clips.length,
      movementStatus: nextSession.status,
    }
  });

  return { ok: true, duplicate: false, session: nextSession, clip };
}

function buildMovementVideoReply(registered = {}) {
  const session = registered?.session || {};
  const clipCount = Array.isArray(session.clips) ? session.clips.length : 0;

  if (clipCount >= 2) {
    return [
      `動画は受け取りました。今は同じチェック回の動画として ${clipCount} 本をひとまとめにしています。`,
      '別々に断定せず、同じ回の素材として整理してから見ます。',
      '角度が分かる一言があると精度が上がります。例: 横から / 前から / 後ろから',
      '必要なら、このまま「横からです」「前からです」のように送ってください。'
    ].join('\n');
  }

  return [
    '動画は受け取りました。',
    '今は1本ずつ返すのではなく、同じチェック回の素材としてまとめ始めています。',
    '別角度があれば続けて送って大丈夫です。今の回として一緒に扱います。',
    'おすすめは「横から1本」と「正面か後方から1本」です。'
  ].join('\n');
}

module.exports = {
  registerMovementVideo,
  buildMovementVideoReply,
};
