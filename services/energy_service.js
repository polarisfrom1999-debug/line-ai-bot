'use strict';

function normalizeText(value) {
  return String(value || '').trim();
}

function toHalfWidth(text) {
  return normalizeText(text).replace(/[０-９．]/g, (s) => String.fromCharCode(s.charCodeAt(0) - 0xFEE0));
}

function round1(value) {
  return Math.round((Number(value || 0) + Number.EPSILON) * 10) / 10;
}

function hashText(value) {
  const safe = normalizeText(value);
  let h = 0;
  for (let i = 0; i < safe.length; i += 1) h = ((h << 5) - h) + safe.charCodeAt(i);
  return Math.abs(h || 0);
}

function pickVariant(seed, variants) {
  const rows = Array.isArray(variants) ? variants.filter(Boolean) : [];
  if (!rows.length) return '';
  return rows[seed % rows.length];
}

function extractMinutes(text) {
  const safe = toHalfWidth(text);
  const match = safe.match(/([0-9]+(?:\.[0-9]+)?)\s*分/);
  if (!match) return null;
  return Number(match[1]);
}

function extractSteps(text) {
  const safe = toHalfWidth(text);
  const match = safe.match(/([0-9]+(?:\,[0-9]{3})*)\s*歩/);
  if (!match) return null;
  return Number(match[1].replace(/,/g, ''));
}

function extractDistanceKm(text) {
  const safe = toHalfWidth(text);
  const match = safe.match(/([0-9]+(?:\.[0-9]+)?)\s*(?:km|キロ)/i);
  if (!match) return null;
  return Number(match[1]);
}

function extractCount(text, labelRegex) {
  const safe = toHalfWidth(text);
  const match = safe.match(new RegExp(`([0-9]+)\\s*(?:回|${labelRegex})`));
  if (!match) return null;
  return Number(match[1]);
}

function detectExerciseType(text) {
  const safe = normalizeText(text);
  if (/ジョギング|ランニング|走った|走りました|走る/.test(safe)) return 'jogging';
  if (/ウォーキング|歩いた|散歩/.test(safe)) return 'walking';
  if (/スクワット/.test(safe)) return 'squat';
  if (/腕立て|プッシュアップ/.test(safe)) return 'pushup';
  if (/ストレッチ/.test(safe)) return 'stretch';
  if (/筋トレ/.test(safe)) return 'strength';
  if (/運動/.test(safe)) return 'exercise';
  return 'unknown';
}

function getExerciseDisplayName(type) {
  if (type === 'jogging') return 'ジョギング';
  if (type === 'walking') return 'ウォーキング';
  if (type === 'squat') return 'スクワット';
  if (type === 'pushup') return '腕立て';
  if (type === 'stretch') return 'ストレッチ';
  if (type === 'strength') return '筋トレ';
  return '運動';
}

function estimateExerciseCalories(text, options = {}) {
  const safe = normalizeText(text);
  const type = detectExerciseType(safe);
  const minutes = extractMinutes(safe);
  const steps = extractSteps(safe);
  const distanceKm = extractDistanceKm(safe);
  const weightKg = Number(options?.weightKg || 60);

  if (type === 'jogging') {
    if (distanceKm) return Math.round(distanceKm * weightKg * 1.03);
    return Math.round((minutes || 20) * 8);
  }

  if (type === 'walking') {
    if (steps) return Math.round(steps * 0.04);
    if (distanceKm) return Math.round(distanceKm * weightKg * 0.53);
    return Math.round((minutes || 20) * 4);
  }

  if (type === 'squat') {
    const count = extractCount(safe, '回');
    if (count) return Math.round(count * 0.45);
    return Math.round((minutes || 10) * 5);
  }

  if (type === 'pushup') {
    const count = extractCount(safe, '回');
    if (count) return Math.round(count * 0.35);
    return Math.round((minutes || 10) * 5.5);
  }

  if (type === 'stretch') {
    return Math.round((minutes || 15) * 2.5);
  }

  if (type === 'strength' || type === 'exercise') {
    return Math.round((minutes || 20) * 5);
  }

  return null;
}

function buildExerciseRecord(text, options = {}) {
  const safe = normalizeText(text);
  if (!safe) return null;
  // メニュー設計・相談文を運動「記録」にしない
  if (/練習メニュー|メニュー.*(考え|教え)|考えて|中学生|部活|選手|アドバイス|相談|どうすれば|おすすめ|プラン|プログラム/.test(safe)) {
    return null;
  }

  const type = detectExerciseType(safe);
  const minutes = extractMinutes(safe);
  const steps = extractSteps(safe);
  const distanceKm = extractDistanceKm(safe);
  const estimatedCalories = estimateExerciseCalories(safe, options);

  return {
    type: 'exercise',
    name: getExerciseDisplayName(type),
    exerciseType: type,
    summary: safe,
    minutes,
    steps,
    distanceKm,
    estimatedCalories
  };
}

function buildExerciseReply(record) {
  const safeRecord = record || {};
  const name = safeRecord.name || '運動';
  const minutes = safeRecord.minutes != null ? Number(safeRecord.minutes) : null;
  const distanceKm = safeRecord.distanceKm != null ? Number(safeRecord.distanceKm) : null;
  const steps = safeRecord.steps != null ? Number(safeRecord.steps) : null;
  const kcal = safeRecord.estimatedCalories != null ? Number(safeRecord.estimatedCalories) : null;
  const seed = hashText(`${safeRecord.summary || ''}|${name}|${minutes || ''}|${distanceKm || ''}|${steps || ''}`);

  const effortLabel = minutes != null
    ? `${name}${minutes ? `を${minutes}分` : ''}`
    : distanceKm != null
      ? `${name}${distanceKm ? `で${distanceKm}km` : ''}`
      : steps != null
        ? `${name}${steps ? `で${steps}歩` : ''}`
        : name;

  const intro = pickVariant(seed, [
    `${effortLabel}、いい流れです。`,
    `今日は${effortLabel}ですね。`,
    `${effortLabel}できたの、ちゃんと積み上がっています。`,
    `${effortLabel}まで持っていけたのは大きいです。`
  ]);

  const detail = kcal != null
    ? pickVariant(seed + 1, [
        `体重やペース差はあるけれど、目安にすると ${kcal}kcal 前後です。`,
        `ざっくり見ると ${kcal}kcal くらいの動きです。`,
        `この1回でみると、消費はだいたい ${kcal}kcal 前後です。`
      ])
    : pickVariant(seed + 1, [
        '数字は細かく置いておいても、体を動かせた事実がちゃんと残ります。',
        '厳密な数字より、動けた流れが今日は十分価値あります。',
        '量よりも、止まらず続けられていることを大事にして大丈夫です。',
      ]);

  const close = pickVariant(seed + 2, [
    'このまま続けやすい形を残していきましょう。',
    '今日はここを一つの前進として置いておけば十分です。',
    '次も完璧じゃなくていいので、続けやすいところでいきましょう。',
    '無理に上乗せしなくても、今の一歩はちゃんと効いてきます。',
  ]);

  return [intro, detail, close].filter(Boolean).join('\n');
}

function buildEnergySummaryText(params = {}) {
  const estimatedBmr = Number(params.estimatedBmr || 0);
  const estimatedTdee = Number(params.estimatedTdee || 0);
  const intakeKcal = Number(params.intakeKcal || 0);
  const activityKcal = Number(params.activityKcal || 0);
  const baseline = estimatedTdee || estimatedBmr;
  const balance = intakeKcal - baseline - activityKcal;

  const lines = [];
  if (estimatedBmr > 0) lines.push(`基礎代謝目安: ${round1(estimatedBmr)}kcal`);
  if (estimatedTdee > 0) lines.push(`1日消費目安: ${round1(estimatedTdee)}kcal`);
  lines.push(`摂取: ${round1(intakeKcal)}kcal`);
  lines.push(`活動消費: ${round1(activityKcal)}kcal`);

  if (baseline > 0) {
    const sign = balance > 0 ? '+' : '';
    lines.push(`ざっくり収支: ${sign}${round1(balance)}kcal`);
  }

  if (balance > 300) {
    lines.push('今日は詰めて戻すより、次の食事を少し整えるくらいで十分です。');
  } else if (balance < -300) {
    lines.push('かなり削れているので、無理を積みすぎないかも見ておきたいです。');
  } else {
    lines.push('今日は大きく外しすぎず、流れを見やすい位置です。');
  }

  return lines.join('\n');
}

module.exports = {
  extractMinutes,
  extractSteps,
  extractDistanceKm,
  estimateExerciseCalories,
  buildExerciseRecord,
  buildExerciseReply,
  buildEnergySummaryText,
  detectExerciseType,
  getExerciseDisplayName
};
