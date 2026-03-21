'use strict';

const { generateTextOnly } = require('./gemini_service');

function safeText(value, max = 1000) {
  return String(value || '').trim().slice(0, max);
}

function normalizeJsonText(rawText) {
  const text = String(rawText || '').trim();
  if (!text) return '';
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  return fenced ? fenced[1].trim() : text;
}

function safeParseJson(rawText, fallback = null) {
  try {
    return JSON.parse(normalizeJsonText(rawText));
  } catch (_error) {
    return fallback;
  }
}

function toNumberOrNull(value) {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(String(value).replace(/[^\d.-]/g, ''));
  return Number.isFinite(n) ? n : null;
}

function clampOrNull(value, min, max) {
  const n = toNumberOrNull(value);
  if (!Number.isFinite(n)) return null;
  if (n < min || n > max) return null;
  return n;
}

function normalizeMemoryCandidates(items) {
  if (!Array.isArray(items)) return [];
  return items
    .map((item) => ({
      memory_type: safeText(item?.memory_type || '', 80),
      content: safeText(item?.content || '', 200),
    }))
    .filter((item) => item.memory_type && item.content)
    .slice(0, 5);
}

function normalizeMealItems(items) {
  if (!Array.isArray(items)) return [];
  return items
    .map((item) => ({
      name: safeText(item?.name || item?.item || '', 80),
      amount_text: safeText(item?.amount_text || item?.amount || '', 80),
    }))
    .filter((item) => item.name)
    .slice(0, 10);
}

function normalizeExerciseItems(items) {
  if (!Array.isArray(items)) return [];
  return items
    .map((item) => ({
      name: safeText(item?.name || item?.exercise || '', 80),
      duration_minutes: clampOrNull(item?.duration_minutes, 0, 1440),
      count: clampOrNull(item?.count, 0, 100000),
      distance_km: clampOrNull(item?.distance_km, 0, 1000),
      amount_text: safeText(item?.amount_text || '', 80),
    }))
    .filter((item) => item.name)
    .slice(0, 10);
}

function buildEmptyResult(sourceText = '') {
  return {
    intent: 'unknown',
    category: 'unknown',
    capture_type: null,
    action: 'pass_through',
    auto_save: false,
    needs_confirmation: false,
    reply_text: '',
    payload: {},
    memory_candidates: [],
    follow_up_question: null,
    source_text: safeText(sourceText, 1000),
  };
}

function buildFallbackBodyMetrics(text) {
  const raw = safeText(text, 300);
  if (!raw) return buildEmptyResult(text);

  const normalized = raw
    .replace(/[　]/g, ' ')
    .replace(/％/g, '%')
    .replace(/ｋｇ/gi, 'kg');

  let weightKg = null;
  let bodyFatPercent = null;

  const weightPatterns = [
    /(?:体重|今朝の体重|今日の体重|本日の体重)\s*[:：]?\s*(-?\d+(?:\.\d+)?)(?:\s*(?:kg|キロ))?/i,
    /(-?\d+(?:\.\d+)?)\s*(?:kg|キロ)/i,
  ];

  const bodyFatPatterns = [
    /(?:体脂肪率|体脂肪)\s*[:：]?\s*(-?\d+(?:\.\d+)?)(?:\s*(?:%|パーセント|パー))?/i,
    /(-?\d+(?:\.\d+)?)\s*(?:%|パーセント|パー)/i,
  ];

  for (const re of weightPatterns) {
    const m = normalized.match(re);
    if (m && m[1] != null) {
      const value = clampOrNull(m[1], 20, 300);
      if (value !== null) {
        weightKg = value;
        break;
      }
    }
  }

  for (const re of bodyFatPatterns) {
    const m = normalized.match(re);
    if (m && m[1] != null) {
      const value = clampOrNull(m[1], 1, 80);
      if (value !== null) {
        bodyFatPercent = value;
        break;
      }
    }
  }

  if (weightKg === null && bodyFatPercent === null) {
    return buildEmptyResult(text);
  }

  const clearText =
    /(?:kg|キロ|体重)/i.test(normalized) ||
    /(?:%|パーセント|パー|体脂肪率|体脂肪)/i.test(normalized);

  const replyLines = [];
  if (weightKg !== null && bodyFatPercent !== null) {
    replyLines.push(`体重${weightKg}kg、体脂肪率${bodyFatPercent}%として受け取りました。`);
  } else if (weightKg !== null) {
    replyLines.push(`体重${weightKg}kgとして受け取りました。`);
  } else if (bodyFatPercent !== null) {
    replyLines.push(`体脂肪率${bodyFatPercent}%として受け取りました。`);
  }

  if (clearText) {
    replyLines.push('この内容で保存しておきますね。');
  } else {
    replyLines.push('こちらでこう受け取っています。違っていたらそのまま教えてくださいね。');
  }

  return {
    intent: 'body_metrics',
    category: 'body_metrics',
    capture_type: 'body_metrics',
    action: clearText ? 'auto_save' : 'needs_confirmation',
    auto_save: clearText,
    needs_confirmation: !clearText,
    reply_text: replyLines.join('\n'),
    payload: {
      weight_kg: weightKg,
      body_fat_percent: bodyFatPercent,
    },
    memory_candidates: [],
    follow_up_question: null,
    source_text: safeText(text, 1000),
  };
}

function normalizeResult(raw, originalText) {
  const intent = safeText(raw?.intent || raw?.category || 'unknown', 50) || 'unknown';
  const category = safeText(raw?.category || raw?.intent || 'unknown', 50) || 'unknown';

  const captureTypeRaw = raw?.capture_type;
  const captureType = captureTypeRaw === null ? null : (safeText(captureTypeRaw || '', 50) || null);

  let action = safeText(raw?.action || '', 50);
  if (!action) {
    if (raw?.auto_save) action = 'auto_save';
    else if (raw?.needs_confirmation) action = 'needs_confirmation';
    else if (
      category === 'pain_consult' ||
      category === 'general_consult' ||
      category === 'mixed_record_consult'
    ) {
      action = 'reply_only';
    } else {
      action = 'pass_through';
    }
  }

  const weightKg = clampOrNull(raw?.payload?.weight_kg, 20, 300);
  const bodyFatPercent = clampOrNull(raw?.payload?.body_fat_percent, 1, 80);

  return {
    intent,
    category,
    capture_type: captureType,
    action,
    auto_save: action === 'auto_save' || Boolean(raw?.auto_save),
    needs_confirmation: action === 'needs_confirmation' || Boolean(raw?.needs_confirmation),
    reply_text: safeText(raw?.reply_text || '', 500),
    payload: {
      weight_kg: weightKg,
      body_fat_percent: bodyFatPercent,
      meal_type: safeText(raw?.payload?.meal_type || '', 50),
      meal_text: safeText(raw?.payload?.meal_text || '', 300),
      meal_items: normalizeMealItems(raw?.payload?.meal_items),
      exercise_text: safeText(raw?.payload?.exercise_text || '', 300),
      exercise_items: normalizeExerciseItems(raw?.payload?.exercise_items),
      pain_location: safeText(raw?.payload?.pain_location || '', 100),
      pain_summary: safeText(raw?.payload?.pain_summary || '', 200),
      consult_summary: safeText(raw?.payload?.consult_summary || '', 200),
      mixed_summary: safeText(raw?.payload?.mixed_summary || '', 200),
    },
    memory_candidates: normalizeMemoryCandidates(raw?.memory_candidates),
    follow_up_question: safeText(raw?.follow_up_question || '', 200) || null,
    source_text: safeText(originalText, 1000),
  };
}

function buildFallbackHeuristics(text) {
  const base = buildFallbackBodyMetrics(text);
  if (base.category === 'body_metrics') return base;

  const raw = safeText(text, 300);

  const hasPain =
    /(痛|しび|痺|張る|違和感|つらい|辛い|だる|重い|こわば|腫れ|炎症|膝|腰|肩|首|股関節|足底|ふくらはぎ)/i.test(raw);

  const hasQuestion =
    /(\?|？|どう|大丈夫|いいかな|よいかな|してもいい|していい|問題ない|平気)/i.test(raw);

  const hasMeal =
    /(食べた|飲んだ|朝ごはん|昼ごはん|夜ごはん|朝食|昼食|夕食|おやつ|間食|パン|ご飯|ラーメン|味噌汁|コーヒー|お茶)/i.test(raw);

  const hasExercise =
    /(歩いた|歩きました|散歩|ウォーキング|走った|ジョギング|ランニング|筋トレ|ストレッチ|体操|運動|泳いだ|自転車|バイク|ヨガ)/i.test(raw);

  if (hasPain && hasQuestion) {
    return {
      intent: 'consultation',
      category: 'pain_consult',
      capture_type: null,
      action: 'reply_only',
      auto_save: false,
      needs_confirmation: false,
      reply_text: '気になりますね。まずは無理に進めず、どこが・どんな時に一番つらいかを教えてください。',
      payload: {
        pain_summary: raw,
      },
      memory_candidates: [],
      follow_up_question: 'どこが、どんな動きで一番つらいですか？',
      source_text: safeText(text, 1000),
    };
  }

  if (hasMeal && hasExercise) {
    return {
      intent: 'consultation',
      category: 'mixed_record_consult',
      capture_type: null,
      action: 'needs_confirmation',
      auto_save: false,
      needs_confirmation: true,
      reply_text: '食事と運動の話として受け取っています。まずは記録してよい内容から、こちらで一緒に整えていきますね。',
      payload: {
        mixed_summary: raw,
      },
      memory_candidates: [],
      follow_up_question: null,
      source_text: safeText(text, 1000),
    };
  }

  if (hasMeal) {
    return {
      intent: 'consultation',
      category: 'meal_record',
      capture_type: null,
      action: 'needs_confirmation',
      auto_save: false,
      needs_confirmation: true,
      reply_text: '食事のこととして受け取っています。こちらで記録する内容が合っているか、必要なら少しだけ教えてくださいね。',
      payload: {
        meal_text: raw,
        meal_items: [],
      },
      memory_candidates: [],
      follow_up_question: null,
      source_text: safeText(text, 1000),
    };
  }

  if (hasExercise) {
    return {
      intent: 'consultation',
      category: 'exercise_record',
      capture_type: null,
      action: 'needs_confirmation',
      auto_save: false,
      needs_confirmation: true,
      reply_text: '運動のこととして受け取っています。内容が合っていればそのまま記録に進めますね。',
      payload: {
        exercise_text: raw,
        exercise_items: [],
      },
      memory_candidates: [],
      follow_up_question: null,
      source_text: safeText(text, 1000),
    };
  }

  if (hasPain) {
    return {
      intent: 'consultation',
      category: 'pain_consult',
      capture_type: null,
      action: 'reply_only',
      auto_save: false,
      needs_confirmation: false,
      reply_text: 'それは気になりますね。まずは無理を増やさず、今いちばん困っている感じをそのまま教えてください。',
      payload: {
        pain_summary: raw,
      },
      memory_candidates: [],
      follow_up_question: null,
      source_text: safeText(text, 1000),
    };
  }

  return buildEmptyResult(text);
}

async function analyzeChatCapture({ userText, user = {} }) {
  const text = safeText(userText, 1000);
  if (!text) {
    return buildEmptyResult('');
  }

  const prompt = [
    'あなたはLINE上の伴走AI「AI牛込」です。',
    '利用者の自然文をまず人間のように理解し、記録候補・相談種別・返信方針をJSONだけで返してください。',
    '',
    '最重要方針:',
    '- 必ずJSONのみを返す',
    '- 機械的なエラー表現は使わない',
    '- 年配の方でも自然に進められる、やさしい返答文にする',
    '- 利用者の発言をまず意味理解し、固定形式の押し付けをしない',
    '- 記録できるものは自然に記録候補へ回す',
    '- 曖昧ならやわらかく確認する',
    '- 相談は相談として受け止め、無理に記録扱いしない',
    '- 痛み相談を運動記録にしない',
    '- 食事・運動・相談が混ざる文は mixed_record_consult にしてよい',
    '- 相談や雑談の中で今後役立つことは memory_candidates に入れてよい',
    '',
    'category 候補:',
    '- body_metrics',
    '- meal_record',
    '- exercise_record',
    '- pain_consult',
    '- general_consult',
    '- mixed_record_consult',
    '- unknown',
    '',
    'action 候補:',
    '- auto_save',
    '- needs_confirmation',
    '- reply_only',
    '- pass_through',
    '',
    'capture_type 候補:',
    '- body_metrics',
    '- memory_note',
    '- null',
    '',
    '判断ルール:',
    '- 体重・体脂肪率が明確なら category=body_metrics, action=auto_save',
    '- 食事内容がかなり明確なら category=meal_record, action=auto_save でもよい',
    '- 食事だが量や内容が曖昧なら category=meal_record, action=needs_confirmation',
    '- 運動内容が明確なら category=exercise_record, action=auto_save でもよい',
    '- 運動だが時間や内容が曖昧なら category=exercise_record, action=needs_confirmation',
    '- 痛みや体調の相談は category=pain_consult, action=reply_only',
    '- 日常の悩みやストレス相談は category=general_consult, action=reply_only',
    '- 記録と相談が混ざるときは category=mixed_record_consult',
    '',
    'reply_text の方針:',
    '- 利用者に返す自然な短めの日本語',
    '- 厳しい言い方や事務的表現を避ける',
    '- 保存前確認も自然文で',
    '',
    '返却JSONスキーマ:',
    '{',
    '  "intent": "body_metrics | consultation | chat | unknown",',
    '  "category": "body_metrics | meal_record | exercise_record | pain_consult | general_consult | mixed_record_consult | unknown",',
    '  "capture_type": "body_metrics | memory_note | null",',
    '  "action": "auto_save | needs_confirmation | reply_only | pass_through",',
    '  "auto_save": false,',
    '  "needs_confirmation": false,',
    '  "reply_text": "利用者に返す自然な日本語",',
    '  "follow_up_question": "必要な時だけ短く",',
    '  "payload": {',
    '    "weight_kg": null,',
    '    "body_fat_percent": null,',
    '    "meal_type": "",',
    '    "meal_text": "",',
    '    "meal_items": [',
    '      { "name": "ごはん", "amount_text": "半分" }',
    '    ],',
    '    "exercise_text": "",',
    '    "exercise_items": [',
    '      { "name": "ウォーキング", "duration_minutes": 30, "count": null, "distance_km": null, "amount_text": "" }',
    '    ],',
    '    "pain_location": "",',
    '    "pain_summary": "",',
    '    "consult_summary": "",',
    '    "mixed_summary": ""',
    '  },',
    '  "memory_candidates": [',
    '    { "memory_type": "emotional_trigger | work_context | pain_pattern | goal | helpful_support_style | craving_pattern | continuation_barrier | other", "content": "短い要約" }',
    '  ]',
    '}',
    '',
    'memory_note にしてよい例:',
    '- 仕事の疲れで夜に甘いものが増える',
    '- 恋愛ストレスで食べ過ぎやすい',
    '- 夜に崩れやすい',
    '- 強い言い方よりやさしい励ましの方が続く',
    '- 膝の外側が走ると痛みやすい',
    '',
    `利用者名: ${safeText(user?.display_name || '', 80) || '未設定'}`,
    `利用者発言: ${JSON.stringify(text)}`,
  ].join('\n');

  try {
    const raw = await generateTextOnly(prompt, 0.2);
    const parsed = safeParseJson(raw, null);

    if (!parsed || typeof parsed !== 'object') {
      return buildFallbackHeuristics(text);
    }

    const normalized = normalizeResult(parsed, text);

    if (
      normalized.category === 'body_metrics' &&
      (normalized.payload.weight_kg !== null || normalized.payload.body_fat_percent !== null)
    ) {
      if (!normalized.reply_text) {
        const fallback = buildFallbackBodyMetrics(text);
        return {
          ...normalized,
          reply_text: fallback.reply_text,
        };
      }
      return normalized;
    }

    if (
      normalized.category &&
      normalized.category !== 'unknown' &&
      normalized.action &&
      normalized.action !== 'pass_through'
    ) {
      return normalized;
    }

    return buildFallbackHeuristics(text);
  } catch (_error) {
    return buildFallbackHeuristics(text);
  }
}

module.exports = {
  analyzeChatCapture,
};
