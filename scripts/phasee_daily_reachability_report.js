'use strict';

require('dotenv').config();

const { supabase } = require('../services/supabase_service');
const manifest = require('../config/phasee_reachability_manifest');

function toTokyoYmd(date) {
  return new Intl.DateTimeFormat('sv-SE', {
    timeZone: 'Asia/Tokyo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).format(date);
}

function buildRecentDays(days) {
  const out = [];
  const now = new Date();
  for (let i = 0; i < days; i += 1) {
    const d = new Date(now);
    d.setDate(now.getDate() - i);
    out.push(toTokyoYmd(d));
  }
  return out.reverse();
}

async function fetchRows(dayFrom, dayTo) {
  const { data, error } = await supabase
    .from('phasee_route_reachability_daily')
    .select('day_ymd,tag,count,last_seen_at,files_jsonb')
    .gte('day_ymd', dayFrom)
    .lte('day_ymd', dayTo)
    .order('day_ymd', { ascending: true });
  if (error) {
    if (/phasee_route_reachability_daily|does not exist|relation/i.test(String(error.message || ''))) {
      return { rows: [], warning: 'phasee_route_reachability_daily table is missing. Apply sql/phasee_route_reachability_daily.sql first.' };
    }
    throw new Error(error.message || 'fetch_failed');
  }
  return { rows: Array.isArray(data) ? data : [], warning: '' };
}

async function buildReport(days = 30) {
  const dayList = buildRecentDays(days);
  const dayFrom = dayList[0];
  const dayTo = dayList[dayList.length - 1];
  const fetched = await fetchRows(dayFrom, dayTo);
  const rows = fetched.rows || [];
  const map = new Map();
  for (const row of rows) {
    map.set(`${row.tag}:${row.day_ymd}`, row);
  }

  const result = [];
  const zeroThreshold = Number(manifest.zeroCandidateDays || 14);
  for (const route of manifest.routes) {
    let lastSeen = '';
    let zeroDayCount = 0;
    for (let i = dayList.length - 1; i >= 0; i -= 1) {
      const day = dayList[i];
      const hit = map.get(`${route.tag}:${day}`);
      const count = Number(hit?.count || 0);
      if (!lastSeen && hit?.last_seen_at) lastSeen = hit.last_seen_at;
      if (count === 0) {
        zeroDayCount += 1;
      } else {
        break;
      }
    }
    const perDay = dayList.map((day) => {
      const hit = map.get(`${route.tag}:${day}`);
      return {
        day,
        count: Number(hit?.count || 0)
      };
    });
    result.push({
      tag: route.tag,
      files: route.files,
      last_seen: lastSeen || null,
      zero_day_count: zeroDayCount,
      candidate_for_deletion: zeroDayCount >= zeroThreshold,
      days: perDay
    });
  }
  return {
    generated_at: new Date().toISOString(),
    day_range: { from: dayFrom, to: dayTo, days },
    zero_candidate_threshold_days: zeroThreshold,
    routes: result,
    warning: fetched.warning || ''
  };
}

async function run() {
  const days = Number(process.env.PHASEE_REPORT_DAYS || 30);
  const report = await buildReport(Number.isFinite(days) && days > 0 ? days : 30);
  const candidates = report.routes.filter((r) => r.candidate_for_deletion);
  console.log('phasee_daily_reachability_report: ok');
  console.log(JSON.stringify({
    generated_at: report.generated_at,
    day_range: report.day_range,
    zero_candidate_threshold_days: report.zero_candidate_threshold_days,
    warning: report.warning || '',
    candidates: candidates.map((c) => ({
      tag: c.tag,
      zero_day_count: c.zero_day_count,
      last_seen: c.last_seen,
      files: c.files
    })),
    routes: report.routes.map((r) => ({
      tag: r.tag,
      zero_day_count: r.zero_day_count,
      last_seen: r.last_seen,
      files: r.files
    }))
  }, null, 2));
}

run().catch((error) => {
  console.error(error?.stack || error?.message || error);
  process.exit(1);
});
