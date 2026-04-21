'use strict';

const assert = require('assert');
const sessionRepo = require('../repositories/session_state_repository');
const labRepo = require('../repositories/lab_session_repository');
const mealRepo = require('../repositories/meal_capture_repository');

async function run() {
  assert.strictEqual(typeof sessionRepo.upsertActiveSession, 'function');
  assert.strictEqual(typeof sessionRepo.getLatestActiveSession, 'function');
  assert.strictEqual(typeof sessionRepo.closeActiveSessions, 'function');
  assert.strictEqual(typeof labRepo.createLabSession, 'function');
  assert.strictEqual(typeof mealRepo.createMealCaptureSession, 'function');
  assert.strictEqual(typeof mealRepo.appendMealCaptureEvent, 'function');
  console.log('smoke_v2_repositories: ok');
}

run().catch((error) => {
  console.error(error?.stack || error?.message || error);
  process.exit(1);
});
