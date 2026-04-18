'use strict';

const fs = require('fs/promises');
const path = require('path');

const DATA_DIR = path.join(__dirname, '..', 'data', 'athlete_support');

function safeUserKey(userId) {
  return String(userId || '')
    .replace(/[^a-zA-Z0-9_-]/g, '_')
    .slice(0, 120) || 'unknown';
}

function filePath(userId) {
  return path.join(DATA_DIR, `${safeUserKey(userId)}.json`);
}

async function ensureDir() {
  await fs.mkdir(DATA_DIR, { recursive: true });
}

function defaultState() {
  return {
    version: 1,
    profile: {
      displayName: '',
      grade: 7,
      sex: 'female',
      events: ['800m', '1500m'],
      prefecture: 'tokyo',
      targetTime800: '',
      targetTime1500: '',
      nextCompetitionName: '',
      nextCompetitionDate: '',
      currentFocus: ''
    },
    dailyByDate: {},
    trainingByDate: {}
  };
}

async function readState(userId) {
  await ensureDir();
  const fp = filePath(userId);
  try {
    const raw = await fs.readFile(fp, 'utf8');
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return defaultState();
    return { ...defaultState(), ...parsed, profile: { ...defaultState().profile, ...(parsed.profile || {}) } };
  } catch (_e) {
    return defaultState();
  }
}

async function writeState(userId, state) {
  await ensureDir();
  const fp = filePath(userId);
  const payload = JSON.stringify(state, null, 2);
  await fs.writeFile(fp, payload, 'utf8');
}

module.exports = {
  readState,
  writeState,
  defaultState,
  DATA_DIR
};
