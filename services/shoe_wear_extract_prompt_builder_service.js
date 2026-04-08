'use strict';

function buildShoeWearExtractPrompt({ rawText = '' } = {}) {
  const schema = {
    type: 'object',
    properties: {
      is_shoe_wear_image: { type: 'boolean' },
      side: { type: 'string' },
      wear_regions: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            region: { type: 'string' },
            severity: { type: 'string' },
            confidence: { type: 'number' }
          },
          required: ['region']
        }
      },
      asymmetry_notes: { type: 'array', items: { type: 'string' } },
      movement_hypotheses: { type: 'array', items: { type: 'string' } },
      issues: { type: 'array', items: { type: 'string' } },
      confidence: { type: 'number' }
    },
    required: ['is_shoe_wear_image', 'wear_regions', 'confidence']
  };

  const prompt = [
    'あなたは「ここから。」の靴底摩耗画像抽出担当です。返答はJSONのみです。',
    '目的は、靴底の減り方を構造化し、動作の癖の候補を安全に整理することです。',
    '断定診断は禁止です。movement_hypotheses には「可能性」の表現で入れてください。',
    'wear_regions では heel_inner / heel_outer / midfoot_inner / midfoot_outer / forefoot_inner / forefoot_outer などを使ってください。',
    '左右や内外の判定に自信が低い時は issues に書いて confidence を下げてください。',
    `利用者の補助テキスト: ${String(rawText || '').trim() || 'なし'}`
  ].join('\n');

  return {
    domain: 'shoe_wear_image',
    promptVersion: 'shoe_wear_extract_v1',
    schema,
    prompt,
    temperature: 0.1,
    preferredModel: process.env.GEMINI_MODEL || 'gemini-2.5-flash'
  };
}

module.exports = {
  buildShoeWearExtractPrompt
};
