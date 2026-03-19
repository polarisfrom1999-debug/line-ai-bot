'use strict';

/**
 * services/capture_router_service.js
 *
 * 役割:
 * - ユーザー発話をざっくり分類する
 * - 初期設定開始ワードか判定する
 * - 記録候補か判定する
 * - 相談優先か判定する
 * - 不足項目を洗い出す
 * - 次に聞く自然な質問文を作る
 */

const ONBOARDING_KEYWORDS = [
  'プロフィール登録',
  'プロフィール入力',
  '初期設定',
  '無料診断',
  'はじめる',
  '登録したい',
  '診断したい',
];

const CONSULTATION_HINTS = [
  '痛い',
  '痛み',
  '大丈夫',
  'どう思う',
  'ダメかな',
  '不安',
  '相談',
  'つらい',
  'しんどい',
  '違和感',
  '平気',
  'いいですか',
  'していい',
  'やっていい',
  '走っていい',
  '歩いていい',
];

function safeText(value, fallback = '') {
  return String(value || fallback).trim();
}

function normalizeLoose(text) {
  return safeText(text)
    .toLowerCase()
    .replace(/[！!？?。.,，、]/g, '')
    .replace(/\s+/g, '');
}

function includesAny(text, words = []) {
  return words.some((w) => text.includes(w));
}

function extractMinutes(text) {
  const t = safeText(text);

  let m = t.match(/(\d+(?:\.\d+)?)\s*分/);
  if (m) return Number(m[1]);

  m = t.match(/(\d+(?:\.\d+)?)\s*時間/);
  if (m) return Math.round(Number(m[1]) * 60);

  m = t.match(/(\d+)\s*時間\s*(\d+)\s*分/);
  if (m) return Number(m[1]) * 60 + Number(m[2]);

  return null;
}

function extractDistanceKm(text) {
  const t = safeText(text);

  let m = t.match(/(\d+(?:\.\d+)?)\s*km/i);
  if (m) return Number(m[1]);

  m = t.match(/(\d+(?:\.\d+)?)\s*キロ/);
  if (m) return Number(m[1]);

  return null;
}

function extractWeightKg(text) {
  const t = safeText(text);
  const m = t.match(/(\d+(?:\.\d+)?)\s*kg/i);
  if (!m) return null;
  return Number(m[1]);
}

function extractBodyFatPercent(text) {
  const t = safeText(text);
  const m = t.match(/(\d+(?:\.\d+)?)\s*%/);
  if (!m) return null;
  return Number(m[1]);
}

function isOnboardingStart(text) {
  const normalized = normalizeLoose(text);
  return ONBOARDING_KEYWORDS.some((keyword) => normalized.includes(normalizeLoose(keyword)));
}

function detectExerciseType(text) {
  const normalized = normalizeLoose(text);

  if (
    normalized.includes('ジョギング') ||
    normalized.includes('ランニング') ||
    normalized.includes('走った') ||
    normalized.includes('走れた')
  ) {
    return 'jogging';
  }

  if (
    normalized.includes('ウォーキング') ||
    normalized.includes('歩いた') ||
    normalized.includes('歩けた') ||
    normalized.includes('散歩')
  ) {
    return 'walking';
  }

  if (
    normalized.includes('筋トレ') ||
    normalized.includes('トレーニング') ||
    normalized.includes('スクワット') ||
    normalized.includes('腕立て')
  ) {
    return 'strength_training';
  }

  return null;
}

function detectMealCandidate(text) {
  const normalized = normalizeLoose(text);

  return (
    normalized.includes('食べた') ||
    normalized.includes('飲んだ') ||
    normalized.includes('朝ごはん') ||
    normalized.includes('昼ごはん') ||
    normalized.includes('夜ごはん') ||
    normalized.includes('夕飯') ||
    normalized.includes('昼食') ||
    normalized.includes('朝食') ||
    normalized.includes('夕食') ||
    normalized.includes('ラーメン') ||
    normalized.includes('チャーハン') ||
    normalized.includes('ご飯') ||
    normalized.includes('お腹いっぱい') ||
    normalized.includes('軽め')
  );
}

function detectWeightCandidate(text) {
  const normalized = normalizeLoose(text);
  return normalized.includes('体重') || /(\d+(?:\.\d+)?)\s*kg/i.test(text);
}

function detectBodyFatCandidate(text) {
  const normalized = normalizeLoose(text);
  return normalized.includes('体脂肪') || normalized.includes('体脂肪率');
}

function detectConsultation(text) {
  const normalized = normalizeLoose(text);
  return includesAny(normalized, CONSULTATION_HINTS.map(normalizeLoose));
}

function buildExercisePayload(text) {
  return {
    activity: detectExerciseType(text),
    duration_min: extractMinutes(text),
    distance_km: extractDistanceKm(text),
    source_text: safeText(text),
  };
}

function buildWeightPayload(text) {
  return {
    weight_kg: extractWeightKg(text),
    source_text: safeText(text),
  };
}

function buildBodyFatPayload(text) {
  return {
    body_fat_percent: extractBodyFatPercent(text),
    source_text: safeText(text),
  };
}

function buildMealPayload(text) {
  return {
    raw_text: safeText(text),
    meal_label: null,
    food_items: [],
    source_text: safeText(text),
  };
}

function getMissingFieldsForExercise(payload = {}) {
  const missing = [];

  if (!payload.activity) {
    missing.push('activity');
  }

  if (!payload.duration_min) {
    missing.push('duration_min');
  }

  return missing;
}

function getMissingFieldsForMeal(payload = {}) {
  const missing = [];
  const rawText = safeText(payload.raw_text);

  const vagueOnly =
    rawText &&
    (
      rawText.includes('お腹いっぱい') ||
      rawText.includes('軽め') ||
      rawText.includes('少しだけ') ||
      rawText.includes('たくさん食べた')
    );

  if (vagueOnly) {
    missing.push('food_items');
  }

  return missing;
}

function getMissingFieldsForWeight(payload = {}) {
  const missing = [];
  if (payload.weight_kg == null) missing.push('weight_kg');
  return missing;
}

function getMissingFieldsForBodyFat(payload = {}) {
  const missing = [];
  if (payload.body_fat_percent == null) missing.push('body_fat_percent');
  return missing;
}

function buildExerciseClarifyReply(payload = {}, missingFields = []) {
  if (missingFields.includes('activity')) {
    return '運動の記録として残せるように、どんな運動だったか教えてください。たとえばジョギング、ウォーキング、筋トレなどで大丈夫です。';
  }

  if (payload.activity === 'jogging') {
    return 'いいですね。記録を整えるために、何分くらい走ったか教えてください。ざっくりで大丈夫です。';
  }

  if (payload.activity === 'walking') {
    return 'いいですね。記録に残すなら、何分くらい歩けたか教えてください。ざっくりで大丈夫です。';
  }

  if (payload.activity === 'strength_training') {
    return 'いいですね。記録を整えるために、何分くらいやったか教えてください。ざっくりで大丈夫です。';
  }

  return '記録を整えるために、何分くらいだったか教えてください。ざっくりで大丈夫です。';
}

function buildMealClarifyReply() {
  return '食事記録として残せるように、何を食べたか1〜2品だけ教えてください。ざっくりで大丈夫です。';
}

function buildWeightClarifyReply() {
  return '体重記録として残せるように、何kgだったか教えてください。';
}

function buildBodyFatClarifyReply() {
  return '体脂肪率の記録として残せるように、何％だったか教えてください。';
}

function analyzeNewCaptureCandidate(text) {
  const rawText = safeText(text);
  const normalized = normalizeLoose(rawText);

  if (!rawText) {
    return {
      route: 'ignore',
      captureType: null,
      payload: null,
      missingFields: [],
      replyText: '',
      isConsultationPriority: false,
    };
  }

  if (isOnboardingStart(rawText)) {
    return {
      route: 'onboarding_start',
      captureType: 'onboarding',
      payload: { source_text: rawText },
      missingFields: [],
      replyText: '',
      isConsultationPriority: false,
    };
  }

  const hasConsultation = detectConsultation(rawText);
  const exerciseType = detectExerciseType(rawText);
  const isMeal = detectMealCandidate(rawText);
  const isWeight = detectWeightCandidate(rawText);
  const isBodyFat = detectBodyFatCandidate(rawText);

  if (exerciseType) {
    const payload = buildExercisePayload(rawText);
    const missingFields = getMissingFieldsForExercise(payload);

    if (hasConsultation) {
      return {
        route: 'consultation_chat',
        captureType: 'exercise',
        payload,
        missingFields,
        replyText: '',
        isConsultationPriority: true,
      };
    }

    if (missingFields.length > 0) {
      return {
        route: 'pending_clarification',
        captureType: 'exercise',
        payload,
        missingFields,
        replyText: buildExerciseClarifyReply(payload, missingFields),
        isConsultationPriority: false,
      };
    }

    return {
      route: 'save_exercise',
      captureType: 'exercise',
      payload,
      missingFields: [],
      replyText: '',
      isConsultationPriority: false,
    };
  }

  if (isBodyFat) {
    const payload = buildBodyFatPayload(rawText);
    const missingFields = getMissingFieldsForBodyFat(payload);

    if (missingFields.length > 0) {
      return {
        route: 'pending_clarification',
        captureType: 'body_fat',
        payload,
        missingFields,
        replyText: buildBodyFatClarifyReply(),
        isConsultationPriority: false,
      };
    }

    return {
      route: 'save_body_fat',
      captureType: 'body_fat',
      payload,
      missingFields: [],
      replyText: '',
      isConsultationPriority: false,
    };
  }

  if (isWeight && !normalized.includes('体脂肪')) {
    const payload = buildWeightPayload(rawText);
    const missingFields = getMissingFieldsForWeight(payload);

    if (missingFields.length > 0) {
      return {
        route: 'pending_clarification',
        captureType: 'weight',
        payload,
        missingFields,
        replyText: buildWeightClarifyReply(),
        isConsultationPriority: false,
      };
    }

    return {
      route: 'save_weight',
      captureType: 'weight',
      payload,
      missingFields: [],
      replyText: '',
      isConsultationPriority: false,
    };
  }

  if (isMeal) {
    const payload = buildMealPayload(rawText);
    const missingFields = getMissingFieldsForMeal(payload);

    if (hasConsultation) {
      return {
        route: 'consultation_chat',
        captureType: 'meal',
        payload,
        missingFields,
        replyText: '',
        isConsultationPriority: true,
      };
    }

    if (missingFields.length > 0) {
      return {
        route: 'pending_clarification',
        captureType: 'meal',
        payload,
        missingFields,
        replyText: buildMealClarifyReply(),
        isConsultationPriority: false,
      };
    }

    return {
      route: 'save_meal',
      captureType: 'meal',
      payload,
      missingFields: [],
      replyText: '',
      isConsultationPriority: false,
    };
  }

  if (hasConsultation) {
    return {
      route: 'consultation_chat',
      captureType: null,
      payload: { source_text: rawText },
      missingFields: [],
      replyText: '',
      isConsultationPriority: true,
    };
  }

  return {
    route: 'general_chat',
    captureType: null,
    payload: { source_text: rawText },
    missingFields: [],
    replyText: '',
    isConsultationPriority: false,
  };
}

module.exports = {
  safeText,
  normalizeLoose,
  extractMinutes,
  extractDistanceKm,
  extractWeightKg,
  extractBodyFatPercent,
  isOnboardingStart,
  analyzeNewCaptureCandidate,
};
