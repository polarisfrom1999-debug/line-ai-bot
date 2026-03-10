async function ensureUser(supabase, lineUserId, tz = 'Asia/Tokyo') {
  const { data: existing, error: selectError } = await supabase
    .from('users')
    .select('*')
    .eq('line_user_id', lineUserId)
    .maybeSingle();

  if (selectError) throw selectError;
  if (existing) return existing;

  const insertPayload = {
    line_user_id: lineUserId,
    timezone: tz,
    intake_status: 'not_started',
  };

  const { data: created, error: insertError } = await supabase
    .from('users')
    .insert(insertPayload)
    .select('*')
    .single();

  if (insertError) throw insertError;
  return created;
}

async function refreshUserById(supabase, userId) {
  const { data, error } = await supabase
    .from('users')
    .select('*')
    .eq('id', userId)
    .single();

  if (error) throw error;
  return data;
}

module.exports = {
  ensureUser,
  refreshUserById,
};