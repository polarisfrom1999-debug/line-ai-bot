'use strict';

/**
 * services/chatgpt_conversation_router.js
 *
 * 目的:
 * - ChatGPT先行処理拡張の土台
 * - 直前会話の流れを踏まえて、
 *   smalltalk / consultation / record_candidate / procedure / unknown
 *   を先に判定する
 * - index.js 側では「まずこの router に投げる」形へ寄せていく
 *
 * 今回の調整:
 * - 「プラン教えて」「料金」などは procedure を最優先
 * - 「体重62.4kg」「体脂肪率28%」などは record_candidate を最優先
 * - 明確入力の時は ambiguous に倒しにくくする
 */

const {
  buildInterpretationInput,
  safeText,
} = require('./chat_context_service');
const {
  buildSoftFollowup,
  buildDisambiguationReply,
} = require('./chat_recovery_service');
const {
  extractRecordCandidatesFromText,
  looksLikeConsultation,
} = require('./record_candidate_service');

const ROUTES = {
  SMALLTALK: 'smalltalk',
  CONSULTATION: 'consultation',
  RECORD_CANDIDATE: 'record_candidate',
  PROCEDURE: 'procedure',
  UNKNOWN: 'unknown',
};

function normalizeLoose(text = '') {
  return safeText(text)
    .toLowerCase()
    .replace(/[！!？?\s　]/g, ' ')
    .trim();
}

function includesAny(text = '', patterns = []) {
  return patterns.some((pattern) => pattern.test(text));
}

function detectProcedureIntent(text = '') {
  const t = normalizeLoose(text);
  return includesAny(t, [
    /プラン/,
    /料金/,
    /値段/,
    /無料体験/,
    /体験/,
    /会員/,
    /登録/,
    /入会/,
    /決済/,
    /支払い/,
    /変更/,
    /継続/,
    /解約/,
    /使い方/,
    /説明/,
    /教えて/,
    /コース/,
  ]);
}

function detectStrongProcedureIntent(text = '') {
  const t = normalizeLoose(text);
  return includesAny(t, [
    /プラン.*教えて/,
    /料金.*教えて/,
    /プラン教えて/,
    /料金教えて/,
    /会員.*教えて/,
    /継続.*したい/,
    /入会.*したい/,
    /プラン.*知りたい/,
    /料金.*知りたい/,
  ]);
}

function detectSmalltalkIntent(text = '') {
  const t = normalizeLoose(text);
  return includesAny(t, [
    /こんにちは/,
    /こんばんは/,
    /おはよう/,
    /ありがとう/,
    /疲れた/,
    /眠い/,
    /雑談/,
    /なんとなく/,
    /話したい/,
    /聞いて/,
  ]);
}

function isStrongWeightInput(text = '') {
  const t = safeText(text);
  return /体重\s*\d+(?:\.\d+)?\s*(kg|ｋｇ|キロ)/i.test(t)
    || /^\d+(?:\.\d+)?\s*(kg|ｋｇ|キロ)$/i.test(t);
}

function isStrongBodyFatInput(text = '') {
  const t = safeText(text);
  return /体脂肪(?:率)?\s*\d+(?:\.\d+)?\s*%/i.test(t)
    || /^\d+(?:\.\d+)?\s*%$/i.test(t);
}

function isStrongExerciseConsultation(text = '') {
  const t = normalizeLoose(text);
  return (
    looksLikeConsultation(t) &&
    includesAny(t, [
      /歩い/,
      /走っ/,
      /運動/,
      /ジョギング/,
      /膝/,
      /腰/,
      /痛い/,
      /痛み/,
    ])
  );
}

function scoreRoute(input = {}) {
  const text = safeText(input.currentUserText);
  const normalized = normalizeLoose(text);
  const topicHints = input.topicHints || {};
  const recordCandidates = extractRecordCandidatesFromText(text);

  const scores = {
    [ROUTES.SMALLTALK]: 0,
    [ROUTES.CONSULTATION]: 0,
    [ROUTES.RECORD_CANDIDATE]: 0,
    [ROUTES.PROCEDURE]: 0,
    [ROUTES.UNKNOWN]: 0,
  };

  if (detectSmalltalkIntent(normalized)) scores[ROUTES.SMALLTALK] += 2;
  if (detectProcedureIntent(normalized)) scores[ROUTES.PROCEDURE] += 3;
  if (detectStrongProcedureIntent(normalized)) scores[ROUTES.PROCEDURE] += 6;

  if (looksLikeConsultation(normalized) || topicHints.hasConsultTopic) {
    scores[ROUTES.CONSULTATION] += 3;
  }

  if (recordCandidates.length) {
    scores[ROUTES.RECORD_CANDIDATE] += Math.max(2, Math.round((recordCandidates[0].confidence || 0) * 4));
  }

  if (isStrongWeightInput(text) || isStrongBodyFatInput(text)) {
    scores[ROUTES.RECORD_CANDIDATE] += 6;
  }

  if (topicHints.hasProcedureTopic) scores[ROUTES.PROCEDURE] += 1;
  if (topicHints.hasMealTopic || topicHints.hasExerciseTopic || topicHints.hasWeightTopic || topicHints.hasBloodTestTopic) {
    scores[ROUTES.RECORD_CANDIDATE] += 1;
  }

  if (isStrongExerciseConsultation(normalized)) {
    scores[ROUTES.CONSULTATION] += 5;
    scores[ROUTES.RECORD_CANDIDATE] -= 3;
  }

  if (input.currentTextLooksAmbiguous) {
    if (topicHints.hasConsultTopic) scores[ROUTES.CONSULTATION] += 1;
    if (topicHints.hasMealTopic || topicHints.hasExerciseTopic || topicHints.hasWeightTopic) {
      scores[ROUTES.RECORD_CANDIDATE] += 1;
    }
    if (!topicHints.hasProcedureTopic && !topicHints.hasMealTopic && !topicHints.hasExerciseTopic && !topicHints.hasConsultTopic) {
      scores[ROUTES.SMALLTALK] += 1;
    }
  }

  return {
    scores,
    recordCandidates,
    flags: {
      strongProcedure: detectStrongProcedureIntent(normalized),
      strongWeight: isStrongWeightInput(text),
      strongBodyFat: isStrongBodyFatInput(text),
      strongExerciseConsultation: isStrongExerciseConsultation(normalized),
    },
  };
}

function pickPrimaryRoute(scores = {}, flags = {}) {
  const entries = Object.entries(scores).sort((a, b) => b[1] - a[1]);
  const [topRoute, topScore] = entries[0] || [ROUTES.UNKNOWN, 0];
  const secondScore = entries[1]?.[1] ?? 0;

  let ambiguous = topScore <= 0 || Math.abs(topScore - secondScore) <= 1;

  if (flags.strongProcedure && topRoute === ROUTES.PROCEDURE) ambiguous = false;
  if ((flags.strongWeight || flags.strongBodyFat) && topRoute === ROUTES.RECORD_CANDIDATE) ambiguous = false;
  if (flags.strongExerciseConsultation && topRoute === ROUTES.CONSULTATION) ambiguous = false;

  return {
    primaryRoute: ambiguous ? ROUTES.UNKNOWN : topRoute,
    ambiguous,
    sortedEntries: entries,
  };
}

function buildRouteResult({
  input = {},
  primaryRoute = ROUTES.UNKNOWN,
  ambiguous = false,
  recordCandidates = [],
  sortedEntries = [],
} = {}) {
  const lastAssistantText = input.lastAssistantMessage?.text || '';
  const topicHints = input.topicHints || {};
  const candidateRoutes = sortedEntries
    .filter((item) => Number(item[1]) > 0)
    .map((item) => item[0])
    .slice(0, 3);

  if (ambiguous) {
    return {
      route: ROUTES.UNKNOWN,
      is_ambiguous: true,
      needs_clarification: true,
      reply_text: buildDisambiguationReply({
        candidates: candidateRoutes,
        topicHints,
      }),
      record_candidates: recordCandidates,
      meta: {
        candidate_routes: candidateRoutes,
        topic_hints: topicHints,
      },
    };
  }

  if (primaryRoute === ROUTES.RECORD_CANDIDATE && !recordCandidates.length) {
    return {
      route: ROUTES.UNKNOWN,
      is_ambiguous: true,
      needs_clarification: true,
      reply_text: buildSoftFollowup({
        route: primaryRoute,
        userText: input.currentUserText,
        lastAssistantText,
        topicHints,
      }),
      record_candidates: [],
      meta: {
        topic_hints: topicHints,
      },
    };
  }

  return {
    route: primaryRoute,
    is_ambiguous: false,
    needs_clarification: false,
    reply_text: '',
    record_candidates: recordCandidates,
    top_record_candidate: recordCandidates[0] || null,
    meta: {
      topic_hints: topicHints,
      candidate_routes: candidateRoutes,
    },
  };
}

async function routeConversation({
  user,
  currentUserText = '',
  recentMessages = [],
  profileSummary = '',
} = {}) {
  const input = buildInterpretationInput({
    user,
    recentMessages,
    currentUserText,
    profileSummary,
  });

  const scored = scoreRoute(input);
  const picked = pickPrimaryRoute(scored.scores, scored.flags);

  return buildRouteResult({
    input,
    primaryRoute: picked.primaryRoute,
    ambiguous: picked.ambiguous,
    recordCandidates: scored.recordCandidates,
    sortedEntries: picked.sortedEntries,
  });
}

module.exports = {
  ROUTES,
  normalizeLoose,
  detectProcedureIntent,
  detectStrongProcedureIntent,
  detectSmalltalkIntent,
  isStrongWeightInput,
  isStrongBodyFatInput,
  isStrongExerciseConsultation,
  scoreRoute,
  pickPrimaryRoute,
  buildRouteResult,
  routeConversation,
};
