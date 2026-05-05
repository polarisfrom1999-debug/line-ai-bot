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

function buildRoutineLine(pattern = {}) {
  if (pattern?.stable_breakfast_pattern) {
    return '朝の形が安定していますね。迷わず選べる朝食があるのは、続ける上で大きな強みです。';
  }
  if (pattern?.stable_meal_timing) {
    return '食べる時間帯のリズムが整ってきています。体調維持にはこの安定が効いてきます。';
  }
  if (pattern?.stable_favorite_food) {
    return '好みに合う定番が定着しているのは良い流れです。無理に崩さなくて大丈夫です。';
  }
  return '';
}

async function enhanceReply(params = {}) {
  const rawReply = normalizeText(params.rawReply || '');
  if (!rawReply || shouldSkip(params.intentType)) {
    return { text: rawReply, meta: { skipped: true } };
  }

  const intent = inferIntentTag(params.intentType);
  const pattern = userPatternInsightService.buildPatternInsights({
    userId: params.userId,
    userText: params.userText || '',
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
    microChanges: micro.changes,
    patternInsight: pattern
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
  if (pattern.stable_routine_detected) {
    const routineLine = buildRoutineLine(pattern);
    if (routineLine) lines.push(`\n${routineLine}`);
    console.info('[stable_routine_reply_generated]', {
      user_id: params.userId,
      routine_type: pattern.pattern_type,
      suggested_action: pattern.suggest_micro_adjustment_only ? 'suggest_micro_adjustment_only' : 'suggest_keep_routine',
      preserved_existing_pattern: Boolean(pattern.suggest_keep_routine || pattern.suggest_micro_adjustment_only)
    });
  } else if (pattern.hasRecentPatterns) {
    lines.push(`\n${pattern.insights[0]}という流れが見えています。`);
  }
  if (pattern.routine_disruption_detected && pattern.user_may_feel_anxious_about_change) {
    lines.push('\nいつもの流れが崩れると落ち着かないこともありますよね。今日は代わりの形で十分です。');
  }
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

