'use strict';

function normalizeText(value) {
  return String(value || '').trim();
}

function round0(value) {
  return Math.round(Number(value || 0));
}

function toNumberLike(value) {
  const safe = normalizeText(value).replace(/[０-９．]/g, (s) => String.fromCharCode(s.charCodeAt(0) - 0xFEE0));
  const num = Number(safe.replace(/[^\d.]/g, ''));
  return Number.isFinite(num) ? num : 0;
}

function extractProfileWeightKg(profileLike = {}) {
  const candidates = [
    profileLike.latestWeight,
    profileLike.weight,
    profileLike.currentWeight,
    profileLike.factMap?.weight?.value,
    profileLike.longMemory?.weight
  ];
  for (const candidate of candidates) {
    const num = toNumberLike(candidate);
    if (num > 0) return num;
  }
  return 60;
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
  const hourHalfMatch = safe.match(/(\d{1,2})\.5\s*時間/);
  if (hourHalfMatch) return Number(hourHalfMatch[1]) * 60 + 30;
  const hourMatch = safe.match(/(\d{1,2})\s*時間/);
  if (hourMatch) return Number(hourMatch[1]) * 60;
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

function summarizeExerciseRecords(exercises = []) {
  const rows = Array.isArray(exercises) ? exercises : [];
  const summary = {
    totalExercise: 0,
    running: 0,
    strength: 0,
    walking: 0,
    housework: 0,
    other: 0,
    rows: []
  };

  for (const item of rows) {
    const label = normalizeText(item?.name || item?.summary || '');
    const kcal = Number(item?.estimatedCalories || item?.kcal || 0);
    if (!label || kcal <= 0) continue;
    summary.totalExercise += kcal;
    summary.rows.push({ label, kcal, minutes: Number(item?.minutes || 0) || 0 });

    if (/ジョギング|ランニング|走/.test(label)) {
      summary.running += kcal;
    } else if (/筋トレ|スクワット|腕立て|腹筋/.test(label)) {
      summary.strength += kcal;
    } else if (/ウォーキング|散歩|歩/.test(label)) {
      summary.walking += kcal;
    } else if (/草むしり|草取り|掃除|窓ふき|窓拭き|家事/.test(label)) {
      summary.housework += kcal;
    } else {
      summary.other += kcal;
    }
  }

  summary.totalExercise = round0(summary.totalExercise);
  summary.running = round0(summary.running);
  summary.strength = round0(summary.strength);
  summary.walking = round0(summary.walking);
  summary.housework = round0(summary.housework);
  summary.other = round0(summary.other);
  return summary;
}

function buildRangeLabel(center, ratio = 0.2) {
  const base = Math.max(1, Number(center || 0));
  const low = round0(base * (1 - ratio));
  const high = round0(base * (1 + ratio));
  return `${low}〜${high}kcal`;
}

function detectActivityQuestionMode(text) {
  const safe = normalizeText(text);
  return {
    wantsBreakdown: /内訳|どう計算|それぞれ|何kcalずつ|分けると|ランニング.*筋トレ|筋トレ.*ランニング/.test(safe),
    wantsRange: /範囲|目安|くらい|だいたい/.test(safe),
    wantsDailyTotal: /1日|今日全体|総消費|一日|基礎代謝|全部/.test(safe),
    asksConflict: /どっちが正しい|どちらが正しい|前は|以前|差がある|随分と差|数字違う/.test(safe),
    asksRunningOnly: /ランニング|ジョギング|走/.test(safe),
    asksStrengthOnly: /筋トレ|スクワット|腕立て|腹筋/.test(safe)
  };
}

function buildBreakdownLines(summary) {
  const lines = [];
  if (summary.running > 0) lines.push(`- ランニング系: 約${summary.running}kcal`);
  if (summary.strength > 0) lines.push(`- 筋トレ系: 約${summary.strength}kcal`);
  if (summary.walking > 0) lines.push(`- 歩行系: 約${summary.walking}kcal`);
  if (summary.housework > 0) lines.push(`- 家事系: 約${summary.housework}kcal`);
  if (summary.other > 0) lines.push(`- その他: 約${summary.other}kcal`);
  return lines;
}

function buildActivityReply({ text, exercises = [], weightKg = 60, totalDaily = 0 } = {}) {
  const safe = normalizeText(text);
  const summary = summarizeExerciseRecords(exercises);
  const mode = detectActivityQuestionMode(safe);

  if (!summary.totalExercise) {
    return '今のところ今日の運動記録がまだ少ないので、走った時間や筋トレ内容が入るともう少し安定して見られます。';
  }

  const runningCenter = summary.running;
  const strengthCenter = summary.strength;
  const totalCenter = summary.totalExercise;
  const breakdownLines = buildBreakdownLines(summary);

  if (mode.asksConflict) {
    const baseLines = [
      'ここから。では、今ある記録と現在の体重を基準にして計算し直した値を優先します。',
      `今の基準では、今日の運動分は 約${totalCenter}kcal 前後です。`
    ];
    if (breakdownLines.length) baseLines.push(`内訳:
${breakdownLines.join('\n')}`);
    if (totalDaily > 0) baseLines.push(`基礎代謝なども含めた1日全体の消費目安は 約${round0(totalDaily)}kcal 前後です。`);
    baseLines.push('以前の数値は、強度や別の仮定が混ざった推定だった可能性があります。今後はこの基準で揃えて見ます。');
    return baseLines.join('\n');
  }

  if (mode.wantsBreakdown) {
    const lines = [`今日の運動分の内訳です。合計は 約${totalCenter}kcal 前後です。`];
    if (breakdownLines.length) lines.push(breakdownLines.join('\n'));
    if (totalDaily > 0 && mode.wantsDailyTotal) lines.push(`基礎代謝なども含めた1日全体の消費目安は 約${round0(totalDaily)}kcal 前後です。`);
    return lines.join('\n');
  }

  if (mode.asksRunningOnly && runningCenter > 0 && !mode.asksStrengthOnly) {
    if (mode.wantsRange) {
      return `今日の走った分だけなら、今の記録では 約${runningCenter}kcal 前後、目安としては ${buildRangeLabel(runningCenter)} くらいです。`;
    }
    return `今日の走った分だけなら、ざっくり ${runningCenter}kcal 前後です。`;
  }

  if (mode.asksStrengthOnly && strengthCenter > 0 && !mode.asksRunningOnly) {
    if (mode.wantsRange) {
      return `今日の筋トレ分だけなら、今の記録では 約${strengthCenter}kcal 前後、目安としては ${buildRangeLabel(strengthCenter)} くらいです。`;
    }
    return `今日の筋トレ分だけなら、ざっくり ${strengthCenter}kcal 前後です。`;
  }

  if (mode.wantsDailyTotal && totalDaily > 0) {
    return [
      `今日の運動分だけだと、ざっくり ${totalCenter}kcal 前後です。`,
      `基礎代謝なども含めた1日全体の消費目安は、ざっくり ${round0(totalDaily)}kcal 前後で見ています。`
    ].join('\n');
  }

  if (mode.wantsRange) {
    return `今日の運動分だけなら、今の記録では 約${totalCenter}kcal 前後、目安としては ${buildRangeLabel(totalCenter)} くらいです。`;
  }

  return `今日の運動分だけだと、ざっくり ${totalCenter}kcal 前後です。1日全体の消費を見る時は、基礎代謝を含めて別で整理します。`;
}

module.exports = {
  parseActivity,
  estimateCaloriesFromMet,
  extractProfileWeightKg,
  summarizeExerciseRecords,
  buildActivityReply,
  buildRangeLabel,
};
