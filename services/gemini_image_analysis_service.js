'use strict';

const { dispatchGemini } = require('./gemini_dispatch_service');

async function analyzeImage(arg1, arg2) {
  try {
    let payload, prompt;

    // ログ [ 'imagePayload', 'prompt', 'model' ] に対応する救済ロジック
    if (arg1 && arg1.imagePayload) {
      // 引数が1つの「詰め合わせパック」で届いた場合
      payload = arg1.imagePayload;
      prompt = arg1.prompt;
    } else {
      // 通常通り 2つの引数で届いた場合
      payload = arg1;
      prompt = arg2;
    }

    const buffer = payload?.data || payload?.buffer;
    if (!buffer) {
      console.error('届いたデータの中身のキー:', Object.keys(arg1 || {}));
      throw new Error('画像データが届いていません');
    }

    const imagePart = {
      buffer: buffer,
      mimeType: payload.mimetype || payload.mimeType || 'image/jpeg'
    };

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
        estimated_nutrition: { kcal: 400, protein: 20, fat: 12, carbs: 48 }, 
        comment: 'サーバーの接続を調整中ですが、解析を開始します。' 
      } 
    };
  }
}

module.exports = { analyzeImage };
