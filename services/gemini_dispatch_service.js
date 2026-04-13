'use strict';

const { GoogleGenerativeAI } = require('@google/generative-ai');

async function dispatchGemini(payload) {
  const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
  // 正式版の v1 窓口で、最新モデルを呼び出します
  const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });

  const formattedParts = payload.map(part => {
    // 画像データ（Buffer）が含まれている場合の処理
    const buffer = part.buffer || part.data;
    if (buffer) {
      return {
        inlineData: {
          data: typeof buffer === 'string' ? buffer : buffer.toString('base64'),
          mimeType: part.mimeType || part.mimetype || 'image/jpeg'
        }
      };
    }
    // テキストデータの場合
    return { text: typeof part === 'string' ? part : JSON.stringify(part) };
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
