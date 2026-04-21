-- Phase v2: lab canonical session/panel model (additive)
create table if not exists lab_sessions (
  id bigserial primary key,
  user_id text not null,
  source_image_id text,
  source_message_id text,
  status text not null default 'tentative',
  patient_name text,
  patient_id text,
  facility_name text,
  print_date date,
  exam_dates_json jsonb not null default '[]'::jsonb,
  parsed_items_json jsonb not null default '[]'::jsonb,
  raw_text text,
  confidence numeric(6,3),
  is_lab_image_strict boolean not null default false,
  is_lab_image_tentative boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  expires_at timestamptz
);

create index if not exists idx_lab_sessions_user_created
  on lab_sessions(user_id, created_at desc);

create table if not exists lab_panels (
  id bigserial primary key,
  user_id text not null,
  panel_status text not null default 'draft',
  patient_name text,
  patient_id text,
  facility_name text,
  latest_exam_date date,
  exam_dates_json jsonb not null default '[]'::jsonb,
  items_json jsonb not null default '[]'::jsonb,
  source_session_id bigint references lab_sessions(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_lab_panels_user_updated
  on lab_panels(user_id, updated_at desc);
