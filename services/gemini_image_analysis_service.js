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
    
    if (startIdx === -1) throw new Error('JSONが見つかりません');
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
    console.error('[gemini_image_analysis]救済モード発動:', error.message);
    // 完全に失敗した時のフォールバックデータ
    return { 
      ok: false, 
      data: { 
        isMealImage: true, 
        items: ['画像から解析中...'], 
        estimated_nutrition: { kcal: 400, protein: 20, fat: 15, carbs: 40 }, 
        comment: 'AI応答が不安定なため、標準的な数値を表示しています。' 
      } 
    };
  }
}

module.exports = { analyzeImage };
