'use strict';

/**
 * 直近の meal_logs を走査し、dedupeFingerprint が一致する重複行を削除する（古い id を残す）。
 *
 * Usage:
 *   node scripts/repair_duplicate_meal_logs.js <LINE_USER_ID> [--days=14] [--dry-run]
 *
 * 環境変数: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY（既存の supabase_service と同じ）
 */

const { supabase } = require('../services/supabase_service');
const { ensureUser } = require('../services/user_service');
const mealLogQueryService = require('../services/meal_log_query_service');

function parseArgs(argv) {
  const lineUserId = argv.find((a) => !a.startsWith('--')) || '';
  const dryRun = argv.includes('--dry-run');
  let days = 14;
  const dArg = argv.find((a) => /^--days=/.test(a));
  if (dArg) days = Math.min(120, Math.max(1, Number(dArg.split('=')[1]) || 14));
  return { lineUserId, dryRun, days };
}

function addDaysYmd(ymd, delta) {
  const m = String(ymd || '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return '';
  const dt = new Date(`${m[1]}-${m[2]}-${m[3]}T12:00:00+09:00`);
  dt.setDate(dt.getDate() + delta);
  return new Intl.DateTimeFormat('sv-SE', {
    timeZone: 'Asia/Tokyo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).format(dt);
}

async function main() {
  const { lineUserId, dryRun, days } = parseArgs(process.argv.slice(2));
  if (!lineUserId) {
    console.error('Usage: node scripts/repair_duplicate_meal_logs.js <LINE_USER_ID> [--days=14] [--dry-run]');
    process.exit(1);
  }
  if (!supabase) {
    console.error('supabase client is not configured.');
    process.exit(1);
  }

  const user = await ensureUser(supabase, lineUserId, 'Asia/Tokyo');
  const todayYmd = new Intl.DateTimeFormat('sv-SE', {
    timeZone: 'Asia/Tokyo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).format(new Date());
  const fromYmd = addDaysYmd(todayYmd, -(days - 1));
  const logs = await mealLogQueryService.getMealLogsByDateRange(lineUserId, fromYmd, todayYmd);
  if (!logs.length) {
    console.log('No meal_logs in range.');
    return;
  }

  const byFp = new Map();
  for (const log of logs) {
    const fp = mealLogQueryService.dedupeFingerprint(log);
    const cur = byFp.get(fp) || [];
    cur.push(log);
    byFp.set(fp, cur);
  }

  const toDelete = [];
  for (const [, group] of byFp) {
    if (group.length < 2) continue;
    const sorted = [...group].sort((a, b) => String(a.eatenAt || '').localeCompare(String(b.eatenAt || '')));
    const keep = sorted[0];
    for (let i = 1; i < sorted.length; i += 1) {
      toDelete.push({ id: sorted[i].id, fp, keepId: keep.id });
    }
  }

  console.log(JSON.stringify({ userId: user.id, fromYmd, todayYmd, scanned: logs.length, deleteCount: toDelete.length, dryRun }, null, 2));
  if (!toDelete.length) return;

  if (dryRun) {
    console.log('Dry-run: would delete ids:', toDelete.map((x) => x.id).join(', '));
    return;
  }

  const ids = toDelete.map((x) => x.id).filter(Boolean);
  const { error } = await supabase.from('meal_logs').delete().in('id', ids);
  if (error) {
    console.error('Delete failed:', error.message || error);
    process.exit(1);
  }
  console.log('Deleted', ids.length, 'duplicate meal_logs rows.');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
