'use strict';

const { runDomainImport } = require('./gemini_import_orchestrator_service');

const promptBuilder = {
  async build({ attachments }) {
    return {
      schemaName: 'meal_import_v1',
      promptVersion: 'meal_import_v1',
      prompt: [
        'あなたは食事画像の構造化担当です。',
        '料理名・食材名・推定量・栄養値を JSON で返してください。',
        '必ず日本語ラベルを優先し、たんぱく質・脂質・糖質・カロリーを返してください。',
        '{',
        '  "meal_summary": "...",',
        '  "items": [',
        '    {',
        '      "dish_name": "オキアミ納豆",',
        '      "estimated_amount": "1パック",',
        '      "kcal": 120,',
        '      "protein_g": 10,',
        '      "fat_g": 5,',
        '      "carbs_g": 8,',
        '      "confidence": 0.0',
        '    }',
        '  ],',
        '  "totals": {',
        '    "kcal": 0,',
        '    "protein_g": 0,',
        '    "fat_g": 0,',
        '    "carbs_g": 0',
        '  },',
        '  "issues": []',
        '}',
        `画像数: ${attachments.length}`,
      ].join('\n'),
    };
  },
};

const thinNormalizer = {
  async normalize({ raw }) {
    return {
      summary: raw?.meal_summary || null,
      items: Array.isArray(raw?.items) ? raw.items : [],
      totals: raw?.totals || { kcal: null, protein_g: null, fat_g: null, carbs_g: null },
      issues: Array.isArray(raw?.issues) ? raw.issues : [],
    };
  },
};

async function importMealWithGemini({ userId, attachments, geminiRunner, store, sessionMeta }) {
  return runDomainImport({
    userId,
    domain: 'meal',
    attachments,
    promptBuilder,
    geminiRunner,
    store,
    thinNormalizer,
    sessionMeta,
  });
}

module.exports = {
  importMealWithGemini,
};
