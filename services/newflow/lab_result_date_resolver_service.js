'use strict';

function normalizeText(v) {
  return String(v || '').trim();
}

function extractYmd(s) {
  const t = normalizeText(s).replace(/\s+/g, '');
  let m = t.match(/(20\d{2})[\/\-.年](\d{1,2})[\/\-.月](\d{1,2})/);
  if (m) return `${m[1]}-${String(m[2]).padStart(2, '0')}-${String(m[3]).padStart(2, '0')}`;
  m = t.match(/(20\d{2})-(\d{2})-(\d{2})/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  return '';
}

/**
 * @param {object} ctx
 * @param {string} [ctx.printDate] — 印刷日（observed に使わない）
 * @param {string[]} [ctx.examDatesJson] — lab_sessions.exam_dates_json 由来
 * @param {string} [ctx.observedDateText] — 候補テキスト
 * @param {boolean} [ctx.multiDatePanel] — 複数日検査っぽい
 */
function resolveObservedDate(ctx = {}) {
  const printDate = extractYmd(ctx.printDate || '');
  const obsText = normalizeText(ctx.observedDateText || '');
  const obsYmd = extractYmd(obsText);
  const examList = Array.isArray(ctx.examDatesJson) ? ctx.examDatesJson.map((x) => extractYmd(String(x))).filter(Boolean) : [];

  let observed_date = null;
  let observed_date_text = obsText || null;
  let observed_date_status = 'unknown';
  let review_reason = null;

  if (obsYmd) {
    observed_date = obsYmd;
    observed_date_status = 'exact';
    if (printDate && obsYmd === printDate) {
      observed_date_status = 'needs_review';
      review_reason = 'observed_equals_print_date_verify';
    }
  }

  if (!observed_date && examList.length === 1 && !ctx.multiDatePanel) {
    observed_date = examList[0];
    observed_date_status = 'exact';
  }

  if (!observed_date && examList.includes('unknown_date')) {
    observed_date_status = 'unknown';
  }

  const uniqYears = new Set(examList.map((d) => (d.length >= 4 ? d.slice(0, 4) : '')).filter(Boolean));
  if (ctx.multiDatePanel && examList.length > 1) {
    const years = examList.map((d) => Number(String(d).slice(0, 4))).filter(Number.isFinite);
    const hasOddYearMix =
      years.some((y) => y >= 2024) && years.some((y) => y < 2020);
    if (hasOddYearMix) {
      observed_date_status = 'needs_review';
      review_reason = review_reason || 'suspicious_observed_date';
    }
    const hasOdd = examList.some((d) => {
      const y = Number(d.slice(0, 4));
      const others = examList.filter((x) => x !== d).map((x) => Number(x.slice(0, 4))).filter(Number.isFinite);
      return others.length && others.every((oy) => Math.abs(y - oy) >= 8);
    });
    if (hasOdd || uniqYears.size > 2) {
      observed_date_status = 'needs_review';
      review_reason = review_reason || 'mixed_or_suspicious_dates';
    }
  }

  if (/unknown/i.test(obsText)) {
    observed_date_status = observed_date ? 'needs_review' : 'unknown';
    review_reason = review_reason || 'unknown_date_token';
  }

  return {
    observed_date,
    observed_date_text,
    observed_date_status,
    review_reason
  };
}

module.exports = {
  resolveObservedDate,
  extractYmd,
  normalizeText
};
