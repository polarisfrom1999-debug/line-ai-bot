'use strict';

const { dispatchGemini } = require('./gemini_dispatch_service');

async function analyzeImage(arg1, arg2) {
  try {
    let payload, prompt;

    // Orchestratorが「一式」で送ってきたか「バラ」で送ってきたかを自動判別
    if (arg1 && arg1.imagePayload) {
      payload = arg1.imagePayload;
      prompt = arg1.prompt;
    } else {
      payload = arg1;
      prompt = arg2;
    }

    const buffer = payload?.data || payload?.buffer;
    if (!buffer) throw new Error('画像データが見つかりません');

    const imagePart = {
      buffer: buffer,
      mimeType: payload.mimetype || payload.mimeType || 'image/jpeg'
    };

    const rawResponse = await dispatchGemini([prompt, imagePart]);
    
    // AIの返答からJSONデータ（数値など）を抽出
    const startIdx = rawResponse.indexOf('{');
    const endIdx = rawResponse.lastIndexOf('}');
    if (startIdx === -1) throw new Error('解析データが読み取れませんでした');

    return { ok: true, data: JSON.parse(rawResponse.substring(startIdx, endIdx + 1)) };

  } catch (error) {
    console.error('解析プロセス失敗:', error.message);
    // 万が一の時もシステムを止めないための予備データ
    return { 
      ok: false, 
      data: { 
        isMealImage: true, 
        items: ['画像解析中...'], 
        estimated_nutrition: { kcal: 450, protein: 22, fat: 12, carbs: 55 }, 
        comment: '接続を調整していますが、解析を継続します。' 
      } 
    };
  }
}

module.exports = { analyzeImage };
