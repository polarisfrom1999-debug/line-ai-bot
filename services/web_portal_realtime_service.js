'use strict';

const streamsByUser = new Map();
let heartbeatHandle = null;

function normalizeUserId(userId) {
  return String(userId || '').trim();
}

function ensureHeartbeat() {
  if (heartbeatHandle) return;
  heartbeatHandle = setInterval(() => {
    const now = new Date().toISOString();
    for (const streams of streamsByUser.values()) {
      for (const client of streams) {
        try {
          client.res.write(`event: ping\ndata: ${JSON.stringify({ now })}\n\n`);
        } catch (_error) {}
      }
    }
  }, Number(process.env.WEB_REALTIME_HEARTBEAT_MS || 25000));
  if (typeof heartbeatHandle.unref === 'function') heartbeatHandle.unref();
}

function writeEvent(res, eventName, payload) {
  res.write(`event: ${eventName}\n`);
  res.write(`data: ${JSON.stringify(payload || {})}\n\n`);
}

function openStream({ userId, res, initialSync = null, sessionExpiresAt = null } = {}) {
  const safeUserId = normalizeUserId(userId);
  if (!safeUserId) throw new Error('userId is required');

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  if (typeof res.flushHeaders === 'function') res.flushHeaders();
  if (res.socket?.setTimeout) res.socket.setTimeout(0);
  if (res.socket?.setNoDelay) res.socket.setNoDelay(true);
  if (res.socket?.setKeepAlive) res.socket.setKeepAlive(true)

  const client = { res, connectedAt: Date.now() };
  const streams = streamsByUser.get(safeUserId) || new Set();
  streams.add(client);
  streamsByUser.set(safeUserId, streams);
  ensureHeartbeat()

  writeEvent(res, 'connected', {
    userId: safeUserId,
    sessionExpiresAt,
    now: new Date().toISOString(),
    sync: initialSync
  })

  const close = () => {
    const current = streamsByUser.get(safeUserId);
    if (!current) return;
    current.delete(client);
    if (!current.size) streamsByUser.delete(safeUserId);
  };
  res.on('close', close);
  res.on('finish', close);
}

function notifyUser(userId, payload = {}) {
  const safeUserId = normalizeUserId(userId);
  if (!safeUserId) return;
  const streams = streamsByUser.get(safeUserId);
  if (!streams || !streams.size) return;
  const body = {
    now: new Date().toISOString(),
    ...payload
  };
  for (const client of [...streams]) {
    try {
      writeEvent(client.res, payload.eventName || 'sync', body);
    } catch (_error) {
      streams.delete(client);
    }
  }
  if (!streams.size) streamsByUser.delete(safeUserId);
}

module.exports = {
  openStream,
  notifyUser
};
