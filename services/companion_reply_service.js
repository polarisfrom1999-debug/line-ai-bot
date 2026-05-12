'use strict';

const contextMemoryService = require('./context_memory_service');
const userPatternInsightService = require('./user_pattern_insight_service');
const microChangeDetectorService = require('./micro_change_detector_service');
const motivationPhraseService = require('./motivation_phrase_service');
const threeStepsAheadService = require('./three_steps_ahead_service');
const { PHASES } = require('./relationship_phase_service');
const { selectConversationTone } = require('./conversation_tone_selector_service');
const emotionalQualityCheckService = require('./emotional_quality_check_service');
const userDailyContextBuilderService = require('./user_daily_context_builder_service');
const contextualObservationSelectorService = require('./contextual_observation_selector_service');
const conversationStyleProfileService = require('./conversation_style_profile_service');
const humanPhraseVariationService = require('./human_phrase_variation_service');

function normalizeText(v) {
  return String(v || '').trim();
}

function detectSupportStyle(text, intent) {
  const safe = normalizeText(text);
  if (/(痛い|重い|しびれ|違和感)/.test(safe)) return 'caution';
  if (/meal_correction|meal/.test(intent) && /(たぶん|くらい|曖昧|わからない)/.test(safe)) return 'reassure';
  if (intent === 'exercise_feedback' || intent === 'exercise') return 'encourage';
  return 'normal';
}

function inferIntentTag(intentType = '') {
  const safe = normalizeText(intentType);
  if (/athlete_video|video/.test(safe)) return 'video';
  if (/emotional_support/.test(safe)) return 'emotional_support';
  if (/life_companion/.test(safe)) return 'life_companion';
  if (/correction_feedback/.test(safe)) return 'correction_feedback';
  if (/meal_record_text|meal_note|meal|today_meal/.test(safe)) return 'meal';
  if (/exercise_feedback/.test(safe)) return 'exercise_feedback';
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

/**
 * @returns {{ depth: 'short'|'normal'|'deep', reason: string }}
 */
function selectReplyDepth(intent, params = {}, relationshipPhase = '') {
  const cm = normalizeText(params.conversationMode || params.intentType || '');
  if (cm === 'emotional_support' || intent === 'emotional_support') {
    return { depth: 'deep', reason: 'emotional_support_locked_deep' };
  }
  const safeText = normalizeText(params.userText || '');
  const deepMarkers = /不安|迷い|弱音|寂し|さみしい|心が重い|気持ちが重い|痛み|失敗|できなかった|食べすぎ|ダメだった|だめだった|疲れ|しんどい|限界|相談|どう思う|実は|本当は|言いにくい|つらい|苦しい|泣き|落ち込/;
  if (deepMarkers.test(safeText)) {
    return { depth: 'deep', reason: 'vulnerability_distress_or_seeking' };
  }
  if (/(相談|ちょっと|聞いて)/.test(safeText) && safeText.length > 8) {
    return { depth: 'deep', reason: 'help_seeking' };
  }
  if (safeText.length <= 8 && /^(はい|うん|OK|ok|お[kK]|了解)$/i.test(safeText)) {
    return { depth: 'short', reason: 'light_ack' };
  }
  if ((intent === 'meal' || intent === 'exercise') && safeText.length <= 14) {
    return { depth: 'short', reason: 'brief_health_note' };
  }
  if (intent === 'normal_chat' && safeText.length < 22) {
    return { depth: 'short', reason: 'brief_chat' };
  }
  if (relationshipPhase === PHASES.P3 || relationshipPhase === PHASES.P4) {
    if (intent === 'normal_chat' && safeText.length > 36) {
      return { depth: 'deep', reason: 'longer_chat_higher_trust_phase' };
    }
  }
  if (intent === 'correction_feedback') {
    return { depth: 'normal', reason: 'correction_feedback_minimal' };
  }
  if (intent === 'exercise_feedback') {
    return { depth: 'normal', reason: 'exercise_feedback_body' };
  }
  return { depth: 'normal', reason: 'default' };
}

function maybePhaseMealClosing(relationshipPhase, userText, core) {
  const ut = normalizeText(userText || '');
  const c = normalizeText(core || '');
  const lines = [];
  if (relationshipPhase === PHASES.P1 && !/控えめ|概算|推定/.test(c)) {
    lines.push('写真からの概算なので、今日は少し控えめ側で見ておきますね。');
    if (!/直せます|直せる|言い直/.test(c)) {
      lines.push('違っていれば、あとで自然に直せます。');
    }
  }
  if (relationshipPhase === PHASES.P2 && /なか卯|すき家|吉野家|松屋|チェーン|店で|お店/.test(ut)) {
    lines.push('そうやって教えてくれると、写真だけよりかなり実際に近づけられます。今の記録は大きくズレていなさそうなので、このままで良さそうです。');
  }
  if (relationshipPhase === PHASES.P3 && /半分|訂正|修正|補正|補足|あとから|実際は|教えてくれ|伝えてくれ/.test(ut)) {
    lines.push('最近、あとから少し補足してくれることが増えているように見えます。完璧な一発より、実感に近づけていく方が続きます。ここから。はその形で大丈夫です。');
  }
  if (relationshipPhase === PHASES.P4 && /腰|痛み|しんど|疲れ/.test(ut)) {
    lines.push('今日は食事の形は見えていますが、体の声も一緒に置いておきます。ここで頑張りを足すより、明日も動ける体を残す方が大事そうなら、「整える日」にしておきましょう。');
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

function fuseContextualObservation({
  observationText = '',
  observationType = '',
  core = '',
  intent = 'normal_chat',
  userId = ''
} = {}) {
  const obs = normalizeText(observationText);
  const c = normalizeText(core);
  const log = (integrated, reason) => {
    console.info('[contextual_observation_integrated]', {
      user_id: normalizeText(userId) || '(anon)',
      observation_type: normalizeText(observationType) || '',
      integrated_into_reply: integrated,
      skipped_reason: reason
    });
  };
  if (!obs) {
    log(false, 'no_observation');
    return { text: c, integrated: false };
  }
  if (intent === 'video') {
    log(false, 'video_intent_reserved');
    return { text: c, integrated: false };
  }
  const prefixLen = Math.min(24, obs.length);
  if (prefixLen >= 6 && c.includes(obs.slice(0, prefixLen))) {
    log(false, 'already_in_core');
    return { text: c, integrated: false };
  }

  let obsTrim = obs.replace(/\s+/g, ' ').replace(/。+$/, '');
  const dupPhrase = /(ちゃんと見えています|流れが見えています|形になっています)/;
  if (dupPhrase.test(obsTrim) && dupPhrase.test(c)) {
    obsTrim = obsTrim.replace(dupPhrase, '').replace(/[、。]\s*$/u, '').trim();
  }
  if (!obsTrim) {
    log(false, 'observation_empty_after_dedup');
    return { text: c, integrated: false };
  }

  const bridgeMap = {
    past_effort_link: 'なので、',
    yesterday_carryover: 'なので、',
    stable_rhythm: '',
    meal_balance: '',
    learning_success: '',
    emotional_context: '',
    body_awareness: '',
    correction_trust: '',
    trust_signal: '',
    life_environment: '',
    body_care: '',
    today_flow: '',
    today_continuity: '',
    gentle_default: ''
  };
  const br = bridgeMap[observationType] || '';
  const parts = c.split('\n');
  const firstLine = parts[0] || '';
  const rest = parts.slice(1).join('\n');
  const mergedFirst = br ? `${obsTrim}。${br}${firstLine}` : `${obsTrim}。${firstLine}`;
  const fused = rest ? `${mergedFirst}\n${rest}` : mergedFirst;
  const cleaned = fused.replace(/。\s*。/g, '。').trim();
  log(true, 'fused_lead_sentence');
  return { text: cleaned, integrated: true };
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
  const relationshipPhase = resolveRelationshipPhase(params);

  if (normalizeText(params.intentType) === 'correction_feedback') {
    const eq = emotionalQualityCheckService.applyEmotionalQualityPass({
      text: rawReply,
      userText: params.userText || '',
      intent: 'correction_feedback',
      conversationMode: 'correction_feedback',
      replyDepth: 'normal',
      relationshipPhase,
      userId: params.userId,
      hour: Number(params.hour || 0),
      totalTurns: Number((await contextMemoryService.getUserState(params.userId).catch(() => ({})))?.totalTurns || 0)
    });
    console.info('[companion_reply_context]', {
      user_id: params.userId,
      intent: 'correction_feedback',
      active_context_type: normalizeText(params.activeContextType || ''),
      has_today_summary: false,
      has_recent_patterns: false,
      has_micro_change: false,
      support_style: 'normal',
      reply_depth: 'normal'
    });
    return { text: eq.text, meta: { intent: 'correction_feedback', supportStyle: 'normal', reply_depth: 'normal', bypass: 'correction_feedback' } };
  }

  if (!rawReply || shouldSkip(params.intentType)) {
    const intentSkipped = inferIntentTag(params.intentType);
    const depthMeta = selectReplyDepth(intentSkipped, params, relationshipPhase);
    console.info('[conversation_tone_selected]', {
      user_id: params.userId,
      relationship_phase: relationshipPhase,
      tone_mode: 'skipped',
      reply_depth: depthMeta.depth,
      reason: 'companion_layer_skipped'
    });
    console.info('[companion_reply_depth_selected]', {
      user_id: params.userId,
      intent: intentSkipped,
      relationship_phase: relationshipPhase,
      reply_depth: depthMeta.depth,
      reason: depthMeta.reason
    });
    console.info('[companion_reply_emotional_quality_check]', {
      user_id: params.userId,
      intent: intentSkipped,
      relationship_phase: relationshipPhase,
      has_specific_reaction: null,
      has_user_word_echo: null,
      has_warmth: null,
      has_next_step: null,
      has_template_only_phrase: null,
      has_trust_building_phrase: null,
      rewrite_applied: null,
      skipped: true
    });
    return { text: rawReply, meta: { skipped: true } };
  }

  const intent = inferIntentTag(params.intentType);
  const depthMeta = selectReplyDepth(intent, params, relationshipPhase);
  const tonePick = selectConversationTone(relationshipPhase, intent, depthMeta);
  console.info('[conversation_tone_selected]', {
    user_id: params.userId,
    relationship_phase: relationshipPhase,
    tone_mode: tonePick.tone_mode,
    reply_depth: depthMeta.depth,
    reason: tonePick.reason,
    safe_reliance: tonePick.safe_reliance,
    deep_trust: tonePick.deep_trust,
    emotional_safety: tonePick.emotional_safety,
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
    support_style: supportStyle,
    reply_depth: depthMeta.depth
  });

  const core = avoidBareTemplate(rawReply);
  const recentAssistantReplies = getRecentAssistantReplies(params.recentMessages);

  let userState = { totalTurns: 0 };
  try {
    userState = await contextMemoryService.getUserState(params.userId);
  } catch (_e) {
    userState = { totalTurns: 0 };
  }

  let integratedCore = core;
  const conversationModeNorm = normalizeText(params.conversationMode || params.intentType || '');
  const stableRoutineEvidenceCountParam = Number(params.stableRoutineEvidenceCount);
  const suppressMealTextStableRoutine =
    intent === 'meal'
    && conversationModeNorm === 'meal_record_text'
    && (!Number.isFinite(stableRoutineEvidenceCountParam) || stableRoutineEvidenceCountParam < 2);
  const skipContextualObservation = /emotional_support|life_companion|correction_feedback/.test(conversationModeNorm);

  if (!skipContextualObservation) {
    try {
      await conversationStyleProfileService.applyLightStyleUpdate(params.userId, params.userText);
      const { today_context } = await userDailyContextBuilderService.buildUserDailyContext(params.userId);
      const sel = contextualObservationSelectorService.selectContextualObservation({
        userId: params.userId,
        userText: params.userText,
        todayContext: today_context,
        intentTag: intent,
        relationshipPhase
      });
      const obsTypeNorm = normalizeText(sel.observation_type || '');
      const skipStableRhythmObs = suppressMealTextStableRoutine && obsTypeNorm === 'stable_rhythm';
      const oc = normalizeText(sel.observation_text || '');
      const cr = normalizeText(core);
      if (oc && cr.length >= 10 && cr.includes(oc.slice(0, Math.min(24, oc.length)))) {
        console.info('[contextual_observation_integrated]', {
          user_id: params.userId,
          observation_type: normalizeText(sel.observation_type || ''),
          integrated_into_reply: false,
          skipped_reason: 'observation_overlaps_core'
        });
      } else if (oc && skipStableRhythmObs) {
        console.info('[contextual_observation_integrated]', {
          user_id: params.userId,
          observation_type: obsTypeNorm,
          integrated_into_reply: false,
          skipped_reason: 'meal_text_stable_rhythm_insufficient_evidence'
        });
      } else if (oc) {
        const fused = fuseContextualObservation({
          observationText: oc,
          observationType: sel.observation_type || '',
          core: cr,
          intent,
          userId: params.userId
        });
        integratedCore = fused.text;
      } else {
        console.info('[contextual_observation_integrated]', {
          user_id: params.userId,
          observation_type: normalizeText(sel.observation_type || 'none'),
          integrated_into_reply: false,
          skipped_reason: normalizeText(sel.reason || 'no_specific_observation')
        });
      }
    } catch (_e) {
      console.info('[contextual_observation_integrated]', {
        user_id: params.userId,
        observation_type: '',
        integrated_into_reply: false,
        skipped_reason: 'builder_or_selector_error'
      });
    }
  } else {
    console.info('[contextual_observation_integrated]', {
      user_id: params.userId,
      observation_type: '',
      integrated_into_reply: false,
      skipped_reason: 'conversation_first_emotional_or_life'
    });
  }

  const lines = [integratedCore];
  let dedupMeta = { avoided: false, replaced: false };

  const recentUserCorrectionHints = (Array.isArray(params.recentMessages) ? params.recentMessages : [])
    .filter((m) => m?.role === 'user')
    .slice(-6)
    .some((m) => /半分|訂正|修正|補正|実際は|あとから/.test(normalizeText(m?.content || '')));

  if (pattern.stable_routine_detected && !suppressMealTextStableRoutine) {
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

  if (relationshipPhase === PHASES.P3 && intent === 'meal' && recentUserCorrectionHints && !normalizeText(params.userText || '').match(/半分|訂正|補正/)) {
    lines.push('\n最近、写真のあとに「実際はこうだった」と教えてくれることが増えているように見えます。記録が推定だけでなく、あなたの実感に近づいてきています。');
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
    lines.push(videoPhrase.phrase || integratedCore);
    dedupMeta = { avoided: videoPhrase.avoided, replaced: videoPhrase.replaced };
  } else if (intent === 'emotional_support' || intent === 'life_companion') {
    dedupMeta = { avoided: false, replaced: false };
  } else if (intent === 'normal_chat') {
    const banks = {
      [PHASES.P1]: [
        'まずはここに送れただけで十分です。',
        '気になることを、そのまま一文で送ってくれれば大丈夫です。',
        '言いにくいことでも、ざっくりで大丈夫です。今わかる範囲で十分です。',
        'あとで直せます。責めるための会話ではありません。'
      ],
      [PHASES.P2]: [
        '健康の話に無理に戻さなくて大丈夫です。',
        '今の言葉を、そのまま大事にします。',
        '雑談も、ちゃんと置いておきます。',
        'ここでは、そのまま話して大丈夫です。'
      ],
      [PHASES.P3]: [
        '少しずつ、言葉の温度まで見えてきています。',
        '迷いのままでも、ここに置いておけます。',
        '責めずに、いまの感触だけ一緒に見ていきましょう。',
        '言葉のクセや間、そっと横で見ています。'
      ],
      [PHASES.P4]: [
        '前にも似た流れがあったかもしれません。急がず、今日は一歩だけで十分です。',
        'あなたが自分で選べるように、横で支えます。',
        '深くは寄り添いますが、生活の主導はあなたの側にあります。',
        '必要なら、現実の誰かに伝える言葉も一緒に短く整えます。'
      ]
    };
    const bank = banks[relationshipPhase] || banks[PHASES.P1];
    const chatPhrase = pickNonRecentPhrase(bank, recentAssistantReplies);
    if (depthMeta.depth !== 'short' && chatPhrase.phrase) lines.push(`\n${chatPhrase.phrase}`);
    dedupMeta = { avoided: chatPhrase.avoided, replaced: chatPhrase.replaced };
  } else {
    if (intent === 'meal') {
      const mealExtras = maybePhaseMealClosing(relationshipPhase, params.userText, integratedCore);
      for (const ex of mealExtras) {
        if (ex && !lines.some((ln) => ln.includes(ex.slice(0, 10)))) lines.push(`\n${ex}`);
      }
      dedupMeta = { avoided: false, replaced: false };
    } else {
      const motivationPick = pickNonRecentPhrase([motivation], recentAssistantReplies);
      if (motivationPick.phrase && depthMeta.depth !== 'short') lines.push(`\n${motivationPick.phrase}`);
      const nextStepPick = pickNonRecentPhrase([nextStep], recentAssistantReplies);
      if (nextStepPick.phrase && depthMeta.depth !== 'short') lines.push(`\n${nextStepPick.phrase}`);
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

  let text = dedupeSourceNotes(lines.join('\n').trim(), intent);

  const styleProf = params.longMemory?.conversationStyleProfile || {};
  const userSoftTone = /[\u{1F300}-\u{1FAFF}]/u.test(params.userText || '') || /(〜|ですぅ|わーい|🙌|っ+[\s。]|ちゃん)/.test(params.userText || '');
  if (
    intent !== 'emotional_support'
    && intent !== 'life_companion'
    && userSoftTone
    && (relationshipPhase === PHASES.P3 || relationshipPhase === PHASES.P4)
    && (styleProf.emojiLover || styleProf.casualLover || /[\u{1F300}-\u{1FAFF}]/u.test(params.userText || ''))
    && Math.random() < 0.3
  ) {
    const casualBank = ['それは良かったですぅ〜', 'わーい🙌 ちゃんと届いています。', 'たまのご褒美くらい、全然いい線ですよぉ〜'];
    const pickC = pickNonRecentPhrase(casualBank, recentAssistantReplies);
    if (pickC.phrase) text = `${text}\n${pickC.phrase}`.trim();
  }

  if (intent === 'meal' && depthMeta.depth === 'normal' && Math.random() < 0.4) {
    const closingPick = humanPhraseVariationService.selectHumanPhraseVariation({
      phrase_group: 'closing_soft',
      recent_assistant_texts: recentAssistantReplies,
      silent: true
    });
    if (closingPick.phrase && !text.includes(closingPick.phrase.slice(0, 8))) {
      text = `${text}\n${closingPick.phrase}`.trim();
      console.info('[human_phrase_variation_selected]', {
        phrase_group: closingPick.phrase_group || 'closing_soft',
        selected_phrase: closingPick.phrase,
        avoided_recent_phrase: closingPick.avoided_recent_phrase || '(none)'
      });
    }
  }

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
    relationship_phase: relationshipPhase,
    reply_depth: depthMeta.depth,
    reason: depthMeta.reason
  });

  const eq = emotionalQualityCheckService.applyEmotionalQualityPass({
    text,
    userText: params.userText || '',
    intent,
    conversationMode: normalizeText(params.conversationMode || params.intentType || intent),
    replyDepth: depthMeta.depth,
    relationshipPhase,
    userId: params.userId,
    hour: Number(params.hour || 0),
    totalTurns: Number(userState.totalTurns || 0)
  });

  return { text: eq.text, meta: { intent, supportStyle, reply_depth: depthMeta.depth } };
}

module.exports = {
  enhanceReply,
};
