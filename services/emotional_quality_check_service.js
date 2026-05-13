'use strict';

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

const BANNED_ADDITION_PHRASES = [
  'ひとりで抱えすぎなくて大丈夫です',
  '一緒に整理していきましょう',
  '今わかる範囲だけで',
  'そのまま話してくれてありがとうございます',
  'の重さ、ちゃんと受け取っています',
];

const TEMPLATE_ONLY_RE = /^(記録しました|確認しました|保存しました|いい流れです|無理なく続けましょう|頑張りましょう|次の一歩は小さくて十分です)[。]?$/;

const INTERNAL_RE = /\b(DB保存済み|内部|trace_id)\b/gi;

function removeGenericTemplatePhrases(text = '') {
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

function stripTemplateOnlyLines(text) {
  const lines = String(text || '').split('\n');
  const next = lines.filter((line) => !TEMPLATE_ONLY_RE.test(normalizeText(line)));
  return next.join('\n').trim();
}

function stripBannedAdditionPhrases(text, conversationMode) {
  let out = String(text || '');
  for (const phrase of BANNED_ADDITION_PHRASES) {
    if (out.includes(phrase)) {
      out = out.split(phrase).join('').replace(/\n{3,}/g, '\n\n').trim();
    }
  }
  if (conversationMode === 'emotional_support' && /(手入力の目安|今日の合計|kcal|カロリー)/i.test(out)) {
    out = out.split('\n').filter((ln) => !/(手入力の目安|今日の合計|kcal|カロリー)/i.test(ln)).join('\n').trim();
  }
  if (conversationMode === 'life_companion' && /(記録|kcal|カロリー|DB保存済み)/.test(out)) {
    out = out.split('\n').filter((ln) => !/(記録|kcal|カロリー|DB保存済み)/.test(ln)).join('\n').trim();
  }
  return out;
}

function capLength(text, conversationMode) {
  const lines = String(text || '').split('\n').map((l) => l.trim()).filter(Boolean);
  if (!lines.length) return '';
  let max = 10;
  if (conversationMode === 'emotional_support') max = 6;
  if (conversationMode === 'correction_feedback') max = 5;
  if (lines.length <= max) return lines.join('\n');
  return lines.slice(0, max).join('\n');
}

/**
 * 文章追加なし — NG削除・内部表現除去・長さ制限のみ。
 */
function applyEmotionalQualityPass(params = {}) {
  const conversationMode = normalizeText(params.conversationMode || params.intent || '');
  const intent = normalizeText(params.intent || '');
  const userId = normalizeText(params.userId || '');
  let text = String(params.text || '');

  const stripped = removeGenericTemplatePhrases(text);
  text = stripped.text;
  text = stripTemplateOnlyLines(text);
  text = stripBannedAdditionPhrases(text, conversationMode);
  text = String(text || '').replace(INTERNAL_RE, '').replace(/\n{3,}/g, '\n\n').trim();
  text = capLength(text, conversationMode);

  const routeMismatch = (
    (conversationMode === 'emotional_support' && /(TG|中性脂肪|検査画像)/i.test(text))
    || (conversationMode === 'correction_feedback' && /(おはぎ|白湯|味付き卵)/.test(text) && !/(すみません|ズレ|訂正)/.test(text))
  );

  console.info('[companion_reply_emotional_quality_check]', {
    user_id: userId,
    conversation_mode: conversationMode,
    intent,
    guard_only: true,
    generic_template_removed: stripped.removed,
    route_mismatch_detected: routeMismatch,
    output_preview: text.slice(0, 120),
  });

  return {
    text: text.trim(),
    emotional_quality_ok: !routeMismatch,
    rewrite_applied: stripped.removed,
    guard_only: true,
  };
}

function extractEchoSnippet(userText) {
  const safe = normalizeText(userText).replace(/\n/g, ' ');
  if (safe.length < 4 || safe.length > 72) return '';
  return safe.replace(/^[「『]/, '').replace(/[」』]$/, '').slice(0, 48);
}

module.exports = {
  applyEmotionalQualityPass,
  extractEchoSnippet,
};
