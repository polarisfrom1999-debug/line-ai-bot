'use strict';

const assert = require('assert');
const activeContextService = require('../services/active_context_service');

async function run() {
  const userId = 'smoke-user';
  const payload = { labPanel: { patientName: 'test' } };
  const saved = await activeContextService.setActiveContext(userId, {
    type: 'lab_followup_session',
    payload,
    ttlMs: 60 * 1000
  });
  assert(saved?.type === 'lab_followup_session');

  const loaded = await activeContextService.getActiveContext(userId);
  assert(loaded?.type === 'lab_followup_session');
  assert(loaded?.payload?.labPanel?.patientName === 'test');
  await activeContextService.clearActiveContext(userId);
  console.log('smoke_v2_session_followup: ok');
}

run().catch((error) => {
  console.error(error?.stack || error?.message || error);
  process.exit(1);
});
