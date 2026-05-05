-- lab_sessions: supersede 候補の突き合わせ（SELECT のみ）
-- 用途: 117/118/119 の後続 session、120/121/122 の正本候補を同一ユーザー・同一ソース単位で並べる
-- UPDATE / DELETE は含まない

-- ---------------------------------------------------------------------------
-- 1) 焦点 ID のスナップショット（列は監査・正本判断に使う最小セット）
-- ---------------------------------------------------------------------------
select
  ls.id,
  ls.user_id,
  ls.status,
  ls.print_date,
  ls.exam_dates_json,
  jsonb_array_length(ls.parsed_items_json) as parsed_len,
  coalesce(nullif(trim(ls.source_image_id), ''), '') as source_image_id,
  coalesce(nullif(trim(ls.source_message_id), ''), '') as source_message_id,
  (ls.gemini_raw is not null) as has_gemini_raw,
  (ls.structured_json is not null) as has_structured_json,
  left(coalesce(ls.raw_text, ''), 120) as raw_preview,
  ls.validation_status,
  ls.superseded_by_session_id,
  ls.created_at
from lab_sessions ls
where ls.id in (116, 117, 118, 119, 120, 121, 122)
order by ls.id;

-- ---------------------------------------------------------------------------
-- 2) 同一 source_image_id のセッション連鎖（空でない ID のみ）
--    117/118/119 の source_image_id をコピペして WHERE で絞ると速い
-- ---------------------------------------------------------------------------
select
  ls.id,
  ls.user_id,
  trim(ls.source_image_id) as source_image_id,
  ls.status,
  ls.print_date,
  ls.exam_dates_json,
  jsonb_array_length(ls.parsed_items_json) as parsed_len,
  ls.validation_status,
  ls.superseded_by_session_id,
  ls.created_at
from lab_sessions ls
where coalesce(nullif(trim(ls.source_image_id), ''), '') <> ''
  and trim(ls.source_image_id) in (
    select trim(ls2.source_image_id)
    from lab_sessions ls2
    where ls2.id in (117, 118, 119)
      and coalesce(nullif(trim(ls2.source_image_id), ''), '') <> ''
  )
order by trim(ls.source_image_id), ls.created_at, ls.id;

-- ---------------------------------------------------------------------------
-- 3) 同一 source_message_id のセッション連鎖（空でない ID のみ）
-- ---------------------------------------------------------------------------
select
  ls.id,
  ls.user_id,
  trim(ls.source_message_id) as source_message_id,
  ls.status,
  ls.print_date,
  ls.exam_dates_json,
  jsonb_array_length(ls.parsed_items_json) as parsed_len,
  ls.validation_status,
  ls.superseded_by_session_id,
  ls.created_at
from lab_sessions ls
where coalesce(nullif(trim(ls.source_message_id), ''), '') <> ''
  and trim(ls.source_message_id) in (
    select trim(ls2.source_message_id)
    from lab_sessions ls2
    where ls2.id in (117, 118, 119)
      and coalesce(nullif(trim(ls2.source_message_id), ''), '') <> ''
  )
order by trim(ls.source_message_id), ls.created_at, ls.id;

-- ---------------------------------------------------------------------------
-- 4) ユーザー内タイムライン（117–122 と同じ user_id 前提で前後を広く見る）
--    ※ user_id は 1) の結果から1つに置き換えて実行
-- ---------------------------------------------------------------------------
-- select
--   ls.id,
--   ls.status,
--   ls.print_date,
--   ls.exam_dates_json,
--   jsonb_array_length(ls.parsed_items_json) as parsed_len,
--   coalesce(nullif(trim(ls.source_image_id), ''), '') as source_image_id,
--   coalesce(nullif(trim(ls.source_message_id), ''), '') as source_message_id,
--   ls.created_at
-- from lab_sessions ls
-- where ls.user_id = '<PASTE_USER_ID_FROM_SNAPSHOT>'
--   and ls.created_at >= (select min(created_at) from lab_sessions where id in (116, 117, 118, 119, 120, 121, 122)) - interval '30 days'
--   and ls.created_at <= (select max(created_at) from lab_sessions where id in (116, 117, 118, 119, 120, 121, 122)) + interval '30 days'
-- order by ls.created_at, ls.id;

-- ---------------------------------------------------------------------------
-- 5) 「117/118/119 のいずれかより後に作られ、同一ユーザーのセッション」（弱い候補）
--    source が一致しない再アップロードも拾う。誤結合に注意し print_date / parsed で突合せる。
--    seed ごとの対応は query 2/3 の source 一致が優先。
-- ---------------------------------------------------------------------------
select
  ls.id,
  ls.user_id,
  ls.print_date,
  jsonb_array_length(ls.parsed_items_json) as parsed_len,
  ls.exam_dates_json,
  coalesce(nullif(trim(ls.source_image_id), ''), '') as source_image_id,
  coalesce(nullif(trim(ls.source_message_id), ''), '') as source_message_id,
  ls.created_at
from lab_sessions ls
where ls.id not in (117, 118, 119)
  and exists (
    select 1
    from lab_sessions s
    where s.id in (117, 118, 119)
      and s.user_id = ls.user_id
      and ls.created_at > s.created_at
  )
order by ls.created_at, ls.id;
