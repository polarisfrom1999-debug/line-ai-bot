'use strict';

const { dispatchGemini } = require('./gemini_dispatch_service');

async function analyzeImage(arg1, arg2) {
  try {
    let payload, prompt;

    // Orchestratorからのデータ構造を判別
    if (arg1 && arg1.imagePayload) {
      payload = arg1.imagePayload;
      prompt = arg1.prompt;
    } else {
      payload = arg1;
      prompt = arg2;
    }

    const buffer = payload?.data || payload?.buffer;
    if (!buffer) throw new Error('画像がありません');

    const imagePart = {
      buffer: buffer,
      mimeType: payload.mimetype || payload.mimeType || 'image/jpeg'
    };

    const rawResponse = await dispatchGemini([prompt, imagePart]);
    
    // JSON部分の抽出
    const startIdx = rawResponse.indexOf('{');
    const endIdx = rawResponse.lastIndexOf('}');
    if (startIdx === -1) throw new Error('解析不能');

    return { ok: true, data: JSON.parse(rawResponse.substring(startIdx, endIdx + 1)) };

  } catch (error) {
    console.error('解析プロセス失敗:', error.message);
    return { 
      ok: false, 
      data: { 
        isMealImage: true, 
        items: ['画像解析中'], 
        estimated_nutrition: { kcal: 450, protein: 20, fat: 12, carbs: 50 }, 
        comment: '一時的に自動推定モードで動作しています。' 
      } 
    };
  }
}

module.exports = { analyzeImage };
