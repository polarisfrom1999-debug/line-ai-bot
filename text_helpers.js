begin;

create table if not exists public.lab_import_sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  line_user_id text,
  line_message_id text,
  status text not null default 'draft',
  detected_dates_json jsonb,
  selected_date text,
  raw_extracted_json jsonb,
  working_data_json jsonb,
  active_item_name text,
  active_date text,
  source_image_url text,
  expires_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.lab_results (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  measured_at timestamptz not null default now(),
  hba1c numeric,
  fasting_glucose numeric,
  ldl numeric,
  hdl numeric,
  triglycerides numeric,
  ast numeric,
  alt numeric,
  ggt numeric,
  uric_acid numeric,
  creatinine numeric,
  source_image_url text,
  import_session_id uuid references public.lab_import_sessions(id) on delete set null,
  raw_model_json jsonb,
  created_at timestamptz not null default now()
);

create table if not exists public.intake_sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  status text not null default 'draft',
  current_step text not null default 'choose_ai_type',
  answers_json jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.user_profiles (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null unique references public.users(id) on delete cascade,
  conversation_style text,
  encouragement_style text,
  current_barriers text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_lab_import_sessions_user_created_at on public.lab_import_sessions(user_id, created_at desc);
create index if not exists idx_lab_results_user_measured_at on public.lab_results(user_id, measured_at desc);
create index if not exists idx_intake_sessions_user_created_at on public.intake_sessions(user_id, created_at desc);

notify pgrst, 'reload schema';

commit;