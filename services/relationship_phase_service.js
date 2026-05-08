'use strict';

const contextMemoryService = require('./context_memory_service');
const trustSignalDetectorService = require('./trust_signal_detector_service');

const PHASES = {
  P1: 'phase_1_professional_trust',
  P2: 'phase_2_safe_openness',
  P3: 'phase_3_emotional_trust',
  P4: 'phase_4_life_companion',
};

const ORDER = [PHASES.P1, PHASES.P2, PHASES.P3, PHASES.P4];

const LEGACY_PHASE_MAP = {
  phase_2_friendly_openness: PHASES.P2,
  phase_3_close_companion: PHASES.P3,
  phase_4_life_partner: PHASES.P4,
};

function normalizeText(v) {
  return String(v || '').trim();
}

function phaseRank(phase) {
  const i = ORDER.indexOf(normalizeText(phase));
  return i >= 0 ? i : 0;
}

function toTokyoYmd(d = new Date()) {
  return new Intl.DateTimeFormat('sv-SE', {
    timeZone: 'Asia/Tokyo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(d);
}

function daysBetweenYmd(a, b) {
  if (!a || !b) return 0;
  const [ay, am, ad] = a.split('-').map(Number);
  const [by, bm, bd] = b.split('-').map(Number);
  const da = Date.UTC(ay, am - 1, ad);
  const db = Date.UTC(by, bm - 1, bd);
  return Math.max(0, Math.round((db - da) / (24 * 60 * 60 * 1000)));
}

function normalizeStoredRelationshipPhase(longMemory = {}) {
  const raw = normalizeText(longMemory?.relationshipPhase);
  if (LEGACY_PHASE_MAP[raw]) return LEGACY_PHASE_MAP[raw];
  if (ORDER.includes(raw)) return raw;
  return '';
}

function migrateLegacyPhase(longMemory = {}, userState = {}) {
  const stored = normalizeStoredRelationshipPhase(longMemory);
  if (stored) return stored;
  const st = normalizeText(userState?.relationshipStage || '');
  if (st === 'best_friend') return PHASES.P3;
  if (st === 'friend') return PHASES.P2;
  return PHASES.P1;
}

function isTrustPhrase(text) {
  const safe = normalizeText(text);
  return /ありがと|助かる|聞いて|話して|話せて|救わ|支え|頼って|相談(して|でき)/.test(safe);
}

function isVulnerabilityMarker(text) {
  const safe = normalizeText(text);
  return /しんどい|つらい|限界|無理|弱音|だめ|不安|寂しい|孤独|泣き|落ち込|やる気.*ない|苦しい|怖い|迷い|わからない|曖昧|たぶん|きつい/.test(safe);
}

function isCorrectionOrConsult(text) {
  const safe = normalizeText(text);
  return /半分|訂正|修正|補正|間違い|教えて|どう思う|相談|聞いてほしい/.test(safe);
}

function isObligatoryShort(text) {
  const safe = normalizeText(text);
  if (!safe || safe.length > 14) return false;
  if (/記録|食事|運動|歩|km|ｋｍ|kcal|カロリー|体重|検査|画像|写真/.test(safe)) return false;
  return /^(はい|うん|お[kK]|OK|ok|了解|済|した|です|なるほど|そう|うーん|…|\.{2,})$/i.test(safe)
    || (safe.length <= 6 && !/[。！？]/.test(safe));
}

function buildTrustSignals({
  recentMessages = [],
  longMemory = {},
  userState = {},
  userText = '',
  trustHits = [],
} = {}) {
  const windowMsgs = (Array.isArray(recentMessages) ? recentMessages : []).filter((m) => m?.role === 'user');
  const lastUser = windowMsgs.slice(-14).map((m) => normalizeText(m?.content || '')).filter(Boolean);

  let trustPhraseCount = 0;
  let vulnerabilityMarkers = 0;
  let correctionConsult = 0;
  let substantive = 0;
  let obligatoryShort = 0;

  for (const line of lastUser) {
    if (isTrustPhrase(line)) trustPhraseCount += 1;
    if (isVulnerabilityMarker(line)) vulnerabilityMarkers += 1;
    if (isCorrectionOrConsult(line)) correctionConsult += 1;
    if (line.length >= 12 || /[。！？]/.test(line) || line.split(/\s+/).length >= 2) substantive += 1;
    if (isObligatoryShort(line)) obligatoryShort += 1;
  }

  if (userText) {
    if (isTrustPhrase(userText)) trustPhraseCount += 1;
    if (isVulnerabilityMarker(userText)) vulnerabilityMarkers += 1;
    if (isCorrectionOrConsult(userText)) correctionConsult += 1;
    if (userText.length >= 12 || /[。！？]/.test(userText)) substantive += 1;
  }

  const trial = normalizeText(longMemory?.trialStartedAt || '');
  const startedYmd = trial ? trial.slice(0, 10) : '';
  const activeDaySpan = startedYmd ? Math.min(120, daysBetweenYmd(startedYmd, toTokyoYmd()) + 1) : 0;

  const eating = Array.isArray(longMemory?.eatingPattern) ? longMemory.eatingPattern.length : 0;
  const bodySig = Array.isArray(longMemory?.bodySignals) ? longMemory.bodySignals.length : 0;
  const lifeCtx = Array.isArray(longMemory?.lifeContext) ? longMemory.lifeContext.length : 0;
  const healthRecordDiversityScore = Math.min(3, (eating > 0 ? 1 : 0) + (bodySig > 0 ? 1 : 0) + (lifeCtx > 0 ? 1 : 0));

  const denom = Math.max(1, lastUser.length);
  const obligatoryShortRatio = obligatoryShort / denom;

  const totalTurns = Number(userState?.totalTurns || 0);

  const deepTrustCounts = trustSignalDetectorService.countSignalsByType(trustHits);
  const deepTrustTotal = Array.isArray(trustHits) ? trustHits.length : 0;

  return {
    active_day_span: activeDaySpan,
    total_turns: totalTurns,
    substantive_user_messages_in_window: substantive,
    trust_phrase_hits: trustPhraseCount,
    vulnerability_markers: vulnerabilityMarkers,
    correction_or_consult_signals: correctionConsult,
    health_record_diversity_score: healthRecordDiversityScore,
    obligatory_short_ratio: Math.round(obligatoryShortRatio * 100) / 100,
    window_user_messages: lastUser.length,
    deep_trust_signal_counts: deepTrustCounts,
    deep_trust_signal_total: deepTrustTotal,
  };
}

function targetPhaseFromSignals(signals) {
  let score = 0;
  score += Math.min(15, Number(signals.active_day_span || 0) * 1.2);
  score += Math.min(22, Number(signals.substantive_user_messages_in_window || 0) * 2.2);
  score += Number(signals.trust_phrase_hits || 0) * 6;
  score += Number(signals.vulnerability_markers || 0) * 7;
  score += Number(signals.correction_or_consult_signals || 0) * 3.5;
  score += Number(signals.health_record_diversity_score || 0) * 4;
  score += Math.min(12, Number(signals.total_turns || 0) * 0.12);
  score += Math.min(20, Number(signals.deep_trust_signal_total || 0) * 4.5);
  score -= Number(signals.obligatory_short_ratio || 0) * 28;

  const counts = signals.deep_trust_signal_counts || {};
  if (counts.gratitude) score += Math.min(8, counts.gratitude * 3);
  if (counts.vulnerability || counts.emotional_disclosure) score += 4;

  if (score < 18) return PHASES.P1;
  if (score < 36) return PHASES.P2;
  if (score < 56) return PHASES.P3;
  return PHASES.P4;
}

function clampPhaseAdvance(previous, suggested, signals, meta = {}) {
  const prevI = phaseRank(previous);
  const sugI = phaseRank(suggested);
  if (sugI <= prevI) return ORDER[prevI];

  const turnsNow = Number(signals.total_turns || 0);
  const turnsAt = Number(meta.turnsAtLastPhaseChange ?? turnsNow);
  const minTurns = 8;
  if (turnsNow - turnsAt < minTurns && sugI > prevI + 1) {
    return ORDER[Math.min(ORDER.length - 1, prevI + 1)];
  }

  if (signals.obligatory_short_ratio >= 0.62 && signals.substantive_user_messages_in_window < 3) {
    return ORDER[prevI];
  }

  if (sugI - prevI > 1) {
    return ORDER[prevI + 1];
  }
  return ORDER[sugI];
}

function buildEvalReason(previous, next, signals) {
  if (previous === next) return 'threshold_not_met_or_hold_policy';
  if (phaseRank(next) > phaseRank(previous)) return 'trust_signals_support_phase_advance';
  return 'trust_signals_suggest_step_back_or_hold';
}

/**
 * フェーズ評価（利用回数だけで一気に上げない。deep_trust シグナルと最低ターン間隔で抑制）。
 */
async function evaluateAndPersistRelationshipPhase({
  userId,
  longMemory = {},
  userState = {},
  recentMessages = [],
  userText = '',
  trustHits = [],
} = {}) {
  const previous = migrateLegacyPhase(longMemory, userState);
  const signals = buildTrustSignals({
    recentMessages,
    longMemory,
    userState,
    userText,
    trustHits,
  });
  const suggested = targetPhaseFromSignals(signals);
  const meta = (longMemory?.relationshipPhaseMeta && typeof longMemory.relationshipPhaseMeta === 'object')
    ? longMemory.relationshipPhaseMeta
    : {};
  let next = clampPhaseAdvance(previous, suggested, signals, meta);

  if (phaseRank(next) < phaseRank(previous) && signals.obligatory_short_ratio < 0.55) {
    next = previous;
  }

  const reason = buildEvalReason(previous, next, signals);

  const rawPhaseInDb = normalizeText(longMemory?.relationshipPhase || '');
  const needsLegacyRename = Boolean(LEGACY_PHASE_MAP[rawPhaseInDb]);

  if (needsLegacyRename && next === previous) {
    await contextMemoryService.mergeLongMemory(userId, {
      relationshipPhase: next,
      relationshipPhaseUpdatedAt: new Date().toISOString(),
    });
  } else if (next !== previous) {
    await contextMemoryService.mergeLongMemory(userId, {
      relationshipPhase: next,
      relationshipPhaseUpdatedAt: new Date().toISOString(),
      relationshipPhaseMeta: {
        ...meta,
        turnsAtLastPhaseChange: Number(userState?.totalTurns || signals.total_turns || 0),
        lastPhaseChangeYmd: toTokyoYmd(),
      },
    });
  }

  console.info('[relationship_phase_evaluated]', {
    user_id: userId,
    previous_phase: previous,
    new_phase: next,
    trust_signals: signals,
    reason,
  });

  return { phase: next, previousPhase: previous, signals, reason };
}

module.exports = {
  PHASES,
  ORDER,
  evaluateAndPersistRelationshipPhase,
  buildTrustSignals,
  migrateLegacyPhase,
  normalizeStoredRelationshipPhase,
};
