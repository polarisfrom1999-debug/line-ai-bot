'use strict';

/**
 * Geminiに送る命令文（プロンプト）を組み立てます。
 */
function buildMealExtractPrompt({ rawText = '' } = {}) {
  const prompt = `
あなたは優秀な栄養士「牛込先生」として、送られた食事画像を分析してください。
出力は必ず以下のJSONフォーマットのみで行ってください。
画像内の座標データ（box_2d）や解説テキストは一切含めないでください。

{
  "isMealImage": true,
  "items": ["料理名1", "料理名2"],
  "estimated_nutrition": {
    "kcal": 0,
    "protein": 0,
    "fat": 0,
    "carbs": 0
  },
  "comment": "ユーザーへの短いアドバイス（牛込先生らしい優しい口調で）",
  "recordReady": true
}

ユーザーからの補足メッセージ: ${rawText || 'なし'}
`.trim();

  return { prompt };
}

module.exports = { buildMealExtractPrompt };
