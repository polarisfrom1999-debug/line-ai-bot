-- phase15: lab reports normalized storage

create table if not exists lab_reports (
  id bigserial primary key,
  user_id text not null,
  exam_date date,
  source_type text not null default 'image',
  status text not null default 'partial',
  raw_text text,
  image_url text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_lab_reports_user_exam_date
  on lab_reports (user_id, exam_date desc, created_at desc);

create index if not exists idx_lab_reports_user_created
  on lab_reports (user_id, created_at desc);

create table if not exists lab_report_items (
  id bigserial primary key,
  report_id bigint not null references lab_reports(id) on delete cascade,
  user_id text not null,
  exam_date date,
  canonical_name text not null,
  display_name text,
  value_numeric numeric,
  value_text text,
  unit text,
  raw_label text,
  created_at timestamptz not null default now()
);

create index if not exists idx_lab_report_items_user_canonical_date
  on lab_report_items (user_id, canonical_name, exam_date desc, created_at desc);

create index if not exists idx_lab_report_items_report
  on lab_report_items (report_id);
