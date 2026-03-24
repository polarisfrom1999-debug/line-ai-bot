const { findNumber } = require('../utils/text_helpers');
const { round1, toNumberOrNull } = require('../utils/formatters');

function normalizeActivityText(text) {
  return String(text || '')
    .replace(/[０-９]/g, (s) => String.fromCharCode(s.charCodeAt(0) - 65248))
    .replace(/　/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function calcGenericExerciseKcal(label, minutes, reps, weightKg) {
  const weight = Number(weightKg) || 60;
  const lower = String(label || '').toLowerCase();

  if (minutes != null) {
    if (lower.includes('ジョギング') || lower.includes('ランニング') || lower.includes('走')) {
      return round1(minutes * weight * 0.09);
    }
    if (lower.includes('ウォーキング') || lower.includes('散歩') || lower.includes('歩行') || lower.includes('歩')) {
      return round1(minutes * weight * 0.035);
    }
    if (lower.includes('自転車')) return round1(minutes * weight * 0.06);
    if (lower.includes('階段')) return round1(minutes * weight * 0.08);
    if (lower.includes('ストレッチ') || lower.includes('ヨガ') || lower.includes('体操')) {
      return round1(minutes * weight * 0.025);
    }
    if (lower.includes('プランク') || lower.includes('体幹')) return round1(minutes * weight * 0.05);
    return round1(minutes * weight * 0.045);
  }

  if (reps != null) {
    if (lower.includes('スクワット')) return round1(reps * 0.32);
    if (lower.includes('腹筋')) return round1(reps * 0.25);
    if (lower.includes('膝つき腕立て')) return round1(reps * 0.28);
    if (lower.includes('腕立て')) return round1(reps * 0.4);
    if (lower.includes('もも上げ')) return round1(reps * 0.18);
    if (lower.includes('開脚')) return round1(reps * 0.08);
    if (lower.includes('階段')) return round1(reps * 0.45);
    return round1(reps * 0.15);
  }

  return null;
}

function parseDurationMinutesFromSegment(segment) {
  const text = normalizeActivityText(segment);
  if (!text) return null;

  const hm = text.match(/([0-9]+(?:\.[0-9]+)?)\s*時間(?:間)?\s*([0-9]+(?:\.[0-9]+)?)\s*分/);
  if (hm) {
    return round1(Number(hm[1]) * 60 + Number(hm[2]));
  }

  const hOnly = text.match(/([0-9]+(?:\.[0-9]+)?)\s*時間(?:間)?/);
  const mOnly = text.match(/([0-9]+(?:\.[0-9]+)?)\s*分/);

  if (hOnly && mOnly) {
    return round1(Number(hOnly[1]) * 60 + Number(mOnly[1]));
  }
  if (hOnly) {
    return round1(Number(hOnly[1]) * 60);
  }
  if (mOnly) {
    return round1(Number(mOnly[1]));
  }

  const hourLike = text.match(/([0-9]+(?:\.[0-9]+)?)\s*h\b/i);
  if (hourLike) {
    return round1(Number(hourLike[1]) * 60);
  }

  const minLike = text.match(/([0-9]+(?:\.[0-9]+)?)\s*(min|mins|minute|minutes|m)\b/i);
  if (minLike) {
    return round1(Number(minLike[1]));
  }

  return null;
}

function buildMinuteItem(label, minutes, weightKg) {
  return {
    label,
    minutes,
    reps: null,
    kcal: calcGenericExerciseKcal(label, minutes, null, weightKg),
  };
}

function buildRepItem(label, reps, weightKg) {
  return {
    label,
    minutes: null,
    reps,
    kcal: calcGenericExerciseKcal(label, null, reps, weightKg),
  };
}

function pushIfNew(items, nextItem) {
  if (!nextItem) return;
  const duplicate = items.some((item) => {
    return item.label === nextItem.label && item.minutes === nextItem.minutes && item.reps === nextItem.reps;
  });
  if (!duplicate) items.push(nextItem);
}

function parseKeywordDurationItems(text, weightKg) {
  const t = normalizeActivityText(text);
  const items = [];

  const minuteActivityDefs = [
    { label: 'スロージョギング', keywords: ['スロージョギング'] },
    { label: 'ジョギング', keywords: ['ジョギング', 'ランニング', '走った', '走る', '走りました'] },
    { label: '散歩', keywords: ['散歩'] },
    { label: 'ウォーキング', keywords: ['ウォーキング'] },
    { label: '歩行', keywords: ['歩行', '歩いた', '歩く'] },
    { label: '自転車', keywords: ['自転車'] },
    { label: '階段', keywords: ['階段'] },
    { label: 'ストレッチ', keywords: ['ストレッチ', '伸ばした', 'ほぐした'] },
    { label: 'ヨガ', keywords: ['ヨガ'] },
    { label: 'ラジオ体操', keywords: ['ラジオ体操'] },
    { label: '体操', keywords: ['体操'] },
    { label: 'プランク', keywords: ['プランク'] },
    { label: '体幹', keywords: ['体幹'] },
  ];

  for (const def of minuteActivityDefs) {
    for (const keyword of def.keywords) {
      const escaped = keyword.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

      const patterns = [
        new RegExp(`(${escaped})\\s*([0-9]+(?:\\.[0-9]+)?)\\s*分`, 'i'),
        new RegExp(`(${escaped})\\s*([0-9]+(?:\\.[0-9]+)?)\\s*時間(?:間)?\\s*([0-9]+(?:\\.[0-9]+)?)\\s*分`, 'i'),
        new RegExp(`(${escaped})\\s*([0-9]+(?:\\.[0-9]+)?)\\s*時間(?:間)?`, 'i'),
        new RegExp(`([0-9]+(?:\\.[0-9]+)?)\\s*分\\s*(?:の|ほどの|くらいの|ぐらいの)?\\s*(${escaped})`, 'i'),
        new RegExp(`([0-9]+(?:\\.[0-9]+)?)\\s*時間(?:間)?\\s*([0-9]+(?:\\.[0-9]+)?)\\s*分\\s*(?:の|ほどの|くらいの|ぐらいの)?\\s*(${escaped})`, 'i'),
        new RegExp(`([0-9]+(?:\\.[0-9]+)?)\\s*時間(?:間)?\\s*(?:の|ほどの|くらいの|ぐらいの)?\\s*(${escaped})`, 'i'),
      ];

      for (const pattern of patterns) {
        const m = t.match(pattern);
        if (!m) continue;

        const joined = m.slice(1).filter(Boolean).join(' ');
        const minutes = parseDurationMinutesFromSegment(joined);
        if (minutes != null) {
          pushIfNew(items, buildMinuteItem(def.label, minutes, weightKg));
        }
      }

      const index = t.search(new RegExp(escaped, 'i'));
      if (index >= 0) {
        const head = t.slice(Math.max(0, index - 20), index + keyword.length + 20);
        const minutes = parseDurationMinutesFromSegment(head);
        if (minutes != null) {
          pushIfNew(items, buildMinuteItem(def.label, minutes, weightKg));
        }
      }
    }
  }

  return items;
}

function parseRepItems(text, weightKg) {
  const t = normalizeActivityText(text);
  const items = [];

  const repPatterns = [
    { label: 'スクワット', regex: /(スクワット)\s*([0-9]+(?:\.[0-9]+)?)\s*回/i },
    { label: '腹筋', regex: /(腹筋)\s*([0-9]+(?:\.[0-9]+)?)\s*回/i },
    { label: '膝つき腕立て', regex: /(膝つき腕立て)\s*([0-9]+(?:\.[0-9]+)?)\s*回/i },
    { label: '腕立て', regex: /(腕立て)\s*([0-9]+(?:\.[0-9]+)?)\s*回/i },
    { label: 'もも上げ', regex: /(もも上げ)\s*([0-9]+(?:\.[0-9]+)?)\s*回/i },
    { label: '開脚', regex: /(開脚)\s*([0-9]+(?:\.[0-9]+)?)\s*回/i },
    { label: '階段', regex: /(階段)\s*([0-9]+(?:\.[0-9]+)?)\s*段/i },
  ];

  for (const p of repPatterns) {
    const m = t.match(p.regex);
    if (!m) continue;
    const reps = toNumberOrNull(m[2]);
    pushIfNew(items, buildRepItem(p.label, reps, weightKg));
  }

  return items;
}

function parseGenericActivityItems(text, weightKg) {
  const t = normalizeActivityText(text);
  const items = [];

  const keywordDurationItems = parseKeywordDurationItems(t, weightKg);
  keywordDurationItems.forEach((item) => pushIfNew(items, item));

  const repItems = parseRepItems(t, weightKg);
  repItems.forEach((item) => pushIfNew(items, item));

  if (!items.length) {
    if (/少し歩/i.test(t) || /ちょっと歩/i.test(t) || /買い物で.*歩/i.test(t) || /結構歩/i.test(t)) {
      pushIfNew(items, buildMinuteItem('歩行', 10, weightKg));
    } else if (/階段を使/i.test(t)) {
      pushIfNew(items, buildMinuteItem('階段', 3, weightKg));
    } else if (/ストレッチした|伸ばした|ほぐした/i.test(t)) {
      pushIfNew(items, buildMinuteItem('ストレッチ', 5, weightKg));
    } else if (/ヨガした/i.test(t)) {
      pushIfNew(items, buildMinuteItem('ヨガ', 10, weightKg));
    } else if (/プランクした/i.test(t)) {
      pushIfNew(items, buildMinuteItem('プランク', 1, weightKg));
    } else if (/ジョギングした|ランニングした|走った|走る/i.test(t)) {
      const fallbackMinutes = parseDurationMinutesFromSegment(t);
      pushIfNew(items, buildMinuteItem('ジョギング', fallbackMinutes != null ? fallbackMinutes : 10, weightKg));
    } else if (/スクワットした/i.test(t)) {
      pushIfNew(items, buildRepItem('スクワット', 5, weightKg));
    } else if (/腹筋した/i.test(t)) {
      pushIfNew(items, buildRepItem('腹筋', 5, weightKg));
    } else if (/腕立てした/i.test(t)) {
      pushIfNew(items, buildRepItem('腕立て', 3, weightKg));
    }
  }

  return items;
}

function parseActivity(text, weightKg = 60) {
  const base = normalizeActivityText(text);

  const steps = toNumberOrNull(findNumber(base, /歩数\s*([0-9]+(?:\.[0-9]+)?)/i));
  const walkingMinutes =
    toNumberOrNull(findNumber(base, /(散歩|歩行|ウォーキング)\s*([0-9]+(?:\.[0-9]+)?)\s*分/i, 2)) ||
    null;
  const explicitKcal = toNumberOrNull(findNumber(base, /(消費|活動消費)\s*([0-9]+(?:\.[0-9]+)?)/i, 2));

  const activityItems = parseGenericActivityItems(base, weightKg);
  const summary = activityItems
    .map((x) => {
      if (x.minutes != null) return `${x.label} ${x.minutes}分`;
      if (x.reps != null) return `${x.label} ${x.reps}回`;
      return x.label;
    })
    .filter(Boolean)
    .join(' / ');

  const itemKcal = activityItems.reduce((sum, x) => sum + (Number(x.kcal) || 0), 0);

  return {
    steps,
    walking_minutes: walkingMinutes,
    estimated_activity_kcal: explicitKcal != null ? explicitKcal : round1(itemKcal || 0) || null,
    exercise_summary: summary || null,
    raw_detail_json: {
      activity_items: activityItems,
    },
  };
}

function estimateActivityKcal(steps, walkingMinutes, weightKg) {
  const weight = weightKg || 60;
  const stepKcal = steps ? Number(steps) * 0.04 : 0;
  const walkKcal = walkingMinutes ? Number(walkingMinutes) * (weight * 0.035) : 0;
  return round1(Math.max(stepKcal, walkKcal));
}

function estimateActivityKcalWithStrength(steps, walkingMinutes, weightKg, rawDetail = {}) {
  const base = Number(estimateActivityKcal(steps, walkingMinutes, weightKg)) || 0;
  const items = Array.isArray(rawDetail?.activity_items) ? rawDetail.activity_items : [];
  const detailKcal = items.reduce((sum, item) => sum + (Number(item?.kcal) || 0), 0);
  return round1(base + detailKcal);
}

module.exports = {
  calcGenericExerciseKcal,
  parseGenericActivityItems,
  parseActivity,
  estimateActivityKcal,
  estimateActivityKcalWithStrength,
};
