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

function buildFallbackBodyMetrics(text) {
  const raw = safeText(text, 300);
  if (!raw) {
    return {
      intent: 'unknown',
      capture_type: null,
      auto_save: false,
      needs_confirmation: false,
      reply_text: '',
      payload: {},
      memory_candidates: [],
    };
  }

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
    return {
      intent: 'unknown',
      capture_type: null,
      auto_save: false,
      needs_confirmation: false,
      reply_text: '',
      payload: {},
      memory_candidates: [],
    };
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
    capture_type: 'body_metrics',
    auto_save: clearText,
    needs_confirmation: !clearText,
    reply_text: replyLines.join('\n'),
    payload: {
      weight_kg: weightKg,
      body_fat_percent: bodyFatPercent,
    },
    memory_candidates: [],
  };
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

function normalizeResult(raw, originalText) {
  const intent = safeText(raw?.intent || 'unknown', 50) || 'unknown';
  const captureType = safeText(raw?.capture_type || '', 50) || null;

  const weightKg = clampOrNull(raw?.payload?.weight_kg, 20, 300);
  const bodyFatPercent = clampOrNull(raw?.payload?.body_fat_percent, 1, 80);

  return {
    intent,
    capture_type: captureType,
    auto_save: Boolean(raw?.auto_save),
    needs_confirmation: Boolean(raw?.needs_confirmation),
    reply_text: safeText(raw?.reply_text || '', 500),
    payload: {
      weight_kg: weightKg,
      body_fat_percent: bodyFatPercent,
    },
    memory_candidates: normalizeMemoryCandidates(raw?.memory_candidates),
    source_text: safeText(originalText, 1000),
  };
}

async function analyzeChatCapture({ userText, user = {} }) {
  const text = safeText(userText, 1000);
  if (!text) {
    return {
      intent: 'unknown',
      capture_type: null,
      auto_save: false,
      needs_confirmation: false,
      reply_text: '',
      payload: {},
      memory_candidates: [],
      source_text: '',
    };
  }

  const prompt = [
    'あなたはLINE上の伴走AI「AI牛込」です。',
    '利用者の自然文をまず人間のように理解し、記録候補や返信方針をJSONで返してください。',
    '',
    '大事な方針:',
    '- 必ずJSONのみを返す',
    '- 機械的なエラー表現は使わない',
    '- 年配の方でも自然に進められる、やさしい返答文にする',
    '- 明確な体重・体脂肪率は auto_save=true にしてよい',
    '- 少し曖昧なら needs_confirmation=true にしてよい',
    '- 相談や雑談は chat / consultation にして、自然な返答文を短く作る',
    '',
    'intent 候補:',
    '- body_metrics',
    '- consultation',
    '- chat',
    '- unknown',
    '',
    'capture_type 候補:',
    '- body_metrics',
    '- memory_note',
    '- null',
    '',
    '返却JSONスキーマ:',
    '{',
    '  "intent": "body_metrics | consultation | chat | unknown",',
    '  "capture_type": "body_metrics | memory_note | null",',
    '  "auto_save": true,',
    '  "needs_confirmation": false,',
    '  "reply_text": "利用者に返す自然な日本語。短め。",',
    '  "payload": {',
    '    "weight_kg": null,',
    '    "body_fat_percent": null',
    '  },',
    '  "memory_candidates": [',
    '    { "memory_type": "emotional_trigger | work_context | pain_pattern | goal | helpful_support_style | other", "content": "短い要約" }',
    '  ]',
    '}',
    '',
    `利用者名: ${safeText(user?.display_name || '', 80) || '未設定'}`,
    `利用者発言: ${JSON.stringify(text)}`,
  ].join('\n');

  try {
    const raw = await generateTextOnly(prompt, 0.2);
    const parsed = safeParseJson(raw, null);

    if (!parsed || typeof parsed !== 'object') {
      return {
        ...buildFallbackBodyMetrics(text),
        source_text: text,
      };
    }

    const normalized = normalizeResult(parsed, text);

    if (
      normalized.intent === 'body_metrics' &&
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

    const fallback = buildFallbackBodyMetrics(text);
    if (fallback.capture_type === 'body_metrics') {
      return {
        ...fallback,
        source_text: text,
      };
    }

    return normalized;
  } catch (_error) {
    return {
      ...buildFallbackBodyMetrics(text),
      source_text: text,
    };
  }
}

module.exports = {
  analyzeChatCapture,
};
