const { findNumber } = require('../utils/text_helpers');
const { round0, round1, toNumberOrNull } = require('../utils/formatters');

function calcGenericExerciseKcal(label, minutes, reps, weightKg) {
  const weight = Number(weightKg) || 60;
  const lower = String(label || '').toLowerCase();

  if (minutes != null) {
    if (lower.includes('ジョギング') || lower.includes('ランニング')) return round1(minutes * weight * 0.09);
    if (lower.includes('ウォーキング') || lower.includes('散歩') || lower.includes('歩行')) return round1(minutes * weight * 0.035);
    if (lower.includes('自転車')) return round1(minutes * weight * 0.06);
    if (lower.includes('階段')) return round1(minutes * weight * 0.08);
    if (lower.includes('ストレッチ') || lower.includes('ヨガ') || lower.includes('体操')) return round1(minutes * weight * 0.025);
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

function parseGenericActivityItems(text, weightKg) {
  const t = String(text || '');
  const items = [];

  const minutePatterns = [
    { regex: /(スロージョギング)\s*([0-9]+(?:\.[0-9]+)?)\s*分/i },
    { regex: /(ジョギング)\s*([0-9]+(?:\.[0-9]+)?)\s*分/i },
    { regex: /(ランニング)\s*([0-9]+(?:\.[0-9]+)?)\s*分/i },
    { regex: /(散歩)\s*([0-9]+(?:\.[0-9]+)?)\s*分/i },
    { regex: /(ウォーキング)\s*([0-9]+(?:\.[0-9]+)?)\s*分/i },
    { regex: /(歩行)\s*([0-9]+(?:\.[0-9]+)?)\s*分/i },
    { regex: /(自転車)\s*([0-9]+(?:\.[0-9]+)?)\s*分/i },
    { regex: /(階段)\s*([0-9]+(?:\.[0-9]+)?)\s*分/i },
    { regex: /(ストレッチ)\s*([0-9]+(?:\.[0-9]+)?)\s*分/i },
    { regex: /(ヨガ)\s*([0-9]+(?:\.[0-9]+)?)\s*分/i },
    { regex: /(ラジオ体操)\s*([0-9]+(?:\.[0-9]+)?)\s*分/i },
    { regex: /(体操)\s*([0-9]+(?:\.[0-9]+)?)\s*分/i },
    { regex: /(プランク)\s*([0-9]+(?:\.[0-9]+)?)\s*分/i },
    { regex: /(体幹)\s*([0-9]+(?:\.[0-9]+)?)\s*分/i },
  ];

  for (const p of minutePatterns) {
    const m = t.match(p.regex);
    if (!m) continue;
    const label = String(m[1]).trim();
    const minutes = toNumberOrNull(m[2]);
    items.push({
      label,
      minutes,
      reps: null,
      kcal: calcGenericExerciseKcal(label, minutes, null, weightKg),
    });
  }

  const repPatterns = [
    { regex: /(スクワット)\s*([0-9]+(?:\.[0-9]+)?)\s*回/i },
    { regex: /(腹筋)\s*([0-9]+(?:\.[0-9]+)?)\s*回/i },
    { regex: /(膝つき腕立て)\s*([0-9]+(?:\.[0-9]+)?)\s*回/i },
    { regex: /(腕立て)\s*([0-9]+(?:\.[0-9]+)?)\s*回/i },
    { regex: /(もも上げ)\s*([0-9]+(?:\.[0-9]+)?)\s*回/i },
    { regex: /(開脚)\s*([0-9]+(?:\.[0-9]+)?)\s*回/i },
    { regex: /(階段)\s*([0-9]+(?:\.[0-9]+)?)\s*段/i },
  ];

  for (const p of repPatterns) {
    const m = t.match(p.regex);
    if (!m) continue;
    const label = String(m[1]).trim();
    const reps = toNumberOrNull(m[2]);
    items.push({
      label,
      minutes: null,
      reps,
      kcal: calcGenericExerciseKcal(label, null, reps, weightKg),
    });
  }

  if (!items.length) {
    if (/少し歩/i.test(t) || /ちょっと歩/i.test(t) || /買い物で.*歩/i.test(t) || /結構歩/i.test(t)) {
      items.push({
        label: '歩行',
        minutes: 10,
        reps: null,
        kcal: calcGenericExerciseKcal('歩行', 10, null, weightKg),
      });
    } else if (/階段を使/i.test(t)) {
      items.push({
        label: '階段',
        minutes: 3,
        reps: null,
        kcal: calcGenericExerciseKcal('階段', 3, null, weightKg),
      });
    } else if (/ストレッチした|伸ばした|ほぐした/i.test(t)) {
      items.push({
        label: 'ストレッチ',
        minutes: 5,
        reps: null,
        kcal: calcGenericExerciseKcal('ストレッチ', 5, null, weightKg),
      });
    } else if (/ヨガした/i.test(t)) {
      items.push({
        label: 'ヨガ',
        minutes: 10,
        reps: null,
        kcal: calcGenericExerciseKcal('ヨガ', 10, null, weightKg),
      });
    } else if (/プランクした/i.test(t)) {
      items.push({
        label: 'プランク',
        minutes: 1,
        reps: null,
        kcal: calcGenericExerciseKcal('プランク', 1, null, weightKg),
      });
    } else if (/ジョギングした|走った/i.test(t)) {
      items.push({
        label: 'ジョギング',
        minutes: 10,
        reps: null,
        kcal: calcGenericExerciseKcal('ジョギング', 10, null, weightKg),
      });
    } else if (/スクワットした/i.test(t)) {
      items.push({
        label: 'スクワット',
        minutes: null,
        reps: 5,
        kcal: calcGenericExerciseKcal('スクワット', null, 5, weightKg),
      });
    } else if (/腹筋した/i.test(t)) {
      items.push({
        label: '腹筋',
        minutes: null,
        reps: 5,
        kcal: calcGenericExerciseKcal('腹筋', null, 5, weightKg),
      });
    } else if (/腕立てした/i.test(t)) {
      items.push({
        label: '腕立て',
        minutes: null,
        reps: 3,
        kcal: calcGenericExerciseKcal('腕立て', null, 3, weightKg),
      });
    }
  }

  return items;
}

function parseActivity(text, weightKg = 60) {
  const base = String(text || '');

  const steps = toNumberOrNull(findNumber(base, /歩数\s*([0-9]+(?:\.[0-9]+)?)/i));
  const walkingMinutes = toNumberOrNull(findNumber(base, /(散歩|歩行|ウォーキング)\s*([0-9]+(?:\.[0-9]+)?)\s*分/i, 2));
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