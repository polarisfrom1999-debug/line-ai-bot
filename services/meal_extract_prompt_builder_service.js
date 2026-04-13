'use strict';

/**
 * meal_extract_prompt_builder_service.js
 * * 食事画像（写真、メニュー、パッケージ等）から情報を抽出するための
 * プロンプトおよびJSONスキーマを構築します。
 */

function buildMealExtractPrompt({ rawText = '', previousMealSummary = '' } = {}) {
  // Gemini API (@google/genai) の responseJsonSchema に適合する定義
  const schema = {
    type: 'object',
    properties: {
      isMealImage: { 
        type: 'boolean', 
        description: '画像が食事、飲み物、または食品（メニューやパッケージ含む）に関連しているか' 
      },
      imageKind: { 
        type: 'string', 
        description: '画像の分類: meal_photo (料理), menu_text (メニュー), food_package (パッケージ), nutrition_label (成分表), unknown' 
      },
      mealTypeHint: { 
        type: 'string', 
        description: '推測される食事タイミング: breakfast, lunch, dinner, snack, unknown' 
      },
      items: { 
        type: 'array', 
        items: { type: 'string' },
        description: '特定された料理名や食材のリスト'
      },
      amountNote: { 
        type: 'string', 
        description: '量に関する特記事項（例：大盛り、半分など）' 
      },
      amountRatio: { 
        type: 'number', 
        description: '標準的な1人前を1.0とした時の推定比率' 
      },
      estimatedNutrition: {
        type: 'object',
        properties: {
          kcal: { type: 'number', description: '推定総カロリー' },
          protein: { type: 'number', description: '推定たんぱく質(g)' },
          fat: { type: 'number', description: '推定脂質(g)' },
          carbs: { type: 'number', description: '推定炭水化物/糖質(g)' }
        },
        required: ['kcal', 'protein', 'fat', 'carbs']
      },
      visibleText: { 
        type: 'string', 
        description: '画像内から読み取れた重要な文字（商品名や栄養数値など）' 
      },
      uncertaintyNotes: { 
        type: 'array', 
        items: { type: 'string' },
        description: '判別が難しかった点や、憶測が含まれる箇所の記述'
      },
      confirmationQuestions: { 
        type: 'array', 
        items: { type: 'string' },
        description: 'ユーザーに確認すべき事項（例：「中身はあんこですか？」）'
      },
      comment: { 
        type: 'string', 
        description: '牛込先生としてのやさしいアドバイスや感想' 
      },
      confidence: { 
        type: 'number', 
        description: '解析結果の確信度 (0.0 - 1.0)' 
      },
      recordReady: { 
        type: 'boolean', 
        description: 'そのまま記録として保存して良い状態かどうか' 
      }
    },
    required: [
      'isMealImage', 
      'imageKind', 
      'items', 
      'estimatedNutrition', 
      'comment', 
      'confidence', 
      'recordReady'
    ]
  };

  const prompt = [
    'あなたは「ここから。」の伴走AI、牛込先生です。',
    '送られた画像（食事写真、メニュー、パッケージなど）を分析し、指定されたJSON形式で情報を抽出してください。',
    '',
    '【解析の指針】',
    '1. 料理名だけでなく、画像から「揚げ物」「味付けの濃さ」「野菜の量」を洞察してください。',
    '2. 栄養価の推定は、一般的な1人前のポーションを基準にしつつ、amountRatioで調整してください。',
    '3. comment欄では、治療家・伴走者としての視点を持ち、利用者が安心できるような「やさしく具体的なアドバイス」を添えてください。',
    '4. 文字（メニュー名や成分表）が写っている場合は、視覚情報よりも文字情報を優先して信頼してください。',
    '',
    `【ユーザーからの補足テキスト】: ${rawText || 'なし'}`,
    `【前回の食事の文脈】: ${previousMealSummary || 'なし'}`,
    '',
    '返答は純粋なJSONオブジェクトのみで行い、説明テキストは含めないでください。'
  ].join('\n');

  return { prompt, schema };
}

module.exports = { buildMealExtractPrompt };
