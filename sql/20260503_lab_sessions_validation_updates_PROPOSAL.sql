-- =============================================================================
-- PROPOSAL のみ — 実行前に必ず全文レビューし、本番では意思決定後に個別実行すること。
-- 前提: sql/20260503_lab_sessions_validation_columns.sql 適用済み
-- このファイルを一括実行しないこと（Editor ではブロック単位で）。
-- =============================================================================
-- 反映しないもの（合意）: DELETE / status(active等)変更 / follow-up / 自動再処理 / 数値・日付の自動補正
-- =============================================================================

-- -----------------------------------------------------------------------------
-- STEP 0: 更新前の再確認（116〜122）
-- -----------------------------------------------------------------------------
-- select id, validation_status, superseded_by_session_id, validation_notes, validation_audited_at
-- from lab_sessions
-- where id between 116 and 122
-- order by id;

-- =============================================================================
-- STEP 1: 提案 UPDATE（実行する場合は begin; … commit; で囲むことを推奨）
-- =============================================================================

-- 116 — needs_manual_review（116 は 117〜122 と別帳票・別患者コード系。print と exam の年ズレ）
update lab_sessions
set
  validation_status = 'needs_manual_review',
  superseded_by_session_id = null,
  validation_notes = 'print_date 2018-10-17 に対し exam_dates_json が 2025-07-10。117〜122 とは別帳票相当。source 空のため人手確認。',
  validation_audited_at = now()
where id = 116;

-- 117 — superseded → 120（監査: 未来日付・基準範囲混入の疑い。120 が同一帳票の正本候補）
update lab_sessions
set
  validation_status = 'superseded',
  superseded_by_session_id = 120,
  validation_notes = 'supersede 先 120。print_date 2025-03-24 同一系、exam_dates_json に未来日付。120 の exam 列が自然。',
  validation_audited_at = now()
where id = 117;

-- 118 — superseded → 120（117 と同旨）
update lab_sessions
set
  validation_status = 'superseded',
  superseded_by_session_id = 120,
  validation_notes = 'supersede 先 120。117 と同様。120 を正本候補。',
  validation_audited_at = now()
where id = 118;

-- 119 — superseded → 122（単日落ち・raw 多項目の疑い。122 が同一日・単日正本候補）
update lab_sessions
set
  validation_status = 'superseded',
  superseded_by_session_id = 122,
  validation_notes = 'supersede 先 122。print_date 2023-10-17 同一、parsed_len=1 と raw 不整合。122 は parsed_len=9。',
  validation_audited_at = now()
where id = 119;

-- 120 — 複数日検査の正本候補（ok）
update lab_sessions
set
  validation_status = 'ok',
  superseded_by_session_id = null,
  validation_notes = '複数日検査の正本候補。exam_dates_json が 2016〜2017 系で自然。117/118 の supersede 先。',
  validation_audited_at = now()
where id = 120;

-- 121 — needs_manual_review（120 との日付列ズレ・LDH 人手確認。自動補正しない）
update lab_sessions
set
  validation_status = 'needs_manual_review',
  superseded_by_session_id = null,
  validation_notes = '120 と同一系で 2017-03-22 列が 2025-03-22 になっている疑い。LDH 21 は画像照合。自動補正しない。',
  validation_audited_at = now()
where id = 121;

-- 122 — 単日検査の正本候補（ok）
update lab_sessions
set
  validation_status = 'ok',
  superseded_by_session_id = null,
  validation_notes = '単日検査の正本候補。print_date 2023-10-17、parsed_len=9。119 の supersede 先。',
  validation_audited_at = now()
where id = 122;

-- =============================================================================
-- STEP 2: 更新後の確認
-- =============================================================================
-- select id, validation_status, superseded_by_session_id, left(validation_notes, 80), validation_audited_at
-- from lab_sessions
-- where id between 116 and 122
-- order by id;
