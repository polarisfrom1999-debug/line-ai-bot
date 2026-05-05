-- Phase 2-1: athlete video storage metadata (binaries live in Supabase Storage bucket `athlete-videos`).
-- Apply in Supabase SQL editor or migration runner.

create table if not exists public.athlete_video_records (
  id uuid primary key default gen_random_uuid(),
  line_user_id text not null,
  message_id text,
  line_content_id text,
  storage_bucket text,
  storage_path text,
  public_url text,
  content_type text,
  file_size_bytes bigint,
  duration_ms integer,
  athlete_name text,
  event_type text,
  race_distance_m integer,
  title text,
  meet_name text,
  memo text,
  status text not null default 'received',
  error_message text,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create index if not exists idx_athlete_video_records_line_user_id
  on public.athlete_video_records(line_user_id);

create index if not exists idx_athlete_video_records_message_id
  on public.athlete_video_records(message_id);

create index if not exists idx_athlete_video_records_created_at
  on public.athlete_video_records(created_at desc);

create table if not exists public.athlete_video_analysis (
  id uuid primary key default gen_random_uuid(),
  video_record_id uuid references public.athlete_video_records(id) on delete cascade,
  summary text,
  analysis_json jsonb,
  status text not null default 'pending',
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create index if not exists idx_athlete_video_analysis_video_record_id
  on public.athlete_video_analysis(video_record_id);
