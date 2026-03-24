'use strict';

const AI_TYPE_VALUES = {
  SOFT: 'soft_support',
  BRIGHT: 'bright_push',
  RELIABLE: 'reliable_lead',
  STRONG: 'strong_drive',
};

const AI_TYPE_LABELS = {
  [AI_TYPE_VALUES.SOFT]: 'そっと寄り添う',
  [AI_TYPE_VALUES.BRIGHT]: '明るく後押し',
  [AI_TYPE_VALUES.RELIABLE]: '頼もしく導く',
  [AI_TYPE_VALUES.STRONG]: '力強く支える',
};

const AI_TYPE_OPTIONS = [
  AI_TYPE_VALUES.SOFT,
  AI_TYPE_VALUES.BRIGHT,
  AI_TYPE_VALUES.RELIABLE,
  AI_TYPE_VALUES.STRONG,
];

function normalizeLoose(text) {
  return String(text || '')
    .trim()
    .toLowerCase()
    .replace(/[！!？?。.,，、]/g, '')
    .replace(/\s+/g, '');
}

function getAiTypeLabel(aiType) {
  return AI_TYPE_LABELS[aiType] || AI_TYPE_LABELS[AI_TYPE_VALUES.SOFT];
}

function normalizeAiTypeInput(text, fallback = AI_TYPE_VALUES.SOFT) {
  const raw = String(text || '').trim();
  const t = normalizeLoose(raw);

  if (!t) return fallback;

  if (
    t === normalizeLoose(AI_TYPE_VALUES.SOFT) ||
    t.includes(normalizeLoose('そっと寄り添う')) ||
    t.includes(normalizeLoose('寄り添う'))
  ) {
    return AI_TYPE_VALUES.SOFT;
  }

  if (
    t === normalizeLoose(AI_TYPE_VALUES.BRIGHT) ||
    t.includes(normalizeLoose('明るく後押し')) ||
    t.includes(normalizeLoose('後押し')) ||
    t.includes(normalizeLoose('明るく'))
  ) {
    return AI_TYPE_VALUES.BRIGHT;
  }

  if (
    t === normalizeLoose(AI_TYPE_VALUES.RELIABLE) ||
    t.includes(normalizeLoose('頼もしく導く')) ||
    t.includes(normalizeLoose('導く')) ||
    t.includes(normalizeLoose('頼もしく'))
  ) {
    return AI_TYPE_VALUES.RELIABLE;
  }

  if (
    t === normalizeLoose(AI_TYPE_VALUES.STRONG) ||
    t.includes(normalizeLoose('力強く支える')) ||
    t.includes(normalizeLoose('支える')) ||
    t.includes(normalizeLoose('力強く'))
  ) {
    return AI_TYPE_VALUES.STRONG;
  }

  if (t === 'gentle' || t === 'soft') return AI_TYPE_VALUES.SOFT;
  if (t === 'energetic' || t === 'bright') return AI_TYPE_VALUES.BRIGHT;
  if (t === 'analytical' || t === 'reliable') return AI_TYPE_VALUES.RELIABLE;
  if (t === 'casual' || t === 'strong') return AI_TYPE_VALUES.STRONG;

  return fallback;
}

module.exports = {
  AI_TYPE_VALUES,
  AI_TYPE_LABELS,
  AI_TYPE_OPTIONS,
  getAiTypeLabel,
  normalizeAiTypeInput,
};
