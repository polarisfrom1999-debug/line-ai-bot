'use strict';

/**
 * services/record_confirmation_service.js
 *
 * 役割:
 * - 実績として保存してよい候補か判定する
 * - 曖昧なら最小確認へ回す
 */

function normalizeText(value) {
  return String(value || '').trim();
}

function isPlanText(text) {
  return /予定|つもり|しようと思う|食べよう|控えるつもり|やるつもり|したい/.test(text);
}

function isWishText(text) {
  return /できたら|できれば|目指す|頑張れたら/.test(text);
}

function isConsultationText(text) {
  return /どうしたら|悩|困って|できない|つらい|不安|相談/.test(text);
}

function buildClarificationQuestion(candidate) {
  if (!candidate) return '今日の実績として見てよさそうですか？';
  switch (candidate.recordType) {
    case 'meal':
      return 'これは今日食べた分として見てよさそうですか？';
    case 'weight':
      return 'この体重は今朝の数値で見てよさそうですか？';
    case 'exercise':
      return 'これは実際にやった運動として見てよさそうですか？';
    case 'lab':
      return 'この検査値は今回の結果として保存してよさそうですか？';
    default:
      return 'この内容は実績として見てよさそうですか？';
  }
}

function confirmCandidate(candidate, context) {
  const rawText = normalizeText(candidate?.rawText || context?.input?.rawText);
  if (!candidate) {
    return {
      shouldPersist: false,
      needsClarification: false,
      clarificationQuestion: null,
      reason: 'no_candidate'
    };
  }

  if (!rawText) {
    return {
      shouldPersist: false,
      needsClarification: false,
      clarificationQuestion: null,
      reason: 'empty_text'
    };
  }

  if (isPlanText(rawText) || isWishText(rawText) || isConsultationText(rawText)) {
    return {
      shouldPersist: false,
      needsClarification: false,
      clarificationQuestion: null,
      reason: 'not_actual_record'
    };
  }

  if (candidate.needsConfirmation || /昨日|たぶん|くらい|半分|少し|軽め/.test(rawText)) {
    return {
      shouldPersist: false,
      needsClarification: true,
      clarificationQuestion: buildClarificationQuestion(candidate),
      reason: 'needs_clarification'
    };
  }

  return {
    shouldPersist: true,
    needsClarification: false,
    clarificationQuestion: null,
    reason: 'confirmed'
  };
}

module.exports = {
  confirmCandidate,
  buildClarificationQuestion
};
