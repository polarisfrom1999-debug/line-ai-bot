'use strict';

const contextMemoryService = require('./context_memory_service');

function normalizeText(v) {
  return String(v || '').trim();
}

function joinMealLabel(m) {
  return normalizeText(m?.summary || m?.name || m?.mealLabel || '');
}

function summarizeExercises(list = []) {
  if (!Array.isArray(list) || !list.length) return '';
  const parts = list.slice(-4).map((e) => {
    const s = normalizeText(e?.summary || e?.name || '');
    const steps = e?.steps != null ? Number(e.steps) : null;
    if (steps && steps > 0) return `${s || '歩数'} ${steps}歩`.trim();
    return s || '運動';
  });
  return parts.filter(Boolean).join('、').slice(0, 120);
}

function collectWeightsFromDays(daySlices = []) {
  const out = [];
  const sortedDays = [...daySlices].sort((a, b) => String(a.date).localeCompare(String(b.date)));
  for (const day of sortedDays) {
    for (const w of day.records?.weights || []) {
      const kg = w?.weight != null ? Number(w.weight) : null;
      if (kg && kg > 0) out.push({ date: day.date, kg, raw: w });
    }
  }
  return out;
}

function buildWeightTrend(weights) {
  if (weights.length < 2) return '';
  const a = weights[weights.length - 2];
  const b = weights[weights.length - 1];
  return `${a.kg}→${b.kg}`;
}

function scanUserMessagesForSignals(recentMessages = []) {
  const userLines = recentMessages.filter((m) => m?.role === 'user').map((m) => normalizeText(m?.content)).filter(Boolean);
  const recent_user_words = userLines.slice(-5).filter((t) => t.length >= 4 && t.length <= 140);
  let emotional_context = '';
  let recent_success = '';
  const trust_signals = [];
  let recent_correction = false;

  for (let i = userLines.length - 1; i >= 0; i -= 1) {
    const t = userLines[i];
    if (!emotional_context && /(心が重|不安|心配|つらい|しんどい|怖い|迷う|モヤモヤ)/.test(t)) {
      emotional_context = t.slice(0, 80);
    }
    if (!recent_success && /(\d{3,5}\s*歩|歩数|ラジオ体操|ストレッチ|体操|ウォーキング|走)/.test(t)) {
      const m = t.match(/(\d{3,5})\s*歩/);
      if (m) recent_success = `昨日${Number(m[1]).toLocaleString('ja-JP')}歩`;
      else recent_success = t.slice(0, 72);
    }
    if (/(家族|主人|夫|妻|子ども|子供|母|父).*(共有|見せ|褒め|喜ん)/.test(t) || /(褒められ|やってみた|伝えた)/.test(t)) {
      trust_signals.push(t.slice(0, 100));
    }
    if (/(訂正|修正|補正|半分|実際は|言い直)/.test(t)) recent_correction = true;
  }

  return {
    recent_user_words: recent_user_words.slice(-4),
    emotional_context,
    recent_success,
    trust_signals: [...new Set(trust_signals)].slice(-3),
    recent_correction
  };
}

function detectBreakfastRoutine(todayMeals = [], longMem = {}) {
  const patterns = Array.isArray(longMem?.eatingPattern) ? longMem.eatingPattern : [];
  const joined = patterns.join(' ');
  const firstToday = todayMeals[0];
  const firstLabel = joinMealLabel(firstToday);
  const morningRe = /朝|白湯|卵|味付き卵|ヨーグルト|トースト|スープ/;
  const stable = Boolean(firstLabel && morningRe.test(joined + firstLabel));
  return {
    has_breakfast_routine: stable,
    breakfast_pattern: patterns.find((p) => morningRe.test(p)) || firstLabel.slice(0, 48)
  };
}

function yesterdayVsTodayExercise(daySlices, todayKey) {
  const sorted = [...daySlices].sort((a, b) => String(a.date).localeCompare(String(b.date)));
  const todayBucket = sorted.find((d) => d.date === todayKey);
  const prev = sorted.filter((d) => d.date < todayKey).pop();
  const yEx = prev?.records?.exercises || [];
  let ySteps = 0;
  for (const e of yEx) {
    const st = e?.steps != null ? Number(e.steps) : 0;
    if (st > ySteps) ySteps = st;
  }
  const ySummary = summarizeExercises(yEx);
  const tSummary = summarizeExercises(todayBucket?.records?.exercises || []);
  return {
    yesterday_exercise_summary: ySummary,
    yesterday_peak_steps: ySteps || null,
    exercise_today: tSummary
  };
}

/**
 * 返信前に「今日の背景」をまとめる（DB/メモリの日次バケツ＋直近会話＋長期メモ）。
 * @param {string} userId
 * @param {{ limitDays?: number, stubTodayContext?: object }} [options]
 * @returns {Promise<{ today_context: object }>}
 */
async function buildUserDailyContext(userId, options = {}) {
  if (options.stubTodayContext && typeof options.stubTodayContext === 'object') {
    return { today_context: { ...options.stubTodayContext } };
  }

  const limitDays = Math.max(2, Math.min(14, Number(options.limitDays) || 4));
  const [todayRec, daySlices, recentMsgs, longMem] = await Promise.all([
    contextMemoryService.getTodayRecords(userId),
    contextMemoryService.getRecentDailyRecords(userId, limitDays),
    contextMemoryService.getRecentMessages(userId, 48),
    contextMemoryService.getLongMemory(userId)
  ]);

  const todayKey = contextMemoryService.getTokyoTodayYmd();
  const meals = Array.isArray(todayRec?.meals) ? todayRec.meals : [];
  const meal_count = meals.length;
  const latest_meal = joinMealLabel(meals[meals.length - 1]) || '';
  const br = detectBreakfastRoutine(meals, longMem);

  const weightsFlat = collectWeightsFromDays(daySlices);
  const weight_trend = buildWeightTrend(weightsFlat);
  const latestWeight = weightsFlat.length ? weightsFlat[weightsFlat.length - 1] : null;

  const yx = yesterdayVsTodayExercise(daySlices, todayKey);
  let recent_success = yx.yesterday_peak_steps
    ? `昨日${yx.yesterday_peak_steps.toLocaleString('ja-JP')}歩`
    : '';
  if (!recent_success && yx.yesterday_exercise_summary) {
    recent_success = `昨日の動き（${yx.yesterday_exercise_summary}）`;
  }

  const msgSig = scanUserMessagesForSignals(recentMsgs);
  if (msgSig.recent_success) recent_success = msgSig.recent_success;

  const life_context = (Array.isArray(longMem?.lifeContext) ? longMem.lifeContext : []).slice(-4).join('／').slice(0, 120);
  const continuous_habits = (Array.isArray(longMem?.eatingPattern) ? longMem.eatingPattern : []).slice(-6);

  const body_note = recentMsgs
    .filter((m) => m?.role === 'user')
    .map((m) => normalizeText(m?.content))
    .reverse()
    .find((t) => /(痛い|だるい|眠い|熱|体調|足|腰|肩)/.test(t) && t.length < 100) || '';

  const today_context = {
    meal_count,
    has_breakfast_routine: Boolean(br.has_breakfast_routine),
    breakfast_pattern: normalizeText(br.breakfast_pattern) || null,
    latest_meal: latest_meal || null,
    exercise_today: yx.exercise_today || null,
    body_note: body_note || null,
    weight_trend: weight_trend || null,
    latest_weight_kg: latestWeight?.kg ?? null,
    life_context: life_context || null,
    emotional_context: msgSig.emotional_context || null,
    recent_success: recent_success || null,
    recent_user_words: msgSig.recent_user_words,
    continuous_habits,
    trust_signals: msgSig.trust_signals,
    recent_correction: msgSig.recent_correction,
    yesterday_exercise_summary: yx.yesterday_exercise_summary || null
  };

  return { today_context };
}

module.exports = {
  buildUserDailyContext
};
