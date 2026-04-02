'use strict';

const BUSINESS_DAY_START_HOUR = 2;

function toJapanDate(date = new Date()) {
  return new Date(date.toLocaleString('en-US', { timeZone: 'Asia/Tokyo' }));
}

function pad2(v) {
  return String(v).padStart(2, '0');
}

function formatDayKey(date) {
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;
}

function getBusinessDateInfo(inputDate = new Date()) {
  const tokyo = toJapanDate(inputDate);
  if (tokyo.getHours() < BUSINESS_DAY_START_HOUR) {
    tokyo.setDate(tokyo.getDate() - 1);
  }
  tokyo.setHours(0, 0, 0, 0);
  return {
    businessDate: tokyo,
    dayKey: formatDayKey(tokyo),
    startHour: BUSINESS_DAY_START_HOUR,
  };
}

function resolveDateFromText(text, baseDate = new Date()) {
  const safe = String(text || '').trim();
  const base = toJapanDate(baseDate);

  if (/一昨日/.test(safe)) {
    base.setDate(base.getDate() - 2);
    return getBusinessDateInfo(base).dayKey;
  }
  if (/昨日/.test(safe)) {
    base.setDate(base.getDate() - 1);
    return getBusinessDateInfo(base).dayKey;
  }
  if (/今日|さっき|今/.test(safe)) {
    return getBusinessDateInfo(base).dayKey;
  }

  const absolute = safe.match(/(?:(20\d{2})[\/\-.年])?\s*(\d{1,2})[\/\-.月]\s*(\d{1,2})日?/);
  if (absolute) {
    const year = Number(absolute[1] || base.getFullYear());
    const month = Number(absolute[2]);
    const day = Number(absolute[3]);
    const dt = new Date(year, month - 1, day);
    return formatDayKey(dt);
  }

  return getBusinessDateInfo(base).dayKey;
}

function compareDayKeys(a, b) {
  if (!a || !b) return 0;
  if (a === b) return 0;
  return String(a).localeCompare(String(b));
}

function buildDayLabel(dayKey, baseDate = new Date()) {
  const todayKey = getBusinessDateInfo(baseDate).dayKey;
  const yesterday = new Date(toJapanDate(baseDate));
  yesterday.setDate(yesterday.getDate() - 1);
  const yesterdayKey = getBusinessDateInfo(yesterday).dayKey;
  if (dayKey === todayKey) return '今日';
  if (dayKey === yesterdayKey) return '昨日';
  const [y, m, d] = String(dayKey || '').split('-');
  if (y && m && d) return `${Number(m)}月${Number(d)}日`;
  return 'その日';
}

module.exports = {
  BUSINESS_DAY_START_HOUR,
  getBusinessDateInfo,
  resolveDateFromText,
  formatDayKey,
  compareDayKeys,
  buildDayLabel,
};
