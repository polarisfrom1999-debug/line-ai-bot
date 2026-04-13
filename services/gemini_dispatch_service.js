'use strict';

const { GoogleGenerativeAI } = require('@google/generative-ai');

async function dispatchGemini(payload, options = {}) {
  const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
  // 先生が以前使っていた安定したモデルに固定します
  const model = genAI.getGenerativeModel({ model: 'gemini-1.5-flash' });

  // 画像データをGoogleが受け取れる形に変換します
  const formattedParts = payload.map(part => {
    if (part.buffer) {
      return {
        inlineData: {
          data: part.buffer.toString('base64'),
          mimeType: part.mimeType || 'image/jpeg'
        }
      };
    }
    return typeof part === 'string' ? part : JSON.stringify(part);
  });

  try {
    const result = await model.generateContent(formattedParts);
    const response = await result.response;
    return response.text();
  } catch (error) {
    console.error('Gemini通信エラー:', error.message);
    throw error;
  }
}

module.exports = { dispatchGemini };
