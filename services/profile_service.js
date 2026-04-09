'use strict';

function normalizeText(value) {
  return String(value || '').trim();
}

function toHalfWidth(text) {
  return normalizeText(text).replace(/[０-９．％]/g, (s) => String.fromCharCode(s.charCodeAt(0) - 0xFEE0));
}

function extractLineValue(line, label) {
  const regex = new RegExp(`^${label}[：:]\\s*(.+)$`);
  const match = normalizeText(line).match(regex);
  return match ? normalizeText(match[1]) : '';
}

function splitLines(text) {
  return normalizeText(text)
    .split(/\\n+/)
    .map((line) => normalizeText(line))
    .filter(Boolean);
}

function normalizeWeightLike(value, unit) {
  const safe = toHalfWidth(value).replace(/[^\\d.]/g, '');
  if (!safe) return normalizeText(value);
  return unit ? `${safe}${unit}` : safe;
}

function lineLooksLikeQuestion(line) {
  return /教えて|知りたい|覚えてる|なんだっけ|ですか|ますか|\\?$|？$/.test(normalizeText(line));
}

function extractLooseValue(line, _label, regex) {
  const match = normalizeText(line).match(regex);
  return match ? normalizeText(match[1]) : '';
}


function sanitizePreferredName(value) {
  const safe = normalizeText(value)
    .replace(/^(私の名前は|名前は|名前：|名前:)/u, '')
    .replace(/(です|だよ|ですよ|と呼んでください|って呼んで|と呼んで).*$/u, '')
    .trim();

  if (!safe) return '';
  if (safe.length > 12) return '';
  if (/今日|昨日|明日|暖か|眠い|しんど|痛い|なりそう|です$|ます$/.test(safe)) return '';
  if (/\\s/.test(safe)) return '';
  return safe;
}

function normalizeProfileValue(key, value) {
  const safe = normalizeText(value);
  if (!safe) return '';

  if (key === 'preferredName') return sanitizePreferredName(safe);
  if (key === 'weight') return normalizeWeightLike(safe, 'kg');
  if (key === 'bodyFat') return normalizeWeightLike(safe, '%');
  if (key === 'height') return normalizeWeightLike(safe, 'cm');
  return safe;
}

function extractProfilePatchFromText(text) {
  const lines = splitLines(text);
  const patch = {};

  for (const line of lines) {
    if (lineLooksLikeQuestion(line)) continue;

    const name = extractLineValue(line, '名前') || extractLooseValue(line, '名前', /^(?:私の名前は|名前\\s*[は：:]?)\\s*(.+)$/u);
    const age = extractLineValue(line, '年齢') || extractLooseValue(line, '年齢', /^年齢\\s*[は：:]?\\s*([0-9０-９]+(?:\\.[0-9０-９]+)?)$/u);
    const weight = extractLineValue(line, '体重') || extractLooseValue(line, '体重', /^体重\\s*[は：:]?\\s*([0-9０-９]+(?:\\.[0-9０-９]+)?)\\s*(?:kg|ＫＧ|キロ)?$/iu);
    const bodyFat = extractLineValue(line, '体脂肪率') || extractLooseValue(line, '体脂肪率', /^体脂肪率\\s*[は：:]?\\s*([0-9０-９]+(?:\\.[0-9０-９]+)?)\\s*(?:%|％|パーセント)?$/iu);
    const height = extractLineValue(line, '身長') || extractLooseValue(line, '身長', /^身長\\s*[は：:]?\\s*([0-9０-９]+(?:\\.[0-9０-９]+)?)\\s*(?:cm|ＣＭ|センチ)?$/iu);
    const goal = extractLineValue(line, '目標') || extractLooseValue(line, '目標', /^目標\\s*[は：:]?\\s*(.+)$/u);

    if (name) {
      const preferredName = normalizeProfileValue('preferredName', name);
      if (preferredName) patch.preferredName = preferredName;
    }
    if (age) patch.age = normalizeProfileValue('age', age);
    if (weight) patch.weight = normalizeProfileValue('weight', weight);
    if (bodyFat) patch.bodyFat = normalizeProfileValue('bodyFat', bodyFat);
    if (height) patch.height = normalizeProfileValue('height', height);
    if (goal) patch.goal = normalizeProfileValue('goal', goal);
  }

  return patch;
}

function buildProfileSummary(longMemory) {
  const lines = [];

  const preferredName = sanitizePreferredName(longMemory?.preferredName || '');
  if (preferredName) lines.push(`名前: ${preferredName}`);
  if (longMemory?.age) lines.push(`年齢: ${longMemory.age}`);
  if (longMemory?.height) lines.push(`身長: ${longMemory.height}`);
  if (longMemory?.weight) lines.push(`体重: ${longMemory.weight}`);
  if (longMemory?.bodyFat) lines.push(`体脂肪率: ${longMemory.bodyFat}`);
  if (longMemory?.goal) lines.push(`目標: ${longMemory.goal}`);
  if (longMemory?.aiType) lines.push(`AIタイプ: ${longMemory.aiType}`);
  if (longMemory?.constitutionType) lines.push(`体質タイプ: ${longMemory.constitutionType}`);
  if (longMemory?.selectedPlan) lines.push(`プラン: ${longMemory.selectedPlan}`);

  const narrative = longMemory?.narrativeMemory || {};
  if (Array.isArray(narrative?.supportStyleNotes) && narrative.supportStyleNotes.length) {
    lines.push(`伴走メモ: ${narrative.supportStyleNotes.slice(0, 2).join(' / ')}`);
  }

  if (!lines.length) {
    return 'プロフィールはまだ強く残っていません。これから少しずつ整えていきましょう。';
  }

  return lines.join('\\n');
}

function buildProfileUpdatedReply(patch) {
  const lines = ['プロフィールを更新しました。'];

  const preferredName = sanitizePreferredName(patch?.preferredName || '');
  if (preferredName) lines.push(`名前: ${preferredName}`);
  if (patch?.age) lines.push(`年齢: ${patch.age}`);
  if (patch?.height) lines.push(`身長: ${patch.height}`);
  if (patch?.weight) lines.push(`体重: ${patch.weight}`);
  if (patch?.bodyFat) lines.push(`体脂肪率: ${patch.bodyFat}`);
  if (patch?.goal) lines.push(`目標: ${patch.goal}`);

  return lines.join('\\n');
}

function buildMemoryAnswer(longMemory) {
  const lines = [];

  const preferredName = sanitizePreferredName(longMemory?.preferredName || '');
  if (preferredName) lines.push(`名前は「${preferredName}」として覚えています。`);
  if (longMemory?.height) lines.push(`身長は ${longMemory.height} として見ています。`);
  if (longMemory?.weight) lines.push(`体重は ${longMemory.weight} として見ています。`);
  if (longMemory?.bodyFat) lines.push(`体脂肪率は ${longMemory.bodyFat} として見ています。`);
  if (longMemory?.age) lines.push(`年齢は ${longMemory.age} として見ています。`);
  if (longMemory?.goal) lines.push(`目標は「${longMemory.goal}」です。`);
  if (longMemory?.aiType) lines.push(`AIタイプは「${longMemory.aiType}」です。`);
  if (longMemory?.constitutionType) lines.push(`体質タイプは「${longMemory.constitutionType}」です。`);
  if (longMemory?.selectedPlan) lines.push(`プランは「${longMemory.selectedPlan}」です。`);

  const narrative = longMemory?.narrativeMemory || {};
  if (Array.isArray(narrative?.strugglePatterns) && narrative.strugglePatterns.length) {
    lines.push(`最近は「${narrative.strugglePatterns.slice(0, 2).join(' / ')}」も頭に置いています。`);
  }
  if (Array.isArray(narrative?.backgroundContexts) && narrative.backgroundContexts.length) {
    lines.push(`生活背景では「${narrative.backgroundContexts.slice(0, 2).join(' / ')}」も見ています。`);
  }

  if (!lines.length) {
    return '今はまだ強く残っていることは多くないので、これから少しずつ覚えていきますね。';
  }

  return lines.join('\\n');
}

module.exports = {
  extractProfilePatchFromText,
  buildProfileSummary,
  buildProfileUpdatedReply,
  buildMemoryAnswer
};