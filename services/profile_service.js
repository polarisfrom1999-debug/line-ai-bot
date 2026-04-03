'use strict';

/**
 * services/profile_service.js
 *
 * 明示入力だけで重要プロフィールを更新する。
 */

function normalizeName(name) {
  const cleaned = String(name || '').trim().replace(/[！!。.]$/g, '');
  if (!cleaned) return null;
  if (/日になりそう|暖かい|気分/.test(cleaned)) return null;
  if (cleaned.length > 20) return null;
  return cleaned;
}

function parseExplicitProfileInput(text) {
  const src = String(text || '').trim();
  const out = {};

  let m = src.match(/^名前は\s*(.+?)\s*です[！!。]?$/);
  if (m) {
    const n = normalizeName(m[1]);
    if (n) out.preferredName = n;
  }

  m = src.match(/^(.+?)\s*と呼んでください[！!。]?$/);
  if (m) {
    const n = normalizeName(m[1]);
    if (n) out.preferredName = n;
  }

  m = src.match(/(\d+(?:\.\d+)?)\s*kg/);
  if (m) out.weightKg = Number(m[1]);

  m = src.match(/(19\d{2}|20\d{2})年生まれ/);
  if (m) out.birthYear = Number(m[1]);

  return out;
}

function mergeProfile(profile = {}, updates = {}) {
  return { ...profile, ...updates, updatedAt: new Date().toISOString() };
}

function describeProfile(profile = {}) {
  const parts = [];
  if (profile.preferredName) parts.push(`名前は「${profile.preferredName}」`);
  if (profile.weightKg != null) parts.push(`体重は${profile.weightKg}kg`);
  if (profile.birthYear) parts.push(`生年は${profile.birthYear}年`);
  return parts.length ? `${parts.join('、')}として見ています。` : '今のところプロフィール情報はまだ多くありません。';
}

function answerProfileQuestion(text, profile = {}) {
  const src = String(text || '');
  if (/名前.*覚えて|私の名前|名前は\?$|名前は？/.test(src)) {
    return profile.preferredName
      ? `名前は「${profile.preferredName}」として覚えています。`
      : 'まだ名前ははっきり受け取れていないので、よければ「名前は うっし〜です」のように送ってください。';
  }

  if (/プロフィール/.test(src)) {
    return describeProfile(profile);
  }

  if (/体重/.test(src) && profile.weightKg != null) {
    return `体重は ${profile.weightKg}kg として見ています。`;
  }

  return null;
}

module.exports = {
  normalizeName,
  parseExplicitProfileInput,
  mergeProfile,
  describeProfile,
  answerProfileQuestion,
};
