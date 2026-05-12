'use strict';

/**
 * MEAL_TEXT_DUPLICATE_WINDOW_HOURS（.env）
 * 未指定・不正値は 4。許容は整数 2〜6 のみ。
 */
function resolveMealTextDuplicateWindowHours() {
  const rawStr = process.env.MEAL_TEXT_DUPLICATE_WINDOW_HOURS;
  if (rawStr == null || String(rawStr).trim() === '') return 4;
  const raw = Number(String(rawStr).trim());
  if (!Number.isFinite(raw)) return 4;
  const n = Math.round(raw);
  if (n !== raw) return 4;
  if (n < 2 || n > 6) return 4;
  return n;
}

module.exports = {
  resolveMealTextDuplicateWindowHours,
};
