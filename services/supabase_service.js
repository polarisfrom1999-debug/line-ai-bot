const { createClient } = require('@supabase/supabase-js');
const { getEnv } = require('../config/env');

const env = getEnv();

const supabase = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: {
    autoRefreshToken: false,
    persistSession: false,
  },
});

module.exports = {
  supabase,
};