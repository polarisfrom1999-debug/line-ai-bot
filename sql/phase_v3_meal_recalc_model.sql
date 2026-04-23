begin;

create table if not exists public.base_meals (
  id bigserial primary key,
  user_id text not null,
  eaten_at timestamptz not null,
  source_message_id text,
  source_image_id text,
  meal_label text not null default '食事',
  base_payload_json jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_base_meals_user_eaten_at
  on public.base_meals(user_id, eaten_at desc);

create table if not exists public.correction_events (
  event_id bigserial primary key,
  meal_id bigint not null references public.base_meals(id) on delete cascade,
  user_id text not null,
  event_type text not null,
  payload_json jsonb not null default '{}'::jsonb,
  priority integer not null,
  "timestamp" timestamptz not null,
  dedupe_key text not null,
  source_message_id text not null default '',
  created_by_flow text not null default 'newflow',
  created_at timestamptz not null default now()
);

create unique index if not exists uq_correction_events_meal_dedupe
  on public.correction_events(meal_id, dedupe_key);

create index if not exists idx_correction_events_meal_timestamp
  on public.correction_events(meal_id, priority asc, "timestamp" asc, event_id asc);

create index if not exists idx_correction_events_user_timestamp
  on public.correction_events(user_id, "timestamp" desc);

commit;
