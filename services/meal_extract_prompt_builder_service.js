'use strict';

function buildMealExtractPrompt({ rawText = '', previousMealSummary = '' } = {}) {
  const schema = {
    type: 'object',
    properties: {
      isMealImage: { type: 'boolean' },
      items: { type: 'array', items: { type: 'string' } },
      estimated_nutrition: {
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
    required: ['isMealImage', 'items', 'estimated_nutrition', 'recordReady']
  };

  const prompt = [
    'あなたは「ここから。」の伴走AI、牛込先生です。',
    '食事画像を分析し、JSON形式で返してください。',
    `ユーザーからの補足: ${rawText || 'なし'}`
  ].join('\n');

  return { prompt, schema };
}

module.exports = { buildMealExtractPrompt };
