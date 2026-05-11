'use strict';

const TEXT_MANUAL_SOURCE = 'text_manual_estimate';

function normalizeText(v) {
  return String(v || '').trim();
}

function round1(value) {
  return Math.round((Number(value || 0) + Number.EPSILON) * 10) / 10;
}

function countFromText(s, defaultCount = 1) {
  if (/[二２2]\s*個|[二２2]個/.test(s)) return 2;
  if (/[三３3]\s*個|[三３3]個/.test(s)) return 3;
  if (/[一１1]\s*個|[一１1]個|[一１1]\s*本|[一１1]本/.test(s)) return 1;
  const mn = s.match(/(\d+)\s*(個|本|杯|膳|枚)/);
  if (mn) return Math.max(1, Math.min(6, Number(mn[1]) || 1));
  return defaultCount;
}

/**
 * 1行分の手入力食事を下限寄りで推定（Gemini 画像解析とは別系統）。
 * @returns {{ label: string, kcal: number, kcalHigh: number|null, protein: number, fat: number, carbs: number } | null}
 */
function parseLineItem(segment) {
  const raw = normalizeText(segment);
  if (!raw) return null;
  const s = raw.replace(/\s+/g, '');

  if (/白湯/.test(s)) {
    return { label: raw.includes('ml') || raw.includes('ML') ? raw : '白湯', kcal: 0, kcalHigh: 0, protein: 0, fat: 0, carbs: 0 };
  }

  if (/おはぎ/.test(s)) {
    const n = countFromText(s, 1);
    const perLow = 150;
    const perHigh = 200;
    const kcal = n * perLow;
    const kcalHigh = n * perHigh;
    return {
      label: n > 1 ? `おはぎ${n}個` : 'おはぎ1個',
      kcal,
      kcalHigh,
      protein: round1(n * 4),
      fat: round1(n * 3),
      carbs: round1(n * 32)
    };
  }

  if (/ゆで卵|煮卵/.test(s)) {
    const n = countFromText(s, 1);
    const kcal = n * 70;
    return {
      label: n > 1 ? `ゆで卵${n}個` : 'ゆで卵1個',
      kcal,
      kcalHigh: n * 90,
      protein: round1(n * 6),
      fat: round1(n * 5),
      carbs: round1(n * 0.5)
    };
  }

  if (/味付き卵|味付卵/.test(s)) {
    const n = countFromText(s, 1);
    const kcal = n * 70;
    return {
      label: n > 1 ? `味付き卵${n}個` : '味付き卵1個',
      kcal,
      kcalHigh: n * 90,
      protein: round1(n * 6),
      fat: round1(n * 5),
      carbs: round1(n * 0.5)
    };
  }

  if (/卵/.test(s) && !/味付/.test(s)) {
    const n = countFromText(s, 1);
    const kcal = n * 70;
    return {
      label: n > 1 ? `卵${n}個` : '卵1個',
      kcal,
      kcalHigh: n * 90,
      protein: round1(n * 6),
      fat: round1(n * 5),
      carbs: round1(n * 0.5)
    };
  }

  if (/バナナ/.test(s)) {
    const n = countFromText(s, 1);
    return {
      label: n > 1 ? `バナナ${n}本` : 'バナナ1本',
      kcal: n * 70,
      kcalHigh: n * 90,
      protein: round1(n * 1),
      fat: 0,
      carbs: round1(n * 17)
    };
  }

  if (/(ご飯|ごはん|白米|玄米)/.test(s)) {
    let ratio = 1;
    if (/半分|1\/2|２分の1|0\.5/.test(s)) ratio = 0.5;
    const isBrown = /玄米/.test(s);
    const base = isBrown ? 165 : 180;
    const kcal = Math.round(base * ratio);
    const label = ratio < 0.99 ? 'ご飯半分' : (isBrown ? '玄米' : 'ご飯');
    return {
      label,
      kcal,
      kcalHigh: Math.round(base * 1.05 * ratio),
      protein: round1(3 * ratio),
      fat: round1(0.5 * ratio),
      carbs: round1(40 * ratio)
    };
  }

  if (/味噌汁|みそ汁/.test(s)) {
    const n = countFromText(s, 1);
    return {
      label: n > 1 ? `味噌汁${n}杯` : '味噌汁1杯',
      kcal: n * 40,
      kcalHigh: n * 50,
      protein: round1(n * 2.5),
      fat: round1(n * 1.5),
      carbs: round1(n * 3.5)
    };
  }

  if (/サラダ|チーズ|トースト|ヨーグルト|パン|鮭|豚肉|牛肉|青汁|麺|パスタ|うどん|そば/.test(s)) {
    const rough = { kcal: 120, protein: 5, fat: 4, carbs: 14 };
    if (/サラダ/.test(s)) Object.assign(rough, { kcal: 80, protein: 3, fat: 5, carbs: 7 });
    if (/チーズ/.test(s)) Object.assign(rough, { kcal: 80, protein: 5, fat: 6, carbs: 1 });
    if (/トースト|パン/.test(s)) Object.assign(rough, { kcal: 160, protein: 5, fat: 4, carbs: 28 });
    if (/ヨーグルト/.test(s)) Object.assign(rough, { kcal: 80, protein: 4, fat: 3, carbs: 10 });
    if (/鮭|豚肉|牛肉/.test(s)) Object.assign(rough, { kcal: 160, protein: 16, fat: 9, carbs: 2 });
    return { label: raw, kcal: rough.kcal, kcalHigh: Math.round(rough.kcal * 1.12), ...rough };
  }

  return null;
}

function splitSegments(text) {
  const safe = normalizeText(text);
  if (!safe) return [];
  return safe
    .split(/[,、，\n]+/)
    .map((p) => normalizeText(p))
    .filter(Boolean);
}

/**
 * @param {string} text
 * @param {{ recordKind?: 'meal_text_record' | 'reward_food' }} opts
 * @returns {null | {
 *   parsedMeal: object,
 *   breakdownLines: string[],
 *   recordKind: string
 * }}
 */
function parseAndBuildManualMealRecord(text, opts = {}) {
  const recordKind = opts.recordKind === 'reward_food' ? 'reward_food' : 'meal_text_record';
  const segments = splitSegments(text);
  if (!segments.length) return null;

  const rows = [];
  for (const seg of segments) {
    const row = parseLineItem(seg);
    if (row) rows.push(row);
  }
  if (!rows.length) return null;

  const nutrition = rows.reduce(
    (acc, r) => ({
      kcal: acc.kcal + r.kcal,
      protein: acc.protein + r.protein,
      fat: acc.fat + r.fat,
      carbs: acc.carbs + r.carbs
    }),
    { kcal: 0, protein: 0, fat: 0, carbs: 0 }
  );

  const items = rows.map((r) => r.label);
  const breakdownLines = rows.map((r) => {
    if (r.kcalHigh != null && r.kcalHigh > r.kcal) {
      return `${r.label} 約${r.kcal}〜${r.kcalHigh}kcal（記録は控えめに${r.kcal}kcal）`;
    }
    if (r.kcal <= 0) return `${r.label} 約0kcal`;
    return `${r.label} 約${r.kcal}kcal`;
  });

  const parsedMeal = {
    isMealImage: false,
    confidence: 0.82,
    items,
    estimatedNutrition: clampNutrition(nutrition),
    estimated_nutrition: clampNutrition(nutrition),
    comment: '',
    mealType: 'unknown',
    amountRatio: 1,
    amountNote: '',
    recordReady: true,
    calorie_source: TEXT_MANUAL_SOURCE,
    calorie_confidence: 'low',
    original_gemini_calories: 0,
    final_calories: clampNutrition(nutrition).kcal,
    correction_reason: 'text_manual_line_parse',
    recordKind,
    manualRows: rows
  };

  return { parsedMeal, breakdownLines, recordKind };
}

function clampNutrition(n) {
  return {
    kcal: Math.max(0, round1(n.kcal)),
    protein: Math.max(0, round1(n.protein)),
    fat: Math.max(0, round1(n.fat)),
    carbs: Math.max(0, round1(n.carbs))
  };
}

/**
 * @param {{ parsedMeal: object, breakdownLines: string[], recordKind: string, userText: string, todayTotalKcal?: number }} p
 */
function buildShortManualReply(p = {}) {
  const { parsedMeal, breakdownLines, recordKind, userText, todayTotalKcal } = p;
  const items = (parsedMeal?.items || []).join('、');
  const lines = [];

  if (recordKind === 'reward_food') {
    lines.push(`${items}、届いています。`);
    lines.push('たまのご褒美として受け止めました。責めず、次は1個に戻せたら十分です。');
  } else {
    const ut = normalizeText(userText);
    if (/白湯|味付き卵|ゆで卵|卵/.test(ut)) {
      lines.push(`${items}ですね。`);
      lines.push('朝の形として安定しています。卵でたんぱく質も入っているので、今日のスタートとして十分です。');
    } else if (/ご飯半分|半分/.test(ut) && /ご飯|ごはん/.test(ut)) {
      lines.push(`${items}ですね。`);
      lines.push('量を調整しながら整えようとしているのが見えます。このくらいの抜き方で十分です。');
    } else {
      lines.push(`${items}、記録として受け取りました。`);
      lines.push('今日の流れの中で、無理のない形として問題ありません。');
    }
  }

  lines.push('');
  lines.push(`手入力の目安：${breakdownLines.join(' / ')}`);
  if (Number.isFinite(todayTotalKcal) && todayTotalKcal >= 0) {
    lines.push(`今日の食事の合計（目安）：おおよそ ${Math.round(todayTotalKcal)}kcal`);
  }

  return lines.join('\n').trim();
}

module.exports = {
  TEXT_MANUAL_SOURCE,
  parseAndBuildManualMealRecord,
  buildShortManualReply,
  parseLineItem,
};
