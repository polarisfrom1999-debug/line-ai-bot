services/profile_service.js
'use strict';

function normalizeText(value) {
  return String(value || '').trim();
}

function extractLineValue(line, label) {
  const regex = new RegExp(`^${label}[：:]\\s*(.+)$`);
  const match = normalizeText(line).match(regex);
  return match ? normalizeText(match[1]) : '';
}

function splitLines(text) {
  return normalizeText(text)
    .split(/\n+/)
    .map((line) => normalizeText(line))
    .filter(Boolean);
}

function extractProfilePatchFromText(text) {
  const lines = splitLines(text);
  const patch = {};

  for (const line of lines) {
    const name = extractLineValue(line, '名前');
    const age = extractLineValue(line, '年齢');
    const weight = extractLineValue(line, '体重');
    const bodyFat = extractLineValue(line, '体脂肪率');
    const goal = extractLineValue(line, '目標');

    if (name) patch.preferredName = name;
    if (age) patch.age = age;
    if (weight) patch.weight = weight;
    if (bodyFat) patch.bodyFat = bodyFat;
    if (goal) patch.goal = goal;
  }

  return patch;
}

function buildProfileSummary(longMemory) {
  const lines = [];

  if (longMemory?.preferredName) lines.push(`名前: ${longMemory.preferredName}`);
  if (longMemory?.age) lines.push(`年齢: ${longMemory.age}`);
  if (longMemory?.weight) lines.push(`体重: ${longMemory.weight}`);
  if (longMemory?.bodyFat) lines.push(`体脂肪率: ${longMemory.bodyFat}`);
  if (longMemory?.goal) lines.push(`目標: ${longMemory.goal}`);
  if (longMemory?.aiType) lines.push(`AIタイプ: ${longMemory.aiType}`);
  if (longMemory?.constitutionType) lines.push(`体質タイプ: ${longMemory.constitutionType}`);
  if (longMemory?.selectedPlan) lines.push(`プラン: ${longMemory.selectedPlan}`);

  if (!lines.length) {
    return 'プロフィールはまだ強く残っていません。これから少しずつ整えていきましょう。';
  }

  return lines.join('\n');
}

function buildProfileUpdatedReply(patch) {
  const lines = ['プロフィールを更新しました。'];

  if (patch?.preferredName) lines.push(`名前: ${patch.preferredName}`);
  if (patch?.age) lines.push(`年齢: ${patch.age}`);
  if (patch?.weight) lines.push(`体重: ${patch.weight}`);
  if (patch?.bodyFat) lines.push(`体脂肪率: ${patch.bodyFat}`);
  if (patch?.goal) lines.push(`目標: ${patch.goal}`);

  return lines.join('\n');
}

module.exports = {
  extractProfilePatchFromText,
  buildProfileSummary,
  buildProfileUpdatedReply
};
