-- Phase v2: session_state canonical persistence (additive)
create table if not exists session_state (
  id bigserial primary key,
  user_id text not null,
  session_type text not null,
  status text not null default 'active',
  payload_jsonb jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  expires_at timestamptz,
  closed_at timestamptz
);

create index if not exists idx_session_state_user_status_exp
  on session_state(user_id, status, expires_at desc);

create index if not exists idx_session_state_type
  on session_state(session_type);
