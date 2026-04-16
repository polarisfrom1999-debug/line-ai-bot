'use strict';

/**
 * 直近の assistant 発話と照らし、同じ締め・前置きの連打を避ける。
 */

const BANNED_SUBSTRINGS = [
  '夜は無理に詰め込まず',
  '整える視点でいきましょう',
  '必要なら次の一手を一緒に1つだけ決めましょう',
  'そのまま一言で大丈夫です',
  '一緒に、できる一歩から進めていきましょう',
  'まずは1つに絞って進めれば大丈夫です',
  '焦らず、前向きにいきましょう',
  '今日は攻めるより、減速して整える判断で大丈夫です',
  'またその時々で一緒に見ていきましょう',
  '責めるより、次にどう整えやすいかを一緒に見ていきましょう',
  'また必要なところだけ詰めよう',
];

function normalizeForOverlap(s) {
  return String(s || '')
    .replace(/\s+/g, '')
    .replace(/[。．、,!！?？]/g, '');
}

function recentAssistantBodies(recentMessages, limit = 5) {
  const list = Array.isArray(recentMessages) ? recentMessages : [];
  return list
    .filter((m) => m && m.role === 'assistant' && String(m.content || '').trim())
    .slice(-limit)
    .map((m) => String(m.content || '').trim());
}

function phraseRecentlyUsed(phrase, recentBodies, windowSize = 3) {
  const p = normalizeForOverlap(phrase);
  if (!p || p.length < 8) return false;
  const tail = recentBodies.slice(-windowSize);
  let hits = 0;
  for (const body of tail) {
    if (normalizeForOverlap(body).includes(p)) hits += 1;
  }
  return hits >= 1;
}

function shouldAppendClosingHint(recentBodies) {
  const hint = '必要なら次の一手を一緒に1つだけ決めましょう';
  return !phraseRecentlyUsed(hint, recentBodies, 4);
}

function stripBannedLines(text) {
  const lines = String(text || '')
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);
  const out = [];
  for (const line of lines) {
    const banned = BANNED_SUBSTRINGS.some((b) => line.includes(b));
    if (!banned) out.push(line);
  }
  return out.join('\n');
}

function scrubReplyAgainstRecent(text, recentBodies) {
  let out = String(text || '');
  for (const ban of BANNED_SUBSTRINGS) {
    if (phraseRecentlyUsed(ban, recentBodies, 3) && out.includes(ban)) {
      out = out.split('\n').filter((line) => !line.includes(ban)).join('\n');
    }
  }

  const recentNormalized = recentBodies
    .map((body) => normalizeForOverlap(body))
    .filter(Boolean);

  const filteredLines = out
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .filter((line) => {
      const normalized = normalizeForOverlap(line);
      if (!normalized || normalized.length < 10) return true;
      return !recentNormalized.includes(normalized);
    });

  return filteredLines.join('\n').trim();
}

module.exports = {
  BANNED_SUBSTRINGS,
  recentAssistantBodies,
  phraseRecentlyUsed,
  shouldAppendClosingHint,
  stripBannedLines,
  scrubReplyAgainstRecent,
};
