'use strict';

function normalizeText(v) {
  return String(v || '').trim();
}

function detectTimeBucket(hour) {
  const h = Number(hour || 0);
  if (h < 10) return 'morning';
  if (h < 16) return 'daytime';
  if (h < 22) return 'evening';
  return 'night';
}

function buildPatternInsights(params = {}) {
  const recentMessages = Array.isArray(params.recentMessages) ? params.recentMessages : [];
  const userTexts = recentMessages.filter((m) => m?.role !== 'assistant').map((m) => normalizeText(m?.content || '')).filter(Boolean);
  const safeCurrent = normalizeText(params.userText || '');
  const morningMeals = userTexts.filter((t) => /(朝|朝ごはん|トースト|ヨーグルト)/.test(t)).length;
  const breakfastFoods = userTexts.filter((t) => /(朝|朝ごはん)/.test(t) && /(トースト|ヨーグルト|バナナ|コーヒー|パン|ごはん)/.test(t)).length;
  const nightHeavy = userTexts.filter((t) => /(夜|ラーメン|揚げ|こってり)/.test(t)).length;
  const exerciseCount = userTexts.filter((t) => /(走った|ジョギング|ランニング|筋トレ|腕立て|スクワット|運動)/.test(t)).length;
  const corrections = userTexts.filter((t) => /(半分|1\/4|食べてない|修正|補正)/.test(t)).length;
  const mealTimingMentions = userTexts.filter((t) => /(朝|昼|夜|朝ごはん|昼ごはん|夜ごはん)/.test(t)).length;
  const favoriteFoodMentions = userTexts.filter((t) => /(いつもの|毎朝|定番|ヨーグルト|トースト|納豆|味噌汁)/.test(t)).length;
  const routineDisruption = /(いつもの.*(ない|切れた|なかった|変えた)|違う.*ヨーグルト|代わり)/.test(safeCurrent);
  const anxiousAboutChange = /(不安|落ち着かない|崩れた|いつもと違って嫌|困る)/.test(safeCurrent);
  const changePositive = /(変えてみた|試した|良かった|合ってた)/.test(safeCurrent);
  const changeUncomfortable = /(合わない|しっくりこない|落ち着かない)/.test(safeCurrent);

  const insights = [];
  if (morningMeals >= 2) insights.push('朝は軽めに整える日が多い');
  if (nightHeavy >= 2) insights.push('夜にカロリーが寄りやすい');
  if (exerciseCount >= 2) insights.push('運動は短時間でも継続できている');
  if (corrections >= 2) insights.push('記録を丁寧に補正する傾向がある');

  const stableBreakfastPattern = breakfastFoods >= 2;
  const stableMealTiming = mealTimingMentions >= 4;
  const stableFavoriteFood = favoriteFoodMentions >= 2;
  const stableRoutineDetected = stableBreakfastPattern || stableMealTiming || stableFavoriteFood;
  const routineSupportsContinuity = stableRoutineDetected && corrections <= 3;
  const suggestMicroAdjustmentOnly = stableRoutineDetected && nightHeavy >= 2;
  const suggestKeepRoutine = stableRoutineDetected && !suggestMicroAdjustmentOnly;

  const hasRecentPatterns = insights.length > 0;
  const patternType = stableBreakfastPattern
    ? 'stable_breakfast_pattern'
    : stableMealTiming
      ? 'stable_meal_timing'
      : stableFavoriteFood
        ? 'stable_favorite_food'
        : hasRecentPatterns
          ? 'general_pattern'
          : 'none';
  const confidence = stableRoutineDetected ? 0.86 : (hasRecentPatterns ? 0.72 : 0.55);

  if (patternType !== 'none') {
    console.info('[pattern_insight_detected]', {
      user_id: normalizeText(params.userId || ''),
      pattern_type: patternType,
      confidence,
      is_supportive_routine: routineSupportsContinuity,
      may_need_micro_adjustment: suggestMicroAdjustmentOnly
    });
  }

  return {
    insights,
    hasRecentPatterns,
    timeBucket: detectTimeBucket(params?.hour || 0),
    correctionCount: corrections,
    stable_routine_detected: stableRoutineDetected,
    stable_breakfast_pattern: stableBreakfastPattern,
    stable_meal_timing: stableMealTiming,
    stable_favorite_food: stableFavoriteFood,
    routine_supports_continuity: routineSupportsContinuity,
    routine_disruption_detected: routineDisruption,
    user_may_feel_anxious_about_change: anxiousAboutChange,
    change_is_positive: changePositive,
    change_may_be_uncomfortable: changeUncomfortable,
    suggest_keep_routine: suggestKeepRoutine,
    suggest_micro_adjustment_only: suggestMicroAdjustmentOnly,
    pattern_type: patternType,
    confidence
  };
}

module.exports = {
  buildPatternInsights,
};

