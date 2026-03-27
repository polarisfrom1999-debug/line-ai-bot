'use strict';

function normalizeText(value) {
  return String(value || '').trim();
}

function extractProfilePatchFromText(text) {
  const safeText = normalizeText(text);
  const patch = {};

  const lines = safeText.split(/\n+/).map((line) => line.trim()).filter(Boolean);

  for (const line of lines) {
    if (/^名前[:：]/.test(line)) patch.preferredName = line.replace(/^名前[:：]/, '').trim();
    if (/^体重[:：]/.test(line)) patch.weight = line.replace(/^体重[:：]/, '').trim();
    if (/^体脂肪率[:：]/.test(line)) patch.bodyFat = line.replace(/^体脂肪率[:：]/, '').trim();
    if (/^年齢[:：]/.test(line)) patch.age = line.replace(/^年齢[:：]/, '').trim();
    if (/^目標[:：]/.test(line)) patch.goal = line.replace(/^目標[:：]/, '').trim();
  }

  return patch;
}

module.exports = {
  extractProfilePatchFromText
};
