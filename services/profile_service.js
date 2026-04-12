'use strict';

function normalizeText(value) {
  return String(value || '').trim();
}

function toHalfWidth(text) {
  return normalizeText(text).replace(/[０-９．％]/g, (s) => String.fromCharCode(s.charCodeAt(0) - 0xFEE0));
}

function splitLines(text) {
  return normalizeText(text)
    .split(/\n+/)
    .map((line) => normalizeText(line))
    .filter(Boolean);
}

function normalizeWeightLike(value, unit) {
  const safe = toHalfWidth(value).replace(/[^\d.]/g, '');
  if (!safe) return normalizeText(value);
  return unit ? `${safe}${unit}` : safe;
}

function lineLooksLikeQuestion(line) {
  return /教えて|知りたい|覚えてる|なんだっけ|ですか|ますか|\?$|？$/.test(normalizeText(line));
}

function sanitizePreferredName(value) {
  const safe = normalizeText(value)
    .replace(/^(私の名前は|名前は|名前：|名前:)/u, '')
    .replace(/(です|だよ|ですよ|と呼んでください|って呼んで|と呼んで).*$/u, '')
    .trim();

  if (!safe) return '';
  if (safe.length > 12) return '';
  if (/今日|昨日|明日|暖か|眠い|しんど|痛い|なりそう|です$|ます$/.test(safe)) return '';
  if (/\s/.test(safe)) return '';
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

function extractProfilePatchFromLine(line) {
  const safe = normalizeText(line);
  if (!safe || lineLooksLikeQuestion(safe)) return {};

  const patch = {};

  const nameMatch = safe.match(/^(?:私の名前は|名前(?:は|[：:])?)\s*(.+)$/u);
  const ageMatch = safe.match(/^年齢(?:は|[：:])?\s*([0-9０-９]+(?:\.[0-9０-９]+)?)$/u);
  const heightMatch = safe.match(/^身長(?:は|[：:])?\s*([0-9０-９]+(?:\.[0-9０-９]+)?)\s*(?:cm|ＣＭ|センチ)?$/iu);
  const weightMatch = safe.match(/^体重(?:は|[：:])?\s*([0-9０-９]+(?:\.[0-9０-９]+)?)\s*(?:kg|ＫＧ|キロ)?$/iu);
  const bodyFatMatch = safe.match(/^体脂肪率(?:は|[：:])?\s*([0-9０-９]+(?:\.[0-9０-９]+)?)\s*(?:%|％|パーセント)?$/iu);
  const goalMatch = safe.match(/^目標(?:は|[：:])?\s*(.+)$/u);

  if (nameMatch) {
    const preferredName = normalizeProfileValue('preferredName', nameMatch[1]);
    if (preferredName) patch.preferredName = preferredName;
  }
  if (ageMatch) patch.age = normalizeProfileValue('age', ageMatch[1]);
  if (heightMatch) patch.height = normalizeProfileValue('height', heightMatch[1]);
  if (weightMatch) patch.weight = normalizeProfileValue('weight', weightMatch[1]);
  if (bodyFatMatch) patch.bodyFat = normalizeProfileValue('bodyFat', bodyFatMatch[1]);
  if (goalMatch) patch.goal = normalizeProfileValue('goal', goalMatch[1]);

  return patch;
}

function extractProfilePatchFromText(text) {
  const lines = splitLines(text);
  const patch = {};

  for (const line of lines) {
    Object.assign(patch, extractProfilePatchFromLine(line));
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
  if (longMemory?.selectedPlan || longMemory?.plan) lines.push(`プラン: ${longMemory?.selectedPlan || longMemory?.plan}`);

  const narrative = longMemory?.narrativeMemory || {};
  if (Array.isArray(narrative?.supportStyleNotes) && narrative.supportStyleNotes.length) {
    lines.push(`伴走メモ: ${narrative.supportStyleNotes.slice(0, 2).join(' / ')}`);
  }

  if (!lines.length) {
    return 'プロフィールはまだ強く残っていません。これから少しずつ整えていきましょう。';
  }

  return lines.join('\n');
}

function buildProfileUpdatedReply(patch) {
  const updates = [];

  const preferredName = sanitizePreferredName(patch?.preferredName || '');
  if (preferredName) updates.push(`名前は ${preferredName}`);
  if (patch?.age) updates.push(`年齢は ${patch.age}`);
  if (patch?.height) updates.push(`身長は ${patch.height}`);
  if (patch?.weight) updates.push(`体重は ${patch.weight}`);
  if (patch?.bodyFat) updates.push(`体脂肪率は ${patch.bodyFat}`);
  if (patch?.goal) updates.push(`目標は ${patch.goal}`);

  if (!updates.length) return '更新したい項目があれば、そのまま一言ずつでも大丈夫です。';
  return `プロフィールを整えました。
${updates.join(' / ')}`;
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
  if (longMemory?.aiType) lines.push(`AIタイプは ${longMemory.aiType} です。`);
  if (longMemory?.constitutionType) lines.push(`体質タイプは ${longMemory.constitutionType} です。`);
  if (longMemory?.selectedPlan || longMemory?.plan) lines.push(`プランは ${longMemory?.selectedPlan || longMemory?.plan} です。`);

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

  return lines.join('\n');
}

module.exports = {
  extractProfilePatchFromText,
  buildProfileSummary,
  buildProfileUpdatedReply,
  buildMemoryAnswer
};