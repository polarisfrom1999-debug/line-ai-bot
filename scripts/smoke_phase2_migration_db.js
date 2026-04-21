'use strict';

const assert = require('assert');
const { supabase } = require('../services/supabase_service');

async function smokeSessionState() {
  const marker = `smoke:${Date.now()}`;
  const now = new Date().toISOString();
  const row = {
    user_id: marker,
    session_type: 'lab_image_session',
    status: 'active',
    payload_jsonb: { marker },
    created_at: now,
    updated_at: now,
    expires_at: new Date(Date.now() + 60000).toISOString()
  };
  const ins = await supabase.from('session_state').insert(row).select('user_id,session_type').limit(1).maybeSingle();
  assert(!ins.error, `session_state insert failed: ${ins.error?.message || 'unknown'}`);
  const sel = await supabase.from('session_state').select('user_id,session_type').eq('user_id', marker).limit(1).maybeSingle();
  assert(!sel.error && sel.data, `session_state select failed: ${sel.error?.message || 'not_found'}`);
}

async function smokeLabSessions() {
  const marker = `smoke:${Date.now()}`;
  const now = new Date().toISOString();
  const row = {
    user_id: marker,
    source_image_id: marker,
    source_message_id: marker,
    status: 'tentative',
    patient_name: 'smoke',
    facility_name: 'smoke',
    exam_dates_json: [],
    parsed_items_json: [],
    raw_text: 'smoke',
    confidence: 0.1,
    is_lab_image_strict: false,
    is_lab_image_tentative: true,
    created_at: now,
    updated_at: now,
    expires_at: new Date(Date.now() + 60000).toISOString()
  };
  const ins = await supabase.from('lab_sessions').insert(row).select('user_id,status').limit(1).maybeSingle();
  assert(!ins.error, `lab_sessions insert failed: ${ins.error?.message || 'unknown'}`);
  const sel = await supabase.from('lab_sessions').select('user_id,status').eq('user_id', marker).limit(1).maybeSingle();
  assert(!sel.error && sel.data, `lab_sessions select failed: ${sel.error?.message || 'not_found'}`);
}

async function run() {
  await smokeSessionState();
  await smokeLabSessions();
  console.log('smoke_phase2_migration_db: ok');
}

run().catch((error) => {
  console.error(error?.stack || error?.message || error);
  process.exit(1);
});
