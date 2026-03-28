services/energy_service.js
'use strict';

function normalizeText(value) {
  return String(value || '').trim();
}

function toHalfWidth(text) {
  return normalizeText(text).replace(/[０-９．]/g, (s) => {
    return String.fromCharCode(s.charCodeAt(0) - 0xFEE0);
  });
}

function extractMinutes(text) {
  const safe = toHalfWidth(text);
  const match = safe.match(/([0-9]+)\s*分/);
  if (!match) return null;
  return Number(match[1]);
}

function estimateExerciseCalories(text) {
  const safe = normalizeText(text);
  const minutes = extractMinutes(safe) || 20;

  if (/ジョギング|ランニング|走った|走りました/.test(safe)) {
    return Math.round(minutes * 8);
  }

  if (/ウォーキング|歩いた/.test(safe)) {
    return Math.round(minutes * 4);
  }

  if (/スクワット/.test(safe)) {
    return Math.round(minutes * 5);
  }

  if (/筋トレ|運動/.test(safe)) {
    return Math.round(minutes * 5);
  }

  return null;
}

function buildExerciseRecord(text) {
  const safe = normalizeText(text);
  if (!safe) return null;

  let name = '運動';
  if (/ジョギング|ランニング|走った|走りました/.test(safe)) name = 'ジョギング';
  else if (/ウォーキング|歩いた/.test(safe)) name = 'ウォーキング';
  else if (/スクワット/.test(safe)) name = 'スクワット';
  else if (/筋トレ/.test(safe)) name = '筋トレ';

  const minutes = extractMinutes(safe);
  const estimatedCalories = estimateExerciseCalories(safe);

  return {
    type: 'exercise',
    name,
    summary: safe,
    minutes,
    estimatedCalories
  };
}

function buildExerciseReply(record) {
  const lines = [];

  if (record?.name) {
    lines.push(`${record.name}として受け取りました。`);
  } else {
    lines.push('運動として受け取りました。');
  }

  if (record?.minutes != null) {
    lines.push(`時間は ${record.minutes}分 として見ています。`);
  }

  if (record?.estimatedCalories != null) {
    lines.push(`消費の目安は 約${record.estimatedCalories}kcal です。`);
  }

  lines.push('量の大小より、動けた流れ自体に意味があります。');
  return lines.join('\n');
}

module.exports = {
  extractMinutes,
  estimateExerciseCalories,
  buildExerciseRecord,
  buildExerciseReply
};
