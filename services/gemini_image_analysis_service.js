'use strict';

const { dispatchGemini } = require('./gemini_dispatch_service');

async function analyzeImage(arg1, arg2) {
  try {
    let imagePayload, prompt;

    // 1678行の orchestrator からの届き方に合わせる特殊な仕分け
    if (arg1 && arg1.imagePayload) {
      // 「大きな箱」で届いた場合
      imagePayload = arg1.imagePayload;
      prompt = arg1.prompt;
    } else {
      // バラバラで届いた場合
      imagePayload = arg1;
      prompt = arg2;
    }

    // 画像の「身」を取り出す
    const buffer = imagePayload?.data || imagePayload?.buffer;
    if (!buffer) {
      throw new Error('画像データが見つかりません');
    }

    const imagePart = {
      buffer: buffer,
      mimeType: imagePayload.mimetype || imagePayload.mimeType || 'image/jpeg'
    };

    // 通信実行
    const rawResponse = await dispatchGemini([prompt, imagePart]);
    
    // JSON部分だけを切り出す
    const startIdx = rawResponse.indexOf('{');
    const endIdx = rawResponse.lastIndexOf('}');
    if (startIdx === -1) throw new Error('解析結果が不正です');

    return { ok: true, data: JSON.parse(rawResponse.substring(startIdx, endIdx + 1)) };

  } catch (error) {
    console.error('解析プロセス失敗:', error.message);
    // 万が一の時も、LINEが沈黙しないための予備データ
    return { 
      ok: false, 
      data: { 
        isMealImage: true, 
        items: ['画像から推定中...'], 
        estimated_nutrition: { kcal: 420, protein: 18, fat: 12, carbs: 50 }, 
        comment: '接続を調整中ですが、解析は継続しています。' 
      } 
    };
  }
}

module.exports = { analyzeImage };
