begin;

create table if not exists public.web_link_codes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  line_user_id text not null,
  code text not null unique,
  expires_at timestamptz not null,
  used_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists idx_web_link_codes_user_created_at
  on public.web_link_codes(user_id, created_at desc);
create index if not exists idx_web_link_codes_code
  on public.web_link_codes(code);

create table if not exists public.web_portal_sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  line_user_id text,
  token_hash text not null unique,
  expires_at timestamptz not null,
  revoked_at timestamptz,
  user_agent text,
  ip_address text,
  created_at timestamptz not null default now()
);

create index if not exists idx_web_portal_sessions_user_created_at
  on public.web_portal_sessions(user_id, created_at desc);
create index if not exists idx_web_portal_sessions_token_hash
  on public.web_portal_sessions(token_hash);

notify pgrst, 'reload schema';

commit;
