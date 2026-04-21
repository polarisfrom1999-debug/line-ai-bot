-- Phase v2: meal canonical traceability + soft delete (additive)
alter table meal_logs add column if not exists gemini_raw jsonb;
alter table meal_logs add column if not exists adopted_nutrition_json jsonb;
alter table meal_logs add column if not exists deleted_at timestamptz;
alter table meal_logs add column if not exists deleted_reason text;
alter table meal_logs add column if not exists superseded_by bigint;

create index if not exists idx_meal_logs_not_deleted
  on meal_logs(user_id, eaten_at desc)
  where deleted_at is null;

create table if not exists meal_capture_sessions (
  id bigserial primary key,
  user_id text not null,
  source_channel text default 'line',
  source_message_id text,
  source_image_id text,
  status text not null default 'active',
  active_meal_log_id bigint,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  expires_at timestamptz
);

create table if not exists meal_capture_events (
  id bigserial primary key,
  session_id bigint not null references meal_capture_sessions(id) on delete cascade,
  user_id text not null,
  event_kind text not null,
  payload_jsonb jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists idx_meal_capture_sessions_user
  on meal_capture_sessions(user_id, created_at desc);
