'use strict';

const emotionalQualityCheckService = require('./emotional_quality_check_service');

function normalizeText(v) {
  return String(v || '').trim();
}

const GENERIC_TEMPLATE_STRIP = [
  'ここまでの流れを一本で見ています',
  '急がず、今日はこの一歩で十分です',
  '雑談も、ちゃんと受け止めます',
  '健康の話に引き戻さなくて大丈夫です',
  '続きがあれば、そのまま送ってください',
  'まずはここに送れただけで十分です',
];

const INTERNAL_TERM_RE = /\b(DB保存済み|内部|trace_id|intentType|conversation_mode)\b/gi;

const INTENT_MISMATCH_PHRASES = {
  emotional_support: /(手入力の目安|今日の合計|kcal|カロリー|TG|中性脂肪|検査値)/i,
  correction_feedback: /(ひとりで抱えすぎ|一緒に整理していきましょう|抱えすぎなくて大丈夫|今わかる範囲だけで)/,
  meal_record_text: /(雑談も、ちゃんと受け止めます|健康の話に引き戻さなくて)/,
  meal_note: /(たまのご褒美として受け止めました。責めず、次は1個に戻せたら十分です)/,
};

function stripBannedTemplates(text) {
  let out = String(text || '');
  let removed = false;
  for (const phrase of GENERIC_TEMPLATE_STRIP) {
    if (out.includes(phrase)) {
      out = out.split(phrase).join('').replace(/\n{3,}/g, '\n\n').trim();
      removed = true;
    }
  }
  const echoWeightRe = /「[^」]{1,48}」の重さ、ちゃんと受け取っています。\n?/g;
  if (echoWeightRe.test(out)) {
    out = out.replace(echoWeightRe, '').trim();
    removed = true;
  }
  return { text: out.trim(), removed };
}

function stripInternalTerms(text) {
  return String(text || '').replace(INTERNAL_TERM_RE, '').replace(/\n{3,}/g, '\n\n').trim();
}

function shortenIfNeeded(text, intentType, conversationMode) {
  const cm = normalizeText(conversationMode || intentType);
  const lines = String(text || '').split('\n').map((l) => l.trim()).filter(Boolean);
  if (!lines.length) return '';
  let maxLines = 8;
  if (cm === 'emotional_support') maxLines = 5;
  if (cm === 'correction_feedback') maxLines = 4;
  if (/meal_record_text|meal_note|reward_food|meal_text/.test(cm)) maxLines = 6;
  if (lines.length <= maxLines) return lines.join('\n');
  return lines.slice(0, maxLines).join('\n');
}

function removeIntentMismatchPhrases(text, intentType, conversationMode) {
  const key = normalizeText(conversationMode || intentType);
  let out = String(text || '');
  const re = INTENT_MISMATCH_PHRASES[key];
  if (re) out = out.replace(re, '').replace(/\n{3,}/g, '\n\n').trim();
  return out;
}

/**
 * final_reply_guard — 禁止文削除・短文化・内部表現除去のみ。
 */
function guardReply(text, params = {}) {
  const intentType = normalizeText(params.intentType || params.intent || '');
  const conversationMode = normalizeText(params.conversationMode || intentType);
  let out = normalizeText(text) || String(text || '');

  const banned = stripBannedTemplates(out);
  out = banned.text;
  out = stripInternalTerms(out);
  out = removeIntentMismatchPhrases(out, intentType, conversationMode);
  out = shortenIfNeeded(out, intentType, conversationMode);

  console.info('[companion_reply_guard]', {
    user_id: normalizeText(params.userId || ''),
    intent: intentType || 'normal_chat',
    conversation_mode: conversationMode,
    banned_template_removed: banned.removed,
    output_preview: out.slice(0, 120),
  });

  return { text: out.trim() };
}

function shouldSkip(intentType) {
  const safe = normalizeText(intentType);
  return /^constitution_|^onboarding|^style_feedback|^newflow_image_hard_stop|^compassionate_confirmation|^pending_confirmation/.test(safe);
}

/**
 * 後方互換: enhanceReply はガードのみ（文章追加なし）。
 */
async function enhanceReply(params = {}) {
  const rawReply = normalizeText(params.rawReply || '');
  const intentType = normalizeText(params.intentType || '');
  const conversationMode = normalizeText(params.conversationMode || intentType);

  if (!rawReply || shouldSkip(intentType)) {
    console.info('[companion_reply_guard]', {
      user_id: normalizeText(params.userId || ''),
      intent: intentType || 'skipped',
      skipped: true,
    });
    return { text: rawReply, meta: { skipped: true, guard_only: true } };
  }

  const guarded = guardReply(rawReply, params);
  const eq = emotionalQualityCheckService.applyEmotionalQualityPass({
    text: guarded.text,
    userText: params.userText || '',
    intent: intentType,
    conversationMode,
    replyDepth: normalizeText(params.replyDepth || 'normal'),
    relationshipPhase: normalizeText(params.relationshipPhase || params.longMemory?.relationshipPhase || ''),
    userId: params.userId,
    hour: Number(params.hour || 0),
    totalTurns: Number(params.totalTurns || 0),
  });

  return {
    text: eq.text,
    meta: { intent: intentType, guard_only: true, reply_depth: normalizeText(params.replyDepth || 'normal') },
  };
}

module.exports = {
  enhanceReply,
  guardReply,
};
