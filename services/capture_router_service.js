'use strict';

/**
 * services/capture_router_service.js
 *
 * 役割:
 * - 記録系入力の候補化交通整理
 * - 会話の上位判定は奪わず、保存候補を後段に渡しやすい形へ整える
 * - 予定/願望/相談を実績にしない
 */

function normalizeText(value) {
  return String(value || '').trim();
}

function detectCaptureType(text, shortMemory) {
  if (/LDL|HDL|中性脂肪|AST|ALT|血液検査|HbA1c/i.test(text)) return 'lab_record';
  if (/\b\d{2,3}(\.\d)?\s?kg\b|体重|体脂肪/.test(text)) return 'weight_record';
  if (/歩い|ジョギング|走っ|筋トレ|ストレッチ|運動/.test(text)) return 'exercise_record';
  if (/食べた|朝ごはん|昼ごはん|夜ごはん|朝食|昼食|夕食|ごはん|鍋|パン|卵|サラダ/.test(text)) return 'meal_record';

  const lastImageType = shortMemory?.lastImageType;
  if (/半分|昨日の|今日の|朝の|昼の|夜の|LDLは|何kcal|グラフ/.test(text) && lastImageType) {
    if (lastImageType === 'lab') return 'lab_record';
    if (lastImageType === 'meal') return 'meal_record';
  }

  return 'none';
}

function isPlanOrWishText(text) {
  return /予定|つもり|しようと思う|食べよう|控えるつもり|やるつもり/.test(text);
}

function isConsultationLike(text) {
  return /どうしたら|悩|困って|できない|つらい|不安/.test(text);
}

function buildCandidatePayload(captureType, text, context) {
  const base = {
    source: context?.input?.messageType === 'image' ? 'image_followup' : 'text',
    rawText: text,
    eventDate: new Date(context?.input?.timestamp || Date.now()).toISOString().slice(0, 10)
  };

  switch (captureType) {
    case 'meal_record':
      return Object.assign({}, base, {
        recordType: 'meal',
        mealType: /朝/.test(text) ? 'breakfast' : /昼/.test(text) ? 'lunch' : /夜|夕/.test(text) ? 'dinner' : 'unknown',
        amountNote: /半分|少し|軽め/.test(text) ? (text.match(/半分|少し|軽め/) || [null])[0] : null,
        itemsText: text
      });
    case 'weight_record':
      return Object.assign({}, base, {
        recordType: 'weight',
        valueText: text
      });
    case 'exercise_record':
      return Object.assign({}, base, {
        recordType: 'exercise',
        durationText: text,
        valueText: text
      });
    case 'lab_record':
      return Object.assign({}, base, {
        recordType: 'lab',
        valueText: text
      });
    case 'profile_update':
      return Object.assign({}, base, {
        recordType: 'profile',
        valueText: text
      });
    default:
      return null;
  }
}

function inferConfidence(captureType, text, context) {
  let score = 0;

  if (captureType === 'none') return 0;
  if (context?.input?.messageType === 'image') score += 0.15;
  if (/今日|今朝|食べた|歩いた|した|kg|LDL|HDL|中性脂肪/.test(text)) score += 0.55;
  if (/半分|少し|軽め|昨日/.test(text)) score -= 0.1;
  if (isPlanOrWishText(text)) score -= 0.5;
  if (isConsultationLike(text)) score -= 0.2;

  const byType = {
    meal_record: 0.45,
    weight_record: 0.55,
    exercise_record: 0.5,
    lab_record: 0.6,
    profile_update: 0.4
  };

  return Math.max(0, Math.min(0.99, score + (byType[captureType] || 0)));
}

function needsConfirmation(captureType, text) {
  if (captureType === 'none') return false;
  if (/昨日|たぶん|くらい|半分|少し|軽め/.test(text)) return true;
  if (captureType === 'meal_record' && !/朝|昼|夜|食べた/.test(text)) return true;
  return false;
}

async function routeCapture(context) {
  const text = normalizeText(context?.input?.rawText);
  const shortMemory = context?.shortMemory || {};

  if (!text && context?.input?.messageType !== 'image') {
    return {
      captureType: 'none',
      confidence: 0,
      needsConfirmation: false,
      candidatePayload: null
    };
  }

  if (isPlanOrWishText(text) || isConsultationLike(text)) {
    return {
      captureType: 'none',
      confidence: 0.1,
      needsConfirmation: false,
      candidatePayload: null
    };
  }

  const captureType = detectCaptureType(text, shortMemory);
  const confidence = inferConfidence(captureType, text, context);

  if (captureType === 'none' || confidence < 0.35) {
    return {
      captureType: 'none',
      confidence,
      needsConfirmation: false,
      candidatePayload: null
    };
  }

  return {
    captureType,
    confidence,
    needsConfirmation: needsConfirmation(captureType, text),
    candidatePayload: buildCandidatePayload(captureType, text, context)
  };
}

module.exports = {
  routeCapture,
  detectCaptureType,
  buildCandidatePayload,
  inferConfidence
};
