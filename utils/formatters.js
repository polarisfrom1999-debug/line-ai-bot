function fmt(value) {
  if (value == null || Number.isNaN(Number(value))) return '-';
  const n = Number(value);
  return Number.isInteger(n) ? String(n) : n.toFixed(1);
}

function round1(n) {
  if (n == null || Number.isNaN(Number(n))) return null;
  return Math.round(Number(n) * 10) / 10;
}

function round0(n) {
  if (n == null || Number.isNaN(Number(n))) return null;
  return Math.round(Number(n));
}

function toNumberOrNull(v) {
  if (v == null || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function clamp01(v) {
  if (v == null) return null;
  return Math.max(0, Math.min(1, Number(v)));
}

function safeText(v, maxLen = 1000) {
  return String(v || '').trim().slice(0, maxLen);
}

function formatKcalRange(mid, min, max) {
  if (min != null && max != null) return `${fmt(mid)} kcal（${fmt(min)}〜${fmt(max)} kcal）`;
  if (mid != null) return `${fmt(mid)} kcal`;
  return '不明';
}

module.exports = {
  fmt,
  round1,
  round0,
  toNumberOrNull,
  clamp01,
  safeText,
  formatKcalRange,
};