-- Gemini 第一正本: lab_sessions に生データを保持（空でも可）
alter table lab_sessions add column if not exists gemini_raw jsonb;
alter table lab_sessions add column if not exists structured_json jsonb;
