function findNumber(text, regex, groupIndex = 1) {
  const m = String(text || '').match(regex);
  if (!m || !m[groupIndex]) return null;

  const n = Number(String(m[groupIndex]).replace(/,/g, ''));
  return Number.isFinite(n) ? n : null;
}

function findOne(text, regexes) {
  for (const regex of regexes) {
    const m = String(text || '').match(regex);
    if (m?.[0]) return m[0];
  }
  return null;
}

function includesAny(text, words = []) {
  const base = String(text || '');
  return words.some((w) => base.includes(w));
}

module.exports = {
  findNumber,
  findOne,
  includesAny,
};