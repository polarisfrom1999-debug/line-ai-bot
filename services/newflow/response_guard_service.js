'use strict';

function normalizeText(value) {
  return String(value || '').trim();
}

const BLOCK_PATTERNS = [
  /intent\s*=/i,
  /\bbbox\b/i,
  /\bconfidence\b/i,
  /\braw\s*json\b/i,
  /保存確認が未完了/,
  /運用確認用/,
  /\{[\s\S]*"intentType"[\s\S]*\}/i,
];

const SAFE_FALLBACK = '内容を整理してお伝えします。もう一度だけ同じ内容を短く送ってください。';

function containsBlockedInternalText(text) {
  const safe = normalizeText(text);
  if (!safe) return false;
  return BLOCK_PATTERNS.some((pattern) => pattern.test(safe));
}

function guardReplyText(text) {
  const safe = normalizeText(text);
  if (!safe) return { blocked: false, text: '' };
  console.info('[phasee-new] response_guard_reached', { blocked: false });
  if (!containsBlockedInternalText(safe)) {
    return { blocked: false, text: safe };
  }
  console.info('[phasee-new] response_guard_reached', { blocked: true, sample: safe.slice(0, 80) });
  return { blocked: true, text: SAFE_FALLBACK };
}

module.exports = {
  guardReplyText,
  containsBlockedInternalText,
};
