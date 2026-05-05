'use strict';

const userPatternInsightService = require('./user_pattern_insight_service');
const microChangeDetectorService = require('./micro_change_detector_service');
const motivationPhraseService = require('./motivation_phrase_service');
const threeStepsAheadService = require('./three_steps_ahead_service');

function normalizeText(v) {
  return String(v || '').trim();
}

function detectSupportStyle(text, intent) {
  const safe = normalizeText(text);
  if (/(痛い|重い|しびれ|違和感)/.test(safe)) return 'caution';
  if (/meal_correction|meal/.test(intent) && /(たぶん|くらい|曖昧|わからない)/.test(safe)) return 'reassure';
  if (/exercise/.test(intent)) return 'encourage';
  return 'normal';
}

function inferIntentTag(intentType = '') {
  const safe = normalizeText(intentType);
  if (/meal|today_meal/.test(safe)) return 'meal';
  if (/exercise/.test(safe)) return 'exercise';
  if (/body_condition|pain/.test(safe)) return 'body_condition';
  if (/lab/.test(safe)) return 'lab';
  return 'normal_chat';
}

function avoidBareTemplate(text) {
  return String(text || '')
    .replace(/^運動を記録しました。?$/m, '内容を受け取りました。')
    .replace(/^食事として受け取りました。?$/m, '食事内容、しっかり見ています。')
    .replace(/^確認しました。?$/m, '意図は受け取れています。')
    .replace(/^保存しました。?$/m, '内容を反映しました。');
}

function shouldSkip(intentType) {
  const safe = normalizeText(intentType);
  return /^constitution_|^onboarding|^style_feedback|^newflow_image_hard_stop/.test(safe);
}

async function enhanceReply(params = {}) {
  const rawReply = normalizeText(params.rawReply || '');
  if (!rawReply || shouldSkip(params.intentType)) {
    return { text: rawReply, meta: { skipped: true } };
  }

  const intent = inferIntentTag(params.intentType);
  const pattern = userPatternInsightService.buildPatternInsights({
    recentMessages: params.recentMessages || [],
    hour: params.hour || 0
  });
  const micro = microChangeDetectorService.detectMicroChange({
    todayNutritionSummary: params.todayNutritionSummary || {},
    todayEnergyBalance: params.todayEnergyBalance || {}
  });
  const supportStyle = detectSupportStyle(params.userText, intent);
  const motivation = motivationPhraseService.buildMotivationPhrase({
    userId: params.userId,
    userText: params.userText,
    intent
  });
  const nextStep = threeStepsAheadService.buildThreeStepsAhead({
    intent,
    userText: params.userText,
    microChanges: micro.changes
  });

  console.info('[companion_reply_context]', {
    user_id: params.userId,
    intent,
    active_context_type: normalizeText(params.activeContextType || ''),
    has_today_summary: Boolean(params.todayNutritionSummary || params.todayEnergyBalance),
    has_recent_patterns: pattern.hasRecentPatterns,
    has_micro_change: micro.hasMicroChange,
    support_style: supportStyle
  });

  const core = avoidBareTemplate(rawReply);
  const lines = [core];
  if (pattern.hasRecentPatterns) lines.push(`\n${pattern.insights[0]}という流れが見えています。`);
  if (motivation) lines.push(`\n${motivation}`);
  if (nextStep) lines.push(`\n${nextStep}`);
  const text = lines.join('\n').trim();

  console.info('[companion_reply_generated]', {
    user_id: params.userId,
    intent,
    reply_style: supportStyle,
    included_next_step: Boolean(nextStep),
    avoided_template_phrase: core !== rawReply
  });

  return { text, meta: { intent, supportStyle } };
}

module.exports = {
  enhanceReply,
};

