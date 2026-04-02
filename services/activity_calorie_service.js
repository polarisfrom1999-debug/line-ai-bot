'use strict';

const METS = {
  '散歩': 2.8,
  '歩いた': 3.0,
  'ウォーキング': 3.5,
  'ジョギング': 7.0,
  'ランニング': 8.0,
  'マラソン': 8.5,
  'スクワット': 5.0,
  '筋トレ': 4.5,
  'ストレッチ': 2.3,
  '体操': 3.0,
  '草むしり': 4.5,
  '窓拭き': 3.2,
  '掃除': 3.3,
  '家事': 2.8,
};

function normalizeText(value) {
  return String(value || '').trim();
}

function findMinutes(text) {
  const safe = normalizeText(text);
  const match = safe.match(/(\d+)(?:分|ぷん|minutes?)/i);
  return match ? Number(match[1]) : 0;
}

function findActivityName(text) {
  const safe = normalizeText(text);
  return Object.keys(METS).find((name) => safe.includes(name)) || '';
}

function estimateActivityCalories({ text, weightKg }) {
  const safeWeight = Math.max(30, Number(weightKg || 55));
  const minutes = findMinutes(text);
  const activityName = findActivityName(text);
  if (!activityName || !minutes) {
    return {
      ok: false,
      activityName,
      minutes,
      kcal: 0,
    };
  }
  const mets = METS[activityName] || 3.0;
  const kcal = Math.round((mets * 3.5 * safeWeight / 200) * minutes);
  return {
    ok: true,
    activityName,
    minutes,
    kcal,
    mets,
  };
}

module.exports = {
  METS,
  estimateActivityCalories,
};
