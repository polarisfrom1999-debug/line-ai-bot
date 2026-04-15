"use strict";

const authoritativeProfileService = require('./authoritative_profile_service');
const contextMemoryService = require('./context_memory_service');
const profileService = require('./profile_service');

function normalizeText(value) {
  return String(value || '').trim();
}

function sanitizePreferredName(value) {
  return normalizeText(value)
    .replace(/^(私の名前は|名前は|名前：|名前:)/u, '')
    .replace(/(です|だよ|ですよ|と呼んでください|って呼んで|と呼んで).*$/u, '')
    .replace(/\s+/g, '')
    .trim();
}

function withUnitIfMissing(value, unit) {
  const safe = normalizeText(value);
  if (!safe) return '';
  return new RegExp(`${unit}$`, 'i').test(safe) ? safe : `${safe}${unit}`;
}

function pickLatestValue(...values) {
  for (const value of values) {
    const safe = normalizeText(value);
    if (safe) return safe;
  }
  return '';
}

async function inferNameFromRecentMessages(lineUserId) {
  try {
    const recent = await contextMemoryService.getRecentMessages(lineUserId, 40);
    const rows = Array.isArray(recent) ? recent.filter((row) => row && row.role === 'user').slice().reverse() : [];
    for (const row of rows) {
      const safe = normalizeText(row.content || '');
      if (!safe) continue;

      const explicit = safe.match(/(?:^|\n)(?:私の名前は|名前は|名前[：:])\s*([^\n]+)/u);
      if (explicit) {
        const preferred = sanitizePreferredName(explicit[1]);
        if (preferred) return preferred;
      }

      const casual = safe.match(/^(?:私は|ぼくは|僕は|俺は)?\s*([ぁ-んァ-ヶ一-龠A-Za-z0-9〜～ー\-]{1,16})(?:です|だよ|といいます)$/u);
      if (casual) {
        const preferred = sanitizePreferredName(casual[1]);
        if (preferred) return preferred;
      }
    }
  } catch (_error) {}
  return '';
}

async function buildMergedProfile(lineUserId) {
  const [profile, longMemory, latestWeight] = await Promise.all([
    authoritativeProfileService.getAuthoritativeProfileByLineUser(lineUserId),
    contextMemoryService.getLongMemory(lineUserId),
    contextMemoryService.getLatestWeightEntry(lineUserId)
  ]);

  const factMap = profile?.factMap || {};
  const latestWeightValue = latestWeight?.weight != null ? String(latestWeight.weight) : '';
  const latestBodyFatValue = latestWeight?.bodyFat != null ? String(latestWeight.bodyFat) : '';

  const merged = {
    preferredName: sanitizePreferredName(
      pickLatestValue(
        longMemory?.preferredName,
        factMap.preferredName?.value,
        profile?.preferredName,
        profile?.displayName
      )
    ),
    age: pickLatestValue(longMemory?.age, factMap.age?.value, profile?.age),
    height: withUnitIfMissing(
      pickLatestValue(longMemory?.height, factMap.height?.value, profile?.height),
      'cm'
    ),
    weight: withUnitIfMissing(
      pickLatestValue(latestWeightValue, longMemory?.weight, factMap.weight?.value, profile?.latestWeight),
      'kg'
    ),
    bodyFat: withUnitIfMissing(
      pickLatestValue(latestBodyFatValue, longMemory?.bodyFat, factMap.bodyFat?.value, profile?.latestBodyFat),
      '%'
    ),
    goal: pickLatestValue(longMemory?.goal, factMap.goal?.value, profile?.goal),
    aiType: pickLatestValue(longMemory?.aiType),
    voiceStyle: pickLatestValue(longMemory?.voiceStyle, factMap.voiceStyle?.value),
    constitutionType: pickLatestValue(longMemory?.constitutionType),
    selectedPlan: pickLatestValue(longMemory?.selectedPlan, longMemory?.plan),
    latestWeightDate: latestWeight?.date || profile?.latestWeightDate || null
  };

  return { merged, profile, longMemory, latestWeight };
}

async function buildNameReply(lineUserId) {
  const { merged } = await buildMergedProfile(lineUserId);
  if (merged.preferredName) {
    return `名前は「${merged.preferredName}」として覚えています。`;
  }

  const inferred = await inferNameFromRecentMessages(lineUserId);
  if (inferred) {
    await authoritativeProfileService.persistProfilePatchByLineUser(
      lineUserId,
      { preferredName: inferred },
      { sourceKind: 'recent_message_backfill', confidence: 0.8 }
    );
    return `名前は「${inferred}」として覚えています。`;
  }

  return '今は名前がまだはっきり固定できていないので、名前だけもう一度送ってもらえたら確定して以後そこを優先します。';
}

async function buildWeightLookupReply(lineUserId) {
  const { merged } = await buildMergedProfile(lineUserId);

  const parts = [];
  if (merged.weight) parts.push(`体重 ${merged.weight}`);
  if (merged.bodyFat) parts.push(`体脂肪率 ${merged.bodyFat}`);
  if (parts.length) {
    const prefix = merged.latestWeightDate ? `${merged.latestWeightDate} の最新は ` : '今の最新は ';
    return `${prefix}${parts.join(' / ')} です。`;
  }

  return 'まだ体重の記録がはっきり残っていないので、分かる数値を送ってもらえたらそこから見ていけます。';
}

async function buildMemoryAnswer(lineUserId) {
  const { merged } = await buildMergedProfile(lineUserId);

  const lines = [];
  if (merged.preferredName) lines.push(`名前は「${merged.preferredName}」として覚えています。`);
  if (merged.height) lines.push(`身長は ${merged.height} として見ています。`);
  if (merged.weight) lines.push(`体重は ${merged.weight} として見ています。`);
  if (merged.bodyFat) lines.push(`体脂肪率は ${merged.bodyFat} として見ています。`);
  if (merged.age) lines.push(`年齢は ${merged.age} として見ています。`);
  if (merged.goal) lines.push(`目標は「${merged.goal}」です。`);
  if (merged.aiType) lines.push(`AIタイプは「${merged.aiType}」です。`);
  if (merged.voiceStyle) lines.push(`雰囲気は「${merged.voiceStyle}」です。`);
  if (merged.constitutionType) lines.push(`体質タイプは「${merged.constitutionType}」です。`);
  if (merged.selectedPlan) lines.push(`プランは「${merged.selectedPlan}」です。`);

  if (!lines.length) {
    return '今はまだ強く残っていることは多くないので、これから少しずつ覚えていきますね。';
  }
  return lines.join('\n');
}

async function buildProfileSummary(lineUserId) {
  const { merged } = await buildMergedProfile(lineUserId);
  return profileService.buildProfileSummary(merged);
}

async function persistInlineProfile(lineUserId, patch = {}) {
  return authoritativeProfileService.persistProfilePatchByLineUser(
    lineUserId,
    patch,
    { sourceKind: 'inline_profile' }
  );
}

module.exports = {
  buildMergedProfile,
  buildNameReply,
  buildWeightLookupReply,
  buildMemoryAnswer,
  buildProfileSummary,
  persistInlineProfile
};
