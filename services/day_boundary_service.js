'use strict';

function pad2(v) {
  return String(v).padStart(2, '0');
}

function toDate(value) {
  const d = value instanceof Date ? new Date(value.getTime()) : new Date(value || Date.now());
  return Number.isNaN(d.getTime()) ? new Date() : d;
}

function resolveBusinessDateKey(value, resetHour = 2) {
  const d = toDate(value);
  const shifted = new Date(d.getTime());
  shifted.setHours(shifted.getHours() - Number(resetHour || 2));
  return `${shifted.getFullYear()}-${pad2(shifted.getMonth() + 1)}-${pad2(shifted.getDate())}`;
}

function getBusinessDayRange(value, resetHour = 2) {
  const d = toDate(value);
  const key = resolveBusinessDateKey(d, resetHour);
  const [y, m, day] = key.split('-').map(Number);
  const start = new Date(y, (m - 1), day, Number(resetHour || 2), 0, 0, 0);
  const end = new Date(start.getTime() + 24 * 60 * 60 * 1000 - 1);
  return { key, start, end };
}

function resolveWeekRange(value, resetHour = 2) {
  const d = toDate(value);
  const dayKeyDate = new Date(getBusinessDayRange(d, resetHour).start.getTime());
  const weekday = dayKeyDate.getDay();
  const diffToMonday = (weekday + 6) % 7;
  const start = new Date(dayKeyDate.getTime() - diffToMonday * 24 * 60 * 60 * 1000);
  const end = new Date(start.getTime() + 7 * 24 * 60 * 60 * 1000 - 1);
  return { start, end, key: `${resolveBusinessDateKey(start, resetHour)}_week` };
}

module.exports = {
  resolveBusinessDateKey,
  getBusinessDayRange,
  resolveWeekRange,
};
