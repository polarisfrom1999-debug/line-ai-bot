-- 血液検査 正本: lab_item_master + lab_result_items（lab_sessions は変更しない）
-- 適用: Supabase SQL Editor

CREATE TABLE IF NOT EXISTS lab_item_master (
  id BIGSERIAL PRIMARY KEY,
  normalized_key TEXT NOT NULL UNIQUE,
  display_name_ja TEXT NOT NULL,
  display_name_en TEXT,
  aliases_json JSONB NOT NULL DEFAULT '[]'::jsonb,
  category TEXT,
  default_unit TEXT,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  sort_order INTEGER NOT NULL DEFAULT 9999,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_lab_item_master_active
  ON lab_item_master (is_active);

CREATE INDEX IF NOT EXISTS idx_lab_item_master_category
  ON lab_item_master (category);

CREATE TABLE IF NOT EXISTS lab_result_items (
  id BIGSERIAL PRIMARY KEY,

  user_id TEXT NOT NULL,
  lab_session_id BIGINT NOT NULL REFERENCES lab_sessions (id) ON DELETE CASCADE,

  patient_name TEXT,
  facility_name TEXT,

  observed_date DATE,
  observed_date_text TEXT,
  observed_date_status TEXT NOT NULL DEFAULT 'unknown',

  normalized_key TEXT NOT NULL,
  display_name TEXT NOT NULL,
  raw_name TEXT,

  value_text TEXT,
  value_numeric NUMERIC,
  unit TEXT,
  reference_range TEXT,
  flag TEXT,

  source TEXT NOT NULL DEFAULT 'gemini',
  source_json_path TEXT,
  source_item_hash TEXT,
  raw_item_json JSONB,

  confidence NUMERIC,

  validation_status TEXT NOT NULL DEFAULT 'ok',
  review_reason TEXT,

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT chk_lab_result_items_observed_date_status
    CHECK (observed_date_status IN ('exact', 'unknown', 'needs_review')),

  CONSTRAINT chk_lab_result_items_validation_status
    CHECK (validation_status IN ('ok', 'needs_manual_review', 'rejected', 'superseded'))
);

CREATE INDEX IF NOT EXISTS idx_lab_result_items_user_session
  ON lab_result_items (user_id, lab_session_id);

CREATE INDEX IF NOT EXISTS idx_lab_result_items_user_key_date
  ON lab_result_items (user_id, normalized_key, observed_date);

CREATE INDEX IF NOT EXISTS idx_lab_result_items_session_key
  ON lab_result_items (lab_session_id, normalized_key);

CREATE INDEX IF NOT EXISTS idx_lab_result_items_validation
  ON lab_result_items (validation_status);

CREATE INDEX IF NOT EXISTS idx_lab_result_items_source_hash
  ON lab_result_items (lab_session_id, source_item_hash);
