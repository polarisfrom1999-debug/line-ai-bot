'use strict';

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

function safeText(value, fallback = '') {
  return String(value || fallback).trim();
}

function normalizeLoose(text) {
  return safeText(text)
    .toLowerCase()
    .replace(/[！!？?。.,，、]/g, '')
    .replace(/\s+/g, '');
}

function normalizePersonaType(value) {
  const raw = normalizeLoose(value);

  if (!raw) return AI_PERSONA_TYPES.GENTLE;

  if (
    raw === 'gentle' ||
    raw.includes('そっと寄り添う') ||
    raw.includes('寄り添う') ||
    raw.includes('やさしい') ||
    raw.includes('優しい')
  ) {
    return AI_PERSONA_TYPES.GENTLE;
  }

  if (
    raw === 'bright' ||
    raw.includes('明るく後押し') ||
    raw.includes('明るい') ||
    raw.includes('後押し')
  ) {
    return AI_PERSONA_TYPES.BRIGHT;
  }

  if (
    raw === 'reliable' ||
    raw.includes('頼もしく導く') ||
    raw.includes('頼もしい') ||
    raw.includes('導く')
  ) {
    return AI_PERSONA_TYPES.RELIABLE;
  }

  if (
    raw === 'strong' ||
    raw.includes('力強く支える') ||
    raw.includes('力強い') ||
    raw.includes('支える')
  ) {
    return AI_PERSONA_TYPES.STRONG;
  }

  return AI_PERSONA_TYPES.GENTLE;
}

function getPersonaLabel(personaType) {
  const normalized = normalizePersonaType(personaType);
  return PERSONA_LABELS[normalized] || PERSONA_LABELS[AI_PERSONA_TYPES.GENTLE];
}

function getPersonaQuickReplyItems() {
  return [
    {
      type: AI_PERSONA_TYPES.GENTLE,
      label: PERSONA_LABELS[AI_PERSONA_TYPES.GENTLE],
      description: 'やさしく安心感のある伴走',
    },
    {
      type: AI_PERSONA_TYPES.BRIGHT,
      label: PERSONA_LABELS[AI_PERSONA_TYPES.BRIGHT],
      description: '少し前向きに背中を押す伴走',
    },
    {
      type: AI_PERSONA_TYPES.RELIABLE,
      label: PERSONA_LABELS[AI_PERSONA_TYPES.RELIABLE],
      description: '落ち着いて整理しながら導く伴走',
    },
    {
      type: AI_PERSONA_TYPES.STRONG,
      label: PERSONA_LABELS[AI_PERSONA_TYPES.STRONG],
      description: 'やさしさを残しつつ力強く支える伴走',
    },
  ];
}

function getPersonaSelectionMessage() {
  const lines = [
    'AI牛込の雰囲気を選べます。',
    '今の気分や、続けやすい話し方で選んでください。',
    '',
    `・${PERSONA_LABELS[AI_PERSONA_TYPES.GENTLE]}`,
    `・${PERSONA_LABELS[AI_PERSONA_TYPES.BRIGHT]}`,
    `・${PERSONA_LABELS[AI_PERSONA_TYPES.RELIABLE]}`,
    `・${PERSONA_LABELS[AI_PERSONA_TYPES.STRONG]}`,
    '',
    'あとで変更もできます。',
  ];
  return lines.join('\n');
}

function getPersonaSystemStyle(personaType) {
  const normalized = normalizePersonaType(personaType);

  if (normalized === AI_PERSONA_TYPES.BRIGHT) {
    return [
      '話し方は少し前向きで明るく、背中を押す雰囲気にしてください。',
      '気分が少し上がるような言い回しを入れてください。',
      'ただし軽すぎず、安心感は残してください。',
      'テンションを上げすぎず、自然な会話を優先してください。',
    ].join('\n');
  }

  if (normalized === AI_PERSONA_TYPES.RELIABLE) {
    return [
      '話し方は落ち着いて、信頼感のある雰囲気にしてください。',
      '少し包容力のある大人っぽい印象で、優先順位をわかりやすく示してください。',
      '強すぎる命令口調にはしないでください。',
      '整理が必要な時は、短く要点を示してください。',
    ].join('\n');
  }

  if (normalized === AI_PERSONA_TYPES.STRONG) {
    return [
      '話し方は少し力強く、前へ進める雰囲気にしてください。',
      '気持ちが落ちている相手でも、やさしさを残しながら引っ張ってください。',
      '必要な時は優先順位を明確にし、はっきり提案してください。',
      '責めたり否定したりせず、「ここは整えどころですね」のような表現を使ってください。',
    ].join('\n');
  }

  return [
    '話し方はやさしく包み込むように、安心感を大切にしてください。',
    '相手を急かさず、まず受け止める雰囲気にしてください。',
    '無理を広げすぎない、小さく整える提案を優先してください。',
    'やさしすぎて曖昧になりすぎないよう、必要な時は短く方向性を示してください。',
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
