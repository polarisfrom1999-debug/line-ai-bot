'use strict';

function hoursSince(lastAt) {
  if (!lastAt) return null;
  const dt = new Date(lastAt);
  if (Number.isNaN(dt.getTime())) return null;
  return (Date.now() - dt.getTime()) / 3600000;
}

function buildReentryGuide({ lastUserAt, profile = {} } = {}) {
  const gapHours = hoursSince(lastUserAt);
  if (gapHours == null || gapHours < 18) return null;

  const gapText = gapHours >= 24 * 7 ? '少し久しぶりでも' : '少し間が空いていても';
  return {
    title: '再開ガイド',
    shortText: `${gapText}、今日のこと一つからで大丈夫です。`,
    guidanceHint: '責めずに再開しやすい入口を優先します。',
  };
}

module.exports = { buildReentryGuide };
