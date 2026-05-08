'use strict';

function normalizeText(v) {
  return String(v || '').trim();
}

const TEMPLATE_PHRASES = [
  { re: /記録しました[。]?/g, to: '受け取りました。流れが見えています。' },
  { re: /確認しました[。]?/g, to: '意図は受け取れています。' },
  { re: /保存しました[。]?/g, to: 'こちら側では受け取れています。' },
  { re: /いい流れです[。]?/g, to: '体調や食事の流れを、無理なく見えている範囲で見ています。' },
  { re: /無理なく続けましょう[。]?/g, to: '続け方は、いまの生活に合う形で少しずつで大丈夫です。' },
  { re: /頑張りましょう[。]?/g, to: '無理のない一歩で十分です。' },
  { re: /次の一歩は小さくて十分です[。]?/g, to: '次に選ぶなら、小さな一つで十分です。' },
];

function extractEchoSnippet(userText) {
  const safe = normalizeText(userText).replace(/\n/g, ' ');
  if (safe.length < 4 || safe.length > 72) return '';
  if (/^[\s「」]+$/.test(safe)) return '';
  const strip = safe.replace(/^[「『]/, '').replace(/[」』]$/, '');
  return strip.slice(0, 48);
}

function replyHasUserEcho(reply, userText) {
  const snippet = extractEchoSnippet(userText);
  if (snippet.length < 4) return false;
  const r = normalizeText(reply);
  if (r.includes(snippet)) return true;
  const short = snippet.slice(0, Math.min(12, snippet.length));
  return short.length >= 4 && r.includes(short);
}

function hasSpecificReaction(text) {
  const safe = normalizeText(text);
  if (safe.length < 24) return /ですね|でしたね|感じ|ようです|みえ|見え|そうですね/.test(safe);
  return true;
}

function hasWarmth(text) {
  return /大丈夫|一緒に|受け止|寄り添|無理に|責め|ありがと|丁寧|少し|やさしく|安心/.test(normalizeText(text));
}

function hasNextStep(text) {
  return /まず|次|一歩|試し|整え|足し|減ら|見ましょう|で十分|で大丈夫/.test(normalizeText(text));
}

function isTemplateOnlyPhrase(text) {
  const safe = normalizeText(text).replace(/\s+/g, '');
  return /^(記録しました|確認しました|保存しました|いい流れです|無理なく続けましょう|頑張りましょう|次の一歩は小さくて十分です)[。]?$/.test(safe);
}

function hasTrustBuildingPhrase(text) {
  return /ここでは|そのまま話して|抱えすぎ|現実の誰か|選べるように|横で支え|ざっくりで大丈夫|言いにくい日は|あとで直せ|流れを見るため/.test(normalizeText(text));
}

function applyTemplateRewrites(text) {
  let out = String(text || '');
  let applied = false;
  for (const { re, to } of TEMPLATE_PHRASES) {
    const next = out.replace(re, (m) => {
      if (m) applied = true;
      return to;
    });
    out = next;
  }
  return { text: out.trim(), rewrite_applied: applied };
}

function softenStandaloneTemplateLines(text) {
  let applied = false;
  const lines = String(text || '').split('\n');
  const next = lines.map((line) => {
    const t = normalizeText(line);
    if (!t) return line;
    if (isTemplateOnlyPhrase(t)) {
      const { text: rw, rewrite_applied: ra } = applyTemplateRewrites(t);
      if (ra) applied = true;
      return rw;
    }
    return line;
  });
  return { text: next.join('\n').trim(), rewrite_applied: applied };
}

/**
 * @param {{ text: string, userText?: string, intent?: string, relationshipPhase?: string, userId?: string }} params
 */
function applyEmotionalQualityPass(params = {}) {
  const original = String(params.text || '');
  let text = original;
  const userText = params.userText || '';
  const intent = normalizeText(params.intent || '');
  const userId = normalizeText(params.userId || '');

  const rwGlobal = applyTemplateRewrites(text);
  text = rwGlobal.text;
  const softLines = softenStandaloneTemplateLines(text);
  text = softLines.text;

  let rewrite_applied = rwGlobal.rewrite_applied || softLines.rewrite_applied;

  if (!replyHasUserEcho(text, userText) && userText && extractEchoSnippet(userText) && (intent === 'normal_chat' || intent === 'meal')) {
    const snip = extractEchoSnippet(userText);
    if (snip && !text.includes(snip.slice(0, Math.min(8, snip.length)))) {
      const echo = `「${snip}」と感じていたんですね。\n`;
      text = `${echo}${text}`.trim();
      rewrite_applied = true;
    }
  }

  if (isTemplateOnlyPhrase(text) && text.length < 80) {
    text = `${text}\n責めるための記録ではなく、流れを見るための記録として受け止めています。`.trim();
    rewrite_applied = true;
  }

  const flags = {
    has_specific_reaction: hasSpecificReaction(text),
    has_user_word_echo: replyHasUserEcho(text, userText),
    has_warmth: hasWarmth(text),
    has_next_step: hasNextStep(text),
    has_template_only_phrase: isTemplateOnlyPhrase(text),
    has_trust_building_phrase: hasTrustBuildingPhrase(text),
    rewrite_applied,
  };

  console.info('[companion_reply_emotional_quality_check]', {
    user_id: userId,
    intent,
    relationship_phase: normalizeText(params.relationshipPhase || ''),
    ...flags,
  });

  return { text: text.trim(), ...flags };
}

module.exports = {
  applyEmotionalQualityPass,
  extractEchoSnippet,
};
