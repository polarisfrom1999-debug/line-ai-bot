'use strict';

const memory = require('./context_memory_service');
const pointsService = require('./points_service');

async function persistRecords({ userId, recordPayloads }) {
  const payloads = Array.isArray(recordPayloads) ? recordPayloads : [];
  if (!userId || !payloads.length) return { ok: true, savedCount: 0, saved: [] };

  const saved = [];
  for (const payload of payloads) {
    await memory.addRecord(userId, payload);
    const pointValue = pointsService.getPointsForRecord(payload.recordType);
    await memory.addPoints(userId, pointValue, payload.recordType);
    saved.push({ userId, ...payload });
  }

  return { ok: true, savedCount: saved.length, saved };
}

module.exports = { persistRecords };
