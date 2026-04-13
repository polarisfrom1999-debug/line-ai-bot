'use strict';

const { GoogleGenerativeAI } = require('@google/generative-ai');

/**
 * モデルのフォールバックとリトライを制御する司令塔
 */
async function dispatchGemini(payload, options = {}) {
  const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
  
  // 利用可能な最新かつ安定したモデルを選択
  const modelNames = ['gemini-1.5-flash', 'gemini-1.5-pro'];
  let lastError;

  for (const modelName of modelNames) {
    let retryCount = 0;
    const maxRetries = 2;

    while (retryCount <= maxRetries) {
      try {
        const model = genAI.getGenerativeModel({ model: modelName });
        const result = await model.generateContent(payload);
        const response = await result.response;
        return response.text();
      } catch (error) {
        lastError = error;
        const status = error.status || (error.response && error.response.status);
        
        // 503 (UNAVAILABLE) の場合はリトライ
        if (status === 503 && retryCount < maxRetries) {
          retryCount++;
          console.warn(`[gemini_dispatch] 503 error on ${modelName}. Retry ${retryCount} in ${1500 * retryCount}ms`);
          await new Promise(resolve => setTimeout(resolve, 1500 * retryCount));
          continue;
        }
        
        console.error(`[gemini_dispatch] ${modelName} failed: ${error.message}`);
        break; // 次のモデル（fallback）へ
      }
    }
  }
  throw lastError;
}

module.exports = { dispatchGemini };
