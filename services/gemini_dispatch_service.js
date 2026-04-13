'use strict';

const { GoogleGenerativeAI } = require('@google/generative-ai');

async function dispatchGemini(payload) {
  const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
  
  // 【ここを修正】正式な入り口 'v1' を強制し、モデル名を指定
  const model = genAI.getGenerativeModel(
    { model: "gemini-1.5-flash" },
    { apiVersion: 'v1' } 
  );

  const formattedParts = payload.map(part => {
    // 画像データの抽出（Orchestratorからのあらゆる形に対応）
    const buffer = part.buffer || part.data;
    if (buffer) {
      return {
        inlineData: {
          data: typeof buffer === 'string' ? buffer : buffer.toString('base64'),
          mimeType: part.mimeType || part.mimetype || 'image/jpeg'
        }
      };
    }
    // テキストデータの抽出
    const text = typeof part === 'string' ? part : (part.text || JSON.stringify(part));
    return { text: text };
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
