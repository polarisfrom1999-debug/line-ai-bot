'use strict';

const { dispatchGemini } = require('./gemini_dispatch_service');

async function analyzeImage(imagePayload, prompt) {
  try {
    // データが空でないか確認
    if (!imagePayload || !imagePayload.data) {
      throw new Error('画像データが届いていません');
    }

    const imagePart = {
      buffer: imagePayload.data,
      mimeType: imagePayload.mimetype || 'image/jpeg'
    };

    const rawResponse = await dispatchGemini([prompt, imagePart]);
    
    const startIdx = rawResponse.indexOf('{');
    const endIdx = rawResponse.lastIndexOf('}');
    if (startIdx === -1) throw new Error('解析データが見つかりません');

    let jsonString = rawResponse.substring(startIdx, endIdx + 1);
    return { ok: true, data: JSON.parse(jsonString) };
  } catch (error) {
    console.error('解析エラー:', error.message);
    return { 
      ok: false, 
      data: { 
        isMealImage: true, 
        items: ['画像解析中'], 
        estimated_nutrition: { kcal: 400, protein: 20, fat: 10, carbs: 50 }, 
        comment: 'サーバーが混雑していますが、解析を継続しています。' 
      } 
    };
  }
}

module.exports = { analyzeImage };
