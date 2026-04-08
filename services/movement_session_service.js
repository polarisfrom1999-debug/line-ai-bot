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

function getActiveMovementSession(shortMemory = {}) {
  const session = shortMemory?.movementVideoSession || null;
  if (!session || !isRecent(session.updatedAt)) return null;
  return session;
}

async function applyRoleHintToActiveSession(userId, text) {
  const safeUserId = normalizeText(userId);
  const safeText = normalizeText(text);
  if (!safeUserId || !safeText) return null;
  const role = detectClipRole({ rawText: safeText });
  if (!role) return null;

  const shortMemory = await contextMemoryService.getShortMemory(safeUserId);
  const session = getActiveMovementSession(shortMemory);
  if (!session || !Array.isArray(session.clips) || !session.clips.length) return null;

  const clips = [...session.clips];
  const targetIndex = clips.findIndex((clip) => !normalizeText(clip.role));
  const index = targetIndex >= 0 ? targetIndex : clips.length - 1;
  clips[index] = { ...clips[index], role };

  const nextSession = {
    ...session,
    clips,
    updatedAt: nowIso()
  };

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

  return nextSession;
}

function buildMovementConsultationReply(session = {}, text = '') {
  const safeText = normalizeText(text);
  const roles = Array.isArray(session.clips) ? session.clips.map((clip) => roleLabel(clip.role)).filter(Boolean) : [];
  const roleSummary = roles.length ? `今の回では ${roles.join(' / ')} の素材を受け取っています。` : `今の回では ${Array.isArray(session.clips) ? session.clips.length : 0} 本の素材をまとめています。`;

  const concernLines = [];
  if (/アキレス腱/.test(safeText)) {
    concernLines.push('アキレス腱の負担が気になる時は、着地が体の前に流れすぎていないか、蹴り出しで足首が固くなりすぎていないかを優先して見ます。');
  }
  if (/着地|接地|足の運び/.test(safeText)) {
    concernLines.push('まずは着地位置、接地の長さ、足首の返し方を優先して整理します。');
  }
  if (/膝/.test(safeText)) {
    concernLines.push('あわせて、膝が内に入りすぎていないかも見どころになります。');
  }
  if (/体幹|骨盤|腕振り/.test(safeText)) {
    concernLines.push('体幹のぶれ、骨盤の傾き、腕振りの左右差も同じ回の中で整理していきます。');
  }

  const generic = concernLines.length
    ? concernLines
    : ['今回の素材では、着地・足首・膝の向き・体幹ぶれ・左右差を優先して整理します。'];

  const tail = /評価|解析|判定|見てもら|見てほし|分析/.test(safeText)
    ? '必要なら、このまま「特に右足です」「横からです」のように1つだけ補足してください。'
    : '続けて別角度や気になる場面があれば、そのまま送って大丈夫です。';

  return [roleSummary, ...generic, tail].filter(Boolean).join('\n');
}

module.exports = {
  registerMovementVideo,
  buildMovementVideoReply,
  getActiveMovementSession,
  applyRoleHintToActiveSession,
  buildMovementConsultationReply,
};
