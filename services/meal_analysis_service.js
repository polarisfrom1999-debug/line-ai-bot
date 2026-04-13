'use strict';

const geminiDispatchService = require('./gemini_dispatch_service');
const geminiImageAnalysisService = require('./gemini_image_analysis_service');
const { buildMealExtractPrompt } = require('./meal_extract_prompt_builder_service');
const { supabase } = require('./supabase_service');

const MEAL_IMAGE_SCHEMA = {
  type: 'object',
  properties: {
    isMealImage: { type: 'boolean' },
    items: {
      type: 'array',
      items: { type: 'string' }
    },
    estimated_nutrition: {
      type: 'object',
      properties: {
        kcal: { type: 'number' },
        protein: { type: 'number' },
        fat: { type: 'number' },
        carbs: { type: 'number' }
      }
    },
    comment: { type: 'string' },
    recordReady: { type: 'boolean' }
  },
  required: ['isMealImage', 'items', 'estimated_nutrition', 'comment']
};

function normalizeText(value) {
  return String(value || '').trim();
}

function normalizeNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function findBalancedJsonBlock(text) {
  const source = String(text || '');
  const start = source.indexOf('{');
  if (start < 0) return '';

  let depth = 0;
  let inString = false;
  let escaping = false;

  for (let i = start; i < source.length; i += 1) {
    const ch = source[i];

    if (inString) {
      if (escaping) {
        escaping = false;
      } else if (ch === '\\') {
        escaping = true;
      } else if (ch === '"') {
        inString = false;
      }
      continue;
    }

    if (ch === '"') {
      inString = true;
      continue;
    }

    if (ch === '{') depth += 1;
    if (ch === '}') depth -= 1;

    if (depth === 0) {
      return source.slice(start, i + 1);
    }
  }

  return source.slice(start).trim();
}

function repairLikelyTruncatedJson(text) {
  let cleaned = String(text || '')
    .replace(/^```json\s*/i, '')
    .replace(/^```\s*/i, '')
    .replace(/```/g, '')
    .trim();

  const balancedBlock = findBalancedJsonBlock(cleaned);
  if (balancedBlock) cleaned = balancedBlock;

  cleaned = cleaned
    .replace(/,\s*([}\]])/g, '$1')
    .trim();

  const openBraces = (cleaned.match(/\{/g) || []).length;
  const closeBraces = (cleaned.match(/\}/g) || []).length;
  const openBrackets = (cleaned.match(/\[/g) || []).length;
  const closeBrackets = (cleaned.match(/\]/g) || []).length;

  if (openBrackets > closeBrackets) {
    cleaned += ']'.repeat(openBrackets - closeBrackets);
  }
  if (openBraces > closeBraces) {
    cleaned += '}'.repeat(openBraces - closeBraces);
  }

  return cleaned;
}

function parseLooseMealJson(text) {
  const direct = repairLikelyTruncatedJson(text);

  try {
    return JSON.parse(direct);
  } catch (_) {
    const safeText = String(text || '');
    const itemMatches = [...safeText.matchAll(/"([^"\n]{1,80})"\s*,?/g)]
      .map((row) => normalizeText(row[1]))
      .filter((value) => value && !['isMealImage', 'items', 'estimated_nutrition', 'comment', 'recordReady', 'kcal', 'protein', 'fat', 'carbs'].includes(value));

    const uniqueItems = [...new Set(itemMatches.filter((value) => !/^(true|false|null)$/i.test(value)))].slice(0, 8);
    if (!uniqueItems.length) {
      throw new Error('JSONが壊れていて復元できませんでした');
    }

    return {
      isMealImage: /"isMealImage"\s*:\s*true/i.test(safeText),
      items: uniqueItems,
      estimated_nutrition: {
        kcal: 0,
        protein: 0,
        fat: 0,
        carbs: 0
      },
      comment: '写真から読めた範囲でいったん記録しました。量や追加の具材が分かれば、あとでもう少し整えられます。',
      recordReady: true,
      partial: true
    };
  }
}

function normalizeMealData(parsed) {
  const nutrition = parsed?.estimated_nutrition || parsed?.estimatedNutrition || {};
  return {
    isMealImage: Boolean(parsed?.isMealImage ?? parsed?.is_meal ?? parsed?.isMeal ?? true),
    items: Array.isArray(parsed?.items)
      ? parsed.items.map(normalizeText).filter(Boolean)
      : Array.isArray(parsed?.food_items)
        ? parsed.food_items.map((item) => normalizeText(item?.name || item)).filter(Boolean)
        : [],
    estimated_nutrition: {
      kcal: normalizeNumber(nutrition?.kcal ?? parsed?.estimated_kcal),
      protein: normalizeNumber(nutrition?.protein ?? parsed?.protein_g),
      fat: normalizeNumber(nutrition?.fat ?? parsed?.fat_g),
      carbs: normalizeNumber(nutrition?.carbs ?? parsed?.carbs_g)
    },
    comment: normalizeText(parsed?.comment || parsed?.ai_comment || '今日の記録に入れておきますね。'),
    recordReady: parsed?.recordReady !== false
  };
}

async function analyzeWithStructuredJson(imagePayload, prompt) {
  try {
    const dispatch = await geminiDispatchService.generateStructuredImageJson({
      imagePayload,
      prompt,
      schema: MEAL_IMAGE_SCHEMA,
      domain: 'meal_image',
      temperature: 0.15,
      maxOutputTokens: 1200
    });

    return {
      ok: Boolean(dispatch?.ok),
      mealData: normalizeMealData(dispatch?.json || {}),
      rawText: dispatch?.text || ''
    };
  } catch (error) {
    console.error('[meal_analysis_service] structured image json failed:', error?.message || error);
    return {
      ok: false,
      mealData: null,
      rawText: ''
    };
  }
}

async function analyzeWithLooseText(imagePayload, prompt) {
  const result = await geminiImageAnalysisService.analyzeImage({
    imagePayload,
    prompt
  });

  if (!result.ok) throw new Error('AI解析に失敗しました。');

  try {
    return {
      ok: true,
      mealData: normalizeMealData(parseLooseMealJson(result.text)),
      rawText: result.text || ''
    };
  } catch (error) {
    console.error('[meal_analysis_service] JSON解析エラー:', result.text);
    throw new Error('データの形式を読み取れませんでした。');
  }
}

/**
 * 【完全統合版】
 * システム（orchestrator）が探し求めている「analyzeMealImage」という名前に100%合わせています。
 * これ1枚で、解析から積算、絵文字レポートまで完結するため、他のファイルとの連携エラーも起きません。
 */
async function analyzeMealImage(imagePayload, userId, rawText = '') {
  const { prompt } = buildMealExtractPrompt({ rawText });

  let mealData;
  const structured = await analyzeWithStructuredJson(imagePayload, prompt);
  if (structured.ok && structured.mealData) {
    mealData = structured.mealData;
  } else {
    const fallback = await analyzeWithLooseText(imagePayload, prompt);
    mealData = fallback.mealData;
  }

  let dailyTotalText = '';
  if (mealData.isMealImage && userId) {
    await supabase.from('meals').insert({
      user_id: userId,
      meal_label: (mealData.items || []).join('、'),
      estimated_kcal: mealData.estimated_nutrition?.kcal || 0,
      protein_g: mealData.estimated_nutrition?.protein || 0,
      fat_g: mealData.estimated_nutrition?.fat || 0,
      carbs_g: mealData.estimated_nutrition?.carbs || 0,
      ai_comment: mealData.comment
    });

    try {
      const now = new Date();
      const jstOffset = 9 * 60 * 60 * 1000;
      const todayStart = new Date(new Date(now.getTime() + jstOffset).setHours(0, 0, 0, 0) - jstOffset).toISOString();

      const { data } = await supabase
        .from('meals')
        .select('estimated_kcal, protein_g, fat_g, carbs_g')
        .eq('user_id', userId)
        .gte('created_at', todayStart);

      if (data && data.length > 0) {
        const total = data.reduce((acc, cur) => ({
          kcal: acc.kcal + (Number(cur.estimated_kcal) || 0),
          protein: acc.protein + (Number(cur.protein_g) || 0),
          fat: acc.fat + (Number(cur.fat_g) || 0),
          carbs: acc.carbs + (Number(cur.carbs_g) || 0)
        }), { kcal: 0, protein: 0, fat: 0, carbs: 0 });

        dailyTotalText = `
📈 本日の合計（積算）
┈┈┈┈┈┈┈┈┈┈┈┈┈
  エネルギー 🔥: ${Math.round(total.kcal)} kcal
  タンパク質 💪: ${Math.round(total.protein)} g
  脂質 🍳: ${Math.round(total.fat)} g
  糖質 🍞: ${Math.round(total.carbs)} g
━━━━━━━━━━━━━`;
      }
    } catch (dbErr) {
      console.error('積算エラー:', dbErr);
    }
  }

  const nut = mealData.estimated_nutrition || {};
  const report = [
    '📸 お食事の解析が終わりました！✨',
    '━━━━━━━━━━━━━',
    `【メニュー 🥗】: ${(mealData.items || []).join('、')}`,
    `エネルギー 🔥: ${Math.round(nut.kcal || 0)} kcal`,
    `タンパク質 💪: ${Math.round(nut.protein || 0)} g`,
    `脂質 🍳: ${Math.round(nut.fat || 0)} g`,
    `糖質 🍞: ${Math.round(nut.carbs || 0)} g`,
    '━━━━━━━━━━━━━',
    `💬 牛込先生のアドバイス:\n「${mealData.comment || '今日も一歩、健康に近づきましたね。'}」`,
    dailyTotalText
  ].filter(Boolean).join('\n');

  return report;
}

module.exports = {
  analyzeMealImage,
  analyzeMealImageAndCreateReport: analyzeMealImage,
  mealAnalysisService: analyzeMealImage
};
