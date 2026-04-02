'use strict';

const TOKYO_TZ = 'Asia/Tokyo';
const DAY_RESET_HOUR = Number(process.env.KOKOKARA_DAY_RESET_HOUR || 2);

function pad2(v) {
  return String(v).zfill(2);
}

function getTokyoParts(date = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: TOKYO_TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).formatToParts(date);

  const out = {};
  for (const part of parts) out[part.type] = part.value;
  return {
    year: Number(out.year),
    month: Number(out.month),
    day: Number(out.day),
    hour: Number(out.hour),
    minute: Number(out.minute),
    second: Number(out.second),
  };
}

function toUtcDateFromTokyoParts(parts) {
  return new Date(Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour || 0, parts.minute || 0, parts.second || 0));
}

function shiftTokyoDate(date = new Date(), offsetDays = 0) {
  const parts = getTokyoParts(date);
  const utc = toUtcDateFromTokyoParts(parts);
  utc.setUTCDate(utc.getUTCDate() + Number(offsetDays || 0));
  return utc;
}

function getBusinessDate(date = new Date(), resetHour = DAY_RESET_HOUR) {
  const parts = getTokyoParts(date);
  const utc = toUtcDateFromTokyoParts(parts);
  if (parts.hour < resetHour) utc.setUTCDate(utc.getUTCDate() - 1);
  utc.setUTCHours(0, 0, 0, 0);
  return utc;
}

function formatDateKey(date) {
  const y = date.getUTCFullYear();
  const m = pad2(date.getUTCMonth() + 1);
  const d = pad2(date.getUTCDate());
  return `${y}-${m}-${d}`;
}

function getBusinessDayKey(date = new Date(), resetHour = DAY_RESET_HOUR) {
  return formatDateKey(getBusinessDate(date, resetHour));
}

function getBusinessWeekKey(date = new Date(), resetHour = DAY_RESET_HOUR) {
  const business = getBusinessDate(date, resetHour);
  const day = business.getUTCDay() || 7;
  business.setUTCDate(business.getUTCDate() - (day - 1));
  return formatDateKey(business);
}

function normalizeText(value) {
  return String(value || '').trim();
}

function parseExplicitDate(text, now = new Date(), resetHour = DAY_RESET_HOUR) {
  const safe = normalizeText(text);
  if (!safe) return null;

  if (/一昨日/.test(safe)) {
    const date = getBusinessDate(now, resetHour);
    date.setUTCDate(date.getUTCDate() - 2);
    return { targetDateKey: formatDateKey(date), label: '一昨日', detected: true };
  }
  if (/昨日/.test(safe)) {
    const date = getBusinessDate(now, resetHour);
    date.setUTCDate(date.getUTCDate() - 1);
    return { targetDateKey: formatDateKey(date), label: '昨日', detected: true };
  }
  if (/今日|さっき|今朝|今夜|今晩/.test(safe)) {
    return { targetDateKey: getBusinessDayKey(now, resetHour), label: '今日', detected: true };
  }

  let m = safe.match(/(20\d{2})[\/\-.年]\s*(\d{1,2})[\/\-.月]\s*(\d{1,2})/);
  if (m) {
    return {
      targetDateKey: `${m[1]}-${pad2(m[2])}-${pad2(m[3])}`,
      label: `${m[1]}-${pad2(m[2])}-${pad2(m[3])}`,
      detected: true,
    };
  }

  m = safe.match(/(?<!\d)(\d{1,2})[\/\-.月]\s*(\d{1,2})(?:日)?(?!\d)/);
  if (m) {
    const base = getTokyoParts(now);
    let year = base.year;
    const month = Number(m[1]);
    const day = Number(m[2]);
    if (month > base.month + 1) year -= 1;
    return {
      targetDateKey: `${year}-${pad2(month)}-${pad2(day)}`,
      label: `${year}-${pad2(month)}-${pad2(day)}`,
      detected: true,
    };
  }

  return null;
}

function stripRelativeDateWords(text) {
  return normalizeText(text)
    .replace(/一昨日の?(朝|昼|夜)?/g, '')
    .replace(/昨日の?(朝|昼|夜)?/g, '')
    .replace(/今日の?(朝|昼|夜)?/g, '')
    .replace(/(20\d{2})[\/\-.年]\s*(\d{1,2})[\/\-.月]\s*(\d{1,2})日?/g, '')
    .replace(/(?<!\d)(\d{1,2})[\/\-.月]\s*(\d{1,2})(?:日)?(?!\d)/g, '')
    .trim();
}

module.exports = {
  TOKYO_TZ,
  DAY_RESET_HOUR,
  getTokyoParts,
  getBusinessDate,
  getBusinessDayKey,
  getBusinessWeekKey,
  parseExplicitDate,
  stripRelativeDateWords,
  formatDateKey,
};
