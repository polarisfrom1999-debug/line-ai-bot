services/record_confirmation_service.js
'use strict';

function normalizeText(value) {
  return String(value || '').trim();
}

function isEmptyObject(value) {
  return !value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).length === 0;
}

function shouldSkipByText(summary) {
  const safe = normalizeText(summary);

  if (!safe) return true;
  if (/予定|つもり|しようと思う|やる予定|食べる予定/.test(safe)) return true;
  if (/どうしたら|教えて|相談/.test(safe)) return true;

  return false;
}

async function confirmCandidate(candidate) {
  if (!candidate || !candidate.type) {
    return {
      shouldPersist: false,
      reason: 'invalid_candidate'
    };
  }

  if (candidate.type === 'meal') {
    const summary = normalizeText(candidate.summary || candidate.name || '');
    const nutrition = candidate.estimatedNutrition || {};

    if (shouldSkipByText(summary)) {
      return {
        shouldPersist: false,
        reason: 'future_or_consultation'
      };
    }

    if (!summary && isEmptyObject(nutrition)) {
      return {
        shouldPersist: false,
        reason: 'empty_meal'
      };
    }

    return {
      shouldPersist: true,
      needsClarification: false,
      clarificationQuestion: null
    };
  }

  if (candidate.type === 'exercise') {
    const summary = normalizeText(candidate.summary || candidate.name || '');
    if (shouldSkipByText(summary)) {
      return {
        shouldPersist: false,
        reason: 'future_or_consultation'
      };
    }

    return {
      shouldPersist: Boolean(summary),
      needsClarification: false,
      clarificationQuestion: null
    };
  }

  if (candidate.type === 'weight') {
    const summary = normalizeText(candidate.summary || '');
    return {
      shouldPersist: Boolean(summary),
      needsClarification: false,
      clarificationQuestion: null
    };
  }

  if (candidate.type === 'lab') {
    const items = Array.isArray(candidate.items) ? candidate.items : [];
    return {
      shouldPersist: items.length > 0 || Boolean(normalizeText(candidate.summary || '')),
      needsClarification: false,
      clarificationQuestion: null
    };
  }

  return {
    shouldPersist: false,
    reason: 'unsupported_type'
  };
}

module.exports = {
  confirmCandidate
};
