create table if not exists phasee_route_reachability_daily (
  id bigserial primary key,
  day_ymd date not null,
  tag text not null,
  count integer not null default 0,
  last_seen_at timestamptz not null default now(),
  files_jsonb jsonb not null default '[]'::jsonb,
  meta_jsonb jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists uq_phasee_route_reachability_daily
  on phasee_route_reachability_daily(day_ymd, tag);

create index if not exists idx_phasee_route_reachability_tag_day
  on phasee_route_reachability_daily(tag, day_ymd desc);
