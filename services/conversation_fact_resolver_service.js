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
  const [profile, longMemory] = await Promise.all([
    authoritativeProfileService.getAuthoritativeProfileByLineUser(lineUserId),
    contextMemoryService.getLongMemory(lineUserId)
  ]);

  const factMap = profile?.factMap || {};

  // 重要:
  // ここでは「直近に更新された longMemory 側」を優先して採用する。
  // authoritative は補完用途に回す。
  const merged = {
    preferredName: sanitizePreferredName(
      longMemory?.preferredName ||
      factMap.preferredName?.value ||
      profile?.preferredName ||
      profile?.displayName ||
      ''
    ),
    age: normalizeText(
      longMemory?.age ||
      factMap.age?.value ||
      profile?.age ||
      ''
    ),
    height: withUnitIfMissing(
      longMemory?.height ||
      factMap.height?.value ||
      profile?.height ||
      '',
      'cm'
    ),
    weight: withUnitIfMissing(
      longMemory?.weight ||
      factMap.weight?.value ||
      profile?.latestWeight ||
      '',
      'kg'
    ),
    bodyFat: withUnitIfMissing(
      longMemory?.bodyFat ||
      factMap.bodyFat?.value ||
      profile?.latestBodyFat ||
      '',
      '%'
    ),
    goal: normalizeText(
      longMemory?.goal ||
      factMap.goal?.value ||
      profile?.goal ||
      ''
    ),
    aiType: normalizeText(longMemory?.aiType || ''),
    constitutionType: normalizeText(longMemory?.constitutionType || ''),
    selectedPlan: normalizeText(longMemory?.selectedPlan || longMemory?.plan || '')
  };

  return { merged, profile, longMemory };
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
    return `今は ${parts.join(' / ')} として見ています。`;
  }

  const latest = await contextMemoryService.getLatestWeightEntry(lineUserId);
  if (!latest) {
    return 'まだ体重の記録がはっきり残っていないので、分かる数値を送ってもらえたらそこから見ていけます。';
  }

  const latestParts = [];
  if (latest.weight != null) latestParts.push(`体重 ${latest.weight}`);
  if (latest.bodyFat != null) latestParts.push(`体脂肪率 ${latest.bodyFat}`);
  return `${latest.date} の最新は ${latestParts.join(' / ')} です。`;
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
  buildNameReply,
  buildWeightLookupReply,
  buildMemoryAnswer,
  buildProfileSummary,
  persistInlineProfile
};
