'use strict';

const { GoogleGenerativeAI } = require('@google/generative-ai');

async function dispatchGemini(payload, options = {}) {
  const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
  
  // 最新の正式モデル（v1）を指定します
  const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });

  const formattedParts = payload.map(part => {
    // 画像データが含まれている場合（様々なパターンに対応）
    const buffer = part.buffer || part.data || (part.imagePayload && part.imagePayload.data);
    if (buffer) {
      return {
        inlineData: {
          data: typeof buffer === 'string' ? buffer : buffer.toString('base64'),
          mimeType: part.mimeType || part.mimetype || 'image/jpeg'
        }
      };
    }
    // テキストデータの場合
    const text = typeof part === 'string' ? part : (part.prompt || JSON.stringify(part));
    return { text: text };
  });

  try {
    // 送信形式を最新の公式ルールに合わせました
    const result = await model.generateContent({ contents: [{ role: "user", parts: formattedParts }] });
    const response = await result.response;
    return response.text();
  } catch (error) {
    console.error('Gemini通信エラー:', error.message);
    throw error;
  }
}

module.exports = { dispatchGemini };
