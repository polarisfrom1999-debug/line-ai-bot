'use strict';

/**
 * services/ai_persona_service.js
 *
 * 目的:
 * - AI人格4タイプの定義を一元管理
 * - 会話文体の指針を返す
 * - Quick Replyや表示文言を統一
 */

const AI_PERSONA_TYPES = {
  GENTLE: 'gentle',
  BRIGHT: 'bright',
  RELIABLE: 'reliable',
  STRONG: 'strong',
};

const PERSONA_LABELS = {
  [AI_PERSONA_TYPES.GENTLE]: 'そっと寄り添う',
  [AI_PERSONA_TYPES.BRIGHT]: '明るく後押し',
  [AI_PERSONA_TYPES.RELIABLE]: '頼もしく導く',
  [AI_PERSONA_TYPES.STRONG]: '力強く支える',
};

function normalizePersonaType(value) {
  const v = String(value || '').trim().toLowerCase();

  if (
    v === AI_PERSONA_TYPES.GENTLE ||
    v === PERSONA_LABELS[AI_PERSONA_TYPES.GENTLE]
  ) {
    return AI_PERSONA_TYPES.GENTLE;
  }

  if (
    v === AI_PERSONA_TYPES.BRIGHT ||
    v === PERSONA_LABELS[AI_PERSONA_TYPES.BRIGHT]
  ) {
    return AI_PERSONA_TYPES.BRIGHT;
  }

  if (
    v === AI_PERSONA_TYPES.RELIABLE ||
    v === PERSONA_LABELS[AI_PERSONA_TYPES.RELIABLE]
  ) {
    return AI_PERSONA_TYPES.RELIABLE;
  }

  if (
    v === AI_PERSONA_TYPES.STRONG ||
    v === PERSONA_LABELS[AI_PERSONA_TYPES.STRONG]
  ) {
    return AI_PERSONA_TYPES.STRONG;
  }

  return AI_PERSONA_TYPES.GENTLE;
}

function getPersonaLabel(type) {
  const normalized = normalizePersonaType(type);
  return PERSONA_LABELS[normalized] || PERSONA_LABELS[AI_PERSONA_TYPES.GENTLE];
}

function getPersonaQuickReplyItems() {
  return [
    { label: PERSONA_LABELS[AI_PERSONA_TYPES.GENTLE], data: AI_PERSONA_TYPES.GENTLE },
    { label: PERSONA_LABELS[AI_PERSONA_TYPES.BRIGHT], data: AI_PERSONA_TYPES.BRIGHT },
    { label: PERSONA_LABELS[AI_PERSONA_TYPES.RELIABLE], data: AI_PERSONA_TYPES.RELIABLE },
    { label: PERSONA_LABELS[AI_PERSONA_TYPES.STRONG], data: AI_PERSONA_TYPES.STRONG },
  ];
}

function getPersonaSystemStyle(type) {
  const normalized = normalizePersonaType(type);

  switch (normalized) {
    case AI_PERSONA_TYPES.BRIGHT:
      return `
あなたは「ここから。」の伴走AIです。
会話は自然で、あたたかく、少し明るめにしてください。
元気づけるが、軽すぎないこと。
褒めすぎ・テンプレ感・営業感は避けてください。
一言ごとに相手の努力や気持ちを自然に拾ってください。
語尾は柔らかく、人間らしく。`;
    case AI_PERSONA_TYPES.RELIABLE:
      return `
あなたは「ここから。」の伴走AIです。
会話は落ち着いていて、安心感があり、頼れる印象で返してください。
断定しすぎず、筋道を立てて、相手が次に動きやすいよう導いてください。
褒め言葉の連発は避け、自然な励ましにしてください。
語尾は丁寧だが堅すぎず、伴走者らしく。`;
    case AI_PERSONA_TYPES.STRONG:
      return `
あなたは「ここから。」の伴走AIです。
会話は前向きで、芯があり、背中を押す力強さを持たせてください。
ただし威圧的・命令的にはしないでください。
相手の弱さも受け止めつつ、「ここからまた進めます」という姿勢を大切にしてください。
短めでも熱量が伝わる自然会話にしてください。`;
    case AI_PERSONA_TYPES.GENTLE:
    default:
      return `
あなたは「ここから。」の伴走AIです。
会話はやさしく、安心感があり、そっと寄り添う雰囲気で返してください。
相手のしんどさや迷いを受け止め、急かさず、自然な共感を入れてください。
褒めすぎ・テンプレ感・説明過多は避けてください。
語尾はやわらかく、牛込らしい温かさを意識してください。`;
  }
}

function getPersonaSelectionMessage() {
  return [
    'これからの話し方は、次の4タイプから選べます。',
    '今の気分に近いものを選んでくださいね。',
    '',
    `・${PERSONA_LABELS[AI_PERSONA_TYPES.GENTLE]}`,
    `・${PERSONA_LABELS[AI_PERSONA_TYPES.BRIGHT]}`,
    `・${PERSONA_LABELS[AI_PERSONA_TYPES.RELIABLE]}`,
    `・${PERSONA_LABELS[AI_PERSONA_TYPES.STRONG]}`,
  ].join('\n');
}

module.exports = {
  AI_PERSONA_TYPES,
  PERSONA_LABELS,
  normalizePersonaType,
  getPersonaLabel,
  getPersonaQuickReplyItems,
  getPersonaSystemStyle,
  getPersonaSelectionMessage,
};
