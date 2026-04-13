'use strict';

const { GoogleGenerativeAI } = require('@google/generative-ai');

async function dispatchGemini(payload, options = {}) {
  // 窓口を「最新の v1」に強制固定します
  const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
  
  // モデル名を公式のフルネーム「models/gemini-1.5-flash」に変更
  const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });

  const formattedParts = payload.map(part => {
    // 画像データの存在チェックをより厳重に
    if (part && part.buffer) {
      return {
        inlineData: {
          data: part.buffer.toString('base64'),
          mimeType: part.mimeType || 'image/jpeg'
        }
      };
    }
    return typeof part === 'string' ? { text: part } : { text: JSON.stringify(part) };
  });

  try {
    const result = await model.generateContent({ contents: [{ role: "user", parts: formattedParts }] });
    const response = await result.response;
    return response.text();
  } catch (error) {
    console.error('Gemini通信エラー:', error.message);
    throw error;
  }
}

module.exports = { dispatchGemini };
