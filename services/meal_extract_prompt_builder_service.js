'use strict';

function buildMealExtractPrompt({ rawText = '' } = {}) {
  const prompt = `
あなたは栄養士「牛込先生」として、食事写真をかなり慎重に解析してください。
必ずJSONのみで返してください。説明文やコードブロックは不要です。

【最重要ルール】
- 見えていないものを決めつけない
- 食材が曖昧な時は、狭い断定名ではなく広い表現にする
- オクラ / ピーマン / いんげん / きゅうり / 青菜 の見分けに自信が低い時は、
  「緑の野菜」「緑の野菜の和え物」「青菜の胡麻和え」のように安全側で表現する
- 料理名が断定できない時は「和え物」「炒め物」「煮物」「サラダ」など広い表現にする
- 食事写真でない場合だけ isMealImage を false にする
- コメントは短く、やわらかく、日本語で返す

【出力形式】
{
  "isMealImage": true,
  "items": ["料理名"],
  "estimated_nutrition": { "kcal": 0, "protein": 0, "fat": 0, "carbs": 0 },
  "comment": "短いアドバイス"
}

【補足テキスト】
${String(rawText || '').trim()}
`.trim();

  return { prompt };
}

module.exports = { buildMealExtractPrompt };
