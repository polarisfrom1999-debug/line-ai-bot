'use strict';

const SCORE_STEP = 0.15;
const MAX_SINGLE_SIGNAL_SCORE = 0.3;
const APPLY_WEAK_MIN = 0.4;
const APPLY_STRONG_MIN = 0.7;

const PROFILE_CATEGORIES = [
  'decision_style',
  'motivation_source',
  'support_style',
  'risk_patterns',
  'trust_builders',
  'preferred_reply_depth',
  'praise_preference',
  'anticipatory_support_preference',
];

function normalizeText(value) {
  return String(value || '').trim();
}

function clone(value) {
  return JSON.parse(JSON.stringify(value || {}));
}

function clamp01(value) {
  return Math.max(0, Math.min(1, Number(value || 0)));
}

function ensureCategory(profile, category) {
  if (!profile[category] || typeof profile[category] !== 'object' || Array.isArray(profile[category])) {
    profile[category] = {};
  }
  return profile[category];
}

function addSignal(signals, category, trait, sourceText, reason, confidence = SCORE_STEP) {
  const safeTrait = normalizeText(trait);
  if (!category || !safeTrait) return;
  signals.push({
    category,
    trait: `${category}.${safeTrait}`,
    signal: safeTrait,
    source_text: normalizeText(sourceText).slice(0, 160),
    confidence: clamp01(confidence),
    reason: normalizeText(reason) || 'conversation_profile_candidate',
  });
}

function asArray(value) {
  if (Array.isArray(value)) return value;
  if (value == null || value === false) return [];
  return [value];
}

function collectCandidateSignals({ candidate, text, conversationUnderstanding, replyStrategy }) {
  const signals = [];
  const sourceText = normalizeText(text);
  const reason = normalizeText(conversationUnderstanding?.reason || replyStrategy?.reason || 'candidate_profile_signal');
  const rawCandidate = Array.isArray(candidate) ? candidate[0] : candidate;
  const cp = rawCandidate?.conversation_profile || rawCandidate || {};

  for (const trait of asArray(cp.decision_style)) addSignal(signals, 'decision_style', trait, sourceText, reason);
  for (const trait of asArray(cp.motivation_source)) addSignal(signals, 'motivation_source', trait, sourceText, reason);
  for (const trait of asArray(cp.support_style)) addSignal(signals, 'support_style', trait, sourceText, reason);
  for (const trait of asArray(cp.risk_patterns)) addSignal(signals, 'risk_patterns', trait, sourceText, reason);
  for (const trait of asArray(cp.trust_builders)) addSignal(signals, 'trust_builders', trait, sourceText, reason);
  for (const trait of asArray(cp.praise_preference)) addSignal(signals, 'praise_preference', trait, sourceText, reason);
  if (cp.anticipatory_support_preference === true) {
    addSignal(signals, 'anticipatory_support_preference', 'preferred', sourceText, reason);
  }
  const preferredDepth = cp.preferred_reply_depth && typeof cp.preferred_reply_depth === 'object'
    ? cp.preferred_reply_depth
    : {};
  for (const [purpose, depth] of Object.entries(preferredDepth)) {
    if (depth) addSignal(signals, 'preferred_reply_depth', `${purpose}:${depth}`, sourceText, reason);
  }

  if (/買い出し|作り置き|確認したい|変えて良い|変えていい|大丈夫/.test(sourceText)) {
    addSignal(signals, 'decision_style', 'checks_before_action', sourceText, 'text_checks_before_action');
    addSignal(signals, 'support_style', 'reasoned_explanation', sourceText, 'text_checks_before_action');
    addSignal(signals, 'support_style', 'anticipatory_support', sourceText, 'text_checks_before_action');
    addSignal(signals, 'trust_builders', 'specific_amounts', sourceText, 'text_checks_before_action');
    addSignal(signals, 'anticipatory_support_preference', 'preferred', sourceText, 'text_checks_before_action');
  }
  if (/何kcal|何g|何回|何キロカロリー|どれくらい|何分/.test(sourceText)) {
    addSignal(signals, 'decision_style', 'numbers_based', sourceText, 'text_numbers_based');
    addSignal(signals, 'decision_style', 'numbers_based', sourceText, 'specific_amount_request');
    addSignal(signals, 'trust_builders', 'specific_amounts', sourceText, 'text_numbers_based');
    addSignal(signals, 'trust_builders', 'specific_amounts', sourceText, 'specific_amount_request');
    addSignal(signals, 'support_style', 'reasoned_explanation', sourceText, 'text_numbers_based');
  }
  if (/できました|飲めました|歩けました|続け|達成|ストレッチでき/.test(sourceText)) {
    addSignal(signals, 'motivation_source', 'praise', sourceText, 'text_praise_motivation');
    addSignal(signals, 'motivation_source', 'praise', sourceText, 'positive_action_report');
    addSignal(signals, 'trust_builders', 'warm_praise', sourceText, 'text_praise_motivation');
    addSignal(signals, 'trust_builders', 'warm_praise', sourceText, 'positive_action_report');
    addSignal(signals, 'praise_preference', 'light_to_normal', sourceText, 'text_praise_motivation');
  }
  if (/不安|心配|迷います|迷う/.test(sourceText)) {
    addSignal(signals, 'decision_style', 'needs_reassurance', sourceText, 'text_needs_reassurance');
    addSignal(signals, 'support_style', 'gentle_boundary', sourceText, 'text_needs_reassurance');
  }

  const deduped = [];
  const seen = new Set();
  for (const signal of signals) {
    const key = `${signal.category}:${signal.signal}:${signal.reason}`;
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(signal);
  }
  return deduped;
}

function updateTrait(currentTrait = {}, signal, now) {
  const evidenceCount = Math.max(0, Number(currentTrait.evidence_count || 0)) + 1;
  const previousScore = clamp01(currentTrait.score || 0);
  const nextScore = clamp01(previousScore + Number(signal.confidence || SCORE_STEP));
  const examples = Array.isArray(currentTrait.examples) ? [...currentTrait.examples] : [];
  const example = normalizeText(signal.source_text).slice(0, 80);
  if (example && !examples.includes(example)) examples.push(example);
  return {
    score: Math.min(nextScore, evidenceCount === 1 ? MAX_SINGLE_SIGNAL_SCORE : 1),
    evidence_count: evidenceCount,
    last_seen_at: now,
    examples: examples.slice(-3),
  };
}

function appliedLevel(score) {
  const n = Number(score || 0);
  if (n >= APPLY_STRONG_MIN) return 'strong';
  if (n >= APPLY_WEAK_MIN) return 'weak';
  return '';
}

function summarizeAppliedTraits(profile = {}, safetyLevel = 'normal') {
  if (/caution|urgent/.test(normalizeText(safetyLevel))) return [];
  const out = [];
  for (const category of PROFILE_CATEGORIES) {
    const bucket = profile[category] && typeof profile[category] === 'object' ? profile[category] : {};
    for (const [trait, data] of Object.entries(bucket)) {
      const level = appliedLevel(data?.score);
      if (level) out.push({ category, trait, score: Number(data.score || 0), level });
    }
  }
  return out.sort((a, b) => b.score - a.score);
}

function aggregateConversationProfileCandidate(params = {}) {
  const now = normalizeText(params.timestamp) || new Date().toISOString();
  const current = clone(params.currentProfile || params.previousDryRunProfile || {});
  for (const category of PROFILE_CATEGORIES) ensureCategory(current, category);

  const evidence = collectCandidateSignals({
    candidate: params.conversation_profile_update_candidate || params.candidate,
    text: params.text,
    conversationUnderstanding: params.conversationUnderstanding,
    replyStrategy: params.replyStrategy,
  });

  const skippedTraits = [];
  for (const signal of evidence) {
    const bucket = ensureCategory(current, signal.category);
    const traitKey = signal.signal;
    bucket[traitKey] = updateTrait(bucket[traitKey], signal, now);
    if (bucket[traitKey].score < APPLY_WEAK_MIN) {
      skippedTraits.push({
        category: signal.category,
        trait: traitKey,
        score: bucket[traitKey].score,
        reason: 'score_below_apply_threshold',
      });
    }
  }

  current.updated_at = now;
  const appliedTraits = summarizeAppliedTraits(current, params.conversationUnderstanding?.safety_level || 'normal');
  return {
    conversationProfile: current,
    dryRunProfile: current,
    evidence,
    appliedTraits,
    skippedTraits,
    reason: evidence.length ? 'conversation_profile_aggregated' : 'no_profile_signal',
  };
}

module.exports = {
  aggregateConversationProfileCandidate,
  summarizeAppliedTraits,
  APPLY_WEAK_MIN,
  APPLY_STRONG_MIN,
};
