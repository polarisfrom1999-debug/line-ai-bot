'use strict';

const lineContentDownloadService = require('./line_content_download_service');
const supabaseStorageService = require('./supabase_storage_service');
const lineMediaService = require('./line_media_service');

const DEFAULT_BUCKET = 'athlete-videos';

function buildStoragePath(lineUserId, messageId, now = new Date()) {
  const uid = String(lineUserId || '').trim();
  const mid = String(messageId || '').trim();
  const parts = new Intl.DateTimeFormat('en', {
    timeZone: 'Asia/Tokyo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(now);
  const y = parts.find((p) => p.type === 'year')?.value || '1970';
  const m = parts.find((p) => p.type === 'month')?.value || '01';
  return `${uid}/${y}/${m}/${mid}.mp4`;
}

function successText() {
  return '動画を保存しました。あとで「この動画を解析」と送ると、フォーム分析できるようにしていきます。';
}

function failureText() {
  return '動画は受け取りました。保存処理を確認中です。';
}

/**
 * LINE 動画メッセージを Storage に保存し、athlete_video_records にメタを残す。
 * 失敗時も例外は投げず { text } を返す（webhook 全体を落とさない）。
 */
async function saveVideoFromLineMessage({
  supabase,
  client: _client,
  lineUserId,
  messageId,
  text: _text,
  durationMs = null,
}) {
  const uid = String(lineUserId || '').trim();
  const mid = String(messageId || '').trim();
  const bucket = DEFAULT_BUCKET;

  if (!supabase || !uid || !mid) {
    console.error('[athlete_video_save_error]', { lineUserId: uid, messageId: mid, error: 'missing_supabase_or_ids' });
    return { text: failureText(), ok: false };
  }

  try {
    const { data: existing } = await supabase
      .from('athlete_video_records')
      .select('id, storage_path, status')
      .eq('message_id', mid)
      .maybeSingle();

    if (existing?.id) {
      console.info('[athlete_video_save_success]', { videoRecordId: existing.id, storagePath: existing.storage_path, dedupe: true });
      return { text: successText(), ok: true, videoRecordId: existing.id, deduped: true };
    }

    const storagePath = buildStoragePath(uid, mid);
    console.info('[athlete_video_save_start]', { lineUserId: uid, messageId: mid, storageBucket: bucket, storagePath });

    const buffer = await lineContentDownloadService.downloadMessageContentBuffer(mid);
    if (!buffer || !buffer.length) {
      throw new Error('empty_video_buffer');
    }

    const sniffed = lineMediaService.detectMimeTypeFromBytes(buffer);
    const contentType = /^video\//.test(sniffed) ? sniffed : 'video/mp4';

    const up = await supabaseStorageService.uploadBuffer(supabase, bucket, storagePath, buffer, {
      contentType,
      upsert: true,
    });
    if (!up.ok) {
      throw up.error || new Error('storage_upload_failed');
    }

    const fileSizeBytes = buffer.length;
    console.info('[athlete_video_storage_upload_success]', { storageBucket: bucket, storagePath, fileSizeBytes });

    const row = {
      line_user_id: uid,
      message_id: mid,
      line_content_id: null,
      storage_bucket: bucket,
      storage_path: storagePath,
      public_url: null,
      content_type: contentType,
      file_size_bytes: fileSizeBytes,
      duration_ms: durationMs != null && Number.isFinite(Number(durationMs)) ? Math.round(Number(durationMs)) : null,
      status: 'stored',
      updated_at: new Date().toISOString(),
    };

    const { data: inserted, error: insErr } = await supabase
      .from('athlete_video_records')
      .insert(row)
      .select('id')
      .maybeSingle();

    if (insErr) throw insErr;

    const videoRecordId = inserted?.id;
    console.info('[athlete_video_record_insert_success]', { videoRecordId, lineUserId: uid, messageId: mid });
    console.info('[athlete_video_save_success]', { videoRecordId, storagePath });

    return { text: successText(), ok: true, videoRecordId, storagePath };
  } catch (error) {
    const errMsg = String(error?.message || error || 'unknown');
    console.error('[athlete_video_save_error]', { lineUserId: uid, messageId: mid, error: errMsg.slice(0, 500) });
    try {
      await supabase
        .from('athlete_video_records')
        .insert({
          line_user_id: uid,
          message_id: mid || null,
          line_content_id: null,
          storage_bucket: bucket,
          storage_path: null,
          public_url: null,
          content_type: null,
          file_size_bytes: null,
          duration_ms: durationMs != null && Number.isFinite(Number(durationMs)) ? Math.round(Number(durationMs)) : null,
          status: 'save_failed',
          error_message: errMsg.slice(0, 500),
          updated_at: new Date().toISOString(),
        });
    } catch (_saveFailedInsertError) {
      // best-effort only; webhook must keep responding
    }
    return { text: failureText(), ok: false, error };
  }
}

module.exports = {
  saveVideoFromLineMessage,
  buildStoragePath,
  DEFAULT_BUCKET,
};
