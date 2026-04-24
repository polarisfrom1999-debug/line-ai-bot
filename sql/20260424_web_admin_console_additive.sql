-- additive only
create table if not exists report_drafts (
  id bigserial primary key,
  user_id text not null,
  report_type text not null,
  period_start text not null,
  period_end text not null,
  source_summary_json jsonb not null default '{}'::jsonb,
  draft_text text not null default '',
  edited_text text not null default '',
  status text not null default 'draft',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, report_type, period_start, period_end)
);

create table if not exists web_theme_settings (
  id bigserial primary key,
  admin_user_id text not null unique,
  theme_id text not null default 'soft-default',
  accent_color text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
