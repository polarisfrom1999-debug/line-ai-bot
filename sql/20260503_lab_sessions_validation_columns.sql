-- lab_sessions: 棚卸し・無効化（削除はしない）用の付帯列。
-- 既存の保存本流は列が無くても動く（NULL 想定）。アプリ改修は任意・段階的。

alter table if exists lab_sessions
  add column if not exists validation_status text,
  add column if not exists validation_notes text,
  add column if not exists superseded_by_session_id bigint references lab_sessions (id) on delete set null,
  add column if not exists validation_audited_at timestamptz;

comment on column lab_sessions.validation_status is
  'ok | suspect_future_date | suspect_range_as_value | suspect_single_item_loss | suspect_ocr_value | needs_reprocess | needs_manual_review | superseded など（運用定義）';
comment on column lab_sessions.validation_notes is '監査・判断の根拠（短い理由）';
comment on column lab_sessions.superseded_by_session_id is '置き換え先の正セッション id。誤読行を残したまま参照を切る';
comment on column lab_sessions.validation_audited_at is '最後に棚卸しラベルを付けた日時';

create index if not exists idx_lab_sessions_validation_status
  on lab_sessions (validation_status)
  where validation_status is not null;

create index if not exists idx_lab_sessions_source_message_id_nz
  on lab_sessions (source_message_id)
  where coalesce(nullif(trim(source_message_id), ''), '') <> '';

create index if not exists idx_lab_sessions_source_image_id_nz
  on lab_sessions (source_image_id)
  where coalesce(nullif(trim(source_image_id), ''), '') <> '';
