"use strict";

const authoritativeProfileService = require('./authoritative_profile_service');
const contextMemoryService = require('./context_memory_service');
const profileService = require('./profile_service');

function normalizeText(value) {
  return String(value || '').trim();
}


async function buildNameReply(lineUserId) {
  const [profile, longMemory] = await Promise.all([
    authoritativeProfileService.getAuthoritativeProfileByLineUser(lineUserId),
    contextMemoryService.getLongMemory(lineUserId)
  ]);

  const preferredName = normalizeText(profile?.preferredName || longMemory?.preferredName || '');
  if (preferredName) return `名前は「${preferredName}」として覚えています。`;
  return '今は名前がまだはっきり固定できていないので、名前だけもう一度送ってもらえたら確定して以後そこを優先します。';
}

async function buildWeightLookupReply(lineUserId) {
  const profile = await authoritativeProfileService.getAuthoritativeProfileByLineUser(lineUserId);
  if (profile?.latestWeight || profile?.latestBodyFat) {
    const parts = [];
    if (profile.latestWeight) parts.push(`体重 ${profile.latestWeight}kg`);
    if (profile.latestBodyFat) parts.push(`体脂肪率 ${profile.latestBodyFat}%`);
    if (profile.latestWeightDate) return `${profile.latestWeightDate} 時点では ${parts.join(' / ')} です。`;
    return `今は ${parts.join(' / ')} として見ています。`;
  }

  const latest = await contextMemoryService.getLatestWeightEntry(lineUserId);
  if (!latest) return 'まだ体重の記録がはっきり残っていないので、分かる数値を送ってもらえたらそこから見ていけます。';
  const parts = [];
  if (latest.weight != null) parts.push(`体重 ${latest.weight}`);
  if (latest.bodyFat != null) parts.push(`体脂肪率 ${latest.bodyFat}`);
  return `${latest.date} の最新は ${parts.join(' / ')} です。`;
}

async function buildMemoryAnswer(lineUserId) {
  const [profile, longMemory] = await Promise.all([
    authoritativeProfileService.getAuthoritativeProfileByLineUser(lineUserId),
    contextMemoryService.getLongMemory(lineUserId)
  ]);

  const lines = [];
  const preferredName = normalizeText(profile?.preferredName || longMemory?.preferredName || '');
  if (preferredName) lines.push(`名前は「${preferredName}」として覚えています。`);
  if (profile?.height || longMemory?.height) lines.push(`身長は ${profile?.height || longMemory?.height}cm として見ています。`);
  if (profile?.latestWeight || longMemory?.weight) lines.push(`体重は ${profile?.latestWeight || longMemory?.weight} として見ています。` + (!profile?.latestWeight && /kg$/i.test(longMemory?.weight || '') ? '' : (profile?.latestWeight ? 'kg' : '')));
  if (profile?.latestBodyFat || longMemory?.bodyFat) lines.push(`体脂肪率は ${profile?.latestBodyFat || longMemory?.bodyFat}${profile?.latestBodyFat ? '%' : ''} として見ています。`);
  if (profile?.age || longMemory?.age) lines.push(`年齢は ${profile?.age || longMemory?.age} として見ています。`);
  if (profile?.goal || longMemory?.goal) lines.push(`目標は「${profile?.goal || longMemory?.goal}」です。`);
  if (longMemory?.aiType) lines.push(`AIタイプは「${longMemory.aiType}」です。`);
  if (longMemory?.constitutionType) lines.push(`体質タイプは「${longMemory.constitutionType}」です。`);
  if (longMemory?.selectedPlan) lines.push(`プランは「${longMemory.selectedPlan}」です。`);

  if (!lines.length) return '今はまだ強く残っていることは多くないので、これから少しずつ覚えていきますね。';
  return lines.join('\n');
}

async function buildProfileSummary(lineUserId) {
  const [profile, longMemory] = await Promise.all([
    authoritativeProfileService.getAuthoritativeProfileByLineUser(lineUserId),
    contextMemoryService.getLongMemory(lineUserId)
  ]);

  const merged = {
    ...longMemory,
    preferredName: profile?.preferredName || longMemory?.preferredName || null,
    age: profile?.age || longMemory?.age || null,
    height: profile?.height || longMemory?.height || null,
    weight: profile?.latestWeight ? `${profile.latestWeight}kg` : (longMemory?.weight || null),
    bodyFat: profile?.latestBodyFat ? `${profile.latestBodyFat}%` : (longMemory?.bodyFat || null),
    goal: profile?.goal || longMemory?.goal || null
  };
  return profileService.buildProfileSummary(merged);
}

async function persistInlineProfile(lineUserId, patch = {}) {
  return authoritativeProfileService.persistProfilePatchByLineUser(lineUserId, patch, { sourceKind: 'inline_profile' });
}

module.exports = {
  buildNameReply,
  buildWeightLookupReply,
  buildMemoryAnswer,
  buildProfileSummary,
  persistInlineProfile
};
