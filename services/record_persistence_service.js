services/record_persistence_service.js
'use strict';

/**
 * services/record_persistence_service.js
 */

async function persistRecords({ userId, recordPayloads }) {
  const payloads = Array.isArray(recordPayloads) ? recordPayloads : [];
  if (!userId || !payloads.length) {
    return { ok: true, savedCount: 0, saved: [] };
  }

  const saved = [];
  for (const payload of payloads) {
    saved.push({
      userId,
      ...payload
    });
  }

  return {
    ok: true,
    savedCount: saved.length,
    saved
  };
}

module.exports = {
  persistRecords
};
