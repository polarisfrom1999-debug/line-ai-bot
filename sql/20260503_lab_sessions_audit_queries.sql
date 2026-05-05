-- 血液検査 lab_sessions 棚卸し用（SELECT のみ。本番は読取専用推奨）
-- 前提: print_date, exam_dates_json, parsed_items_json, raw_text, gemini_raw, structured_json, source_*
-- 正規表現はアプリの isReferenceRangeLikeValue に近い「数値-数値」範囲を検出

-- ---------------------------------------------------------------------------
-- A) print_date より未来の検査日が exam_dates_json に含まれる
--    ('unknown_date' や非日付文字列は除外して比較)
-- ---------------------------------------------------------------------------
-- 例: print 2025-03-24 に対し 2025-10-13 が列挙されている
select
  id,
  user_id,
  status,
  print_date,
  exam_dates_json,
  created_at
from lab_sessions
where print_date is not null
  and jsonb_typeof(exam_dates_json) = 'array'
  and jsonb_array_length(exam_dates_json) > 0
  and exists (
    select 1
    from jsonb_array_elements_text(exam_dates_json) as ed(dt)
    where dt ~ '^\d{4}-\d{2}-\d{2}$'
      and dt::date > print_date
  )
order by id;

-- ---------------------------------------------------------------------------
-- B) parsed_items_json の value に基準範囲っぽい文字列（数値-数値）
-- ---------------------------------------------------------------------------
select
  id,
  user_id,
  status,
  print_date,
  created_at
from lab_sessions
where jsonb_typeof(parsed_items_json) = 'array'
  and jsonb_array_length(parsed_items_json) > 0
  and exists (
    select 1
    from jsonb_array_elements(parsed_items_json) as it
    where (it->>'value') is not null
      and (it->>'value') ~ '^\d+(\.\d+)?\s*[-〜~−–—]\s*\d+(\.\d+)?$'
  )
order by id;

-- 補助: 該当行の怪しい value サンプル（1行に値を集約）
select
  ls.id,
  ls.user_id,
  array_agg(distinct (it->>'value')) filter (
    where (it->>'value') ~ '^\d+(\.\d+)?\s*[-〜~−–—]\s*\d+(\.\d+)?$'
  ) as suspect_range_values
from lab_sessions ls,
  jsonb_array_elements(ls.parsed_items_json) it
where jsonb_typeof(ls.parsed_items_json) = 'array'
group by ls.id, ls.user_id
having count(*) filter (
  where (it->>'value') ~ '^\d+(\.\d+)?\s*[-〜~−–—]\s*\d+(\.\d+)?$'
) > 0
order by ls.id;

-- ---------------------------------------------------------------------------
-- C) raw_text に複数キーワードがあるのに parsed_items が 1 件だけ
--    （ヒューリスティック。調整可）
-- ---------------------------------------------------------------------------
with kw as (
  select unnest(array[
    '中性脂肪', 'HbA1c', 'ヘモグロビン', '総蛋白', '血糖', 'クレアチニン', 'AST', 'ALT'
  ]) as term
),
scored as (
  select
    ls.id,
    ls.user_id,
    ls.status,
    ls.raw_text,
    jsonb_array_length(ls.parsed_items_json) as parsed_len,
    (
      select count(distinct k.term)
      from kw k
      where ls.raw_text is not null
        and position(k.term in ls.raw_text) > 0
    ) as keyword_hits
  from lab_sessions ls
  where coalesce(nullif(trim(ls.raw_text), ''), '') <> ''
    and jsonb_typeof(ls.parsed_items_json) = 'array'
)
select
  id,
  user_id,
  status,
  keyword_hits,
  parsed_len,
  left(raw_text, 200) as raw_text_preview
from scored
where keyword_hits >= 3
  and parsed_len = 1
order by id;

-- ---------------------------------------------------------------------------
-- D) exam_dates_json が ["unknown_date"] のみで、raw_text にキーワードが複数
-- ---------------------------------------------------------------------------
with kw as (
  select unnest(array[
    '中性脂肪', 'HbA1c', 'ヘモグロビン', '総蛋白', '血糖', 'クレアチニン', 'AST', 'ALT'
  ]) as term
)
select
  ls.id,
  ls.user_id,
  ls.status,
  ls.exam_dates_json,
  jsonb_array_length(ls.parsed_items_json) as parsed_len,
  (
    select count(distinct k.term)
    from kw k
    where ls.raw_text is not null
      and position(k.term in ls.raw_text) > 0
  ) as keyword_hits
from lab_sessions ls
where exam_dates_json = '["unknown_date"]'::jsonb
  and coalesce(nullif(trim(ls.raw_text), ''), '') <> ''
  and (
    select count(distinct k.term)
    from kw k
    where position(k.term in ls.raw_text) > 0
  ) >= 2
order by ls.id;

-- ---------------------------------------------------------------------------
-- E) 同一 source_message_id / source_image_id で複数セッション
--    （古い誤読が active のまま等の洗い出し用）
-- ---------------------------------------------------------------------------
-- E1: source_message_id
select
  coalesce(nullif(trim(source_message_id), ''), '(empty)') as source_message_id,
  count(*) as session_count,
  array_agg(id order by created_at) as session_ids,
  array_agg(status order by created_at) as statuses,
  min(created_at) as first_at,
  max(created_at) as last_at
from lab_sessions
group by 1
having count(*) > 1
  and coalesce(nullif(trim(source_message_id), ''), '') <> ''
order by session_count desc, last_at desc;

-- E2: source_image_id
select
  coalesce(nullif(trim(source_image_id), ''), '(empty)') as source_image_id,
  count(*) as session_count,
  array_agg(id order by created_at) as session_ids,
  array_agg(status order by created_at) as statuses,
  min(created_at) as first_at,
  max(created_at) as last_at
from lab_sessions
group by 1
having count(*) > 1
  and coalesce(nullif(trim(source_image_id), ''), '') <> ''
order by session_count desc, last_at desc;

-- ---------------------------------------------------------------------------
-- 参考: 特定 id（例 117–121）の横断サマリ
-- ---------------------------------------------------------------------------
select
  id,
  user_id,
  status,
  print_date,
  exam_dates_json,
  jsonb_array_length(parsed_items_json) as parsed_len,
  coalesce(nullif(trim(source_image_id), ''), '') <> '' as has_source_image_id,
  coalesce(nullif(trim(source_message_id), ''), '') <> '' as has_source_message_id,
  (gemini_raw is not null) as has_gemini_raw,
  (structured_json is not null) as has_structured_json,
  left(coalesce(raw_text, ''), 120) as raw_preview,
  validation_status,
  validation_notes,
  superseded_by_session_id,
  created_at
from lab_sessions
where id in (117, 118, 119, 121)
order by id;
