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
  const texts = recentMessages.map((m) => normalizeText(m?.content || '')).filter(Boolean);
  const userTexts = recentMessages.filter((m) => m?.role !== 'assistant').map((m) => normalizeText(m?.content || '')).filter(Boolean);
  const morningMeals = userTexts.filter((t) => /(朝|朝ごはん|トースト|ヨーグルト)/.test(t)).length;
  const nightHeavy = userTexts.filter((t) => /(夜|ラーメン|揚げ|こってり)/.test(t)).length;
  const exerciseCount = userTexts.filter((t) => /(走った|ジョギング|ランニング|筋トレ|腕立て|スクワット|運動)/.test(t)).length;
  const corrections = userTexts.filter((t) => /(半分|1\/4|食べてない|修正|補正)/.test(t)).length;

  const insights = [];
  if (morningMeals >= 2) insights.push('朝は軽めに整える日が多い');
  if (nightHeavy >= 2) insights.push('夜にカロリーが寄りやすい');
  if (exerciseCount >= 2) insights.push('運動は短時間でも継続できている');
  if (corrections >= 2) insights.push('記録を丁寧に補正する傾向がある');

  const hasRecentPatterns = insights.length > 0;
  return {
    insights,
    hasRecentPatterns,
    timeBucket: detectTimeBucket(params?.hour || 0),
    correctionCount: corrections
  };
}

module.exports = {
  buildPatternInsights,
};

