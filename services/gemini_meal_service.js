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

function roundGram(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  return Math.round(n * 10) / 10;
}

function safeText(value, max = 200) {
  return String(value || '').trim().slice(0, max);
}

function normalizeItem(raw) {
  const geminiName = safeText(raw?.name || raw?.item_name || '', 120) || '不明な食品';
  const qtyText = safeText(raw?.qty_text || raw?.qtyText || raw?.estimated_amount || '', 80) || '1つ';
  const estimatedKcal = roundKcal(raw?.estimated_kcal ?? raw?.estimatedKcal ?? 0);
  const confidence = clampNumber(raw?.confidence ?? 0.7, 0, 1, 0.7);
  const isMainSubject = Boolean(raw?.is_main_subject ?? raw?.isMainSubject ?? true);

  return {
    name: geminiName,
    qty_text: qtyText,
    estimated_kcal: Math.max(0, estimatedKcal),
    confidence,
    is_main_subject: isMainSubject,
    gemini_original_name: geminiName,
  };
}

function buildMealVisionPrompt() {
  return `
あなたは食事画像の解析エンジンです。
目的は、写真に写っている主被写体の食事・飲み物を現実的に推定し、Geminiが判断した具体的な食材名・商品名をできるだけそのまま保持することです。

最重要ルール:
1. 食材名・料理名・商品名は、一般名に丸めすぎず、見えたまま具体的に返すこと。
2. 具体名に自信がある場合は、貝・魚・パンなどの一般名へ戻さないこと。
3. 主被写体を最優先で判定すること。
4. 背景にある食品・飲料は自動で摂取扱いにしないこと。
5. 見えない量を過大に補完しないこと。
6. 推定カロリーは上限寄りではなく中央値寄りで返すこと。
7. 不明点があれば uncertain_points と confirmation_questions に入れること。
8. 飲み物の種類や砂糖の有無が曖昧なら、勝手に高カロリー寄りにしないこと。
9. ソース・ドレッシング・砂糖・シロップは、明確に確認できる時だけ加算すること。
10. たんぱく質・脂質・糖質も現実的な目安で返すこと。
11. 必ずJSONのみを返すこと。説明文は禁止。

具体名優先の例:
- ボンビノス貝 / ホンビノス貝 / プレミアムチョコクロ / サーモン刺身 / 焼きおにぎり
- 具体名候補がかなり有力なら、ハマグリ、白身魚、パン、お菓子、飲み物 のような一般名へ丸めないこと
- 断定しきれない場合のみ「○○の可能性が高い」「○○系」とすること

刺身の扱い:
- サーモンが明確なら、別の白身魚を自動追加しないこと
- 白っぽい部分は、反射、氷、縁、つまの可能性を先に考えること
- 別魚種を追加するのは、明確に別の切り身群が確認できる時だけ

貝の扱い:
- 大ぶりの白貝系は、見た目や文脈から具体名候補が強いならそれを優先すること
- Geminiがボンビノス貝 / ホンビノス貝と判断できる場合は、その名前を保持すること
- 無難な一般名に逃がしすぎないこと

出力要件:
- meal_label: 写真全体の料理名
- items: 配列
- 各itemは name, qty_text, estimated_kcal, confidence, is_main_subject を持つ
- total_kcal は主被写体のみの合計
- range_min, range_max は妥当な推定幅
- protein_g, fat_g, carbs_g は料理全体の目安
- uncertain_points は曖昧点
- needs_confirmation は true/false
- confirmation_questions は必要時のみ質問を入れる
- ai_comment は短い補足文

日本語で判定してください。
JSON以外は絶対に返さないでください。
`.trim();
}

function buildMealTextPrompt(userText) {
  return `
あなたは食事テキスト解析エンジンです。
利用者の文章から、実際に食べた・飲んだ内容だけを整理して、自然で現実的な推定を行ってください。

最重要ルール:
1. 「食べたい」「飲みたい」「どうかな」「大丈夫かな」など、願望・相談・質問は食事記録として扱わないこと。
2. 実際に食べた・飲んだ記録なら is_meal = true、そうでなければ is_meal = false。
3. 「今朝」「朝食」「昼食」「夕食」「AM4時半」などの時間情報があれば meal_label の参考にしてよい。
4. 食材名は具体的に残すこと。一般名に丸めすぎないこと。
5. カロリーは中央値寄り。過大推定しないこと。
6. たんぱく質・脂質・糖質は現実的な目安で返すこと。
7. 量が曖昧なら uncertain_points と confirmation_questions に入れること。
8. コメントは短く自然に。定型的すぎないこと。
9. 必ずJSONのみを返すこと。

利用者メッセージ:
${userText}
`.trim();
}

function buildMealCorrectionPrompt(currentMeal, correctionText) {
  const summary = {
    meal_label: currentMeal?.meal_label || '食事',
    estimated_kcal: currentMeal?.estimated_kcal ?? null,
    kcal_min: currentMeal?.kcal_min ?? null,
    kcal_max: currentMeal?.kcal_max ?? null,
    protein_g: currentMeal?.protein_g ?? null,
    fat_g: currentMeal?.fat_g ?? null,
    carbs_g: currentMeal?.carbs_g ?? null,
    food_items: Array.isArray(currentMeal?.food_items) ? currentMeal.food_items : [],
    ai_comment: currentMeal?.ai_comment || '',
  };

  return `
あなたは食事記録の訂正再計算エンジンです。
これは新規の食事記録ではありません。必ず「現在の食事案」を土台にして、利用者の訂正文だけを反映してください。

最重要ルール:
1. 今回は新規記録禁止。必ず既存の food_items を残したまま必要部分だけ修正すること。
2. 利用者の訂正が飲み物だけなら、飲み物だけを修正し、他の食品は消さないこと。
3. 利用者の訂正が個数・杯数・量なら、その対象項目だけ更新すること。
4. 訂正文に出ていない他の食品を勝手に削除しないこと。
5. 料理名を Beverage / Drink だけにしないこと。元の meal_label をできるだけ維持すること。
6. 飲み物の種類、個数、量、塗った量、トッピング有無は訂正文を反映すること。
7. 量が減る訂正ならカロリーも下げること。量が増える訂正ならカロリーも上げること。
8. 名前は具体的に保つこと。
9. 不確実な点は uncertain_points と confirmation_questions に残すこと。
10. コメントは短く自然に。
11. 必ずJSONのみを返すこと。

特に重要:
- 既存が「パイ + コーヒー」で、訂正文が「ブラックコーヒー2杯です」の場合、
  結果は「パイ + ブラックコーヒー2杯」のままにすること。
- 既存にご飯があり、訂正文が「ご飯半分」「ご飯少なめ」「ご飯多め」の場合、
  ご飯項目の量とカロリーだけを修正すること。
- 訂正文が「味噌汁追加」「お茶」「水」「ノンアル」「2個です」のような短文でも、
  現在の食事案に対する差分訂正として解釈すること。
- 訂正文だけを独立した新しい食事として解釈してはいけない。

現在の食事案:
${JSON.stringify(summary, null, 2)}

利用者の訂正文:
${correctionText}
`.trim();
}

function getMealResponseSchema() {
  return {
    type: 'object',
    properties: {
      meal_label: { type: 'string' },
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
      protein_g: { type: 'number' },
      fat_g: { type: 'number' },
      carbs_g: { type: 'number' },
      uncertain_points: {
        type: 'array',
        items: { type: 'string' },
      },
      needs_confirmation: { type: 'boolean' },
      confirmation_questions: {
        type: 'array',
        items: { type: 'string' },
      },
      ai_comment: { type: 'string' },
    },
    required: [
      'meal_label',
      'items',
      'total_kcal',
      'range_min',
      'range_max',
      'protein_g',
      'fat_g',
      'carbs_g',
      'uncertain_points',
      'needs_confirmation',
      'confirmation_questions',
      'ai_comment',
    ],
  };
}

function getMealTextResponseSchema() {
  return {
    type: 'object',
    properties: {
      is_meal: { type: 'boolean' },
      meal_label: { type: 'string' },
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
      protein_g: { type: 'number' },
      fat_g: { type: 'number' },
      carbs_g: { type: 'number' },
      uncertain_points: {
        type: 'array',
        items: { type: 'string' },
      },
      needs_confirmation: { type: 'boolean' },
      confirmation_questions: {
        type: 'array',
        items: { type: 'string' },
      },
      ai_comment: { type: 'string' },
    },
    required: [
      'is_meal',
      'meal_label',
      'items',
      'total_kcal',
      'range_min',
      'range_max',
      'protein_g',
      'fat_g',
      'carbs_g',
      'uncertain_points',
      'needs_confirmation',
      'confirmation_questions',
      'ai_comment',
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

  return /カフェオレ|ミルクティー|ラテ|飲み物|マグカップ|コップ|紅茶|お茶|水|コーヒー/.test(text);
}

function looksLikeLightSnack(itemNamesText) {
  return /ナゲット|バウム|バーム|クッキー|ドーナツ|お菓子|菓子|ケーキ|パン|カフェオレ|ラテ|ミルクティー|コーヒー|紅茶|お茶|ジュース|青汁|パイ/.test(
    itemNamesText
  );
}

function looksSpecificName(name) {
  const t = String(name || '');
  if (!t) return false;
  return /ホンビノス|ボンビノス|プレミアムチョコクロ|サーモン刺身|焼きおにぎり|フレンチトースト/.test(t);
}

function keepGeminiNames(items) {
  return (items || []).map((item) => ({
    ...item,
    name: safeText(item.gemini_original_name || item.name || '不明な食品', 120) || '不明な食品',
  }));
}

function legacyFoodItemsToNormalizedItems(foodItems = []) {
  return (foodItems || []).map((item) => {
    const name = safeText(item?.name || '不明な食品', 120) || '不明な食品';
    return {
      name,
      qty_text: safeText(item?.estimated_amount || item?.qty_text || '1つ', 80) || '1つ',
      estimated_kcal: Math.max(0, roundKcal(item?.estimated_kcal ?? 0)),
      confidence: clampNumber(item?.confidence ?? 0.9, 0, 1, 0.9),
      is_main_subject: true,
      gemini_original_name: name,
    };
  });
}

function rebuildTotalsFromItems(result) {
  const items = keepGeminiNames(Array.isArray(result?.items) ? result.items : []);
  const total = items
    .filter((item) => item.is_main_subject)
    .reduce((sum, item) => sum + (Number(item.estimated_kcal) || 0), 0);

  return {
    ...result,
    items,
    total_kcal: total,
    range_min: Math.max(0, Math.round(total * 0.85)),
    range_max: Math.max(Math.round(total * 1.15), Math.round(total + 20)),
  };
}

function findItemIndexByPatterns(items, patterns) {
  return items.findIndex((item) => {
    const name = String(item?.name || '');
    return patterns.some((pattern) => pattern.test(name));
  });
}

function scaleMacro(value, ratio) {
  const n = Number(value);
  if (!Number.isFinite(n)) return value ?? null;
  return roundGram(n * ratio);
}

function maybeScaleMacrosFromTotal(previousMeal, nextTotal) {
  const prevTotal = Number(previousMeal?.estimated_kcal);
  if (!Number.isFinite(prevTotal) || prevTotal <= 0) {
    return {
      protein_g: previousMeal?.protein_g ?? null,
      fat_g: previousMeal?.fat_g ?? null,
      carbs_g: previousMeal?.carbs_g ?? null,
    };
  }

  const ratio = Math.max(0.4, Math.min(1.6, nextTotal / prevTotal));

  return {
    protein_g: scaleMacro(previousMeal?.protein_g, ratio),
    fat_g: scaleMacro(previousMeal?.fat_g, ratio),
    carbs_g: scaleMacro(previousMeal?.carbs_g, ratio),
  };
}

function buildBaseItemsForShortCorrection(previousMeal, result) {
  const prevItems = legacyFoodItemsToNormalizedItems(previousMeal?.food_items || []);
  if (prevItems.length) return prevItems;

  const resultItems = keepGeminiNames(Array.isArray(result?.items) ? result.items : []);
  return resultItems;
}

function applySimpleJapaneseCorrectionGuard(result, previousMeal, correctionText) {
  const rawCorrection = String(correctionText || '').trim();
  const compact = rawCorrection.replace(/\s+/g, '').replace(/[。．]/g, '');
  if (!compact) return result;

  const isShortRiceCorrection =
    /^ご飯半分$/.test(compact) ||
    /^ごはん半分$/.test(compact) ||
    /^ご飯少なめ$/.test(compact) ||
    /^ごはん少なめ$/.test(compact) ||
    /^ご飯多め$/.test(compact) ||
    /^ごはん多め$/.test(compact) ||
    /ご飯は半分です/.test(rawCorrection) ||
    /ごはんは半分です/.test(rawCorrection) ||
    /ご飯は少なめです/.test(rawCorrection) ||
    /ごはんは少なめです/.test(rawCorrection) ||
    /ご飯は多めです/.test(rawCorrection) ||
    /ごはんは多めです/.test(rawCorrection);

  const isShortAddOrDrinkCorrection =
    /^味噌汁追加$/.test(compact) ||
    /^みそ汁追加$/.test(compact) ||
    /味噌汁を追加/.test(rawCorrection) ||
    /みそ汁を追加/.test(rawCorrection) ||
    /^お茶$/.test(compact) ||
    /^水$/.test(compact) ||
    /^ノンアル$/.test(compact) ||
    /飲み物はお茶です/.test(rawCorrection) ||
    /飲み物は水です/.test(rawCorrection) ||
    /飲み物はノンアルです/.test(rawCorrection) ||
    /^(\d+)個(?:です)?$/.test(compact);

  const mustUsePreviousMealAsBase = isShortRiceCorrection || isShortAddOrDrinkCorrection;

  let baseItems = buildBaseItemsForShortCorrection(previousMeal, result);
  if (!baseItems.length) {
    return result;
  }

  let working = {
    ...result,
    items: keepGeminiNames(baseItems),
    meal_label: safeText(previousMeal?.meal_label || result?.meal_label || '食事', 100),
    total_kcal: Number(previousMeal?.estimated_kcal ?? result?.total_kcal ?? 0) || 0,
    range_min: Number(previousMeal?.kcal_min ?? result?.range_min ?? 0) || 0,
    range_max: Number(previousMeal?.kcal_max ?? result?.range_max ?? 0) || 0,
    protein_g: previousMeal?.protein_g ?? result?.protein_g ?? null,
    fat_g: previousMeal?.fat_g ?? result?.fat_g ?? null,
    carbs_g: previousMeal?.carbs_g ?? result?.carbs_g ?? null,
    uncertain_points: dedupeLines(result?.uncertain_points || []),
    confirmation_questions: [],
    needs_confirmation: false,
    ai_comment: '訂正内容を反映しました。',
  };

  const items = [...working.items];
  let changed = false;

  const ricePatterns = [/ご飯/, /ごはん/, /ライス/, /白米/, /米/];
  const soupPatterns = [/味噌汁/, /みそ汁/];
  const drinkPatterns = [/コーヒー/, /珈琲/, /カフェオレ/, /ラテ/, /紅茶/, /お茶/, /水/, /ドリンク/, /飲み物/, /ジュース/, /青汁/, /ノンアル/];

  const riceIndex = findItemIndexByPatterns(items, ricePatterns);

  if (riceIndex >= 0 && (/^ご飯半分$/.test(compact) || /^ごはん半分$/.test(compact) || /ご飯は半分です/.test(rawCorrection) || /ごはんは半分です/.test(rawCorrection))) {
    const originalKcal = Number(items[riceIndex].estimated_kcal) || 0;
    items[riceIndex] = {
      ...items[riceIndex],
      qty_text: '半分',
      estimated_kcal: Math.max(0, roundKcal(originalKcal * 0.5)),
      confidence: Math.max(Number(items[riceIndex].confidence || 0), 0.95),
    };
    changed = true;
  }

  if (riceIndex >= 0 && (/^ご飯少なめ$/.test(compact) || /^ごはん少なめ$/.test(compact) || /ご飯は少なめです/.test(rawCorrection) || /ごはんは少なめです/.test(rawCorrection))) {
    const originalKcal = Number(items[riceIndex].estimated_kcal) || 0;
    items[riceIndex] = {
      ...items[riceIndex],
      qty_text: '少なめ',
      estimated_kcal: Math.max(0, roundKcal(originalKcal * 0.7)),
      confidence: Math.max(Number(items[riceIndex].confidence || 0), 0.95),
    };
    changed = true;
  }

  if (riceIndex >= 0 && (/^ご飯多め$/.test(compact) || /^ごはん多め$/.test(compact) || /ご飯は多めです/.test(rawCorrection) || /ごはんは多めです/.test(rawCorrection))) {
    const originalKcal = Number(items[riceIndex].estimated_kcal) || 0;
    items[riceIndex] = {
      ...items[riceIndex],
      qty_text: '多め',
      estimated_kcal: Math.max(0, roundKcal(originalKcal * 1.3)),
      confidence: Math.max(Number(items[riceIndex].confidence || 0), 0.95),
    };
    changed = true;
  }

  if (/^味噌汁追加$/.test(compact) || /^みそ汁追加$/.test(compact) || /味噌汁を追加/.test(rawCorrection) || /みそ汁を追加/.test(rawCorrection)) {
    const soupIndex = findItemIndexByPatterns(items, soupPatterns);
    if (soupIndex >= 0) {
      const originalKcal = Number(items[soupIndex].estimated_kcal) || 35;
      items[soupIndex] = {
        ...items[soupIndex],
        qty_text: items[soupIndex].qty_text || '1杯',
        estimated_kcal: Math.max(originalKcal, 35),
        confidence: Math.max(Number(items[soupIndex].confidence || 0), 0.95),
      };
    } else {
      items.push({
        name: '味噌汁',
        qty_text: '1杯',
        estimated_kcal: 35,
        confidence: 0.95,
        is_main_subject: true,
        gemini_original_name: '味噌汁',
      });
    }
    changed = true;
  }

  if (/^お茶$/.test(compact) || /飲み物はお茶です/.test(rawCorrection)) {
    const drinkIndex = findItemIndexByPatterns(items, drinkPatterns);
    if (drinkIndex >= 0) {
      items[drinkIndex] = {
        ...items[drinkIndex],
        name: 'お茶',
        gemini_original_name: 'お茶',
        qty_text: items[drinkIndex].qty_text || '1杯',
        estimated_kcal: 0,
        confidence: 0.98,
      };
    } else {
      items.push({
        name: 'お茶',
        qty_text: '1杯',
        estimated_kcal: 0,
        confidence: 0.98,
        is_main_subject: true,
        gemini_original_name: 'お茶',
      });
    }
    changed = true;
  }

  if (/^水$/.test(compact) || /飲み物は水です/.test(rawCorrection)) {
    const drinkIndex = findItemIndexByPatterns(items, drinkPatterns);
    if (drinkIndex >= 0) {
      items[drinkIndex] = {
        ...items[drinkIndex],
        name: '水',
        gemini_original_name: '水',
        qty_text: items[drinkIndex].qty_text || '1杯',
        estimated_kcal: 0,
        confidence: 0.98,
      };
    } else {
      items.push({
        name: '水',
        qty_text: '1杯',
        estimated_kcal: 0,
        confidence: 0.98,
        is_main_subject: true,
        gemini_original_name: '水',
      });
    }
    changed = true;
  }

  if (/^ノンアル$/.test(compact) || /飲み物はノンアルです/.test(rawCorrection)) {
    const drinkIndex = findItemIndexByPatterns(items, drinkPatterns);
    if (drinkIndex >= 0) {
      items[drinkIndex] = {
        ...items[drinkIndex],
        name: 'ノンアル',
        gemini_original_name: 'ノンアル',
        qty_text: items[drinkIndex].qty_text || '1本',
        estimated_kcal: Math.min(Number(items[drinkIndex].estimated_kcal) || 15, 15),
        confidence: 0.97,
      };
    } else {
      items.push({
        name: 'ノンアル',
        qty_text: '1本',
        estimated_kcal: 15,
        confidence: 0.97,
        is_main_subject: true,
        gemini_original_name: 'ノンアル',
      });
    }
    changed = true;
  }

  const countMatch = compact.match(/^(\d+)個(?:です)?$/);
  if (countMatch) {
    const count = Math.max(1, Number(countMatch[1]));
    const nonDrinkIndexes = items
      .map((item, index) => ({ item, index }))
      .filter(({ item }) => !drinkPatterns.some((pattern) => pattern.test(String(item?.name || ''))));

    if (nonDrinkIndexes.length) {
      const targetIndex = nonDrinkIndexes[nonDrinkIndexes.length - 1].index;
      const currentKcal = Number(items[targetIndex].estimated_kcal) || 0;
      const currentQtyText = String(items[targetIndex].qty_text || '');
      const baseCountMatch = currentQtyText.match(/(\d+)個/);
      const baseCount = baseCountMatch ? Math.max(1, Number(baseCountMatch[1])) : 1;
      const perItemKcal = baseCount > 0 ? currentKcal / baseCount : currentKcal;

      items[targetIndex] = {
        ...items[targetIndex],
        qty_text: `${count}個`,
        estimated_kcal: Math.max(0, roundKcal(perItemKcal * count)),
        confidence: Math.max(Number(items[targetIndex].confidence || 0), 0.95),
      };
      changed = true;
    }
  }

  if (!changed) {
    return result;
  }

  const next = rebuildTotalsFromItems({
    ...working,
    items,
  });

  if (mustUsePreviousMealAsBase) {
    const scaled = maybeScaleMacrosFromTotal(previousMeal, Number(next.total_kcal) || 0);
    next.protein_g = scaled.protein_g;
    next.fat_g = scaled.fat_g;
    next.carbs_g = scaled.carbs_g;
  }

  return next;
}

function applyUncertainDrinkAdjustment(result) {
  const items = Array.isArray(result.items) ? keepGeminiNames(result.items) : [];
  const uncertainDrink = hasUncertainDrink(result);
  if (!uncertainDrink) return { ...result, items };

  const adjustedItems = items.map((item) => {
    const name = String(item.name || '');
    const isDrinkLike = /カフェオレ|ミルクティー|ラテ|コーヒー|紅茶|お茶|水|ドリンク|飲み物|青汁/.test(name);

    if (!isDrinkLike) return item;

    const current = Number(item.estimated_kcal) || 0;

    if (current <= 0) {
      return { ...item, estimated_kcal: 10 };
    }

    if (current > 95) {
      return { ...item, estimated_kcal: 80 };
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
    range_max: Math.max(Math.round(newTotal * 1.18), Math.round(newTotal + 70)),
  };
}

function applyLightSnackCap(result) {
  const mainItems = (result.items || []).filter((item) => item.is_main_subject);
  const namesText = mainItems.map((item) => item.name).join(' / ');
  const isLightSnack = looksLikeLightSnack(namesText) && mainItems.length <= 5;

  if (!isLightSnack) return { ...result, items: keepGeminiNames(result.items) };

  let total = Number(result.total_kcal) || 0;
  let changed = false;

  if (hasUncertainDrink(result) && total > 430) {
    total = 390;
    changed = true;
  } else if (total > 520) {
    total = Math.round(total * 0.78);
    changed = true;
  }

  if (!changed) return { ...result, items: keepGeminiNames(result.items) };

  const rangeMin = Math.max(0, Math.round(total * 0.82));
  const rangeMax = Math.max(rangeMin + 40, Math.round(total * 1.18));

  const notes = Array.isArray(result.uncertain_points) ? [...result.uncertain_points] : [];
  if (!notes.some((x) => x.includes('軽食'))) {
    notes.unshift('軽食としては高めに出やすいため、控えめ寄りに再調整しています');
  }

  return {
    ...result,
    items: keepGeminiNames(result.items),
    total_kcal: total,
    range_min: rangeMin,
    range_max: rangeMax,
    uncertain_points: notes,
    needs_confirmation: true,
  };
}

function applySashimiSpecificGuard(result) {
  const items = keepGeminiNames(result.items || []);
  const mainItems = items.filter((item) => item.is_main_subject);
  const names = mainItems.map((item) => item.name).join(' / ');

  const hasSalmon = /サーモン/.test(names);
  const hasWhiteFish = /白身魚|鯛|ヒラメ/.test(names);

  if (!hasSalmon || !hasWhiteFish) {
    return { ...result, items };
  }

  const strongSpecific = mainItems.some((item) => looksSpecificName(item.name));
  const whiteFishLowConfidence = mainItems.some(
    (item) => /白身魚|鯛|ヒラメ/.test(item.name) && Number(item.confidence || 0) < 0.88
  );

  if (!strongSpecific && whiteFishLowConfidence) {
    const filtered = items.filter((item) => !(/白身魚|鯛|ヒラメ/.test(item.name) && item.is_main_subject));
    const filteredMain = filtered.filter((item) => item.is_main_subject);
    const newTotal = filteredMain.reduce((sum, item) => sum + (Number(item.estimated_kcal) || 0), 0);
    const notes = dedupeLines([
      '刺身は別魚種を自動追加しやすいため、低信頼の白身魚候補を外しています',
      ...(result.uncertain_points || []),
    ]);

    return {
      ...result,
      items: filtered,
      total_kcal: newTotal,
      range_min: Math.max(0, Math.round(newTotal * 0.85)),
      range_max: Math.max(Math.round(newTotal * 1.18), Math.round(newTotal + 25)),
      uncertain_points: notes,
      needs_confirmation: true,
    };
  }

  return { ...result, items };
}

function applyTextMealGuards(result) {
  const adjusted = {
    ...result,
    items: keepGeminiNames(Array.isArray(result.items) ? result.items : []),
    uncertain_points: dedupeLines(result.uncertain_points),
    confirmation_questions: dedupeLines(result.confirmation_questions),
  };

  const mainItems = adjusted.items.filter((item) => item.is_main_subject);
  const namesText = mainItems.map((item) => item.name).join(' / ');

  if (/食パン/.test(namesText) && /ピーナッツバター/.test(namesText)) {
    const breadItem = mainItems.find((item) => /食パン|パン/.test(item.name));
    const butterItem = mainItems.find((item) => /ピーナッツバター/.test(item.name));
    const drinkItem = mainItems.find((item) => /青汁|お茶|コーヒー|紅茶|水/.test(item.name));

    const breadKcal = breadItem ? Math.min(Math.max(Number(breadItem.estimated_kcal) || 120, 110), 170) : 0;
    const butterKcal = butterItem ? Math.min(Math.max(Number(butterItem.estimated_kcal) || 60, 35), 120) : 0;
    const drinkKcal = drinkItem ? Math.min(Math.max(Number(drinkItem.estimated_kcal) || 15, 0), 40) : 0;

    const total = breadKcal + butterKcal + drinkKcal;
    adjusted.total_kcal = total;
    adjusted.range_min = Math.max(0, Math.round(total * 0.85));
    adjusted.range_max = Math.max(adjusted.range_min + 20, Math.round(total * 1.18));
  }

  return adjusted;
}

function applyCoffeePairCorrectionGuard(result, previousMeal, correctionText) {
  const prevItems = Array.isArray(previousMeal?.food_items) ? previousMeal.food_items : [];
  if (!prevItems.length) return result;

  const correction = String(correctionText || '').trim();
  if (!/コーヒー|珈琲|ブラック/.test(correction)) return result;

  const prevNames = prevItems.map((x) => String(x?.name || ''));
  const prevHasCoffee = prevNames.some((name) => /コーヒー|珈琲|ラテ|カフェオレ/.test(name));
  const prevHasFood = prevNames.some((name) => !/コーヒー|珈琲|ラテ|カフェオレ|紅茶|お茶|水|ドリンク|飲み物/.test(name));

  if (!prevHasCoffee || !prevHasFood) return result;

  const newItems = Array.isArray(result?.items) ? result.items : [];
  const becameDrinkOnly =
    newItems.length > 0 &&
    newItems.every((item) => /コーヒー|珈琲|ラテ|カフェオレ|紅茶|お茶|水|ドリンク|飲み物/.test(String(item?.name || '')));

  const mealLabel = String(result?.meal_label || '');
  const badMealLabel = /^beverage$|^drink$/i.test(mealLabel) || mealLabel === 'Beverage' || mealLabel === 'Drink';

  if (!becameDrinkOnly && !badMealLabel) return result;

  const cupMatch = correction.match(/(\d+)\s*杯/);
  const cupCount = cupMatch ? Math.max(1, Number(cupMatch[1])) : null;

  const rebuiltItems = [];
  for (const prev of prevItems) {
    const prevName = safeText(prev?.name || '不明な食品', 120);
    const prevQty = safeText(prev?.estimated_amount || '1つ', 80);
    const prevKcal = roundKcal(prev?.estimated_kcal ?? 0);
    const prevConf = clampNumber(prev?.confidence ?? 0.9, 0, 1, 0.9);
    const isCoffee = /コーヒー|珈琲|ラテ|カフェオレ/.test(prevName);

    if (isCoffee) {
      const qtyText = cupCount ? `${cupCount}杯` : 'ブラックコーヒー';
      const kcal = cupCount ? cupCount * 4 : 4;
      rebuiltItems.push({
        name: /ブラック/.test(correction) ? 'ブラックコーヒー' : prevName,
        qty_text: qtyText,
        estimated_kcal: kcal,
        confidence: 0.95,
        is_main_subject: true,
        gemini_original_name: /ブラック/.test(correction) ? 'ブラックコーヒー' : prevName,
      });
    } else {
      rebuiltItems.push({
        name: prevName,
        qty_text: prevQty,
        estimated_kcal: prevKcal,
        confidence: prevConf,
        is_main_subject: true,
        gemini_original_name: prevName,
      });
    }
  }

  const total = rebuiltItems.reduce((sum, item) => sum + (Number(item.estimated_kcal) || 0), 0);

  return {
    ...result,
    meal_label: previousMeal?.meal_label || result.meal_label || '食事',
    items: rebuiltItems,
    total_kcal: total,
    range_min: Math.max(0, Math.round(total * 0.96)),
    range_max: Math.max(Math.round(total * 1.05), Math.round(total + 3)),
    protein_g: result?.protein_g ?? previousMeal?.protein_g ?? null,
    fat_g: result?.fat_g ?? previousMeal?.fat_g ?? null,
    carbs_g: result?.carbs_g ?? previousMeal?.carbs_g ?? null,
    uncertain_points: dedupeLines(result?.uncertain_points || []),
    confirmation_questions: dedupeLines(result?.confirmation_questions || []),
    ai_comment: 'コーヒーだけ訂正して、他の食事はそのまま残しました。',
    needs_confirmation: false,
  };
}

function applyLocalMealGuards(result) {
  let adjusted = {
    ...result,
    items: keepGeminiNames(Array.isArray(result.items) ? result.items : []),
    uncertain_points: dedupeLines(result.uncertain_points),
    confirmation_questions: dedupeLines(result.confirmation_questions),
  };

  adjusted = applySashimiSpecificGuard(adjusted);
  adjusted = applyUncertainDrinkAdjustment(adjusted);
  adjusted = applyLightSnackCap(adjusted);
  adjusted = applyTextMealGuards(adjusted);

  const mainItems = adjusted.items.filter((item) => item.is_main_subject);
  const mainNames = mainItems.map((item) => item.name).join(' / ');
  const total = Number(adjusted.total_kcal) || 0;

  const hasLightSnackPattern = looksLikeLightSnack(mainNames) && mainItems.length <= 5;

  if (hasLightSnackPattern && total >= 550) {
    adjusted.uncertain_points.unshift('軽食の見た目に対して推定カロリーが高めのため再確認が必要です');
    adjusted.needs_confirmation = true;
    adjusted.total_kcal = Math.round(total * 0.75);
    adjusted.range_min = Math.min(adjusted.range_min, Math.round(adjusted.total_kcal * 0.85));
    adjusted.range_max = Math.max(adjusted.range_max, Math.round(adjusted.total_kcal * 1.2));
  }

  if (adjusted.range_max - adjusted.range_min > 260) {
    adjusted.uncertain_points.unshift('推定幅が広いため、飲み物や量の確認で精度が上がります');
    adjusted.needs_confirmation = true;
    adjusted.range_max = Math.round(adjusted.total_kcal * 1.18);
    adjusted.range_min = Math.round(adjusted.total_kcal * 0.82);
  }

  adjusted.items = keepGeminiNames(adjusted.items);
  adjusted.uncertain_points = dedupeLines(adjusted.uncertain_points);
  adjusted.confirmation_questions = dedupeLines(adjusted.confirmation_questions);

  if (adjusted.range_min > adjusted.range_max) {
    const tmp = adjusted.range_min;
    adjusted.range_min = adjusted.range_max;
    adjusted.range_max = tmp;
  }

  return adjusted;
}

function normalizeGeminiMealResult(raw) {
  const items = Array.isArray(raw?.items) ? raw.items.map(normalizeItem) : [];

  const normalized = {
    meal_label: safeText(raw?.meal_label || raw?.mealLabel || '', 100),
    items,
    total_kcal: roundKcal(raw?.total_kcal ?? raw?.totalKcal ?? 0),
    range_min: roundKcal(raw?.range_min ?? raw?.rangeMin ?? 0),
    range_max: roundKcal(raw?.range_max ?? raw?.rangeMax ?? 0),
    protein_g: roundGram(raw?.protein_g),
    fat_g: roundGram(raw?.fat_g),
    carbs_g: roundGram(raw?.carbs_g),
    uncertain_points: Array.isArray(raw?.uncertain_points)
      ? raw.uncertain_points.map((x) => safeText(x, 160)).filter(Boolean)
      : [],
    needs_confirmation: Boolean(raw?.needs_confirmation),
    confirmation_questions: Array.isArray(raw?.confirmation_questions)
      ? raw.confirmation_questions.map((x) => safeText(x, 160)).filter(Boolean)
      : [],
    ai_comment: safeText(raw?.ai_comment || '', 200),
    raw_json: raw || {},
  };

  const mainItems = normalized.items.filter((item) => item.is_main_subject);
  const computedMainTotal = mainItems.reduce((sum, item) => sum + (Number(item.estimated_kcal) || 0), 0);

  if (!normalized.meal_label) {
    normalized.meal_label = safeText(mainItems.map((item) => item.name).join(' / '), 100) || '食事';
  }

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
      normalized.uncertain_points.length > 0 ||
      normalized.confirmation_questions.length > 0;
  }

  return applyLocalMealGuards(normalized);
}

function buildLegacyMealFromNormalized(normalized, extra = {}) {
  const mainItems = (normalized.items || []).filter((item) => item.is_main_subject);

  const foodItems = mainItems.map((item) => ({
    name: safeText(item.name || '不明な食品', 80),
    estimated_amount: safeText(item.qty_text || '1つ', 80),
    estimated_kcal: Number(item.estimated_kcal) || 0,
    category: null,
    confidence: Number(item.confidence) || 0.7,
    needs_confirmation: Boolean(normalized.needs_confirmation),
  }));

  const uncertainPoints = Array.isArray(normalized.uncertain_points)
    ? normalized.uncertain_points.filter(Boolean)
    : [];

  const confirmationQuestions = Array.isArray(normalized.confirmation_questions)
    ? normalized.confirmation_questions.filter(Boolean)
    : [];

  const commentBase = safeText(normalized.ai_comment || '', 200);
  const commentLines = [];

  if (commentBase) {
    commentLines.push(commentBase);
  }

  if (uncertainPoints.length) {
    commentLines.push('確認したい点:');
    commentLines.push(...uncertainPoints.slice(0, 2).map((x) => `・${x}`));
  }

  if (confirmationQuestions.length) {
    commentLines.push(...confirmationQuestions.slice(0, 2).map((x) => `・${x}`));
  }

  return {
    is_meal: extra.is_meal !== false,
    meal_label: safeText(normalized.meal_label || '食事', 100),
    food_items: foodItems,
    estimated_kcal: Number(normalized.total_kcal) || 0,
    kcal_min: Number(normalized.range_min) || 0,
    kcal_max: Number(normalized.range_max) || 0,
    protein_g: normalized.protein_g ?? null,
    fat_g: normalized.fat_g ?? null,
    carbs_g: normalized.carbs_g ?? null,
    confidence: Math.max(
      0.55,
      mainItems.length
        ? Math.round(
            (mainItems.reduce((sum, item) => sum + (Number(item.confidence) || 0.7), 0) / mainItems.length) * 100
          ) / 100
        : 0.75
    ),
    uncertainty_notes: uncertainPoints,
    confirmation_questions: confirmationQuestions,
    ai_comment: safeText(commentLines.join('\n') || '食事内容を整理しました。', 1000),
    raw_model_json: {
      source: extra.source || 'gemini_meal_service',
      gemini_result: normalized,
      correction_text: extra.correction_text || null,
      original_text: extra.original_text || null,
    },
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

async function callGeminiJson({
  prompt,
  schema,
  inlineData = null,
  apiKey = process.env.GEMINI_API_KEY,
  model = process.env.GEMINI_MEAL_MODEL || 'gemini-2.5-flash',
  timeoutMs = DEFAULT_TIMEOUT_MS,
  temperature = 0.15,
}) {
  if (!apiKey) {
    throw new Error('GEMINI_API_KEY が未設定です');
  }

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;

  const parts = [{ text: prompt }];
  if (inlineData?.data) {
    parts.push({
      inline_data: {
        mime_type: inlineData.mimeType || 'image/jpeg',
        data: inlineData.data,
      },
    });
  }

  const body = {
    contents: [
      {
        parts,
      },
    ],
    generationConfig: {
      temperature,
      responseMimeType: 'application/json',
      responseSchema: schema,
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

  return parsed;
}

async function analyzeMealPhotoWithGemini({
  base64Image,
  mimeType = 'image/jpeg',
  apiKey = process.env.GEMINI_API_KEY,
  model = process.env.GEMINI_MEAL_MODEL || 'gemini-2.5-flash',
  timeoutMs = DEFAULT_TIMEOUT_MS,
}) {
  if (!base64Image) {
    throw new Error('base64Image が空です');
  }

  const parsed = await callGeminiJson({
    prompt: buildMealVisionPrompt(),
    schema: getMealResponseSchema(),
    inlineData: {
      mimeType,
      data: base64Image,
    },
    apiKey,
    model,
    timeoutMs,
    temperature: 0.15,
  });

  return normalizeGeminiMealResult(parsed);
}

async function analyzeMealTextWithGemini(
  userText,
  {
    apiKey = process.env.GEMINI_API_KEY,
    model = process.env.GEMINI_MEAL_MODEL || 'gemini-2.5-flash',
    timeoutMs = DEFAULT_TIMEOUT_MS,
  } = {}
) {
  const parsed = await callGeminiJson({
    prompt: buildMealTextPrompt(userText),
    schema: getMealTextResponseSchema(),
    apiKey,
    model,
    timeoutMs,
    temperature: 0.2,
  });

  if (!parsed?.is_meal) {
    return {
      is_meal: false,
      meal_label: '',
      food_items: [],
      estimated_kcal: 0,
      kcal_min: 0,
      kcal_max: 0,
      protein_g: null,
      fat_g: null,
      carbs_g: null,
      confidence: 0,
      uncertainty_notes: [],
      confirmation_questions: [],
      ai_comment: safeText(parsed?.ai_comment || '食事記録ではないと判断しました。', 200),
      raw_model_json: {
        source: 'gemini_meal_service_text',
        gemini_result: parsed || {},
        original_text: userText,
      },
    };
  }

  const normalized = normalizeGeminiMealResult(parsed);
  return buildLegacyMealFromNormalized(normalized, {
    source: 'gemini_meal_service_text',
    original_text: userText,
    is_meal: true,
  });
}

async function applyMealCorrectionWithGemini(
  currentMeal,
  correctionText,
  {
    apiKey = process.env.GEMINI_API_KEY,
    model = process.env.GEMINI_MEAL_MODEL || 'gemini-2.5-flash',
    timeoutMs = DEFAULT_TIMEOUT_MS,
  } = {}
) {
  const parsed = await callGeminiJson({
    prompt: buildMealCorrectionPrompt(currentMeal, correctionText),
    schema: getMealResponseSchema(),
    apiKey,
    model,
    timeoutMs,
    temperature: 0.2,
  });

  let normalized = normalizeGeminiMealResult(parsed);
  normalized = applyCoffeePairCorrectionGuard(normalized, currentMeal, correctionText);
  normalized = applySimpleJapaneseCorrectionGuard(normalized, currentMeal, correctionText);
  normalized = applyLocalMealGuards(normalized);

  return buildLegacyMealFromNormalized(normalized, {
    source: 'gemini_meal_service_correction',
    correction_text: correctionText,
    is_meal: true,
  });
}

function buildMealReply(result) {
  const normalized = normalizeGeminiMealResult(result || {});
  const kcal = roundKcal(normalized.total_kcal);
  const minKcal = roundKcal(normalized.range_min);
  const maxKcal = roundKcal(normalized.range_max);
  const protein = roundGram(normalized.protein_g);
  const fat = roundGram(normalized.fat_g);
  const carbs = roundGram(normalized.carbs_g);

  const lines = [
    '食事内容を整理しました。',
    `料理: ${normalized.meal_label || '食事'}`,
    `推定カロリー: ${kcal} kcal（${minKcal}〜${maxKcal} kcal）`,
  ];

  if (protein != null || fat != null || carbs != null) {
    lines.push('');
    lines.push('栄養の目安');
    if (protein != null) lines.push(`・たんぱく質: ${protein}g`);
    if (fat != null) lines.push(`・脂質: ${fat}g`);
    if (carbs != null) lines.push(`・糖質: ${carbs}g`);
  }

  return lines.join('\n');
}

function buildMealSavePayload({
  userId = null,
  imageUrl = null,
  result,
  originalMessageId = null,
}) {
  const normalized = normalizeGeminiMealResult(result || {});

  return {
    user_id: userId,
    source_type: 'photo',
    source_model: 'gemini',
    original_message_id: originalMessageId,
    image_url: imageUrl,
    meal_items_json: keepGeminiNames(normalized.items || []),
    total_kcal: roundKcal(normalized.total_kcal),
    kcal_range_min: roundKcal(normalized.range_min),
    kcal_range_max: roundKcal(normalized.range_max),
    protein_g: roundGram(normalized.protein_g),
    fat_g: roundGram(normalized.fat_g),
    carbs_g: roundGram(normalized.carbs_g),
    uncertain_points_json: normalized.uncertain_points || [],
    confirmation_questions_json: normalized.confirmation_questions || [],
    needs_confirmation: Boolean(normalized.needs_confirmation),
    confirmed_by_user: false,
    raw_response_json: normalized.raw_json || normalized || {},
    created_at: new Date().toISOString(),
  };
}

module.exports = {
  analyzeMealPhotoWithGemini,
  analyzeMealTextWithGemini,
  applyMealCorrectionWithGemini,
  buildMealReply,
  buildMealSavePayload,
  buildMealVisionPrompt,
  getMealResponseSchema,
  normalizeGeminiMealResult,
  applyLocalMealGuards,
};
