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
  if (/athlete_video|video/.test(safe)) return 'video';
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
  return /^constitution_|^onboarding|^style_feedback|^newflow_image_hard_stop|^compassionate_confirmation|^pending_confirmation/.test(safe);
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

function getRecentAssistantReplies(recentMessages = []) {
  return (Array.isArray(recentMessages) ? recentMessages : [])
    .filter((m) => m?.role === 'assistant')
    .map((m) => normalizeText(m?.content || ''))
    .filter(Boolean)
    .slice(-5);
}

function pickNonRecentPhrase(candidates = [], recentReplies = []) {
  const rows = Array.isArray(candidates) ? candidates.filter(Boolean) : [];
  if (!rows.length) return { phrase: '', avoided: false, replaced: false };
  const recent = Array.isArray(recentReplies) ? recentReplies : [];
  const first = rows[0];
  const firstUsed = recent.some((r) => r.includes(first));
  for (const c of rows) {
    const used = recent.some((r) => r.includes(c));
    if (!used) {
      return { phrase: c, avoided: firstUsed, replaced: c !== first };
    }
  }
  return { phrase: first, avoided: false, replaced: false };
}

function dedupeSourceNotes(text = '', intent = '') {
  const safeIntent = normalizeText(intent);
  const original = String(text || '');
  let deduped = original;
  let removed = false;
  if (safeIntent === 'meal') {
    const sourcePhrase = '写真からの推定として記録しました。';
    const matches = deduped.match(new RegExp(sourcePhrase.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g')) || [];
    if (matches.length > 1) {
      let firstKept = false;
      deduped = deduped.replace(/写真からの推定として記録しました。/g, () => {
        if (!firstKept) {
          firstKept = true;
          return '写真からの推定として記録しました。';
        }
        removed = true;
        return '';
      }).replace(/\n{3,}/g, '\n\n').trim();
    }
  }
  console.info('[companion_reply_source_note_deduped]', {
    removed_duplicate_source_note: removed,
    intent: safeIntent || 'normal_chat'
  });
  return deduped;
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
  const recentAssistantReplies = getRecentAssistantReplies(params.recentMessages);
  let dedupMeta = { avoided: false, replaced: false };
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
  if (intent === 'lab') {
    const labPhrase = pickNonRecentPhrase([
      '読み取り値は参考にしつつ、原本と照らして確認していけば十分です。',
      '気になる項目を一つずつ確認していけば、全体は落ち着いて見えてきます。'
    ], recentAssistantReplies);
    if (labPhrase.phrase) lines.push(`\n${labPhrase.phrase}`);
    dedupMeta = { avoided: labPhrase.avoided, replaced: labPhrase.replaced };
  } else if (intent === 'video') {
    const videoPhrase = pickNonRecentPhrase([
      '動画、ちゃんと残しました。あとで「この動画を解析」と送ってくれたら、フォームの流れを一緒に見ていけるようにします。',
      '保存はできています。次は「この動画を解析」で、動きのどこを見直すか整理できます。'
    ], recentAssistantReplies);
    lines.length = 0;
    lines.push(videoPhrase.phrase || core);
    dedupMeta = { avoided: videoPhrase.avoided, replaced: videoPhrase.replaced };
  } else if (intent === 'normal_chat') {
    const chatPhrase = pickNonRecentPhrase([
      '確認したいことがあれば、そのまま送ってください。',
      '気になることを短く送ってくれれば、そこから一緒に整理します。'
    ], recentAssistantReplies);
    if (chatPhrase.phrase) lines.push(`\n${chatPhrase.phrase}`);
    dedupMeta = { avoided: chatPhrase.avoided, replaced: chatPhrase.replaced };
  } else {
    if (intent === 'meal') {
      // Meal reply layout is formatter-first; avoid appending generic lines here.
      dedupMeta = { avoided: false, replaced: false };
    } else {
      const motivationPick = pickNonRecentPhrase([motivation], recentAssistantReplies);
      if (motivationPick.phrase) lines.push(`\n${motivationPick.phrase}`);
      const nextStepPick = pickNonRecentPhrase([nextStep], recentAssistantReplies);
      if (nextStepPick.phrase) lines.push(`\n${nextStepPick.phrase}`);
      dedupMeta = {
        avoided: motivationPick.avoided || nextStepPick.avoided,
        replaced: motivationPick.replaced || nextStepPick.replaced
      };
    }
  }
  const text = dedupeSourceNotes(lines.join('\n').trim(), intent);

  console.info('[companion_reply_phrase_dedup]', {
    avoided_recent_phrase: Boolean(dedupMeta.avoided),
    replaced_phrase: Boolean(dedupMeta.replaced),
    intent
  });

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

