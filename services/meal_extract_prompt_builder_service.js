'use strict';

function buildMealExtractPrompt({ rawText = '', previousMealSummary = '' } = {}) {
  const schema = {
    type: 'object',
    properties: {
      isMealImage: { type: 'boolean' },
      imageKind: { type: 'string' },
      mealTypeHint: { type: 'string' },
      items: { type: 'array', items: { type: 'string' } },
      amountNote: { type: 'string' },
      amountRatio: { type: 'number' },
      estimatedNutrition: {
        type: 'object',
        properties: {
          kcal: { type: 'number' },
          protein: { type: 'number' },
          fat: { type: 'number' },
          carbs: { type: 'number' }
        },
        required: ['kcal', 'protein', 'fat', 'carbs']
      },
      visibleText: { type: 'string' },
      uncertaintyNotes: { type: 'array', items: { type: 'string' } },
      confirmationQuestions: { type: 'array', items: { type: 'string' } },
      comment: { type: 'string' },
      confidence: { type: 'number' },
      recordReady: { type: 'boolean' }
    },
    required: ['isMealImage', 'imageKind', 'items', 'estimatedNutrition', 'confidence', 'recordReady']
  };

  const prompt = [
    'あなたは「ここから。」の食事画像抽出担当です。返答はJSONのみです。',
    '目的は、食事写真、メニュー表、栄養成分表示、商品パッケージ、飲み物画像を構造化することです。',
    '相談文や雑談文に引っ張られず、画像に写っているものと読める文字だけを根拠にしてください。',
    '料理名や食材名は自然な日本語で具体的に出してください。',
    '栄養表示は「たんぱく質・脂質・糖質」に対応する protein/fat/carbs を使ってください。',
    '飲み物単体も食事関連なら isMealImage=true にしてください。',
    'アルコールかお茶か曖昧な時は断定せず、uncertaintyNotes と confirmationQuestions に書いてください。',
    '高齢者に説明しやすい粒度を意識し、過度に専門的な名称へ寄せすぎないでください。',
    `直前の利用者テキスト補助: ${String(rawText || '').trim() || 'なし'}`,
    `前回の食事要約: ${String(previousMealSummary || '').trim() || 'なし'}`
  ].join('\n');

  return {
    domain: 'meal_image',
    promptVersion: 'meal_extract_v1',
    schema,
    prompt,
    temperature: 0.12,
    preferredModel: process.env.GEMINI_MODEL || 'gemini-2.5-flash'
  };
}

module.exports = {
  buildMealExtractPrompt
};
