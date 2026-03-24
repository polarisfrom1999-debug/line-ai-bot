'use strict';

function safeText(value, fallback = '') {
  return String(value || fallback).trim();
}

function normalizeLoose(text) {
  return safeText(text)
    .toLowerCase()
    .replace(/[！!？?。.,，、]/g, '')
    .replace(/\s+/g, '');
}

function hasQuestionIntent(text) {
  const raw = safeText(text);
  const t = normalizeLoose(text);
  if (!t) return false;
  if (/[？?]/.test(raw)) return true;

  const patterns = [
    'かな',
    'ですか',
    'ますか',
    'いいですか',
    '大丈夫ですか',
    'だめですか',
    'ダメですか',
    'してもいい',
    'して平気',
    '問題ない',
    'どうかな',
    'どうですか',
    '良いですか',
    '悪いですか',
    'いいかな',
    '平気かな',
    'だめかな',
    'ダメかな',
    'どうしたら',
    'どうすれば',
    'どう思う',
    '教えて',
  ];

  return patterns.some((p) => t.includes(normalizeLoose(p)));
}

function hasPainOrMedicalContext(text) {
  const t = normalizeLoose(text);
  if (!t) return false;

  const patterns = [
    '痛い',
    '痛み',
    'しびれ',
    '腫れ',
    '炎症',
    '違和感',
    'だるい',
    '重い',
    'つらい',
    '辛い',
    '足底腱膜炎',
    '膝',
    '腰',
    '股関節',
    '肩',
    '首',
    'かかと',
    '足裏',
    'ふくらはぎ',
    '整形外科',
    '病院',
    '治療',
    '症状',
  ];

  return patterns.some((p) => t.includes(normalizeLoose(p)));
}

function isMealDesireOrFeelingText(text) {
  const t = normalizeLoose(text);
  if (!t) return false;

  const patterns = [
    '食べたい',
    '飲みたい',
    'お腹いっぱい食べたい',
    'おなかいっぱい食べたい',
    'お腹一杯食べたい',
    'おなか一杯食べたい',
    'いっぱい食べたい',
    '甘いもの食べたい',
    '何か食べたい',
    '食欲がある',
    '食欲がない',
    '食欲あります',
    '食欲ない',
    'お腹すいた',
    'おなかすいた',
    '食べたくなる',
    '食べてしまいそう',
    '食べそう',
    '飲みたくなる',
    '食欲が止まらない',
    '食欲がすごい',
    '食べすぎそう',
    '食べ過ぎそう',
    '食べすぎたくなる',
    '甘いものが止まらない',
    'お腹いっぱい食べれる',
    'おなかいっぱい食べれる',
  ];

  if (patterns.some((p) => t.includes(p))) return true;
  if ((t.includes('食べ') || t.includes('飲み')) && t.includes('たい')) return true;

  return false;
}

function isExerciseConsultationText(text) {
  const t = normalizeLoose(text);
  if (!t) return false;

  const hasExerciseWord = [
    '走る',
    'ジョギング',
    'ランニング',
    '歩く',
    '運動',
    '筋トレ',
    'ストレッチ',
    'スクワット',
    '散歩',
    'トレーニング',
  ].some((w) => t.includes(normalizeLoose(w)));

  if (!hasExerciseWord) return false;
  return hasQuestionIntent(text) || hasPainOrMedicalContext(text);
}

function isExplicitMealLogText(text) {
  const t = normalizeLoose(text);
  if (!t) return false;
  if (isMealDesireOrFeelingText(text)) return false;
  if (hasQuestionIntent(text)) return false;

  const directPatterns = [
    '食べた',
    '飲んだ',
    '食べました',
    '飲みました',
    '食べたよ',
    '飲んだよ',
    '朝食',
    '昼食',
    '夕食',
    '朝ごはん',
    '昼ごはん',
    '夜ごはん',
    '晩ごはん',
    '朝飯',
    '昼飯',
    '夜飯',
    '今朝',
    'さっき',
  ];

  if (directPatterns.some((p) => t.includes(p))) return true;

  const hasMealVerb = /食べた|飲んだ|食べました|飲みました/.test(t);
  const hasFoodLikeWord = /ラーメン|ご飯|ごはん|パン|おにぎり|うどん|そば|パスタ|カレー|寿司|すし|肉|魚|卵|サラダ|スープ|味噌汁|みそ汁|コーヒー|お茶|ジュース|ビール|お酒|ケーキ|チョコ|アイス|青汁|食パン|ピーナッツバター/.test(t);

  return hasMealVerb || hasFoodLikeWord;
}

function isExerciseLogText(text) {
  const t = normalizeLoose(text);
  if (!t) return false;
  if (isExerciseConsultationText(text)) return false;

  const patterns = [
    '歩いた',
    '走った',
    'ジョギング',
    'ランニング',
    'ウォーキング',
    '散歩',
    '筋トレ',
    'ストレッチ',
    'スクワット',
    '運動した',
    'トレーニングした',
    '分',
    '歩数',
    '消費',
  ];

  return patterns.some((p) => t.includes(normalizeLoose(p)));
}

function detectMessageIntent(text) {
  const raw = safeText(text);
  const t = normalizeLoose(text);

  if (!t) {
    return {
      type: 'general_chat',
      score: 0,
      reasons: ['empty'],
    };
  }

  if (isMealDesireOrFeelingText(raw)) {
    return {
      type: 'feeling_or_desire',
      score: 1,
      reasons: ['meal_desire_or_feeling'],
    };
  }

  if (isExerciseConsultationText(raw)) {
    return {
      type: 'consultation',
      score: 1,
      reasons: ['exercise_consultation'],
    };
  }

  if (hasPainOrMedicalContext(raw) && hasQuestionIntent(raw)) {
    return {
      type: 'consultation',
      score: 1,
      reasons: ['pain_or_medical_question'],
    };
  }

  if (hasPainOrMedicalContext(raw)) {
    return {
      type: 'consultation',
      score: 0.9,
      reasons: ['pain_or_medical_context'],
    };
  }

  if (isExplicitMealLogText(raw)) {
    return {
      type: 'meal_log',
      score: 0.95,
      reasons: ['explicit_meal_log'],
    };
  }

  if (isExerciseLogText(raw)) {
    return {
      type: 'exercise_log',
      score: 0.9,
      reasons: ['exercise_log_like'],
    };
  }

  return {
    type: 'general_chat',
    score: 0.5,
    reasons: ['default_general_chat'],
  };
}

function shouldAvoidMealExerciseAutoCapture(text) {
  const intent = detectMessageIntent(text);
  return intent.type === 'consultation' || intent.type === 'feeling_or_desire';
}

module.exports = {
  detectMessageIntent,
  shouldAvoidMealExerciseAutoCapture,
};
