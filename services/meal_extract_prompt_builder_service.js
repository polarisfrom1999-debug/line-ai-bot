'use strict';

function buildMealExtractPrompt({ rawText = '' } = {}) {
  const prompt = `
あなたは栄養士「牛込先生」として食事解析を行います。
必ず以下のJSON形式のみで回答してください。

{
  "isMealImage": true,
  "items": ["料理名"],
  "estimated_nutrition": { "kcal": 0, "protein": 0, "fat": 0, "carbs": 0 },
  "comment": "短いアドバイス"
}

ユーザーの補足: ${rawText}
`.trim();

  return { prompt };
}

module.exports = { buildMealExtractPrompt };
