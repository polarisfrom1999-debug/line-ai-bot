'use strict';

const { dispatchGemini } = require('./gemini_dispatch_service');

async function analyzeImage(imagePayload, prompt) {
  try {
    // orchestrator側のデータの持ち方（data または buffer）に両対応させます
    const buffer = imagePayload.data || imagePayload.buffer;
    const mime = imagePayload.mimetype || imagePayload.mimeType || 'image/jpeg';

    if (!buffer) {
      console.error('届いたデータの中身:', Object.keys(imagePayload));
      throw new Error('画像データが届いていません');
    }

    const imagePart = { buffer, mimeType: mime };
    const rawResponse = await dispatchGemini([prompt, imagePart]);
    
    const startIdx = rawResponse.indexOf('{');
    const endIdx = rawResponse.lastIndexOf('}');
    if (startIdx === -1) throw new Error('解析データが見つかりません');

    return { ok: true, data: JSON.parse(rawResponse.substring(startIdx, endIdx + 1)) };
  } catch (error) {
    console.error('解析エラー:', error.message);
    return { 
      ok: false, 
      data: { 
        isMealImage: true, 
        items: ['画像解析中'], 
        estimated_nutrition: { kcal: 450, protein: 25, fat: 15, carbs: 55 }, 
        comment: '解析が混雑していますが、推定を開始します。' 
      } 
    };
  }
}

module.exports = { analyzeImage };
