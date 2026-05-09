'use strict';

const { PHASES, migrateLegacyPhase } = require('./relationship_phase_service');
const { selectConversationTone } = require('./conversation_tone_selector_service');

function normalizeText(v) {
  return String(v || '').trim();
}

function isHealthAnchoredText(text) {
  const safe = normalizeText(text);
  if (!safe) return false;
  return /カロリー|kcal|食事|ごはん|ご飯|朝食|昼食|夕食|運動|歩数|体重|体脂肪|検査|血糖|血圧|痛い|腰痛|睡眠|HbA1c|タンパク|糖質/.test(safe);
}

function inferLifeTopic(text) {
  const safe = normalizeText(text);
  if (!safe) return null;
  if (/(心が重い|気持ちが重い|モヤモヤ|空っぽ|泣きたい|落ち込|もう無理|不安で|不安です|怖くて|怖いです)/.test(safe)) {
    return 'emotional_disclosure';
  }
  if (/聞いて|相談|つらい|しんどい|疲れた|嫌だった|嫌な事|嫌なこと/.test(safe)) return 'emotional_disclosure';
  if (/仕事|職場|上司|残業|クライアント|プロジェクト/.test(safe)) return 'work_stress';
  if (/家族|親|子ども|子供|夫|妻|パートナー/.test(safe)) return 'family';
  if (/恋愛|彼氏|彼女|好きな人|告白|別れ/.test(safe)) return 'romance';
  if (/寂しい|さみしい|孤独|ひとり|一人が/.test(safe)) return 'loneliness';
  if (/やる気.*ない|やる気が出ない|無気力/.test(safe)) return 'low_motivation';
  if (/人間関係|友達|友人|同僚|嫌いな人/.test(safe)) return 'relationships';
  if (/嬉し|楽しかった|よかった|ハッピー/.test(safe)) return 'joy';
  if (/迷い|どうしよう|わからない|悩ん/.test(safe)) return 'uncertainty';
  if (safe.length >= 8 && !isHealthAnchoredText(safe)) return 'small_talk';
  return null;
}

function buildReplyForTopic(topic, phase) {
  const p = normalizeText(phase) || PHASES.P1;
  const deep = p === PHASES.P3 || p === PHASES.P4;

  if (topic === 'work_stress') {
    const variants = [
      [
        'それは嫌でしたね。',
        '仕事の嫌なことって、帰ってからも少し残ることがあります。',
        '無理に整理しなくて大丈夫です。',
        'まずは、相手の言い方が刺さったのか、出来事そのものがしんどかったのか、一緒に分けましょう。'
      ],
      [
        'それは気持ちに残りますよね。',
        '仕事の場での一言は、終わってからじわっと効くことがあります。',
        '今すぐ前向きにしなくて大丈夫です。',
        '何が一番つらかったかだけ、先に一緒に置いてみましょう。'
      ],
      [
        'それはしんどかったですね。',
        'ちゃんとやっている人ほど、仕事の違和感が心に残りやすいです。',
        '急いで正解を出さなくて大丈夫です。',
        'まずは言い方が嫌だったのか、扱われ方が苦しかったのか、分けてみましょう。'
      ]
    ];
    const base = variants[Math.abs(String(topic + phase).length) % variants.length];
    const extra = deep ? ['必要なら、現実の誰かに伝える言葉もここで短く整えられます。'] : [];
    return [...base, ...extra].join('\n');
  }

  if (topic === 'loneliness') {
    const variants = [
      [
        '寂しいって言えたの、かなり大事です。',
        '無理に明るくしなくて大丈夫です。',
        '今日は解決より、少し安心できる時間を先に作りましょう。',
        'ここでは、そのまま話して大丈夫です。'
      ],
      [
        'その寂しさ、ちゃんとここに置いて大丈夫です。',
        '無理に気持ちを上げなくて大丈夫です。',
        'まずは安心できる時間を少し確保する方が先かもしれません。',
        '必要なら、言葉を短く整えるのも一緒にやります。'
      ],
      [
        '寂しいと言えたこと自体が、もう大事な一歩です。',
        '今は解決より、落ち着ける時間を先に取りましょう。',
        '急いで前向きにしなくて大丈夫です。',
        'ここでは、そのままの温度で話して大丈夫です。'
      ]
    ];
    return variants[Math.abs(String(topic + phase).length) % variants.length].join('\n');
  }

  if (topic === 'low_motivation') {
    return [
      'やる気が出ない日も、体と心のどちらかが先にいっぱいになっていることがあります。',
      '責めなくて大丈夫です。',
      'いまは「何も増やさない」だけでも十分です。',
      'あなたが自分で選べるように、横で支えます。',
    ].join('\n');
  }

  if (topic === 'family' || topic === 'romance' || topic === 'relationships') {
    return [
      '人とのことは、健康の数字より先に心が動きます。',
      'ここでは、健康記録に無理に戻さず、いまの気持ちを受け止めます。',
      'うまく言えない部分でも、短い言葉で大丈夫です。',
    ].join('\n');
  }

  if (topic === 'joy') {
    return [
      'それ、ちゃんと嬉しかったんですね。',
      'よかったことを一緒に置いておくだけでも、今日の土台になります。',
      '無理に次の行動に繋げなくて大丈夫です。',
    ].join('\n');
  }

  if (topic === 'uncertainty') {
    return [
      '迷いのままでも、ここに置いておけます。',
      '正解を急がなくて大丈夫です。',
      'いま分かっていることから、一つだけ一緒に整理しましょう。',
    ].join('\n');
  }

  if (topic === 'small_talk') {
    return [
      '雑談も、ちゃんと受け止めます。',
      '健康の話に引き戻さなくて大丈夫です。',
      '続きがあれば、そのまま送ってください。',
    ].join('\n');
  }

  if (topic === 'emotional_disclosure') {
    return [
      'いまの重さ、ちゃんと受け取っています。',
      '食事や数値の話に、急いで戻さなくて大丈夫です。',
      '無理に整った言葉にしなくて大丈夫です。まずは呼吸を少しだけゆっくりにする、くらいからで十分です。',
    ].join('\n');
  }

  return null;
}

function getRecentAssistantReplies(recentMessages = []) {
  return (Array.isArray(recentMessages) ? recentMessages : [])
    .filter((m) => m?.role === 'assistant')
    .map((m) => normalizeText(m?.content || ''))
    .filter(Boolean)
    .slice(-5);
}

function dedupeLifeCompanionPhrases(text, topic, recentMessages = []) {
  const recent = getRecentAssistantReplies(recentMessages);
  const replacements = [
    {
      phrase: '〜と感じていたんですね',
      re: /「[^」]{2,}」と感じていたんですね。?/g,
      to: 'その言葉の重さ、ちゃんと受け取っています。',
      style: 'no_direct_quote'
    },
    {
      phrase: 'ここでは、そのまま話して大丈夫です',
      re: /ここでは、そのまま話して大丈夫です。?/g,
      to: 'この場では、整っていない言葉のままでも大丈夫です。',
      style: 'safe_space_variant'
    },
    {
      phrase: 'ひとりで抱えすぎなくて大丈夫です',
      re: /ひとりで抱えすぎなくて大丈夫です。?/g,
      to: '抱え込む前に、少しずつ分けていきましょう。',
      style: 'burden_release_variant'
    },
    {
      phrase: '無理に明るくしなくて大丈夫です',
      re: /無理に明るくしなくて大丈夫です。?/g,
      to: '気持ちを無理に上向きにしなくて大丈夫です。',
      style: 'mood_permission_variant'
    }
  ];
  let out = String(text || '');
  for (const row of replacements) {
    const overused = recent.some((r) => r.includes(row.phrase) || row.re.test(r));
    if (overused && row.re.test(out)) {
      out = out.replace(row.re, row.to);
      console.info('[life_companion_phrase_dedup]', {
        avoided_phrase: row.phrase,
        replacement_style: row.style,
        topic
      });
    }
  }
  return out.trim();
}

/**
 * 健康・記録以外の生活トピックに、ルールベースでまず応答する。
 * @returns {{ replyText: string, topic: string, includes_reflection: boolean, includes_next_step: boolean } | null}
 */
function tryLifeCompanionReply({ userId = '', text, relationshipPhase, longMemory = {}, userState = {}, recentMessages = [] } = {}) {
  const safe = normalizeText(text);
  if (!safe || safe.length < 4) return null;
  if (isHealthAnchoredText(safe)) return null;

  const topic = inferLifeTopic(safe);
  if (!topic) return null;
  console.info('[life_companion_intent_detected]', {
    text: safe.slice(0, 120),
    topic,
    reason: 'topic_keyword_match'
  });

  const phase = migrateLegacyPhase(longMemory, userState || {});
  const replyTextRaw = buildReplyForTopic(topic, relationshipPhase || phase);
  const replyText = dedupeLifeCompanionPhrases(replyTextRaw, topic, recentMessages);
  if (!replyText) return null;

  const includesReflection = /一緒に|受け止め|大丈夫|無理に/.test(replyText);
  const includesNextStep = /まずは|整理|分けましょう|置いてみましょう/.test(replyText);
  const depth = /寂しい|さみしい|しんど|つらい|疲れた|聞いて|相談/.test(safe) ? 'deep' : 'normal';
  const tone = selectConversationTone(relationshipPhase || phase, 'normal_chat', { depth });

  console.info('[life_companion_reply_generated]', {
    user_id: userId || '',
    topic,
    tone_mode: tone.tone_mode,
    reply_depth: depth,
    relationship_phase: relationshipPhase || phase,
    includes_reflection: includesReflection,
    includes_next_step: includesNextStep,
  });

  return {
    replyText,
    topic,
    includes_reflection: includesReflection,
    includes_next_step: includesNextStep,
  };
}

function buildGuaranteedEmotionalSupportReply(text = '') {
  const safe = normalizeText(text);
  const inner = safe.replace(/^[「『]/, '').replace(/[」』]$/, '');
  const lead = inner && inner.length <= 48
    ? `「${inner}」と送ってくれてありがとうございます。その重さ、ここで一緒に置いておきましょう。`
    : '送ってくれた言葉の重さ、ここで一緒に置いておきましょう。';
  return [
    lead,
    '食事や検査の話に、急いで戻さなくて大丈夫です。',
    'いまは気持ちのほうを先に受け止めます。無理に前向きにならなくて大丈夫です。',
  ].join('\n');
}

function buildGuaranteedLifeCompanionReply() {
  return [
    'いまの話題は、健康の数字より先に心が動いているように見えます。',
    'ここでは、記録に無理に戻さず、そのままの温度で受け止めます。',
    '続きがあれば、短い一文でも大丈夫です。',
  ].join('\n');
}

module.exports = {
  inferLifeTopic,
  tryLifeCompanionReply,
  isHealthAnchoredText,
  buildGuaranteedEmotionalSupportReply,
  buildGuaranteedLifeCompanionReply,
};
