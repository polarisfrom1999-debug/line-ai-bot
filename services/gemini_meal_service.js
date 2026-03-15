'use strict';

const DEFAULT_TIMEOUT_MS = 30000;

function safeJsonParse(text, fallback = null) {
  try {
    return JSON.parse(text);
  } catch (_err) {
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

function safeText(value, max = 200) {
  return String(value || '').trim().slice(0, max);
}

function normalizeItem(raw) {
  const name = safeText(raw?.name || '', 80) || '不明な食品';
  const qtyText = safeText(raw?.qty_text || raw?.qtyText || '', 80) || '1つ';
  const estimatedKcal = roundKcal(raw?.estimated_kcal ?? raw?.estimatedKcal ?? 0);
  const confidence = clampNumber(raw?.confidence ?? 0.7, 0, 1, 0.7);
  const isMainSubject = Boolean(raw?.is_main_subject ?? raw?.isMainSubject ?? true);

  return {
    name,
    qty_text: qtyText,
    estimated_kcal: Math.max(0, estimatedKcal),
    confidence,
    is_main_subject: isMainSubject,
  };
}

function buildMealVisionPrompt() {
  return `
あなたは日本向けの食事画像解析エンジンです。
目的は、写真に写っている主被写体の食事・飲み物を、できるだけ具体名で、現実的な量とカロリーで整理することです。

最優先ルール:
1. 写真の主被写体を最優先で判定すること。
2. 背景にある食品・飲料は自動で摂取扱いにしないこと。
3. 見えない量を過大に補完しないこと。
4. 推定カロリーは上限寄りではなく中央値寄りで返すこと。
5. 一般名に丸めすぎないこと。具体名が有力なら具体名を優先すること。
6. 商品名・店の定番名・料理名・魚種・貝の種類などが推定できるなら、無理のない範囲で具体的に書くこと。
7. 不明点があれば uncertain_points と confirmation_questions に入れること。
8. 飲み物の種類や砂糖の有無が曖昧でも、勝手に高カロリー寄りにしないこと。
9. ソース・ドレッシング・砂糖・シロップ・バターは、明確に確認できる時だけ加算すること。
10. 必ずJSONのみを返すこと。説明文は禁止。

具体名の扱い:
- 「貝」「魚」「パン」などの一般名だけで終えず、見た目や文脈から有力なら具体名を書くこと。
- 例: ホンビノス貝 / ボンビノス貝 / サーモン刺身 / プレミアムチョコクロ / フレンチトースト。
- ただし断定が危険な場合は、confirmation_questions で確認前提にすること。

量の扱い:
- 切れ数、個数、本数、杯数が見える場合は qty_text に反映すること。
- 量が見えない時だけ「1個」「1杯」など最小限の表現にすること。

カロリーの基準:
- 刺身や寿司ネタ、貝類は高くしすぎないこと。
- サーモン刺身は 1切れあたりおおむね 25〜35kcal を基本に考えること。
- 白身刺身は 1切れあたりおおむね 10〜20kcal を基本に考えること。
- ホンビノス貝・ハマグリなど大ぶりの貝は 1個あたりおおむね 20〜35kcal を基本に考えること。
- 焼きおにぎり 1個はおおむね 160〜230kcal を基本に考えること。
- 菓子パン・クロワッサン系は高くなりやすいが、見た目以上に過大推定しないこと。
- 軽食3〜4点で合計 500kcal を大きく超える時は、過大推定の可能性を疑うこと。

飲み物の扱い:
- 水、お茶、無糖コーヒーの可能性があるなら高カロリーにしすぎないこと。
- 不明なミルク入り飲料は、まず 70〜110 kcal 程度を中心に考えること。
- カフェオレかミルクティーか曖昧なら、確認質問を出しつつ仮推定は控えめにすること。

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

function dedupeLines(list) {
  const seen = new Set();
  const out = [];

  for (const item of list || []) {
    const text = safeText(item, 160);
    if (!text) continue;
    if (seen.has(text)) continue;
    seen.add(text);
    out.push(text);
  }

  return out;
}

function hasUncertainDrink(result) {
  const text = [
    ...(Array.isArray(result?.uncertain_points) ? result.uncertain_points : []),
    ...(Array.isArray(result?.confirmation_questions) ? result.confirmation_questions : []),
    ...((result?.items || []).map((x) => `${x?.name || ''} ${x?.qty_text || ''}`)),
  ].join(' ');

  return /カフェオレ|ミルクティー|ラテ|飲み物|マグカップ|コップ|紅茶|お茶|水/.test(text);
}

function looksLikeLightSnack(itemNamesText) {
  return /ナゲット|バウム|バーム|クッキー|ドーナツ|お菓子|菓子|ケーキ|パン|クロワッサン|チョコクロ|カフェオレ|ラテ|ミルクティー|コーヒー|紅茶|お茶|ジュース/.test(
    itemNamesText
  );
}

function extractCount(qtyText) {
  const m = String(qtyText || '').match(/(\d+(?:\.\d+)?)/);
  if (!m) return null;
  const n = Number(m[1]);
  return Number.isFinite(n) ? n : null;
}

function applyNamedFoodAdjustments(result) {
  const adjustedItems = (result.items || []).map((item) => {
    const name = String(item.name || '');
    const qtyText = String(item.qty_text || '');
    const count = extractCount(qtyText);
    let estimated = Number(item.estimated_kcal) || 0;

    if (/サーモン/.test(name) && /刺身|さしみ|刺し身/.test(name) && count && count >= 2 && count <= 12) {
      const target = Math.round(count * 30);
      estimated = Math.max(Math.round(count * 25), Math.min(Math.round(count * 35), target));
    }

    if (/白身|鯛|たい|ヒラメ|ひらめ|カンパチ|かんぱち/.test(name) && /刺身|さしみ|刺し身/.test(name) && count && count >= 2 && count <= 12) {
      const target = Math.round(count * 15);
      estimated = Math.max(Math.round(count * 10), Math.min(Math.round(count * 20), target));
    }

    if (/ホンビノス|ボンビノス|はまぐり|ハマグリ|蛤/.test(name) && count && count >= 1 && count <= 6) {
      const target = Math.round(count * 28);
      estimated = Math.max(Math.round(count * 20), Math.min(Math.round(count * 35), target));
    }

    if (/ホタテ|帆立/.test(name) && count && count >= 1 && count <= 6) {
      const target = Math.round(count * 18);
      estimated = Math.max(Math.round(count * 12), Math.min(Math.round(count * 28), target));
    }

    if (/焼きおにぎり/.test(name)) {
      estimated = Math.max(160, Math.min(230, estimated || 190));
    }

    return {
      ...item,
      estimated_kcal: Math.max(0, Math.round(estimated)),
    };
  });

  const mainItems = adjustedItems.filter((item) => item.is_main_subject);
  const newTotal = mainItems.reduce((sum, item) => sum + (Number(item.estimated_kcal) || 0), 0);

  if (!newTotal) {
    return {
      ...result,
      items: adjustedItems,
    };
  }

  return {
    ...result,
    items: adjustedItems,
    total_kcal: newTotal,
    range_min: Math.max(0, Math.round(newTotal * 0.82)),
    range_max: Math.max(Math.round(newTotal * 1.15), Math.round(newTotal + 25)),
  };
}

function normalizeSpecificNames(result) {
  const items = (result.items || []).map((item) => {
    let name = String(item.name || '');

    name = name
      .replace(/ホンビノズ/g, 'ホンビノス')
      .replace(/ボンビノズ/g, 'ボンビノス')
      .replace(/サ一モン/g, 'サーモン');

    if (/ホンビノス|ボンビノス/.test(name) && !/貝/.test(name)) {
      name = `${name}貝`;
    }

    return {
      ...item,
      name: safeText(name, 80) || '不明な食品',
    };
  });

  return {
    ...result,
    items,
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
      ? raw.uncertain_points.map((x) => safeText(x, 160)).filter(Boolean)
      : [],
    needs_confirmation: Boolean(raw?.needs_confirmation),
    confirmation_questions: Array.isArray(raw?.confirmation_questions)
      ? raw.confirmation_questions.map((x) => safeText(x, 160)).filter(Boolean)
      : [],
    raw_json: raw || {},
  };

  const mainItems = normalized.items.filter((item) => item.is_main_subject);
  const computedMainTotal = mainItems.reduce(
    (sum, item) => sum + (Number(item.estimated_kcal) || 0),
    0
  );

  if (!normalized.total_kcal || normalized.total_kcal <= 0) {
    normalized.total_kcal = computedMainTotal;
  }

  if (!normalized.range_min || normalized.range_min <= 0) {
    normalized.range_min = Math.max(0, Math.round(normalized.total_kcal * 0.85));
  }

  if (!normalized.range_max || normalized.range_max <= 0) {
    normalized.range_max = Math.max(
      normalized.range_min,
      Math.round(normalized.total_kcal * 1.18)
    );
  }

  if (normalized.range_min > normalized.range_max) {
    const tmp = normalized.range_min;
    normalized.range_min = normalized.range_max;
    normalized.range_max = tmp;
  }

  if (!normalized.needs_confirmation) {
    normalized.needs_confirmation =
      normalized.uncertain_points.length > 0 ||
      normalized.confirmation_questions.length > 0;
  }

  return applyLocalMealGuards(normalizeSpecificNames(normalized));
}

function applyUncertainDrinkAdjustment(result) {
  const items = Array.isArray(result.items) ? result.items : [];
  const uncertainDrink = hasUncertainDrink(result);
  if (!uncertainDrink) return result;

  const adjustedItems = items.map((item) => {
    const name = String(item.name || '');
    const isDrinkLike = /カフェオレ|ミルクティー|ラテ|コーヒー|紅茶|お茶|水|ドリンク|飲み物/.test(name);

    if (!isDrinkLike) return item;

    const current = Number(item.estimated_kcal) || 0;

    if (current <= 0) {
      return { ...item, estimated_kcal: 80 };
    }

    if (current > 110) {
      return { ...item, estimated_kcal: 90 };
    }

    return item;
  });

  const mainItems = adjustedItems.filter((item) => item.is_main_subject);
  const newTotal = mainItems.reduce((sum, item) => sum + (Number(item.estimated_kcal) || 0), 0);

  return {
    ...result,
    items: adjustedItems,
    total_kcal: newTotal,
    range_min: Math.min(result.range_min, Math.round(newTotal * 0.85)),
    range_max: Math.max(Math.round(newTotal * 1.15), Math.round(newTotal + 60)),
  };
}

function applyLightSnackCap(result) {
  const mainItems = (result.items || []).filter((item) => item.is_main_subject);
  const namesText = mainItems.map((item) => item.name).join(' / ');
  const isLightSnack = looksLikeLightSnack(namesText) && mainItems.length <= 4;

  if (!isLightSnack) return result;

  let total = Number(result.total_kcal) || 0;
  let changed = false;

  if (hasUncertainDrink(result) && total > 430) {
    total = 390;
    changed = true;
  } else if (total > 520) {
    total = Math.round(total * 0.82);
    changed = true;
  }

  if (!changed) return result;

  const rangeMin = Math.max(0, Math.round(total * 0.84));
  const rangeMax = Math.max(rangeMin + 35, Math.round(total * 1.15));

  const notes = Array.isArray(result.uncertain_points) ? [...result.uncertain_points] : [];
  if (!notes.some((x) => x.includes('軽食'))) {
    notes.unshift('軽食としては高めに出やすいため、控えめ寄りに再調整しています');
  }

  return {
    ...result,
    total_kcal: total,
    range_min: rangeMin,
    range_max: rangeMax,
    uncertain_points: notes,
    needs_confirmation: true,
  };
}

function applyLocalMealGuards(result) {
  let adjusted = {
    ...result,
    items: Array.isArray(result.items) ? result.items : [],
    uncertain_points: dedupeLines(result.uncertain_points),
    confirmation_questions: dedupeLines(result.confirmation_questions),
  };

  adjusted = applyNamedFoodAdjustments(adjusted);
  adjusted = applyUncertainDrinkAdjustment(adjusted);
  adjusted = applyLightSnackCap(adjusted);

  const mainItems = adjusted.items.filter((item) => item.is_main_subject);
  const mainNames = mainItems.map((item) => item.name).join(' / ');
  const total = Number(adjusted.total_kcal) || 0;

  const hasLightSnackPattern = looksLikeLightSnack(mainNames) && mainItems.length <= 4;

  if (hasLightSnackPattern && total >= 550) {
    adjusted.uncertain_points.unshift('軽食の見た目に対して推定カロリーが高めのため再確認が必要です');
    adjusted.needs_confirmation = true;
    adjusted.total_kcal = Math.round(total * 0.8);
    adjusted.range_min = Math.min(adjusted.range_min, Math.round(adjusted.total_kcal * 0.84));
    adjusted.range_max = Math.max(adjusted.range_max, Math.round(adjusted.total_kcal * 1.15));
  }

  if (adjusted.range_max - adjusted.range_min > 240) {
    adjusted.uncertain_points.unshift('推定幅が広いため、量や飲み物の確認で精度が上がります');
    adjusted.needs_confirmation = true;
    adjusted.range_max = Math.round(adjusted.total_kcal * 1.15);
    adjusted.range_min = Math.round(adjusted.total_kcal * 0.84);
  }

  adjusted.uncertain_points = dedupeLines(adjusted.uncertain_points);
  adjusted.confirmation_questions = dedupeLines(adjusted.confirmation_questions);

  if (adjusted.range_min > adjusted.range_max) {
    const tmp = adjusted.range_min;
    adjusted.range_min = adjusted.range_max;
    adjusted.range_max = tmp;
  }

  return adjusted;
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
      temperature: 0.15,
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

  const uncertainPoints = dedupeLines(result?.uncertain_points || []);
  const confirmationQuestions = dedupeLines(result?.confirmation_questions || []);

  if (uncertainPoints.length) {
    text += '\n\n確認したい点:\n';
    text += uncertainPoints.map((x) => `・${x}`).join('\n');
  }

  if (confirmationQuestions.length) {
    text += '\n\n';
    text += confirmationQuestions.map((x) => `・${x}`).join('\n');
  }

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
