'use strict';

const { GoogleGenerativeAI } = require('@google/generative-ai');

async function dispatchGemini(payload, options = {}) {
  const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
  const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });

  const formattedParts = payload.map(part => {
    if (part && part.inlineData) return part; // すでに整形済みの場合はそのまま
    if (part && (part.buffer || part.data)) {
      const data = part.buffer || part.data;
      return {
        inlineData: {
          data: typeof data === 'string' ? data : data.toString('base64'),
          mimeType: part.mimeType || part.mimetype || 'image/jpeg'
        }
      };
    }
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
