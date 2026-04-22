'use strict';

require('dotenv').config();

const { supabase } = require('../services/supabase_service');

async function run() {
  const day = new Intl.DateTimeFormat('sv-SE', {
    timeZone: 'Asia/Tokyo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).format(new Date());

  const read = await supabase
    .from('phasee_route_reachability_daily')
    .select('id,day_ymd,tag,count,last_seen_at,files_jsonb')
    .limit(1);
  if (read.error) {
    throw new Error(`phasee table read failed: ${read.error.message}`);
  }

  let write = { skipped: true };
  if (process.env.PHASEE_VERIFY_WRITE === '1') {
    const markerTag = `verify_migration_${Date.now()}`;
    const ins = await supabase
      .from('phasee_route_reachability_daily')
      .insert({
        day_ymd: day,
        tag: markerTag,
        count: 1,
        files_jsonb: ['scripts/phasee_verify_migration.js']
      })
      .select('id,day_ymd,tag,count')
      .limit(1)
      .maybeSingle();
    if (ins.error) throw new Error(`phasee table write failed: ${ins.error.message}`);
    write = { skipped: false, marker: ins.data };
  }

  console.log('phasee_verify_migration: ok');
  console.log(JSON.stringify({
    read_ok: true,
    rows_sample: Array.isArray(read.data) ? read.data.length : 0,
    write
  }, null, 2));
}

run().catch((error) => {
  console.error(error?.stack || error?.message || error);
  process.exit(1);
});
