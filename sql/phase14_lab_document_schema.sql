-- Optional persistent table for future lab document storage.
-- Current code still works without this table; it is a forward-ready schema.

create table if not exists lab_documents (
  id bigserial primary key,
  user_id text not null,
  document_hash text not null,
  document_type text,
  patient_name text,
  report_date date,
  latest_exam_date date,
  exam_dates jsonb not null default '[]'::jsonb,
  panel_json jsonb not null,
  issues jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists idx_lab_documents_user_hash
  on lab_documents (user_id, document_hash);

create index if not exists idx_lab_documents_user_latest
  on lab_documents (user_id, latest_exam_date desc, updated_at desc);
