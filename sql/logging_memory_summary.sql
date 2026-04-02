-- logging_memory_summary.sql
-- 目的:
-- 1. 全文ログ保存を chat_logs に分離
-- 2. 記憶は conversation_memories のまま伴走向けに利用
-- 3. 要約は conversation_summaries に分離

create table if not exists public.chat_logs (
  id bigint generated always as identity primary key,
  created_at timestamptz not null default now(),
  user_id uuid null references public.users(id) on delete set null,
  line_user_id text null,
  role text not null check (role in ('user', 'assistant', 'system', 'tool')),
  message_text text null,
  message_type text null,
  image_context_type text null,
  source_channel text not null default 'line',
  model_used text null,
  trace_id text null,
  related_event_id text null,
  intent_guess text null,
  processing_result text null,
  reply_text text null,
  error_flag boolean not null default false,
  error_message text null,
  metadata jsonb not null default '{}'::jsonb
);

create index if not exists idx_chat_logs_user_id_created_at on public.chat_logs(user_id, created_at desc);
create index if not exists idx_chat_logs_line_user_id_created_at on public.chat_logs(line_user_id, created_at desc);
create index if not exists idx_chat_logs_trace_id on public.chat_logs(trace_id);
create index if not exists idx_chat_logs_related_event_id on public.chat_logs(related_event_id);
create index if not exists idx_chat_logs_role_created_at on public.chat_logs(role, created_at desc);

create table if not exists public.conversation_summaries (
  id bigint generated always as identity primary key,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  user_id uuid not null references public.users(id) on delete cascade,
  line_user_id text null,
  summary_scope text not null check (summary_scope in ('rolling', 'daily')),
  summary_key text not null,
  summary_text text not null default '',
  structured_context jsonb not null default '{}'::jsonb,
  latest_trace_id text null
);

create unique index if not exists uq_conversation_summaries_user_scope_key
  on public.conversation_summaries(user_id, summary_scope, summary_key);

create index if not exists idx_conversation_summaries_updated_at
  on public.conversation_summaries(updated_at desc);

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_conversation_summaries_updated_at on public.conversation_summaries;
create trigger trg_conversation_summaries_updated_at
before update on public.conversation_summaries
for each row execute function public.set_updated_at();

alter table public.chat_logs enable row level security;
alter table public.conversation_summaries enable row level security;

-- ここではサービスロール運用を前提にし、追加の閲覧ポリシーは作りません。
-- 管理画面を作る場合も、最小権限のサーバー経由で参照してください。
