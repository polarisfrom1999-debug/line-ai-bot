'use strict';

function normalizeText(text = '') {
  return String(text || '')
    .trim()
    .toLowerCase()
    .replace(/[　\s]+/g, '')
    .replace(/[!！?？。、,.]/g, '');
}

function hasAny(text = '', patterns = []) {
  const t = normalizeText(text);
  return patterns.some((pattern) => t.includes(normalizeText(pattern)));
}

function parseNumber(text = '') {
  const match = String(text || '').match(/(-?\d+(?:\.\d+)?)/);
  if (!match) return null;
  const value = Number(match[1]);
  return Number.isFinite(value) ? value : null;
}

function isProcedureIntent(text = '') {
  return hasAny(text, [
    'プラン教えて', '料金教えて', '料金', 'プラン', '無料体験', '体験', '入会', '会員', '契約',
    '継続', '停止', '再開', '現在のプラン', '今のプラン', '使い方', 'ヘルプ', 'メニュー'
  ]);
}

function isGraphIntent(text = '') {
  return hasAny(text, [
    'グラフ', '体重グラフ', '食事活動グラフ', '食事グラフ', '活動グラフ', '運動グラフ',
    'hba1cグラフ', 'hb a1cグラフ', 'ldlグラフ', '血液検査グラフ', '体重推移'
  ]);
}

function isConsultationIntent(text = '') {
  return hasAny(text, [
    '痛い', '痛み', 'つらい', 'しんどい', '不安', '心配', '相談', '悩み', '困って', 'どうしたら',
    'どうすれば', 'かな', 'ですか', 'ますか', '大丈夫', '平気', 'だめ', 'ダメ', '歩いてよい', '歩いていい',
    '教えて', 'やり方', '方法', 'あるの', 'ある？', '取れる', '治る', 'ほぐし方'
  ]);
}

function isWeightOnly(text = '') {
  const t = normalizeText(text);
  if (!t) return false;

  if (/^\d{2,3}(?:\.\d)?(?:kg|キロ|きろ)?$/.test(t)) return true;
  if (t.includes('体重')) return true;

  return false;
}

function isBodyFatOnly(text = '') {
  const t = normalizeText(text);
  if (!t) return false;

  if (t.includes('体脂肪')) return true;
  if (/^\d{1,2}(?:\.\d)?(?:%|％)$/.test(t)) return true;

  return false;
}

function isExerciseRecord(text = '') {
  return hasAny(text, [
    '歩いた', 'ウォーキング', '散歩', '走った', 'ジョギング', 'ランニング', '筋トレ', 'ストレッチ', '運動した'
  ]) && !isConsultationIntent(text) && !hasAny(text, ['教えて', 'やり方', '方法']);
}

function isMealRecord(text = '') {
  return hasAny(text, [
    '食べた', '食事', '朝ごはん', '昼ごはん', '夜ごはん', '朝食', '昼食', '夕食', 'おやつ', '飲んだ'
  ]) && !hasAny(text, [
    '食べたい', 'お腹いっぱい食べたい', '食欲', 'カロリーいくつ', 'カロリー教えて'
  ]);
}

function buildWeightCandidate(text = '') {
  const value = parseNumber(text);
  if (!Number.isFinite(value)) return null;

  return {
    type: 'weight',
    parsed_payload: { weight_kg: value },
    confidence: 0.96,
    source_text: text,
  };
}

function buildBodyFatCandidate(text = '') {
  const value = parseNumber(text);
  if (!Number.isFinite(value)) return null;

  return {
    type: 'body_fat',
    parsed_payload: { body_fat_percent: value },
    confidence: 0.95,
    source_text: text,
  };
}

function buildExerciseCandidate(text = '') {
  return {
    type: 'exercise',
    parsed_payload: { raw_text: String(text || '').trim() },
    confidence: 0.8,
    source_text: text,
  };
}

function buildMealCandidate(text = '') {
  return {
    type: 'meal',
    parsed_payload: { raw_text: String(text || '').trim() },
    confidence: 0.78,
    source_text: text,
  };
}

async function routeConversation({ currentUserText = '' } = {}) {
  const text = String(currentUserText || '').trim();
  const normalized = normalizeText(text);

  if (!normalized) {
    return {
      route: 'smalltalk',
      is_ambiguous: true,
      needs_clarification: true,
      reply_text: 'ありがとうございます。続けて教えてくださいね。',
      meta: { topic_hints: {} },
    };
  }

  if (isGraphIntent(text)) {
    return {
      route: 'graph',
      is_ambiguous: false,
      needs_clarification: false,
      meta: { topic_hints: { graph: true } },
    };
  }

  if (isProcedureIntent(text)) {
    return {
      route: 'procedure',
      is_ambiguous: false,
      needs_clarification: false,
      meta: { topic_hints: { procedure: true } },
    };
  }

  if (isWeightOnly(text)) {
    return {
      route: 'record_candidate',
      is_ambiguous: false,
      needs_clarification: false,
      top_record_candidate: buildWeightCandidate(text),
      meta: { topic_hints: { body_metrics: true, weight: true } },
    };
  }

  if (isBodyFatOnly(text)) {
    return {
      route: 'record_candidate',
      is_ambiguous: false,
      needs_clarification: false,
      top_record_candidate: buildBodyFatCandidate(text),
      meta: { topic_hints: { body_metrics: true, body_fat: true } },
    };
  }

  if (isConsultationIntent(text)) {
    return {
      route: 'consultation',
      is_ambiguous: false,
      needs_clarification: false,
      meta: { topic_hints: { consultation: true } },
    };
  }

  if (isExerciseRecord(text)) {
    return {
      route: 'record_candidate',
      is_ambiguous: false,
      needs_clarification: false,
      top_record_candidate: buildExerciseCandidate(text),
      meta: { topic_hints: { exercise: true } },
    };
  }

  if (isMealRecord(text)) {
    return {
      route: 'record_candidate',
      is_ambiguous: false,
      needs_clarification: false,
      top_record_candidate: buildMealCandidate(text),
      meta: { topic_hints: { meal: true } },
    };
  }

  return {
    route: 'smalltalk',
    is_ambiguous: false,
    needs_clarification: false,
    meta: { topic_hints: { smalltalk: true } },
  };
}

module.exports = {
  routeConversation,
};
