'use strict';

function normalizeText(value) {
  return String(value || '').trim();
}

function round0(v) {
  return Math.round(Number(v || 0));
}

const ACTIVITY_LIBRARY = [
  { pattern: /ストレッチ|柔軟|ほぐし|体操/, label: 'ストレッチ', met: 2.5 },
  { pattern: /筋トレ|スクワット|腕立て|腹筋|プランク/, label: '筋トレ', met: 5.0 },
  { pattern: /散歩|ウォーキング|歩いた/, label: 'ウォーキング', met: 3.5 },
  { pattern: /ジョギング|ランニング|走った|マラソン/, label: 'ジョギング', met: 7.0 },
  { pattern: /自転車|サイクリング/, label: '自転車', met: 5.5 },
  { pattern: /ヨガ/, label: 'ヨガ', met: 2.8 },
  { pattern: /草むしり|草取り/, label: '草むしり', met: 4.5 },
  { pattern: /窓拭き|窓ふき|掃除/, label: '掃除', met: 3.5 },
  { pattern: /洗車/, label: '洗車', met: 3.5 },
  { pattern: /階段/, label: '階段', met: 5.0 },
  { pattern: /家事|皿洗い|料理した/, label: '家事', met: 2.5 },
  { pattern: /荷物運び|引っ越し/, label: '荷物運び', met: 6.0 },
];

function extractMinutes(text) {
  const safe = normalizeText(text);
  const m = safe.match(/(\d+(?:\.\d+)?)\s*(分|ぷん)/);
  if (m) return Number(m[1]);
  const h = safe.match(/(\d+(?:\.\d+)?)\s*(時間|じかん|h|hr|hrs)/i);
  if (h) return Number(h[1]) * 60;
  return null;
}

function extractDistanceKm(text) {
  const safe = normalizeText(text);
  const m = safe.match(/(\d+(?:\.\d+)?)\s*(km|キロ)/i);
  return m ? Number(m[1]) : null;
}

function inferActivity(text) {
  const safe = normalizeText(text);
  for (const item of ACTIVITY_LIBRARY) {
    if (item.pattern.test(safe)) return item;
  }
  return null;
}

function estimateCalories({ met, minutes, weightKg = 60 }) {
  if (!met || !minutes) return null;
  return round0(met * 3.5 * weightKg / 200 * minutes);
}

function parseActivityText(text, profile = {}) {
  const safe = normalizeText(text);
  const activity = inferActivity(safe);
  if (!activity) return null;

  const minutes = extractMinutes(safe) || (activity.label === 'ジョギング' && extractDistanceKm(safe) ? round0(extractDistanceKm(safe) * 6.5) : null) || 15;
  const distanceKm = extractDistanceKm(safe);
  const estimatedCalories = estimateCalories({ met: activity.met, minutes, weightKg: Number(profile.weightKg || profile.weight || 60) || 60 });

  return {
    type: 'exercise',
    name: activity.label,
    exerciseType: activity.label,
    summary: safe,
    minutes,
    distanceKm,
    estimatedCalories,
    met: activity.met,
  };
}

module.exports = {
  ACTIVITY_LIBRARY,
  parseActivityText,
  estimateCalories,
};
