function toIsoStringInTZ(date, tz = 'Asia/Tokyo') {
  const d = new Date(date);

  const fmtDate = new Intl.DateTimeFormat('sv-SE', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(d);

  const fmtTime = new Intl.DateTimeFormat('sv-SE', {
    timeZone: tz,
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).format(d);

  return `${fmtDate}T${fmtTime}+09:00`;
}

function currentDateYmdInTZ(tz = 'Asia/Tokyo') {
  return toIsoStringInTZ(new Date(), tz).slice(0, 10);
}

function toTokyoDate(date, tz = 'Asia/Tokyo') {
  const str = new Intl.DateTimeFormat('en-CA', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date(date));

  const [y, m, d] = str.split('-').map(Number);
  return new Date(y, m - 1, d);
}

function daysInMonth(date) {
  const d = new Date(date);
  return new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
}

module.exports = {
  toIsoStringInTZ,
  currentDateYmdInTZ,
  toTokyoDate,
  daysInMonth,
};