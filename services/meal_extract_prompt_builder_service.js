'use strict';

function buildMealExtractPrompt({ rawText = '', previousMealSummary = '' } = {}) {
  const schema = {
    type: 'object',
    properties: {
      isMealImage: { type: 'boolean' },
      imageKind: { type: 'string' },
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
      confidence: { type: 'number' },
      recordReady: { type: 'boolean' }
    },
    required: ['isMealImage', 'items', 'estimatedNutrition', 'recordReady']
  };

  const prompt = [
    'あなたは「ここから。」の伴走AI、牛込先生です。',
    '食事画像を分析し、JSON形式で返してください。',
    'ユーザーが安心できるよう、やさしく専門的すぎないアドバイスを添えてください。',
    `補足情報: ${rawText || 'なし'}`,
    `前回の文脈: ${previousMealSummary || 'なし'}`
  ].join('\n');

  return { prompt, schema };
}

module.exports = { buildMealExtractPrompt };
