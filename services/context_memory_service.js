'use strict';

const { formatJapanDateTime } = require('./time_service');
const shortMemoryStore = new Map();
const longMemoryStore = new Map();
const userStateStore = new Map();
const recentMessageStore = new Map();
const recordStore = new Map();
const pointsStore = new Map();
const surveyStore = new Map();

const DEFAULT_SHORT_MEMORY = {
  pendingRecordCandidate: null,
  lastEmotionTone: 'neutral',
  followUpContext: null,
  onboardingState: { isActive: false, currentStep: null, completedSteps: [], answers: {} },
  surveyState: { isActive: false, surveyType: null, currentIndex: 0, answers: [] }
};
const DEFAULT_LONG_MEMORY = {
  preferredName: null, goal: null, age: null, weight: null, bodyFat: null,
  aiType: null, constitutionType: null, selectedPlan: null, trialStartedAt: null,
  onboardingCompleted: false, eatingPattern: [], supportPreference: [], lifeContext: []
};
const DEFAULT_USER_STATE = { nagiScore: 5, gasolineScore: 5, trustScore: 3, lastEmotionTone: 'neutral', updatedAt: null };
function clone(v){ return JSON.parse(JSON.stringify(v)); }
function mergeDeep(base, patch){
  if (!patch || typeof patch !== 'object' || Array.isArray(patch)) return patch;
  const result = Array.isArray(base) ? [...base] : { ...(base || {}) };
  for (const [k,v] of Object.entries(patch)) result[k] = v && typeof v === 'object' && !Array.isArray(v) ? mergeDeep(result[k], v) : v;
  return result;
}
async function getShortMemory(userId){ return clone(shortMemoryStore.get(userId) || DEFAULT_SHORT_MEMORY); }
async function getLongMemory(userId){ return clone(longMemoryStore.get(userId) || DEFAULT_LONG_MEMORY); }
async function saveShortMemory(userId, payload){ const next = mergeDeep(await getShortMemory(userId), payload || {}); shortMemoryStore.set(userId, next); return clone(next); }
async function mergeLongMemory(userId, patch){ const next = mergeDeep(await getLongMemory(userId), patch || {}); longMemoryStore.set(userId, next); return clone(next); }
async function getUserState(userId){ return clone(userStateStore.get(userId) || DEFAULT_USER_STATE); }
async function updateUserState(userId, payload){ const next = mergeDeep(DEFAULT_USER_STATE, payload || {}); userStateStore.set(userId, next); return clone(next); }
async function getRecentMessages(userId, limit = 20){ return clone((recentMessageStore.get(userId) || []).slice(-limit)); }
async function appendRecentMessage(userId, role, content){ if(!userId||!role||!content) return; const arr=recentMessageStore.get(userId)||[]; arr.push({role,content:String(content),createdAt:formatJapanDateTime()}); recentMessageStore.set(userId, arr.slice(-300)); }
async function appendRecord(userId, record){ const arr=recordStore.get(userId)||[]; arr.push({...record, createdAt: formatJapanDateTime()}); recordStore.set(userId, arr.slice(-1000)); return clone(arr[arr.length-1]); }
async function getRecords(userId){ return clone(recordStore.get(userId)||[]); }
async function addPoints(userId, amount, reason){ const current=pointsStore.get(userId)||{total:0,history:[]}; current.total += Number(amount||0); current.history.push({amount:Number(amount||0), reason:reason||'', createdAt:formatJapanDateTime()}); pointsStore.set(userId,current); return clone(current); }
async function getPoints(userId){ return clone(pointsStore.get(userId)||{total:0,history:[]}); }
async function saveSurveyResult(userId, payload){ const arr=surveyStore.get(userId)||[]; arr.push({...payload, createdAt:formatJapanDateTime()}); surveyStore.set(userId, arr); return clone(arr[arr.length-1]); }
async function getSurveyResults(userId){ return clone(surveyStore.get(userId)||[]); }
async function buildRecentSummary(userId){ const messages=await getRecentMessages(userId, 40); const text=messages.filter(m=>m.role==='user').map(m=>m.content).join('
'); const parts=[]; if(/疲れ|眠い|寝不足/.test(text)) parts.push('最近は疲れや眠さの話が少し出ています。'); if(/不安|つらい|しんどい/.test(text)) parts.push('不安やしんどさが時々あります。'); if(/食べた|ラーメン|寿司|朝ごはん/.test(text)) parts.push('食事の記録は少しずつ続いています。'); if(/運動|歩いた|スクワット/.test(text)) parts.push('運動の話題も入ってきています。'); return parts.join(' ')||''; }
module.exports = { getShortMemory, getLongMemory, saveShortMemory, mergeLongMemory, getUserState, updateUserState, getRecentMessages, appendRecentMessage, appendRecord, getRecords, addPoints, getPoints, saveSurveyResult, getSurveyResults, buildRecentSummary };
