'use strict';

function normalizeText(value) {
  return String(value || '').trim();
}

function round0(value) {
  return Math.round(Number(value || 0));
}

const ACTIVITY_LIBRARY = [
  { name: 'ウォーキング', patterns: [/ウォーキング/, /歩いた/, /歩いてきた/, /歩いてる/, /歩いている/, /散歩/], met: 3.5, defaultMinutes: 20 },
  { name: 'ジョギング', patterns: [/ジョギング/, /ランニング/, /走った/, /走ってきた/, /走ってる/, /走っている/, /マラソン/], met: 7.0, defaultMinutes: 20 },
  { name: 'ストレッチ', patterns: [/ストレッチ/, /ほぐし/, /体操/], met: 2.3, defaultMinutes: 10 },
  { name: '筋トレ', patterns: [/筋トレ/, /スクワット/, /腕立て/, /腹筋/], met: 5.0, defaultMinutes: 10 },
  { name: '階段', patterns: [/階段/], met: 8.0, defaultMinutes: 5 },
  { name: '草むしり', patterns: [/草むしり/, /草取り/], met: 4.5, defaultMinutes: 20 },
  { name: '窓ふき', patterns: [/窓ふき/, /窓拭き/], met: 3.5, defaultMinutes: 15 },
  { name: '掃除', patterns: [/掃除/, /掃除機/], met: 3.3, defaultMinutes: 15 },
  { name: '家事', patterns: [/洗濯/, /皿洗い/, /料理した/, /家事/], met: 2.8, defaultMinutes: 20 },
];

function parseMinutes(text, fallback = 0) {
  const safe = normalizeText(text);
  const minMatch = safe.match(/(\d{1,3})\s*分/);
  if (minMatch) return Number(minMatch[1]);
  const hourMatch = safe.match(/(\d{1,2})(?:\.5)?\s*時間/);
  if (hourMatch) {
    const raw = Number(hourMatch[1]);
    return safe.includes('.5') ? raw * 60 + 30 : raw * 60;
  }
  const countMatch = safe.match(/(\d{1,4})\s*回/);
  if (countMatch) {
    const count = Number(countMatch[1]);
    if (/スクワット|腕立て|腹筋/.test(safe)) return Math.max(fallback || 3, Math.ceil(count / 10) * 2);
  }
  return fallback;
}

function estimateCaloriesFromMet(met, weightKg, minutes) {
  const kg = Math.max(35, Number(weightKg || 60));
  const mins = Math.max(1, Number(minutes || 0));
  return round0((met * 3.5 * kg / 200) * mins);
}

function parseActivity(text, weightKg = 60) {
  const safe = normalizeText(text);
  if (!safe) return null;

  const matched = ACTIVITY_LIBRARY.find((item) => item.patterns.some((pattern) => pattern.test(safe)));
  if (!matched) return null;

  const minutes = parseMinutes(safe, matched.defaultMinutes);
  const estimatedCalories = estimateCaloriesFromMet(matched.met, weightKg, minutes);

  return {
    type: 'exercise',
    name: matched.name,
    summary: safe,
    minutes,
    estimatedCalories,
    praise: estimatedCalories >= 120
      ? 'しっかり動けていますね。今日の積み上がりが見えやすいです。'
      : estimatedCalories >= 50
        ? 'いい流れです。小さな積み上がりでも十分意味があります。'
        : '小さな一歩でもちゃんと前進です。続けられているのが大きいです。'
  };
}

module.exports = {
  parseActivity,
  estimateCaloriesFromMet,
};
