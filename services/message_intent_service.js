'use strict';

/**
 * services/message_intent_service.js
 *
 * 目的:
 * - 相談文を食事/運動として誤判定しにくくする
 * - まず「相談・痛み・質問」を強く優先する
 * - その次に食事/運動/体重などを分類する
 */

function normalizeLoose(text) {
  return String(text || '')
    .trim()
    .toLowerCase()
    .replace(/[　\s]+/g, '')
    .replace(/[!！?？。、,.]/g, '');
}

function hasAny(text, words = []) {
  return words.some((w) => text.includes(w));
}

function countAny(text, words = []) {
  return words.reduce((acc, w) => acc + (text.includes(w) ? 1 : 0), 0);
}

const CONSULT_WORDS = [
  '痛い', '痛み', 'しびれ', '腫れ', '違和感', '不安', '心配', 'つらい', '苦しい',
  'どう思う', 'どうしたら', '大丈夫', 'だめかな', 'いいかな', '診て', '相談',
  '教えて', '気になる', '治る', '治したい', '歩けない', '走っていい', '運動していい',
  '食べてもいい', '膝', '腰', '肩', '首', '股関節', '足首', '足底腱膜炎', 'ヘルニア',
  '坐骨神経痛', '五十肩', '更年期', '血圧', '血糖', 'コレステロール', 'hba1c',
];

const QUESTION_WORDS = [
  '？', '?', 'ですか', 'ますか', 'かな', 'どう', 'なぜ', '何', 'いつ', 'どこ',
];

const EXERCISE_WORDS = [
  '歩いた', '歩きました', '散歩', 'ウォーキング', '走った', '走りました', 'ジョギング',
  'ランニング', '筋トレ', 'ストレッチ', '運動', 'トレーニング', 'スクワット',
  '腹筋', '腕立て', 'ヨガ', 'ピラティス', '自転車', 'バイク', 'プール', '泳いだ',
  '分', 'km', 'キロ', '消費', 'カロリー消費',
];

const MEAL_WORDS = [
  '食べた', '食べました', '飲んだ', '飲みました', '朝ごはん', '昼ごはん', '夜ごはん',
  '朝食', '昼食', '夕食', '間食', 'おやつ', 'ラーメン', 'ご飯', '白米', 'パン',
  'うどん', 'そば', 'パスタ', 'サラダ', '卵', '納豆', '味噌汁', 'コーヒー', 'お茶',
  'プロテイン', '定食', '弁当', '刺身', '焼き魚', '肉', '野菜', 'スープ',
];

const WEIGHT_WORDS = [
  '体重', 'kg', 'キロ', 'たいじゅう',
];

const BODY_FAT_WORDS = [
  '体脂肪', '体脂肪率', '%',
];

function looksLikeQuestion(rawText) {
  const text = String(rawText || '');
  return QUESTION_WORDS.some((w) => text.includes(w));
}

function detectMessageIntent(rawText) {
  const original = String(rawText || '').trim();
  const text = normalizeLoose(original);

  if (!text) {
    return {
      type: 'empty',
      confidence: 1,
      reasons: ['empty'],
    };
  }

  const consultScore =
    countAny(text, CONSULT_WORDS) * 2 +
    (looksLikeQuestion(original) ? 2 : 0);

  const exerciseScore = countAny(text, EXERCISE_WORDS);
  const mealScore = countAny(text, MEAL_WORDS);
  const weightScore = countAny(text, WEIGHT_WORDS);
  const bodyFatScore = countAny(text, BODY_FAT_WORDS);

  // 相談文は最優先
  if (consultScore >= 2) {
    return {
      type: 'consultation',
      confidence: Math.min(1, 0.55 + consultScore * 0.08),
      reasons: ['consult_priority'],
    };
  }

  // 体重・体脂肪
  if (weightScore >= 1 && /(\d{2,3}(\.\d+)?)/.test(text)) {
    return {
      type: 'weight_log',
      confidence: 0.9,
      reasons: ['weight_detected'],
    };
  }

  if (bodyFatScore >= 1 && /(\d{1,2}(\.\d+)?)/.test(text)) {
    return {
      type: 'body_fat_log',
      confidence: 0.9,
      reasons: ['body_fat_detected'],
    };
  }

  // 食事・運動の競合時
  if (mealScore >= 2 && exerciseScore === 0) {
    return {
      type: 'meal_log',
      confidence: 0.84,
      reasons: ['meal_words'],
    };
  }

  if (exerciseScore >= 2 && mealScore === 0) {
    return {
      type: 'exercise_log',
      confidence: 0.84,
      reasons: ['exercise_words'],
    };
  }

  if (mealScore >= 2 && exerciseScore >= 2) {
    return {
      type: 'mixed_log',
      confidence: 0.7,
      reasons: ['meal_and_exercise'],
    };
  }

  // 軽い質問は相談寄り
  if (looksLikeQuestion(original)) {
    return {
      type: 'consultation',
      confidence: 0.66,
      reasons: ['question_fallback'],
    };
  }

  // 食事寄り
  if (mealScore >= 1) {
    return {
      type: 'meal_log',
      confidence: 0.65,
      reasons: ['meal_light'],
    };
  }

  // 運動寄り
  if (exerciseScore >= 1) {
    return {
      type: 'exercise_log',
      confidence: 0.65,
      reasons: ['exercise_light'],
    };
  }

  return {
    type: 'general_chat',
    confidence: 0.5,
    reasons: ['general_fallback'],
  };
}

function shouldAvoidMealExerciseAutoCapture(rawText) {
  const intent = detectMessageIntent(rawText);
  return ['consultation', 'general_chat', 'empty'].includes(intent.type);
}

module.exports = {
  detectMessageIntent,
  shouldAvoidMealExerciseAutoCapture,
};
