'use strict';

function normalizeText(text = '') {
  return String(text || '')
    .trim()
    .toLowerCase()
    .replace(/[　\s]+/g, '')
    .replace(/[!！?？。、,.]/g, '');
}

function parseNumber(text = '') {
  const match = String(text || '').match(/(-?\d+(?:\.\d+)?)/);
  if (!match) return null;
  const value = Number(match[1]);
  return Number.isFinite(value) ? value : null;
}

async function analyzeChatCapture({ userText = '' } = {}) {
  const raw = String(userText || '').trim();
  const text = normalizeText(raw);
  if (!text) return null;

  if (/^(体重)?\d{2,3}(?:\.\d)?kg?$/.test(text)) {
    const weight = parseNumber(raw);
    if (Number.isFinite(weight)) {
      return {
        capture_type: 'body_metrics',
        action: 'needs_confirmation',
        needs_confirmation: true,
        payload: { weight_kg: weight },
        reply_text: `体重${weight}kgで受け取っています。今日の記録として残して大丈夫ですか？`,
      };
    }
  }

  if (text.includes('体脂肪') || /\d{1,2}(?:\.\d)?%/.test(text)) {
    const bodyFat = parseNumber(raw);
    if (Number.isFinite(bodyFat)) {
      return {
        capture_type: 'body_metrics',
        action: 'needs_confirmation',
        needs_confirmation: true,
        payload: { body_fat_percent: bodyFat },
        reply_text: `体脂肪率${bodyFat}%で受け取れています。このまま記録して大丈夫ですか？`,
      };
    }
  }

  return null;
}

module.exports = {
  analyzeChatCapture,
};
