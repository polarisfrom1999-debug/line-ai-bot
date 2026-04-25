-- additive only: LINE 表示名同期の監査用
alter table if exists users
  add column if not exists line_display_name text;
alter table if exists users
  add column if not exists line_display_name_synced_at timestamptz;
alter table if exists users
  add column if not exists line_display_name_sync_error text not null default '';
