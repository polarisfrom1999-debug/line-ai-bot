'use strict';

/**
 * media_domain_classifier_service.js
 *
 * 目的:
 * - 画像 / 動画入力を、Gemini import 骨格へ流す前にドメイン判定する。
 * - 利用者の自然文を優先し、未確定時だけ軽いヒューリスティックで補う。
 *
 * 返す domain:
 * - lab
 * - meal
 * - shoe_wear
 * - movement
 * - unknown
 */

function normalizeText(value) {
  return String(value || '').trim().toLowerCase();
}

function includesAny(text, words) {
  return words.some((word) => text.includes(word));
}

function detectFromText(rawText) {
  const text = normalizeText(rawText);
  if (!text) return null;

  if (includesAny(text, ['血液検査', '採血', 'tg', 'hba1c', 'ldl', 'hdl', 'cpk'])) return 'lab';
  if (includesAny(text, ['食事', 'ごはん', '昼食', '夕食', '朝食', 'カロリー', 'たんぱく質', '脂質', '糖質'])) return 'meal';
  if (includesAny(text, ['靴底', 'シューズ', '摩耗', '減り方'])) return 'shoe_wear';
  if (includesAny(text, ['動画', 'フォーム', '走り方', '接地', '膝の向き', 'アキレス腱', '着地'])) return 'movement';

  return null;
}

function detectFromMimeType(mimeType) {
  const mime = normalizeText(mimeType);
  if (!mime) return null;
  if (mime.startsWith('video/')) return 'movement';
  if (mime.startsWith('image/')) return 'unknown';
  return null;
}

function classifyMediaDomain({ text, mimeType, priorDomain = null }) {
  return (
    detectFromText(text) ||
    priorDomain ||
    detectFromMimeType(mimeType) ||
    'unknown'
  );
}

module.exports = {
  classifyMediaDomain,
};
