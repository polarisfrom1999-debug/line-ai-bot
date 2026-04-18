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
    version: 2,
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
    trainingByDate: {},
    parentByDate: {},
    parentMonthlyByMonth: {},
    trainerMonthlyByMonth: {},
    labRecords: [],
    raceDialogue: {
      phase: 'idle',
      preAnswers: {},
      postAnswers: {},
      updatedAt: null
    },
    successHighlights: [],
    parentNotesForAthlete: [],
    weeklyWeights: []
  };
}

function normalizeState(parsed) {
  const d = defaultState();
  if (!parsed || typeof parsed !== 'object') return d;
  return {
    ...d,
    ...parsed,
    profile: { ...d.profile, ...(parsed.profile || {}) },
    dailyByDate: { ...d.dailyByDate, ...(parsed.dailyByDate || {}) },
    trainingByDate: { ...d.trainingByDate, ...(parsed.trainingByDate || {}) },
    parentByDate: { ...d.parentByDate, ...(parsed.parentByDate || {}) },
    parentMonthlyByMonth: { ...d.parentMonthlyByMonth, ...(parsed.parentMonthlyByMonth || {}) },
    trainerMonthlyByMonth: { ...d.trainerMonthlyByMonth, ...(parsed.trainerMonthlyByMonth || {}) },
    labRecords: Array.isArray(parsed.labRecords) ? parsed.labRecords : [],
    raceDialogue: {
      ...d.raceDialogue,
      ...(parsed.raceDialogue || {}),
      preAnswers: { ...(d.raceDialogue.preAnswers || {}), ...((parsed.raceDialogue || {}).preAnswers || {}) },
      postAnswers: { ...(d.raceDialogue.postAnswers || {}), ...((parsed.raceDialogue || {}).postAnswers || {}) }
    },
    successHighlights: Array.isArray(parsed.successHighlights) ? parsed.successHighlights : [],
    parentNotesForAthlete: Array.isArray(parsed.parentNotesForAthlete) ? parsed.parentNotesForAthlete : [],
    weeklyWeights: Array.isArray(parsed.weeklyWeights) ? parsed.weeklyWeights : []
  };
}

async function readState(userId) {
  await ensureDir();
  const fp = filePath(userId);
  try {
    const raw = await fs.readFile(fp, 'utf8');
    const parsed = JSON.parse(raw);
    return normalizeState(parsed);
  } catch (_e) {
    return defaultState();
  }
}

async function writeState(userId, state) {
  await ensureDir();
  const fp = filePath(userId);
  const payload = JSON.stringify(normalizeState(state), null, 2);
  await fs.writeFile(fp, payload, 'utf8');
}

module.exports = {
  readState,
  writeState,
  defaultState,
  normalizeState,
  DATA_DIR
};
