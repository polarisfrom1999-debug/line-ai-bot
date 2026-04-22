-- Phase E guard migration: ensure lab_sessions has Gemini payload columns
alter table if exists lab_sessions add column if not exists gemini_raw jsonb;
alter table if exists lab_sessions add column if not exists structured_json jsonb;
