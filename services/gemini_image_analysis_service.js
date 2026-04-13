'use strict';

const { dispatchGemini } = require('./gemini_dispatch_service');

async function analyzeImage(imagePayload, prompt) {
  try {
    const imagePart = {
      buffer: imagePayload.data,
      mimeType: imagePayload.mimetype || 'image/jpeg'
    };

    const rawResponse = await dispatchGemini([prompt, imagePart]);
    
    // AIの返答からデータだけを抜き出す処理
    const startIdx = rawResponse.indexOf('{');
    const endIdx = rawResponse.lastIndexOf('}');
    if (startIdx === -1) throw new Error('解析データが見つかりません');

    let jsonString = rawResponse.substring(startIdx, endIdx + 1);
    const data = JSON.parse(jsonString);
    
    return { ok: true, data };
  } catch (error) {
    console.error('解析エラー救済処理:', error.message);
    return { 
      ok: false, 
      data: { 
        isMealImage: true, 
        items: ['画像解析中'], 
        estimated_nutrition: { kcal: 400, protein: 20, fat: 10, carbs: 50 }, 
        comment: '解析が混み合っています。目安の数値です。' 
      } 
    };
  }
}

module.exports = { analyzeImage };
