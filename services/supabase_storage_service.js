'use strict';

/**
 * Supabase Storage へ Buffer をアップロードする薄いラッパー。
 */
async function uploadBuffer(supabase, bucket, objectPath, buffer, options = {}) {
  if (!supabase || !bucket || !objectPath || !buffer || !buffer.length) {
    return { ok: false, error: new Error('missing_upload_args') };
  }
  const contentType = String(options.contentType || 'application/octet-stream');
  const upsert = Boolean(options.upsert);
  try {
    const { data, error } = await supabase.storage.from(bucket).upload(objectPath, buffer, {
      contentType,
      upsert,
    });
    if (error) return { ok: false, error, data: null };
    return { ok: true, error: null, data };
  } catch (e) {
    return { ok: false, error: e, data: null };
  }
}

module.exports = {
  uploadBuffer,
};
