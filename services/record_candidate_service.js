'use strict';

/**
 * services/record_candidate_service.js
 *
 * 役割:
 * - capture系で拾った候補を後段で扱いやすい統一形式へそろえる
 * - ここでは保存しない
 */

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function normalizeDateFromTimestamp(timestamp) {
  const d = new Date(timestamp || Date.now());
  return d.toISOString().slice(0, 10);
}

function normalizeRecordType(captureType, candidatePayload) {
  if (candidatePayload && candidatePayload.recordType) return candidatePayload.recordType;
  switch (captureType) {
    case 'meal_record': return 'meal';
    case 'weight_record': return 'weight';
    case 'exercise_record': return 'exercise';
    case 'lab_record': return 'lab';
    case 'profile_update': return 'profile';
    default: return 'unknown';
  }
}

function buildCandidateFromCaptureRoute(captureRoute, context) {
  if (!captureRoute || !captureRoute.candidatePayload) return null;

  const payload = clone(captureRoute.candidatePayload);
  return {
    recordType: normalizeRecordType(captureRoute.captureType, payload),
    source: payload.source || (context?.input?.messageType === 'image' ? 'image_followup' : 'text'),
    certainty: captureRoute.confidence >= 0.85 ? 'high' : captureRoute.confidence >= 0.6 ? 'medium' : 'low',
    eventDate: payload.eventDate || normalizeDateFromTimestamp(context?.input?.timestamp),
    extracted: payload,
    needsConfirmation: Boolean(captureRoute.needsConfirmation),
    rawText: payload.rawText || context?.input?.rawText || ''
  };
}

function buildCandidatesFromChatCapture(recordCandidates, context) {
  return (recordCandidates || []).map((candidate) => ({
    recordType: candidate.recordType || 'unknown',
    source: candidate.source || (context?.input?.messageType === 'image' ? 'image_followup' : 'text'),
    certainty: candidate.certainty || 'medium',
    eventDate: normalizeDateFromTimestamp(context?.input?.timestamp),
    extracted: clone(candidate),
    needsConfirmation: Boolean(candidate.needsConfirmation),
    rawText: candidate.rawText || context?.input?.rawText || ''
  }));
}

function dedupeCandidates(candidates) {
  const seen = new Set();
  const result = [];
  for (const candidate of candidates || []) {
    if (!candidate) continue;
    const key = JSON.stringify([
      candidate.recordType,
      candidate.eventDate,
      candidate.rawText,
      candidate.source
    ]);
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(candidate);
  }
  return result;
}

function buildUnifiedRecordCandidates(params) {
  const context = params?.context || {};
  const captureRoute = params?.captureRoute || null;
  const chatCapture = params?.chatCapture || {};

  const candidates = [];

  const routeCandidate = buildCandidateFromCaptureRoute(captureRoute, context);
  if (routeCandidate) candidates.push(routeCandidate);

  candidates.push(...buildCandidatesFromChatCapture(chatCapture.recordCandidates, context));

  return dedupeCandidates(candidates);
}

module.exports = {
  buildUnifiedRecordCandidates,
  buildCandidateFromCaptureRoute,
  buildCandidatesFromChatCapture
};
