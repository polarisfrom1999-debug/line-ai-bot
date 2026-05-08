'use strict';

const { PHASES } = require('./relationship_phase_service');

function normalizeText(v) {
  return String(v || '').trim();
}

/**
 * dependency ではなく deep_trust / emotional_safety / safe_reliance としてトーンを選ぶ。
 * @param {string} relationshipPhase
 * @param {string} intentTag — meal | exercise | normal_chat | lab | ...
 * @param {{ depth?: string }} replyDepthMeta
 */
function selectConversationTone(relationshipPhase, intentTag, replyDepthMeta = {}) {
  const p = normalizeText(relationshipPhase) || PHASES.P1;
  const intent = normalizeText(intentTag);
  const depth = normalizeText(replyDepthMeta.depth || 'normal');

  if (p === PHASES.P1) {
    return {
      tone_mode: 'emotional_safety_professional',
      safe_reliance: 'invite_reliable_presence',
      trusted_companion: 'coach_boundary',
      reason: 'phase_1_professional_trust',
    };
  }
  if (p === PHASES.P2) {
    return {
      tone_mode: 'safe_openness',
      deep_trust: 'building',
      emotional_safety: 'explicit_permission',
      reason: 'phase_2_safe_openness',
    };
  }
  if (p === PHASES.P3) {
    if (intent === 'meal' || intent === 'exercise') {
      return {
        tone_mode: 'emotional_trust_attuned_routine',
        readiness_to_reflect: true,
        reason: 'phase_3_health_routine',
      };
    }
    return {
      tone_mode: 'emotional_trust_attuned',
      deep_trust: 'noticing_change',
      reason: 'phase_3_emotional_trust',
    };
  }
  if (intent === 'normal_chat' || depth === 'deep') {
    return {
      tone_mode: 'life_companion_reflective',
      readiness_to_learn: depth !== 'short',
      trusted_companion: 'non_directive',
      reason: 'phase_4_conversation_or_deep',
    };
  }
  return {
    tone_mode: 'life_companion_guided',
    safe_reliance: 'side_by_side',
    reason: 'phase_4_life_companion',
  };
}

module.exports = {
  selectConversationTone,
};
