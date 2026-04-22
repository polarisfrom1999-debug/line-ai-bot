'use strict';

function normalizeText(value) {
  return String(value || '').trim();
}

function classifyByTextHint(textHint) {
  const hint = normalizeText(textHint);
  if (!hint) return 'unknown';
  if (/食事|ごはん|朝食|昼食|夕食|食べた|カロリー|麺|meal/i.test(hint)) return 'meal';
  if (/血液|検査|採血|検査結果|LDL|HDL|HbA1c|TG|中性脂肪|lab/i.test(hint)) return 'lab';
  return 'unknown';
}

function decideImageDomain({ textHint = '', forcedDomain = '' } = {}) {
  const forced = normalizeText(forcedDomain).toLowerCase();
  if (forced === 'meal' || forced === 'lab' || forced === 'unknown') return forced;
  return classifyByTextHint(textHint);
}

module.exports = {
  decideImageDomain,
};
