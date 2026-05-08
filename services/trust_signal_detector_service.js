'use strict';

/**
 * deep_trust / emotional_safety 形成のための発話シグナル（依存ではなく信頼のサインとして扱う）。
 */

function normalizeText(v) {
  return String(v || '').trim();
}

const SIGNAL_TYPES = {
  GRATITUDE: 'gratitude',
  HELP_SEEKING: 'help_seeking',
  VULNERABILITY: 'vulnerability',
  SELF_DOUBT: 'self_doubt',
  CORRECTION_WILLINGNESS: 'correction_willingness',
  EMOTIONAL_DISCLOSURE: 'emotional_disclosure',
  LEARNING_READINESS: 'learning_readiness',
};

function pushHit(list, signal_type, confidence, snippet) {
  list.push({
    signal_type,
    confidence: Math.max(0, Math.min(1, Number(confidence) || 0)),
    text: normalizeText(snippet).slice(0, 200),
  });
}

/**
 * @returns {Array<{ signal_type: string, confidence: number, text: string }>}
 */
function detectDeepTrustSignals(userText, userId = '', options = {}) {
  const silent = Boolean(options.silent);
  const safe = normalizeText(userText);
  const hits = [];
  if (!safe) return hits;

  if (/ありがと|感謝|助かる/.test(safe)) {
    pushHit(hits, SIGNAL_TYPES.GRATITUDE, 0.88, safe);
  }
  if (/ちょっと相談|相談(したい|です)|聞いて|聞いてほしい|どう思う|これでいい\??|どうかな/.test(safe)) {
    pushHit(hits, SIGNAL_TYPES.HELP_SEEKING, 0.82, safe);
  }
  if (/実は|本当は|言いにくい(けど|が)|内緒で|恥ずかしい(けど|が)/.test(safe)) {
    pushHit(hits, SIGNAL_TYPES.VULNERABILITY, 0.85, safe);
  }
  if (/できなかった|ダメだった|食べすぎ|やりすぎ|失敗|だめだった|不安|自信がない/.test(safe)) {
    pushHit(hits, SIGNAL_TYPES.SELF_DOUBT, 0.8, safe);
  }
  if (/半分|訂正|修正|補正|違った|実際は|本当はこう|言い直|直して/.test(safe)) {
    pushHit(hits, SIGNAL_TYPES.CORRECTION_WILLINGNESS, 0.78, safe);
  }
  if (/寂しい|疲れた|しんどい|つらい|泣き|落ち込|苦しい|怖い|モヤモヤ/.test(safe)) {
    pushHit(hits, SIGNAL_TYPES.EMOTIONAL_DISCLOSURE, 0.84, safe);
  }
  if (/なんで|どうして|教えて|知りたい|理由|仕組み|気になる/.test(safe) && safe.length > 6) {
    pushHit(hits, SIGNAL_TYPES.LEARNING_READINESS, 0.72, safe);
  }

  const uid = normalizeText(userId);
  if (!silent) {
    for (const h of hits) {
      console.info('[trust_signal_detected]', {
        user_id: uid,
        signal_type: h.signal_type,
        text: h.text.slice(0, 120),
        confidence: h.confidence,
      });
    }
  }

  return hits;
}

function summarizeForInterpreter(hits = []) {
  const types = [...new Set(hits.map((h) => h.signal_type))];
  const maxConf = hits.length ? Math.max(...hits.map((h) => h.confidence)) : 0;
  return {
    deep_trust_signal_types: types,
    readiness_to_reflect: types.includes(SIGNAL_TYPES.SELF_DOUBT) || types.includes(SIGNAL_TYPES.VULNERABILITY),
    readiness_to_learn: types.includes(SIGNAL_TYPES.LEARNING_READINESS),
    emotional_safety_cue: types.includes(SIGNAL_TYPES.EMOTIONAL_DISCLOSURE) || types.includes(SIGNAL_TYPES.VULNERABILITY),
    trusted_companion_cue: types.includes(SIGNAL_TYPES.GRATITUDE) || types.includes(SIGNAL_TYPES.HELP_SEEKING),
    max_confidence: maxConf,
  };
}

function countSignalsByType(hits = []) {
  const counts = {};
  for (const h of hits) {
    counts[h.signal_type] = (counts[h.signal_type] || 0) + 1;
  }
  return counts;
}

module.exports = {
  SIGNAL_TYPES,
  detectDeepTrustSignals,
  summarizeForInterpreter,
  countSignalsByType,
};
