'use strict';

const DEFAULT_TIMEOUT_MS = 30000;

function safeJsonParse(text, fallback = null) {
  try {
    return JSON.parse(text);
  } catch (err) {
    return fallback;
  }
}

function clampNumber(value, min, max, fallback = 0) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, n));
}

function roundKcal(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0;
  return Math.round(n);
}

function normalizeItem(raw) {
  const name = String(raw?.name || '').trim();
  const qtyText = String(raw?.qty_text || raw?.qtyText || '').trim();
  const estimatedKcal = roundKcal(raw?.estimated_kcal ?? raw?.estimatedKcal ?? 0);
  const confidence = clampNumber(raw?.confidence ?? 0.7, 0, 1, 0.7);
  const isMainSubject = Boolean(
    raw?.is_main_subject ?? raw?.isMainSubject ?? true
  );

  return {
    name: name || '不明な食品',
    qty_text: qtyText || '1つ',
    estimated_kcal: Math.max(0, estimatedKcal),
    confidence,
    is_main_subject: isMainSubject,
  };
}

function normalizeGeminiMealResult(raw) {
  const items = Array.isArray(raw?.items) ? raw.items.map(normalizeItem) : [];

  const normalized = {
    items,
    total_kcal: roundKcal(raw?.total_kcal ?? raw?.totalKcal ?? 0),
    range_min: roundKcal(raw?.range_min ?? raw?.rangeMin ?? 0),
    range_max: roundKcal(raw?.range_max ?? raw?.rangeMax ?? 0),
    uncertain_points: Array.isArray(raw?.uncertain_points)
      ? raw.uncertain_points.map((x) => String(x).trim()).filter(Boolean)
      : [],
    needs_confirmation: Boolean(raw?.needs_confirmation),
    confirmation_questions: Array.isArray(raw?.confirmation_questions)
      ? raw.confirmation_questions.map((x) => String(x).trim()).filter(Boolean)
      : [],
    raw_json: raw || {},
  };

  const mainItems = normalized.items.filter((item) => item.is_main_subject);
  const computedMainTotal = mainItems.reduce((sum, item) => sum + item.estimated_kcal, 0);

  if (!normalized.total_kcal || normalized.total_kcal <= 0) {
    normalized.total_kcal = computedMainTotal;
  }

  if (!normalized.range_min || normalized.range_min <= 0) {
    normalized.range_min = Math.max(0, Math.round(normalized.total_kcal * 0.85));
  }

  if (!normalized.range_max || normalized.range_max <= 0) {
    normalized.range_max = Math.max(normalized.range_min, Math.round(normalized.total_kcal * 1.2));
  }

  if (normalized.range_min > normalized.range_max) {
    const tmp = normalized.range_min;
    normalized.range_min = normalized.range_max;
    normalized.range_max = tmp;
  }

  if (!normalized.needs_confirmation) {
    normalized.needs_confirmation =
      normalized.uncertain_points.length > 0 || normalized.confirmation_questions.length > 0;
  }

  return applyLocalMealGuards(normalized);
}

function applyLocalMealGuards(result) {
  const mainItems = result.items.filter((item) => item.is_main_subject);
  const mainNames = mainItems.map((item) => item.name).join(' / ');
  const total = result.total_kcal;

  const hasLightSnackPattern =
    /ナゲット|バウム|バーム|ドーナツ|お菓子|クッキー|パン|カフェオレ|ラテ|コーヒー|紅茶|ミルクティー/i.test(mainNames) &&
    mainItems.length <= 4;

  if (hasLightSnackPattern && total >= 550) {
    result.uncertain_points.unshift(
      '軽食の見た目に対して推定カロリーが高めのため再確認が必要です'
    );
    result.needs_confirmation = true;

    result.total_kcal = Math.round(total * 0.75);
    result.range_min = Math.min(result.range_min, Math.round(result.total_kcal * 0.85));
    result.range_max = Math.max(result.range_max, Math.round(result.total_kcal * 1.2));
  }

  if (result.range_max - result.range_min > 400) {
    result.uncertain_points.unshift(
      '推定幅が広いため、飲み物や量の確認で精度が上がります'
    );
    result.needs_confirmation = true;
  }

  return result;
}

function buildMealVisionPrompt() {
  return `
あなたは食事画像の解析エンジンです。
目的は、写真に写っている主被写体の食事・飲み物を現実的に推定し、過大評価を避けることです。

必須ルール:
1. 写真の主被写体を最優先で判定すること。
2. 背景にある食品・飲料は自動で摂取扱いにしないこと。
3. 見えない量を過大に補完しないこと。
4. 推定カロリーは上限寄りではなく中央値寄りで返すこと。
5. 少量のおやつ・軽食・飲み物は盛りすぎないこと。
6. 不明点があれば uncertain_points と confirmation_questions に入れること。
7. 飲み物の種類や砂糖の有無が曖昧なら、勝手に高カロリー寄りにしないこと。
8. 背景物は total_kcal に自動加算しないこと。
9. ソース・ドレッシング・砂糖・シロップは、明確に確認できる時だけ加算すること。
10. 必ずJSONのみを返すこと。説明文は禁止。

出力要件:
- items: 配列
- 各itemは name, qty_text, estimated_kcal, confidence, is_main_subject を持つ
- total_kcal は主被写体のみの合計
- range_min, range_max は妥当な推定幅
- uncertain_points は曖昧点
- needs_confirmation は true/false
- confirmation_questions は必要時のみ質問を入れる

日本語で判定してください。
JSON以外は絶対に返さないでください。
`.trim();
}

function getMealResponseSchema() {
  return {
    type: 'object',
    properties: {
      items: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            name: { type: 'string' },
            qty_text: { type: 'string' },
            estimated_kcal: { type: 'number' },
            confidence: { type: 'number' },
            is_main_subject: { type: 'boolean' },
          },
          required: ['name', 'qty_text', 'estimated_kcal', 'confidence', 'is_main_subject'],
        },
      },
      total_kcal: { type: 'number' },
      range_min: { type: 'number' },
      range_max: { type: 'number' },
      uncertain_points: {
        type: 'array',
        items: { type: 'string' },
      },
      needs_confirmation: { type: 'boolean' },
      confirmation_questions: {
        type: 'array',
        items: { type: 'string' },
      },
    },
    required: [
      'items',
      'total_kcal',
      'range_min',
      'range_max',
      'uncertain_points',
      'needs_confirmation',
      'confirmation_questions',
    ],
  };
}

async function fetchWithTimeout(url, options = {}, timeoutMs = DEFAULT_TIMEOUT_MS) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetch(url, {
      ...options,
      signal: controller.signal,
    });
    return res;
  } finally {
    clearTimeout(timer);
  }
}

function extractGeminiText(json) {
  return (
    json?.candidates?.[0]?.content?.parts?.map((p) => p?.text || '').join('') ||
    json?.candidates?.[0]?.content?.parts?.[0]?.text ||
    ''
  );
}

function cleanupJsonText(text) {
  const trimmed = String(text || '').trim();

  if (!trimmed) return '{}';

  if (trimmed.startsWith('```')) {
    return trimmed
      .replace(/^```json\s*/i, '')
      .replace(/^```\s*/i, '')
      .replace(/\s*```$/i, '')
      .trim();
  }

  return trimmed;
}

async function analyzeMealPhotoWithGemini({
  base64Image,
  mimeType = 'image/jpeg',
  apiKey = process.env.GEMINI_API_KEY,
  model = process.env.GEMINI_MEAL_MODEL || 'gemini-2.5-flash',
  timeoutMs = DEFAULT_TIMEOUT_MS,
}) {
  if (!apiKey) {
    throw new Error('GEMINI_API_KEY が未設定です');
  }

  if (!base64Image) {
    throw new Error('base64Image が空です');
  }

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;

  const body = {
    contents: [
      {
        parts: [
          { text: buildMealVisionPrompt() },
          {
            inline_data: {
              mime_type: mimeType,
              data: base64Image,
            },
          },
        ],
      },
    ],
    generationConfig: {
      temperature: 0.2,
      responseMimeType: 'application/json',
      responseSchema: getMealResponseSchema(),
    },
  };

  const res = await fetchWithTimeout(
    url,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    },
    timeoutMs
  );

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Gemini API error: ${res.status} ${errText}`);
  }

  const json = await res.json();
  const rawText = extractGeminiText(json);
  const cleanedText = cleanupJsonText(rawText);
  const parsed = safeJsonParse(cleanedText);

  if (!parsed) {
    throw new Error(`GeminiのJSON解析に失敗しました: ${cleanedText}`);
  }

  return normalizeGeminiMealResult(parsed);
}

function buildMealReply(result) {
  const items = Array.isArray(result?.items) ? result.items : [];
  const mainItems = items.filter((item) => item.is_main_subject);

  const itemLines = mainItems.map((item) => `・${item.name} ${item.qty_text}`);
  const kcal = roundKcal(result?.total_kcal);
  const minKcal = roundKcal(result?.range_min);
  const maxKcal = roundKcal(result?.range_max);

  let text = '食事内容を整理しました。\n';

  if (itemLines.length) {
    text += `${itemLines.join('\n')}\n\n`;
  } else {
    text += '・写真から主な食事を特定できませんでした\n\n';
  }

  text += `推定カロリー: ${kcal} kcal（${minKcal}〜${maxKcal} kcal）`;

  if (Array.isArray(result?.uncertain_points) && result.uncertain_points.length) {
    text += '\n\n確認したい点:\n';
    text += result.uncertain_points.map((x) => `・${x}`).join('\n');
  }

  if (
    Array.isArray(result?.confirmation_questions) &&
    result.confirmation_questions.length
  ) {
    text += '\n\n';
    text += result.confirmation_questions.map((x) => `・${x}`).join('\n');
  }

  text += '\n\n合っていれば保存、違うところがあればそのまま訂正してください。';

  return text;
}

function buildMealSavePayload({
  userId = null,
  imageUrl = null,
  result,
  originalMessageId = null,
}) {
  return {
    user_id: userId,
    source_type: 'photo',
    source_model: 'gemini',
    original_message_id: originalMessageId,
    image_url: imageUrl,
    meal_items_json: result?.items || [],
    total_kcal: roundKcal(result?.total_kcal),
    kcal_range_min: roundKcal(result?.range_min),
    kcal_range_max: roundKcal(result?.range_max),
    uncertain_points_json: result?.uncertain_points || [],
    confirmation_questions_json: result?.confirmation_questions || [],
    needs_confirmation: Boolean(result?.needs_confirmation),
    confirmed_by_user: false,
    raw_response_json: result?.raw_json || result || {},
    created_at: new Date().toISOString(),
  };
}

module.exports = {
  analyzeMealPhotoWithGemini,
  buildMealReply,
  buildMealSavePayload,
  buildMealVisionPrompt,
  getMealResponseSchema,
  normalizeGeminiMealResult,
  applyLocalMealGuards,
};
