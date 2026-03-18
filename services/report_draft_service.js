'use strict';

/**
 * services/report_draft_service.js
 *
 * 目的:
 * - 週間報告 / 月間報告の下書きを安全に生成する
 * - まずは「利用者へ自動送信しない」前提
 * - 管理者確認用メモの元データも返しやすい形にする
 * - index.js からそのまま呼びやすい構造
 */

function toNumber(value, fallback = null) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function safeText(value, fallback = '') {
  return String(value || fallback).trim();
}

function round1(value) {
  const n = toNumber(value, null);
  return n === null ? null : Math.round(n * 10) / 10;
}

function roundInt(value) {
  const n = toNumber(value, null);
  return n === null ? null : Math.round(n);
}

function formatDelta(value, unit = '') {
  const n = toNumber(value, null);
  if (n === null) return null;
  if (n > 0) return `+${round1(n)}${unit}`;
  return `${round1(n)}${unit}`;
}

function formatDateLabel(dateText) {
  if (!dateText) return '';
  const s = String(dateText).slice(0, 10);
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return s;
  return `${m[2]}/${m[3]}`;
}

function avg(numbers) {
  const arr = (numbers || []).map((v) => toNumber(v, null)).filter((v) => v !== null);
  if (!arr.length) return null;
  return arr.reduce((a, b) => a + b, 0) / arr.length;
}

function sum(numbers) {
  const arr = (numbers || []).map((v) => toNumber(v, null)).filter((v) => v !== null);
  if (!arr.length) return 0;
  return arr.reduce((a, b) => a + b, 0);
}

function pickLatest(arr) {
  if (!Array.isArray(arr) || !arr.length) return null;
  return arr[arr.length - 1];
}

function pickFirst(arr) {
  if (!Array.isArray(arr) || !arr.length) return null;
  return arr[0];
}

function buildWeightSummary(weights) {
  const rows = Array.isArray(weights) ? weights : [];
  const values = rows
    .map((r) => toNumber(r.weight_kg, null))
    .filter((v) => v !== null);

  if (!values.length) {
    return {
      has_data: false,
      start_weight: null,
      end_weight: null,
      delta_kg: null,
      avg_weight: null,
      insight: '体重データはまだ少なめです。',
    };
  }

  const startWeight = pickFirst(values);
  const endWeight = pickLatest(values);
  const delta = endWeight - startWeight;
  const averageWeight = avg(values);

  let insight = '体重は大きく乱れず見られています。';
  if (delta <= -1.0) {
    insight = '体重はしっかり良い方向に動いています。';
  } else if (delta < 0) {
    insight = '体重は少しずつ良い方向に向かっています。';
  } else if (delta === 0) {
    insight = '体重は安定して見られています。';
  } else if (delta > 0.8) {
    insight = '体重はやや上がり気味なので、食事や活動量を整える余地がありそうです。';
  } else if (delta > 0) {
    insight = '体重は少し上がっていますが、まだ十分調整しやすい範囲です。';
  }

  return {
    has_data: true,
    start_weight: round1(startWeight),
    end_weight: round1(endWeight),
    delta_kg: round1(delta),
    avg_weight: round1(averageWeight),
    insight,
  };
}

function buildBodyFatSummary(bodyFats) {
  const rows = Array.isArray(bodyFats) ? bodyFats : [];
  const values = rows
    .map((r) => toNumber(r.body_fat_percent, null))
    .filter((v) => v !== null);

  if (!values.length) {
    return {
      has_data: false,
      avg_body_fat_percent: null,
      insight: '体脂肪率データはまだ少なめです。',
    };
  }

  const average = avg(values);
  return {
    has_data: true,
    avg_body_fat_percent: round1(average),
    insight: '体脂肪率も一緒に見ていくと、体重以外の変化も追いやすくなります。',
  };
}

function buildMealSummary(meals) {
  const rows = Array.isArray(meals) ? meals : [];
  const kcalList = rows
    .map((r) => toNumber(r.calories, null))
    .filter((v) => v !== null);

  const proteinList = rows
    .map((r) => toNumber(r.protein_g, null))
    .filter((v) => v !== null);

  const fatList = rows
    .map((r) => toNumber(r.fat_g, null))
    .filter((v) => v !== null);

  const carbList = rows
    .map((r) => toNumber(r.carbs_g, null))
    .filter((v) => v !== null);

  const mealTimes = rows
    .map((r) => safeText(r.meal_time || r.time || ''))
    .filter(Boolean);

  const breakfastCount = rows.filter((r) => {
    const label = safeText(r.meal_type || r.label || '');
    return /朝食|朝/.test(label);
  }).length;

  const lunchCount = rows.filter((r) => {
    const label = safeText(r.meal_type || r.label || '');
    return /昼食|昼/.test(label);
  }).length;

  const dinnerCount = rows.filter((r) => {
    const label = safeText(r.meal_type || r.label || '');
    return /夕食|夜/.test(label);
  }).length;

  const snackCount = rows.filter((r) => {
    const label = safeText(r.meal_type || r.label || '');
    return /間食|おやつ/.test(label);
  }).length;

  const totalKcal = sum(kcalList);
  const avgKcal = kcalList.length ? totalKcal / kcalList.length : null;

  let insight = '食事記録は全体として続けられています。';

  if (rows.length === 0) {
    insight = '食事記録はまだ少なめです。';
  } else if (rows.length < 7) {
    insight = '食事記録はやや少なめなので、まずは1日1回でも残せると流れが見えやすくなります。';
  } else if (snackCount >= 4) {
    insight = '間食の入り方も見えてきているので、食べ方のリズム調整に活かせそうです。';
  } else if (breakfastCount === 0) {
    insight = '朝食の記録が少ないので、朝の流れを整える余地がありそうです。';
  } else if (dinnerCount > breakfastCount + lunchCount) {
    insight = '夕方以降に比重が寄りやすい可能性があるので、食事タイミングも見ていけそうです。';
  }

  return {
    has_data: rows.length > 0,
    meal_count: rows.length,
    total_kcal: roundInt(totalKcal),
    avg_kcal_per_meal: avgKcal === null ? null : roundInt(avgKcal),
    avg_protein_g: proteinList.length ? round1(avg(proteinList)) : null,
    avg_fat_g: fatList.length ? round1(avg(fatList)) : null,
    avg_carbs_g: carbList.length ? round1(avg(carbList)) : null,
    breakfast_count: breakfastCount,
    lunch_count: lunchCount,
    dinner_count: dinnerCount,
    snack_count: snackCount,
    meal_times: mealTimes,
    insight,
  };
}

function buildExerciseSummary(exercises) {
  const rows = Array.isArray(exercises) ? exercises : [];
  const minutesList = rows
    .map((r) => toNumber(r.duration_minutes, null))
    .filter((v) => v !== null);

  const kcalList = rows
    .map((r) => toNumber(r.calories_burned, null))
    .filter((v) => v !== null);

  const exerciseTypes = rows
    .map((r) => safeText(r.exercise_type || r.label || r.name || ''))
    .filter(Boolean);

  const totalMinutes = sum(minutesList);
  const totalKcal = sum(kcalList);

  let insight = '運動記録も少しずつ積み上がっています。';

  if (rows.length === 0) {
    insight = '運動記録はまだ少なめです。';
  } else if (rows.length < 3) {
    insight = '運動は少ない回数でも続けることが大切なので、まずは流れを止めないのが大事です。';
  } else if (totalMinutes >= 90) {
    insight = '運動の積み上がりがしっかり見えています。';
  }

  return {
    has_data: rows.length > 0,
    exercise_count: rows.length,
    total_minutes: roundInt(totalMinutes),
    total_burn_kcal: roundInt(totalKcal),
    exercise_types: [...new Set(exerciseTypes)].slice(0, 5),
    insight,
  };
}

function buildSymptomSummary(symptoms) {
  const rows = Array.isArray(symptoms) ? symptoms : [];
  const symptomTexts = rows
    .map((r) => safeText(r.symptom || r.summary || r.memo || r.text || ''))
    .filter(Boolean);

  let insight = '症状面も大きな変化なく見られています。';

  if (!rows.length) {
    insight = '大きな症状記録は見当たりません。';
  } else if (symptomTexts.some((t) => /痛み|しびれ|つる|腫れ/.test(t))) {
    insight = '症状の記録もあるため、無理のしすぎは避けつつ進めたい流れです。';
  }

  return {
    has_data: rows.length > 0,
    symptom_count: rows.length,
    latest_symptoms: symptomTexts.slice(-3),
    insight,
  };
}

function buildLabSummary(labs) {
  const rows = Array.isArray(labs) ? labs : [];
  const latest = pickLatest(rows);

  if (!latest) {
    return {
      has_data: false,
      latest_date: null,
      insight: '血液検査データはまだ未反映、または対象期間外です。',
    };
  }

  const summaryParts = [];
  if (latest.hba1c !== undefined && latest.hba1c !== null) summaryParts.push(`HbA1c ${latest.hba1c}`);
  if (latest.fasting_glucose !== undefined && latest.fasting_glucose !== null) summaryParts.push(`血糖 ${latest.fasting_glucose}`);
  if (latest.ast !== undefined && latest.ast !== null) summaryParts.push(`AST ${latest.ast}`);
  if (latest.alt !== undefined && latest.alt !== null) summaryParts.push(`ALT ${latest.alt}`);
  if (latest.gamma_gt !== undefined && latest.gamma_gt !== null) summaryParts.push(`γ-GTP ${latest.gamma_gt}`);
  if (latest.ldl_cholesterol !== undefined && latest.ldl_cholesterol !== null) summaryParts.push(`LDL ${latest.ldl_cholesterol}`);
  if (latest.hdl_cholesterol !== undefined && latest.hdl_cholesterol !== null) summaryParts.push(`HDL ${latest.hdl_cholesterol}`);
  if (latest.triglycerides !== undefined && latest.triglycerides !== null) summaryParts.push(`中性脂肪 ${latest.triglycerides}`);

  return {
    has_data: true,
    latest_date: latest.exam_date || latest.date || latest.measured_at || null,
    latest_summary: summaryParts.join(' / '),
    insight: '血液検査も合わせて見られると、体の内側の変化も追いやすくなります。',
  };
}

function buildPositiveHighlights({ weightSummary, mealSummary, exerciseSummary, symptomSummary }) {
  const highlights = [];

  if (weightSummary.has_data && weightSummary.delta_kg !== null && weightSummary.delta_kg < 0) {
    highlights.push('体重が良い方向へ動いています。');
  }

  if (mealSummary.meal_count >= 7) {
    highlights.push('食事記録が続いていて、傾向が見えやすくなっています。');
  }

  if (exerciseSummary.exercise_count >= 3) {
    highlights.push('運動の積み上げができています。');
  }

  if (symptomSummary.has_data && symptomSummary.symptom_count > 0) {
    highlights.push('症状も記録できているので、体調変化を早めに拾いやすいです。');
  }

  if (!highlights.length) {
    highlights.push('少しずつでも記録を続けていること自体が、すでに大きな前進です。');
  }

  return highlights.slice(0, 3);
}

function buildNextActions({ weightSummary, mealSummary, exerciseSummary, symptomSummary, reportType }) {
  const actions = [];

  if (!mealSummary.has_data || mealSummary.meal_count < (reportType === 'weekly' ? 7 : 20)) {
    actions.push('まずは食事を1日1回でも残して、流れを見える化していきましょう。');
  }

  if (!exerciseSummary.has_data || exerciseSummary.exercise_count < (reportType === 'weekly' ? 3 : 10)) {
    actions.push('運動は短時間でも良いので、続けやすい形で回数を作っていきましょう。');
  }

  if (weightSummary.has_data && weightSummary.delta_kg !== null && weightSummary.delta_kg > 0.8) {
    actions.push('体重が少し上がり気味なので、夜の食事量や間食タイミングを一緒に整えていきましょう。');
  }

  if (symptomSummary.has_data) {
    actions.push('痛みや不調がある日は、無理に頑張るより調整しながら続ける形で大丈夫です。');
  }

  if (!actions.length) {
    actions.push('今の良い流れを崩さず、少しずつ積み上げていきましょう。');
  }

  return actions.slice(0, 3);
}

function buildForecast({ weightSummary, mealSummary, exerciseSummary, reportType }) {
  if (weightSummary.has_data && weightSummary.delta_kg !== null && weightSummary.delta_kg < 0) {
    return reportType === 'weekly'
      ? 'この流れが続くと、来週も無理なく良い変化を積み上げやすそうです。'
      : 'この流れが続くと、来月は体重だけでなく体調面の安定も感じやすくなりそうです。';
  }

  if (mealSummary.has_data || exerciseSummary.has_data) {
    return reportType === 'weekly'
      ? '記録の精度が上がるほど、来週はもっと具体的に調整ポイントが見えてきそうです。'
      : '今の積み重ねが続くほど、来月はより個別性の高い提案につなげやすくなります。';
  }

  return reportType === 'weekly'
    ? 'まずは記録の土台ができると、来週から変化がぐっと読みやすくなります。'
    : 'まずは今月の記録土台を整えることで、来月からより深い伴走につなげやすくなります。';
}

function buildWeeklyDraftText(input) {
  const userName = safeText(input.user_name || 'あなた');

  const weightSummary = buildWeightSummary(input.weights);
  const bodyFatSummary = buildBodyFatSummary(input.body_fats);
  const mealSummary = buildMealSummary(input.meals);
  const exerciseSummary = buildExerciseSummary(input.exercises);
  const symptomSummary = buildSymptomSummary(input.symptoms);
  const labSummary = buildLabSummary(input.lab_results);

  const highlights = buildPositiveHighlights({
    weightSummary,
    mealSummary,
    exerciseSummary,
    symptomSummary,
  });

  const nextActions = buildNextActions({
    weightSummary,
    mealSummary,
    exerciseSummary,
    symptomSummary,
    reportType: 'weekly',
  });

  const forecast = buildForecast({
    weightSummary,
    mealSummary,
    exerciseSummary,
    reportType: 'weekly',
  });

  const lines = [];
  lines.push(`${userName}さん、1週間おつかれさまでした。`);
  lines.push('今週の流れをやさしく振り返ると、');

  if (weightSummary.has_data) {
    lines.push(`・体重は ${weightSummary.start_weight}kg → ${weightSummary.end_weight}kg（${formatDelta(weightSummary.delta_kg, 'kg')}）でした。`);
  } else {
    lines.push('・体重データはまだ少なめですが、ここから十分整えていけます。');
  }

  lines.push(`・食事記録は ${mealSummary.meal_count}件、運動記録は ${exerciseSummary.exercise_count}件でした。`);

  if (bodyFatSummary.has_data) {
    lines.push(`・体脂肪率の平均は ${bodyFatSummary.avg_body_fat_percent}% でした。`);
  }

  if (mealSummary.avg_kcal_per_meal !== null) {
    lines.push(`・食事1回あたりの平均は約${mealSummary.avg_kcal_per_meal}kcalです。`);
  }

  if (mealSummary.avg_protein_g !== null || mealSummary.avg_fat_g !== null || mealSummary.avg_carbs_g !== null) {
    lines.push(
      `・栄養の目安は たんぱく質 ${mealSummary.avg_protein_g ?? '-'}g / 脂質 ${mealSummary.avg_fat_g ?? '-'}g / 糖質 ${mealSummary.avg_carbs_g ?? '-'}g でした。`
    );
  }

  lines.push('');
  lines.push('今週よかった点は、');
  highlights.forEach((item) => lines.push(`・${item}`));

  lines.push('');
  lines.push('来週に向けては、');
  nextActions.forEach((item) => lines.push(`・${item}`));

  lines.push('');
  lines.push(forecast);

  if (symptomSummary.has_data && symptomSummary.latest_symptoms.length) {
    lines.push('');
    lines.push('体調面では、無理をしすぎず、その日の状態に合わせて進めていきましょう。');
  }

  if (labSummary.has_data && labSummary.latest_date) {
    lines.push('');
    lines.push(`血液検査の最新反映は ${formatDateLabel(labSummary.latest_date)} ごろの内容です。必要に応じて一緒に見ていきましょう。`);
  }

  return {
    report_type: 'weekly',
    draft_text: lines.join('\n'),
    summary: {
      weight: weightSummary,
      body_fat: bodyFatSummary,
      meals: mealSummary,
      exercises: exerciseSummary,
      symptoms: symptomSummary,
      labs: labSummary,
      highlights,
      next_actions: nextActions,
      forecast,
    },
  };
}

function buildMonthlyDraftText(input) {
  const userName = safeText(input.user_name || 'あなた');

  const weightSummary = buildWeightSummary(input.weights);
  const bodyFatSummary = buildBodyFatSummary(input.body_fats);
  const mealSummary = buildMealSummary(input.meals);
  const exerciseSummary = buildExerciseSummary(input.exercises);
  const symptomSummary = buildSymptomSummary(input.symptoms);
  const labSummary = buildLabSummary(input.lab_results);

  const highlights = buildPositiveHighlights({
    weightSummary,
    mealSummary,
    exerciseSummary,
    symptomSummary,
  });

  const nextActions = buildNextActions({
    weightSummary,
    mealSummary,
    exerciseSummary,
    symptomSummary,
    reportType: 'monthly',
  });

  const forecast = buildForecast({
    weightSummary,
    mealSummary,
    exerciseSummary,
    reportType: 'monthly',
  });

  const lines = [];
  lines.push(`${userName}さん、1か月の積み重ね、本当におつかれさまでした。`);
  lines.push('この1か月を全体で振り返ると、');

  if (weightSummary.has_data) {
    lines.push(`・体重は ${weightSummary.start_weight}kg → ${weightSummary.end_weight}kg（${formatDelta(weightSummary.delta_kg, 'kg')}）でした。`);
    lines.push(`・平均体重は ${weightSummary.avg_weight}kg でした。`);
  } else {
    lines.push('・体重データはまだ少なめですが、ここから十分流れを作れます。');
  }

  lines.push(`・食事記録は ${mealSummary.meal_count}件、運動記録は ${exerciseSummary.exercise_count}件でした。`);

  if (exerciseSummary.total_minutes !== null) {
    lines.push(`・運動時間の合計は ${exerciseSummary.total_minutes}分でした。`);
  }

  if (mealSummary.total_kcal !== null) {
    lines.push(`・記録された総摂取カロリーは ${mealSummary.total_kcal}kcal でした。`);
  }

  if (bodyFatSummary.has_data) {
    lines.push(`・体脂肪率の平均は ${bodyFatSummary.avg_body_fat_percent}% でした。`);
  }

  if (mealSummary.avg_protein_g !== null || mealSummary.avg_fat_g !== null || mealSummary.avg_carbs_g !== null) {
    lines.push(
      `・栄養の目安は たんぱく質 ${mealSummary.avg_protein_g ?? '-'}g / 脂質 ${mealSummary.avg_fat_g ?? '-'}g / 糖質 ${mealSummary.avg_carbs_g ?? '-'}g でした。`
    );
  }

  if (labSummary.has_data) {
    lines.push(`・血液検査の最新反映（${formatDateLabel(labSummary.latest_date)}）も、今後の伴走に活かしていけます。`);
  }

  lines.push('');
  lines.push('この1か月で良かった点は、');
  highlights.forEach((item) => lines.push(`・${item}`));

  lines.push('');
  lines.push('これからさらに整えていきたい点は、');
  nextActions.forEach((item) => lines.push(`・${item}`));

  lines.push('');
  lines.push('体重だけでなく、食事・運動・体調の全部を合わせて見ることで、より無理のない整え方が見えてきます。');
  lines.push(forecast);

  if (symptomSummary.has_data && symptomSummary.latest_symptoms.length) {
    lines.push('');
    lines.push('不調がある日は、頑張ることよりも整えながら続けることを優先して大丈夫です。');
  }

  return {
    report_type: 'monthly',
    draft_text: lines.join('\n'),
    summary: {
      weight: weightSummary,
      body_fat: bodyFatSummary,
      meals: mealSummary,
      exercises: exerciseSummary,
      symptoms: symptomSummary,
      labs: labSummary,
      highlights,
      next_actions: nextActions,
      forecast,
    },
  };
}

function buildAdminReviewMemo(reportResult, input) {
  const summary = reportResult?.summary || {};
  const periodLabel = safeText(input.period_label || '');

  return {
    report_type: reportResult?.report_type || null,
    period_label: periodLabel || null,
    review_points: [
      '数字に不自然な点がないか',
      '体重変化の評価が強すぎないか',
      '症状がある場合に無理な運動推奨になっていないか',
      '押し売り感のある文章になっていないか',
      '利用者さんの性格や状況に合う柔らかさか',
    ],
    quick_summary: {
      weight_delta_kg: summary.weight?.delta_kg ?? null,
      meal_count: summary.meals?.meal_count ?? 0,
      exercise_count: summary.exercises?.exercise_count ?? 0,
      symptom_count: summary.symptoms?.symptom_count ?? 0,
      latest_lab_date: summary.labs?.latest_date ?? null,
    },
    recommended_action:
      reportResult?.report_type === 'weekly'
        ? '内容確認後、軽めの励ましを添えて送信'
        : '内容確認後、来月の重点ポイントを一言添えて送信',
  };
}

function generateWeeklyReportDraft(input) {
  const result = buildWeeklyDraftText(input || {});
  return {
    ok: true,
    report_type: 'weekly',
    draft_text: result.draft_text,
    summary: result.summary,
    admin_review_memo: buildAdminReviewMemo(result, input || {}),
  };
}

function generateMonthlyReportDraft(input) {
  const result = buildMonthlyDraftText(input || {});
  return {
    ok: true,
    report_type: 'monthly',
    draft_text: result.draft_text,
    summary: result.summary,
    admin_review_memo: buildAdminReviewMemo(result, input || {}),
  };
}

module.exports = {
  generateWeeklyReportDraft,
  generateMonthlyReportDraft,
};
