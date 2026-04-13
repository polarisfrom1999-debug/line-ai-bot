'use strict';

// 先生のシステムにある既存の部品を呼び出します
const { GoogleGenerativeAI } = require('@google/genai');

async function dispatchGemini(payload) {
  // すでにある設定（GEMINI_API_KEY）を使います
  const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
  
  // 安定して動作する gemini-1.5-flash モデルを指定
  const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });

  const formattedParts = payload.map(part => {
    // 画像データの取り出し
    const buffer = part.buffer || part.data;
    if (buffer) {
      return {
        inlineData: {
          data: typeof buffer === 'string' ? buffer : buffer.toString('base64'),
          mimeType: part.mimeType || part.mimetype || 'image/jpeg'
        }
      };
    }
    // テキストデータの取り出し
    return { text: typeof part === 'string' ? part : JSON.stringify(part) };
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
