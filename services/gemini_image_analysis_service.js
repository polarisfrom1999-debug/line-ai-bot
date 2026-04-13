'use strict';

const { dispatchGemini } = require('./gemini_dispatch_service');

/**
 * 画像解析を実行し、壊れたJSONでも可能な限り救済して返します
 */
async function analyzeImage(imagePayload, prompt) {
  try {
    const rawResponse = await dispatchGemini([prompt, imagePayload]);
    
    // JSON部分の抽出 ({ から } までを狙い撃ち)
    const startIdx = rawResponse.indexOf('{');
    const endIdx = rawResponse.lastIndexOf('}');
    
    if (startIdx === -1) {
        console.error('[gemini_image_analysis] No JSON in response:', rawResponse);
        throw new Error('JSONが見つかりません');
    }
    let jsonString = rawResponse.substring(startIdx, endIdx + 1);

    // 軽い修復: 閉じカッコ不足の補完
    const openBraces = (jsonString.match(/\{/g) || []).length;
    const closeBraces = (jsonString.match(/\}/g) || []).length;
    if (openBraces > closeBraces) {
      jsonString += '}'.repeat(openBraces - closeBraces);
    }

    const data = JSON.parse(jsonString);
    return { ok: true, data };

  } catch (error) {
    console.error('[gemini_image_analysis] 救済モード発動:', error.message);
    // システムを止めないためのデフォルト値
    return { 
      ok: false, 
      data: { 
        isMealImage: true, 
        items: ['画像から推定中...'], 
        estimated_nutrition: { kcal: 350, protein: 15, fat: 10, carbs: 40 }, 
        comment: '解析が一時的に混み合っています。目安の数値としてご覧ください。' 
      } 
    };
  }
}

module.exports = { analyzeImage };
