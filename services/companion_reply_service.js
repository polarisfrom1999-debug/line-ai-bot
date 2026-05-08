'use strict';

const userPatternInsightService = require('./user_pattern_insight_service');
const microChangeDetectorService = require('./micro_change_detector_service');
const motivationPhraseService = require('./motivation_phrase_service');
const threeStepsAheadService = require('./three_steps_ahead_service');
const { PHASES, selectToneMode } = require('./relationship_phase_service');

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
    .replace(/^運動を記録しました。?$/m, '今日の動き、ちゃんと見えています。')
    .replace(/^食事として受け取りました。?$/m, '今日の食卓の形、ちゃんと見えています。')
    .replace(/^確認しました。?$/m, '意図は受け取れています。')
    .replace(/^保存しました。?$/m, 'こちら側では受け取れています。');
}

function shouldSkip(intentType) {
  const safe = normalizeText(intentType);
  return /^constitution_|^onboarding|^style_feedback|^newflow_image_hard_stop|^compassionate_confirmation|^pending_confirmation/.test(safe);
}

function resolveRelationshipPhase(params) {
  return normalizeText(params.relationshipPhase || params.longMemory?.relationshipPhase || PHASES.P1) || PHASES.P1;
}

function maybePhaseMealClosing(relationshipPhase, userText, core) {
  const ut = normalizeText(userText || '');
  const c = normalizeText(core || '');
  const lines = [];
  if (relationshipPhase === PHASES.P1 && !/控えめ|概算|推定/.test(c)) {
    lines.push('写真からの概算なので、今日は少し控えめ側で見ておきますね。');
  }
  if (relationshipPhase === PHASES.P2 && /なか卯|すき家|吉野家|松屋|チェーン|店で|お店/.test(ut)) {
    lines.push('店名やメニューまで教えてくれると、記録がかなり現実に寄ります。ありがとうございます。');
  }
  if (relationshipPhase === PHASES.P3 && /半分|訂正|修正|補正|教えてくれ|伝えてくれ/.test(ut)) {
    lines.push('細かく直してくれるのは、あとから見返したときにとても効きます。');
  }
  return lines;
}

function phaseExerciseEncouragement(relationshipPhase) {
  if (relationshipPhase === PHASES.P1) return 'まずはここに送れただけで十分です。';
  if (relationshipPhase === PHASES.P2) return '無理のない範囲で動けている形が、そのまま見えています。';
  if (relationshipPhase === PHASES.P3) return '続け方のリズムが、少しずつ顔を出してきています。';
  if (relationshipPhase === PHASES.P4) return '今日は自分で選べた動きが中心ですね。ここは無理に増やさなくて大丈夫そうです。';
  return '';
}

function buildRoutineLine(pattern = {}) {
  if (pattern?.stable_breakfast_pattern) {
    return '朝の形が安定していますね。迷わず選べる朝食があるのは、続ける上で大きな強みです。';
  }
  if (pattern?.stable_meal_timing) {
    return '食べる時間帯のリズムが整ってきています。体調維持にはこの安定が効いてきます。';
  }
  if (pattern?.stable_favorite_food) {
    return '好みに合う定番が定着しているのは、続ける上での大きな支えです。無理に崩さなくて大丈夫です。';
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

function selectReplyDepth(intent, params = {}) {
  const safeText = normalizeText(params.userText || '');
  if (/(しんどい|つらい|限界|無理|苦しい)/.test(safeText)) return 'deep';
  if (intent === 'normal_chat' && safeText.length > 40) return 'medium';
  if (intent === 'meal' || intent === 'lab') return 'standard';
  if (intent === 'exercise' || intent === 'video') return 'standard';
  return 'light';
}

function runEmotionalQualityCheck(replyText, intent) {
  const safe = normalizeText(replyText || '');
  const dismissive = /(気にすんな|大したことない|そんなの無視)/.test(safe);
  const acknowledges = /(大丈夫|無理しない|一緒に|受け止め|いたわ|寄り添)/.test(safe);
  return {
    emotional_quality_ok: !dismissive && (acknowledges || intent === 'video' || intent === 'meal'),
    acknowledges_feeling: acknowledges,
    avoids_dismissive_phrase: !dismissive
  };
}

function dedupeSourceNotes(text = '', intent = '') {
  const safeIntent = normalizeText(intent);
  const original = String(text || '');
  let deduped = original;
  let removed = false;
  if (safeIntent === 'meal') {
    const phrases = ['カロリーは写真からの推定です。', '写真からの推定として記録しました。'];
    for (const sourcePhrase of phrases) {
      const re = new RegExp(sourcePhrase.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g');
      const matches = deduped.match(re) || [];
      if (matches.length > 1) {
        let firstKept = false;
        deduped = deduped.replace(re, () => {
          if (!firstKept) {
            firstKept = true;
            return sourcePhrase;
          }
          removed = true;
          return '';
        }).replace(/\n{3,}/g, '\n\n').trim();
      }
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
    const intentSkipped = inferIntentTag(params.intentType);
    const phaseSkipped = resolveRelationshipPhase(params);
    console.info('[conversation_tone_selected]', {
      user_id: params.userId,
      relationship_phase: phaseSkipped,
      tone_mode: 'skipped',
      reply_depth: 'skipped',
      reason: 'companion_layer_skipped'
    });
    console.info('[companion_reply_depth_selected]', {
      user_id: params.userId,
      intent: intentSkipped,
      reply_depth: 'skipped'
    });
    console.info('[companion_reply_emotional_quality_check]', {
      user_id: params.userId,
      intent: intentSkipped,
      emotional_quality_ok: null,
      skipped: true
    });
    return { text: rawReply, meta: { skipped: true } };
  }

  const intent = inferIntentTag(params.intentType);
  const relationshipPhase = resolveRelationshipPhase(params);
  const replyDepth = selectReplyDepth(intent, params);
  const tonePick = selectToneMode(relationshipPhase, intent);
  console.info('[conversation_tone_selected]', {
    user_id: params.userId,
    relationship_phase: relationshipPhase,
    tone_mode: tonePick.tone_mode,
    reply_depth: replyDepth,
    reason: tonePick.reason
  });

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
      '動画、ちゃんと残しています。あとで「この動画を解析」と送ってくれたら、フォームの流れを一緒に見ていけます。',
      'こちらでは動画を受け取れています。次は「この動画を解析」から、動きのどこを見直すか整理できます。'
    ], recentAssistantReplies);
    lines.length = 0;
    lines.push(videoPhrase.phrase || core);
    dedupMeta = { avoided: videoPhrase.avoided, replaced: videoPhrase.replaced };
  } else if (intent === 'normal_chat') {
    const banks = {
      [PHASES.P1]: [
        'まずはここに送れただけで十分です。',
        '気になることを、そのまま一文で送ってくれれば大丈夫です。',
        '言いにくいことでも、短くでいいので送ってみてください。こちらで受け止めます。'
      ],
      [PHASES.P2]: [
        '健康の話に無理に戻さなくて大丈夫です。',
        '今の言葉を、そのまま大事にします。',
        '雑談も、ちゃんと置いておきます。'
      ],
      [PHASES.P3]: [
        '少しずつ、言葉の温度まで見えてきています。',
        '迷いのままでも、ここに置いておけます。',
        '責めずに、いまの感触だけ一緒に見ていきましょう。'
      ],
      [PHASES.P4]: [
        '前にも似た流れがあったかもしれません。急がず、今日は一歩だけで十分です。',
        'あなたが自分で選べるように、横で支えます。',
        '深くは寄り添いますが、生活の主導はあなたの側にあります。'
      ]
    };
    const bank = banks[relationshipPhase] || banks[PHASES.P1];
    const chatPhrase = pickNonRecentPhrase(bank, recentAssistantReplies);
    if (chatPhrase.phrase) lines.push(`\n${chatPhrase.phrase}`);
    dedupMeta = { avoided: chatPhrase.avoided, replaced: chatPhrase.replaced };
  } else {
    if (intent === 'meal') {
      const mealExtras = maybePhaseMealClosing(relationshipPhase, params.userText, core);
      for (const ex of mealExtras) {
        if (ex && !lines.some((ln) => ln.includes(ex.slice(0, 12)))) lines.push(`\n${ex}`);
      }
      dedupMeta = { avoided: false, replaced: false };
    } else {
      const motivationPick = pickNonRecentPhrase([motivation], recentAssistantReplies);
      if (motivationPick.phrase) lines.push(`\n${motivationPick.phrase}`);
      const nextStepPick = pickNonRecentPhrase([nextStep], recentAssistantReplies);
      if (nextStepPick.phrase) lines.push(`\n${nextStepPick.phrase}`);
      if (intent === 'exercise') {
        const exLine = phaseExerciseEncouragement(relationshipPhase);
        if (exLine) {
          const exPick = pickNonRecentPhrase([exLine], recentAssistantReplies);
          if (exPick.phrase) lines.push(`\n${exPick.phrase}`);
        }
      }
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

  console.info('[companion_reply_depth_selected]', {
    user_id: params.userId,
    intent,
    reply_depth: replyDepth
  });
  const emotionalQ = runEmotionalQualityCheck(text, intent);
  console.info('[companion_reply_emotional_quality_check]', {
    user_id: params.userId,
    intent,
    emotional_quality_ok: emotionalQ.emotional_quality_ok,
    acknowledges_feeling: emotionalQ.acknowledges_feeling,
    avoids_dismissive_phrase: emotionalQ.avoids_dismissive_phrase
  });

  return { text, meta: { intent, supportStyle } };
}

module.exports = {
  enhanceReply,
};

