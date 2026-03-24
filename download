begin;

create table if not exists public.weight_logs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  logged_at timestamptz not null default now(),
  weight_kg numeric not null,
  body_fat_pct numeric,
  created_at timestamptz not null default now()
);

create index if not exists idx_weight_logs_user_logged_at
  on public.weight_logs(user_id, logged_at desc);

notify pgrst, 'reload schema';

commit;