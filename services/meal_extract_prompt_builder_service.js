'use strict';

function buildMealExtractPrompt({ rawText = '' } = {}) {
  // AIが返すべきデータの形（スキーマ）を定義
  const schema = {
    type: 'object',
    properties: {
      isMealImage: { type: 'boolean' },
      items: { type: 'array', items: { type: 'string' } },
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
      comment: { type: 'string' },
      recordReady: { type: 'boolean' }
    },
    required: ['isMealImage', 'items', 'estimatedNutrition', 'recordReady']
  };

  const prompt = [
    'あなたは「ここから。」の伴走AI、牛込先生です。',
    '食事画像を分析し、指定のJSON形式で返してください。',
    'アドバイスは女性ユーザーが前向きになれるよう、やさしい言葉を選んでください。',
    `ユーザーからの補足: ${rawText || 'なし'}`
  ].join('\n');

  return { prompt, schema };
}

module.exports = { buildMealExtractPrompt };
