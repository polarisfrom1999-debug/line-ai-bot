
'use strict';

/**
 * services/capture_router_service.js
 */

function normalizeText(value) {
  return String(value || '').trim();
}

function isFuturePlanText(text) {
  const safeText = normalizeText(text);
  return /(予定|つもり|しようと思|食べる予定|やる予定)/.test(safeText);
}

function detectCaptureTypeFromText(text) {
  const safeText = normalizeText(text);

  if (!safeText) return 'none';
  if (/体脂肪|kg|キロ|体重/.test(safeText)) return 'weight_record';
  if (/歩いた|ジョギング|ランニング|筋トレ|運動|kcal/.test(safeText)) return 'exercise_record';
  if (/LDL|HDL|中性脂肪|HbA1c|AST|ALT|血液検査|採血/.test(safeText)) return 'lab_record';
  if (/朝ごはん|昼ごはん|夜ごはん|朝食|昼食|夕食|食べた|飲んだ|ラーメン|カレー|卵|味噌汁|ごはん|パン/.test(safeText)) return 'meal_record';

  return 'none';
}

function buildCandidatePayload(context, captureType) {
  const text = normalizeText(context?.input?.rawText);

  return {
    recordType: captureType,
    source: context?.input?.messageType === 'image' ? 'image' : 'text',
    rawText: text,
    eventDate: new Date(context?.input?.timestamp || Date.now()).toISOString().slice(0, 10)
  };
}

async function routeCapture(context) {
  const input = context?.input || {};
  const text = normalizeText(input.rawText);
  const imageAnalysis = context?.imageAnalysis || {};
  const shortMemory = context?.shortMemory || {};

  if (input.messageType === 'image') {
    if (imageAnalysis?.meal?.isMealImage) {
      return {
        captureType: 'meal_record',
        confidence: Number(imageAnalysis.meal.confidence || 0.8),
        needsConfirmation: false,
        candidatePayload: {
          recordType: 'meal_record',
          source: 'image',
          eventDate: new Date(input.timestamp || Date.now()).toISOString().slice(0, 10),
          mealType: imageAnalysis.meal.mealType || 'unknown',
          items: imageAnalysis.meal.items || [],
          estimatedNutrition: imageAnalysis.meal.estimatedNutrition || {}
        }
      };
    }

    if (imageAnalysis?.lab?.isLabImage) {
      return {
        captureType: 'lab_record',
        confidence: Number(imageAnalysis.lab.confidence || 0.8),
        needsConfirmation: false,
        candidatePayload: {
          recordType: 'lab_record',
          source: 'image',
          eventDate: imageAnalysis.lab.examDate || new Date(input.timestamp || Date.now()).toISOString().slice(0, 10),
          items: imageAnalysis.lab.items || []
        }
      };
    }
  }

  if (isFuturePlanText(text)) {
    return {
      captureType: 'none',
      confidence: 0.1,
      needsConfirmation: false,
      candidatePayload: null
    };
  }

  if (context?.routerHints?.looksLikeShortFollowUp && shortMemory?.pendingRecordCandidate) {
    return {
      captureType: shortMemory.pendingRecordCandidate.recordType || 'none',
      confidence: 0.7,
      needsConfirmation: false,
      candidatePayload: {
        ...shortMemory.pendingRecordCandidate,
        followUpText: text
      }
    };
  }

  const captureType = detectCaptureTypeFromText(text);
  if (captureType === 'none') {
    return {
      captureType,
      confidence: 0.15,
      needsConfirmation: false,
      candidatePayload: null
    };
  }

  return {
    captureType,
    confidence: 0.75,
    needsConfirmation: false,
    candidatePayload: buildCandidatePayload(context, captureType)
  };
}

module.exports = {
  routeCapture
};
