'use strict';

function safeText(value, fallback = '') {
  return String(value || fallback).trim();
}

function buildHealthConsultationGuide(text = '') {
  const raw = safeText(text);
  const intro = raw
    ? 'それは心配ですね。記録より先に、まず相談として受けますね。'
    : 'まずは相談として受けますね。';

  return [
    intro,
    '強い痛みや長引く症状、いつもと違うつらさがある時は、無理を広げず牛込や医療機関にも相談してください。',
  ].join('\n');
}

module.exports = {
  buildHealthConsultationGuide,
};
