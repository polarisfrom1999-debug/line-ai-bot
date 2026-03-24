function pad2(v) {
  return String(v).padStart(2, '0');
}

function getFixedOffset(tz = 'Asia/Tokyo') {
  if (tz === 'Asia/Tokyo') return '+09:00';
  return 'Z';
}

function formatDateYmdInTZ(date, tz = 'Asia/Tokyo') {
  const d = new Date(date);

  return new Intl.DateTimeFormat('sv-SE', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(d);
}

function formatTimeHmsInTZ(date, tz = 'Asia/Tokyo') {
  const d = new Date(date);

  return new Intl.DateTimeFormat('sv-SE', {
    timeZone: tz,
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).format(d);
}

function formatTimeHmInTZ(date, tz = 'Asia/Tokyo') {
  const d = new Date(date);

  return new Intl.DateTimeFormat('ja-JP', {
    timeZone: tz,
    hour: 'numeric',
    minute: '2-digit',
    hour12: false,
  }).format(d);
}

function getWeekdayJaInTZ(date, tz = 'Asia/Tokyo') {
  const d = new Date(date);

  return new Intl.DateTimeFormat('ja-JP', {
    timeZone: tz,
    weekday: 'long',
  }).format(d);
}

function formatJapaneseDateInTZ(date, tz = 'Asia/Tokyo') {
  const ymd = formatDateYmdInTZ(date, tz);
  const m = String(ymd).match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return ymd;

  return `${Number(m[1])}年${Number(m[2])}月${Number(m[3])}日`;
}

function formatJapaneseDateTimeInTZ(date, tz = 'Asia/Tokyo') {
  const dateText = formatJapaneseDateInTZ(date, tz);
  const weekday = getWeekdayJaInTZ(date, tz);
  const timeText = formatTimeHmInTZ(date, tz);
  return `${dateText}（${weekday}） ${timeText}`;
}

function toIsoStringInTZ(date, tz = 'Asia/Tokyo') {
  const ymd = formatDateYmdInTZ(date, tz);
  const hms = formatTimeHmsInTZ(date, tz);
  const offset = getFixedOffset(tz);
  return `${ymd}T${hms}${offset}`;
}

function currentDateYmdInTZ(tz = 'Asia/Tokyo') {
  return formatDateYmdInTZ(new Date(), tz);
}

function parseYmdParts(dateYmd) {
  const m = String(dateYmd || '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return null;
  return {
    year: Number(m[1]),
    month: Number(m[2]),
    day: Number(m[3]),
  };
}

function addDaysYmd(dateYmd, days = 0) {
  const parts = parseYmdParts(dateYmd);
  if (!parts) return null;

  const baseUtc = Date.UTC(parts.year, parts.month - 1, parts.day);
  const next = new Date(baseUtc + Number(days || 0) * 24 * 60 * 60 * 1000);

  return `${next.getUTCFullYear()}-${pad2(next.getUTCMonth() + 1)}-${pad2(next.getUTCDate())}`;
}

function listRecentDatesYmd(days = 7, tz = 'Asia/Tokyo', endYmd = null) {
  const safeDays = Math.max(1, Number(days) || 1);
  const end = endYmd || currentDateYmdInTZ(tz);
  const list = [];

  for (let i = safeDays - 1; i >= 0; i -= 1) {
    list.push(addDaysYmd(end, -i));
  }

  return list.filter(Boolean);
}

function buildDayRangeIsoInTZ(dateYmd, tz = 'Asia/Tokyo') {
  const ymd = String(dateYmd || '').slice(0, 10);
  const offset = getFixedOffset(tz);

  return {
    startIso: `${ymd}T00:00:00${offset}`,
    endIso: `${ymd}T23:59:59${offset}`,
  };
}

function toTokyoDate(date, tz = 'Asia/Tokyo') {
  const ymd = formatDateYmdInTZ(date, tz);
  const parts = parseYmdParts(ymd);
  if (!parts) return new Date(NaN);
  return new Date(parts.year, parts.month - 1, parts.day);
}

function daysInMonth(date) {
  const d = new Date(date);
  return new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
}

module.exports = {
  toIsoStringInTZ,
  currentDateYmdInTZ,
  formatDateYmdInTZ,
  formatTimeHmsInTZ,
  formatTimeHmInTZ,
  getWeekdayJaInTZ,
  formatJapaneseDateInTZ,
  formatJapaneseDateTimeInTZ,
  addDaysYmd,
  listRecentDatesYmd,
  buildDayRangeIsoInTZ,
  toTokyoDate,
  daysInMonth,
};