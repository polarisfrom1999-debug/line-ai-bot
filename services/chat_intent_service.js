'use strict';

/**
 * services/chat_intent_service.js
 *
 * 目的:
 * - ChatGPT主導でユーザー発言の意味を安全に整理する
 * - 体重・体脂肪率の自然文入力を拾う
 * - 会話メモ候補を抽出する
 * - 失敗しても index.js 側を壊さない
 */

const { genAI, extractGeminiText, safeJsonParse, retry } = require('./gemini_service');

const DEFAULT_TIMEOUT_MS = 30000;

function safeText(value, max = 500) {
  return String(value || '').trim().slice(0, max);
}

function toNumberOrNull(value) {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(String(value).replace(/[^\d.-]/g, ''));
  return Number.isFinite(n) ? n : null;
}

function clampNumber(value, min, max) {
  if (value === null || value === undefined) return null;
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  if (n < min || n > max) return null;
  return n;
}

function normalizeIntent(value) {
  const v = safeText(value, 50).toLowerCase();

  if (
    v === 'meal' ||
    v === 'food' ||
    v === '食事'
  ) return 'meal';

  if (
    v === 'exercise' ||
    v === 'workout' ||
    v === '運動'
  ) return 'exercise';

  if (
    v === 'body_metrics' ||
    v === 'weight' ||
    v === '体重' ||
    v === '体脂肪'
  ) return 'body_metrics';

  if (
    v === 'pain' ||
    v === '痛み'
  ) return 'pain';

  if (
    v === 'consultation' ||
    v === '相談'
  ) return 'consultation';

  if (
    v === 'diagnosis' ||
    v === 'free_diagnosis' ||
    v === '診断'
  ) return 'diagnosis';

  if (
    v === 'plan' ||
    v === 'trial' ||
    v === 'onboarding' ||
    v === '導線'
  ) return 'guidance';

  if (
    v === 'chat' ||
    v === '雑談'
  ) return 'chat';

  return 'unknown';
}

function normalizeSupportNotes(notes) {
  if (!Array.isArray(notes)) return [];
  return notes
    .map((item) => safeText(item, 120))
    .filter(Boolean)
    .slice(0, 5);
}

function normalizeMemoryCandidates(items) {
  if (!Array.isArray(items)) return [];

  return items
    .map((item) => {
      const category = safeText(item?.category || '', 50);
      const summary = safeText(item?.summary || item?.text || '', 160);
      const importance = clampNumber(toNumberOrNull(item?.importance), 1, 5) || 3;

      if (!category || !summary) return null;

      return {
        category,
        summary,
        importance,
      };
    })
    .filter(Boolean)
    .slice(0, 8);
}

function buildFallbackBodyMetricsFromText(text) {
  const src = safeText(text, 300);
  if (!src) {
    return {
      intent: 'unknown',
      confidence: 0,
      body_metrics: null,
      memory_candidates: [],
      support_notes: [],
      reply_hint: '',
    };
  }

  let weightKg = null;
  let bodyFatPercent = null;

  const weightPatterns = [
    /体重\s*[:：]?\s*(\d{2,3}(?:\.\d+)?)/i,
    /(\d{2,3}(?:\.\d+)?)\s*(?:kg|ｋｇ|キロ)/i,
  ];

  const bodyFatPatterns = [
    /体脂肪(?:率)?\s*[:：]?\s*(\d{1,2}(?:\.\d+)?)/i,
    /(\d{1,2}(?:\.\d+)?)\s*(?:%|％|パーセント|パー)/i,
  ];

  for (const re of weightPatterns) {
    const m = src.match(re);
    if (m && m[1]) {
      const n = clampNumber(toNumberOrNull(m[1]), 20, 300);
      if (n !== null) {
        weightKg = n;
        break;
      }
    }
  }

  for (const re of bodyFatPatterns) {
    const m = src.match(re);
    if (m && m[1]) {
      const n = clampNumber(toNumberOrNull(m[1]), 1, 80);
      if (n !== null) {
        bodyFatPercent = n;
        break;
      }
    }
  }

  const hasWeight = weightKg !== null;
  const hasBodyFat = bodyFatPercent !== null;

  if (!hasWeight && !hasBodyFat) {
    return {
      intent: 'unknown',
      confidence: 0.1,
      body_metrics: null,
      memory_candidates: [],
      support_notes: [],
      reply_hint: '',
    };
  }

  return {
    intent: 'body_metrics',
    confidence: hasWeight && hasBodyFat ? 0.95 : 0.82,
    body_metrics: {
      weight_kg: weightKg,
      body_fat_percent: bodyFatPercent,
      missing_fields: [
        ...(hasWeight ? [] : ['weight_kg']),
        ...(hasBodyFat ? [] : ['body_fat_percent']),
      ],
    },
    memory_candidates: [],
    support_notes: [],
    reply_hint: '',
  };
}

function buildPrompt({ text, user = {}, context = {} }) {
  const personaLabel = safeText(
    user.ai_persona_label ||
    user.ai_type_label ||
    user.persona_label ||
    '',
    80
  );

  const currentFlow = safeText(user.current_flow || context.current_flow || '', 50);
  const diagnosisActive = Boolean(context.isDiagnosisActive);
  const pendingCaptureType = safeText(
    user.pending_capture_type || context.pending_capture_type || '',
    50
  );

  return `
あなたは LINE上の伴走AI「AI牛込」です。
目的は、ユーザー発言を会話理解し、保存候補と返信方針を安全に整理することです。

絶対ルール:
- JSONだけを返してください
- 説明文やコードブロックは不要です
- intent は次のいずれか:
  "meal", "exercise", "body_metrics", "pain", "consultation", "diagnosis", "guidance", "chat", "unknown"
- 推測しすぎないでください
- 数値は分かる時だけ入れてください
- 体重は kg、体脂肪率は % の数値だけ返してください
- ダイエットと無関係の相談でも "consultation" や "chat" として自然に扱ってください
- 痛み相談は "pain" を優先してよいです
- 診断進行中っぽい場合は "diagnosis" を優先候補にしてください
- 導線案内やプラン・無料体験に自然接続しそうな内容は "guidance" にしてよいです

返却JSONスキーマ:
{
  "intent": "...",
  "confidence": 0.0,
  "body_metrics": {
    "weight_kg": null,
    "body_fat_percent": null,
    "missing_fields": []
  },
  "memory_candidates": [
    {
      "category": "stressors/goals/barriers/support_style/life_context/habit_risks/motivation/pain_context/other",
      "summary": "短い要約",
      "importance": 3
    }
  ],
  "support_notes": ["短い補助メモ"],
  "reply_hint": "返信で意識するとよい短い方針"
}

現在情報:
- personaLabel: ${JSON.stringify(personaLabel)}
- currentFlow: ${JSON.stringify(currentFlow)}
- diagnosisActive: ${JSON.stringify(diagnosisActive)}
- pendingCaptureType: ${JSON.stringify(pendingCaptureType)}

ユーザー発言:
${JSON.stringify(safeText(text, 1000))}
`.trim();
}

async function callGeminiJson(prompt) {
  const model = genAI.getGenerativeModel({
    model: 'gemini-1.5-flash',
    generationConfig: {
      temperature: 0.2,
      responseMimeType: 'application/json',
    },
  });

  const result = await retry(async () => {
    return model.generateContent(prompt);
  }, 2);

  const rawText = extractGeminiText(result);
  return safeJsonParse(rawText, null);
}

function normalizeResult(raw, originalText) {
  const intent = normalizeIntent(raw?.intent);
  const confidence = Math.max(0, Math.min(1, Number(raw?.confidence) || 0));

  const weightKg = clampNumber(
    toNumberOrNull(raw?.body_metrics?.weight_kg),
    20,
    300
  );

  const bodyFatPercent = clampNumber(
    toNumberOrNull(raw?.body_metrics?.body_fat_percent),
    1,
    80
  );

  const hasWeight = weightKg !== null;
  const hasBodyFat = bodyFatPercent !== null;

  const memoryCandidates = normalizeMemoryCandidates(raw?.memory_candidates);
  const supportNotes = normalizeSupportNotes(raw?.support_notes);
  const replyHint = safeText(raw?.reply_hint || '', 160);

  const normalized = {
    intent,
    confidence,
    body_metrics: hasWeight || hasBodyFat
      ? {
          weight_kg: weightKg,
          body_fat_percent: bodyFatPercent,
          missing_fields: [
            ...(hasWeight ? [] : ['weight_kg']),
            ...(hasBodyFat ? [] : ['body_fat_percent']),
          ],
        }
      : null,
    memory_candidates: memoryCandidates,
    support_notes: supportNotes,
    reply_hint: replyHint,
    source_text: safeText(originalText, 1000),
  };

  if (normalized.intent === 'unknown' && !normalized.body_metrics) {
    const fallback = buildFallbackBodyMetricsFromText(originalText);
    if (fallback.body_metrics) {
      return {
        ...normalized,
        intent: 'body_metrics',
        confidence: Math.max(normalized.confidence, fallback.confidence || 0.8),
        body_metrics: fallback.body_metrics,
      };
    }
  }

  return normalized;
}

async function analyzeUserMessage(text, user = {}, context = {}) {
  try {
    const src = safeText(text, 1000);
    if (!src) {
      return {
        intent: 'unknown',
        confidence: 0,
        body_metrics: null,
        memory_candidates: [],
        support_notes: [],
        reply_hint: '',
        source_text: '',
      };
    }

    const fallback = buildFallbackBodyMetricsFromText(src);
    if (fallback.body_metrics) {
      return {
        ...fallback,
        source_text: src,
      };
    }

    const prompt = buildPrompt({
      text: src,
      user,
      context,
    });

    const raw = await Promise.race([
      callGeminiJson(prompt),
      new Promise((resolve) => {
        setTimeout(() => resolve(null), DEFAULT_TIMEOUT_MS);
      }),
    ]);

    if (!raw || typeof raw !== 'object') {
      return {
        intent: 'unknown',
        confidence: 0,
        body_metrics: null,
        memory_candidates: [],
        support_notes: [],
        reply_hint: '',
        source_text: src,
      };
    }

    return normalizeResult(raw, src);
  } catch (_err) {
    return {
      intent: 'unknown',
      confidence: 0,
      body_metrics: null,
      memory_candidates: [],
      support_notes: [],
      reply_hint: '',
      source_text: safeText(text, 1000),
    };
  }
}

module.exports = {
  analyzeUserMessage,
  buildFallbackBodyMetricsFromText,
};
