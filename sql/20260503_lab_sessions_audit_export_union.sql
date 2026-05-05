-- 監査結果を1結果セットにまとめる（Supabase SQL Editor → 実行 → Download CSV）
-- 列: session_id | suspect_block | sample_detail | print_date | status | user_id
-- DELETE / UPDATE は含まない（SELECT のみ）

WITH kw AS (
  SELECT unnest(array[
    '中性脂肪', 'HbA1c', 'ヘモグロビン', '総蛋白', '血糖', 'クレアチニン', 'AST', 'ALT'
  ]) AS term
),

-- A: exam_dates_json に print_date より未来の YYYY-MM-DD
a AS (
  SELECT
    ls.id AS session_id,
    'A_future_date_in_exam_dates_json'::text AS suspect_block,
    (
      SELECT string_agg(ed.dt, ', ' ORDER BY ed.dt)
      FROM jsonb_array_elements_text(ls.exam_dates_json) AS ed(dt)
      WHERE ed.dt ~ '^\d{4}-\d{2}-\d{2}$'
        AND ed.dt::date > ls.print_date
    ) AS sample_detail,
    ls.print_date,
    ls.status,
    ls.user_id
  FROM lab_sessions ls
  WHERE ls.print_date IS NOT NULL
    AND jsonb_typeof(ls.exam_dates_json) = 'array'
    AND jsonb_array_length(ls.exam_dates_json) > 0
    AND EXISTS (
      SELECT 1
      FROM jsonb_array_elements_text(ls.exam_dates_json) AS ed2(dt2)
      WHERE dt2 ~ '^\d{4}-\d{2}-\d{2}$'
        AND dt2::date > ls.print_date
    )
),

-- B: parsed value が基準範囲っぽい
b AS (
  SELECT
    ls.id AS session_id,
    'B_range_like_value_in_parsed_items'::text AS suspect_block,
    (
      SELECT string_agg(DISTINCT (it->>'value'), ', ' ORDER BY (it->>'value'))
      FROM jsonb_array_elements(ls.parsed_items_json) AS it
      WHERE (it->>'value') IS NOT NULL
        AND (it->>'value') ~ '^\d+(\.\d+)?\s*[-〜~−–—]\s*\d+(\.\d+)?$'
    ) AS sample_detail,
    ls.print_date,
    ls.status,
    ls.user_id
  FROM lab_sessions ls
  WHERE jsonb_typeof(ls.parsed_items_json) = 'array'
    AND jsonb_array_length(ls.parsed_items_json) > 0
    AND EXISTS (
      SELECT 1
      FROM jsonb_array_elements(ls.parsed_items_json) AS it2
      WHERE (it2->>'value') IS NOT NULL
        AND (it2->>'value') ~ '^\d+(\.\d+)?\s*[-〜~−–—]\s*\d+(\.\d+)?$'
    )
),

-- C: raw キーワード >=3 なのに parsed 1 件
c AS (
  SELECT
    ls.id AS session_id,
    'C_raw_multi_keywords_but_one_parsed_item'::text AS suspect_block,
    format(
      'keyword_hits=%s parsed_len=1',
      (
        SELECT count(DISTINCT k.term)::text
        FROM kw k
        WHERE ls.raw_text IS NOT NULL
          AND position(k.term IN ls.raw_text) > 0
      )
    ) AS sample_detail,
    ls.print_date,
    ls.status,
    ls.user_id
  FROM lab_sessions ls
  WHERE coalesce(nullif(trim(ls.raw_text), ''), '') <> ''
    AND jsonb_typeof(ls.parsed_items_json) = 'array'
    AND jsonb_array_length(ls.parsed_items_json) = 1
    AND (
      SELECT count(DISTINCT k.term)
      FROM kw k
      WHERE position(k.term IN ls.raw_text) > 0
    ) >= 3
),

-- D: exam_dates 不明のみ + raw 複数キーワード
d AS (
  SELECT
    ls.id AS session_id,
    'D_unknown_date_only_exam_dates_multi_raw'::text AS suspect_block,
    format(
      'keyword_hits=%s parsed_len=%s',
      (
        SELECT count(DISTINCT k.term)::text
        FROM kw k
        WHERE position(k.term IN ls.raw_text) > 0
      ),
      jsonb_array_length(ls.parsed_items_json)::text
    ) AS sample_detail,
    ls.print_date,
    ls.status,
    ls.user_id
  FROM lab_sessions ls
  WHERE ls.exam_dates_json = '["unknown_date"]'::jsonb
    AND coalesce(nullif(trim(ls.raw_text), ''), '') <> ''
    AND (
      SELECT count(DISTINCT k.term)
      FROM kw k
      WHERE position(k.term IN ls.raw_text) > 0
    ) >= 2
),

-- E1: 同一 source_message_id で複数行（行ごとに peer を列挙）
dup_msg AS (
  SELECT
    trim(source_message_id) AS smid,
    array_agg(ls.id ORDER BY ls.created_at) AS ids,
    array_agg(ls.status ORDER BY ls.created_at) AS st
  FROM lab_sessions ls
  WHERE coalesce(nullif(trim(ls.source_message_id), ''), '') <> ''
  GROUP BY trim(source_message_id)
  HAVING count(*) > 1
),
e_msg AS (
  SELECT
    ls.id AS session_id,
    'E_duplicate_source_message_id'::text AS suspect_block,
    format(
      'source_message_id=%s peer_ids=%s all_ids=%s',
      dm.smid,
      (
        SELECT string_agg(x::text, ',' ORDER BY x)
        FROM unnest(dm.ids) AS x
        WHERE x <> ls.id
      ),
      (
        SELECT string_agg(x::text, ',' ORDER BY x)
        FROM unnest(dm.ids) AS x
      )
    ) AS sample_detail,
    ls.print_date,
    ls.status,
    ls.user_id
  FROM lab_sessions ls
  JOIN dup_msg dm ON trim(ls.source_message_id) = dm.smid
),

-- E2: 同一 source_image_id で複数行
dup_img AS (
  SELECT
    trim(source_image_id) AS sid,
    array_agg(ls.id ORDER BY ls.created_at) AS ids,
    array_agg(ls.status ORDER BY ls.created_at) AS st
  FROM lab_sessions ls
  WHERE coalesce(nullif(trim(ls.source_image_id), ''), '') <> ''
  GROUP BY trim(source_image_id)
  HAVING count(*) > 1
),
e_img AS (
  SELECT
    ls.id AS session_id,
    'E_duplicate_source_image_id'::text AS suspect_block,
    format(
      'source_image_id=%s peers=%s',
      di.sid,
      (
        SELECT string_agg(x::text, ',' ORDER BY x)
        FROM unnest(di.ids) AS x
        WHERE x <> ls.id
      )
    ) AS sample_detail,
    ls.print_date,
    ls.status,
    ls.user_id
  FROM lab_sessions ls
  JOIN dup_img di ON trim(ls.source_image_id) = di.sid
),

combined AS (
  SELECT * FROM a
  UNION ALL
  SELECT * FROM b
  UNION ALL
  SELECT * FROM c
  UNION ALL
  SELECT * FROM d
  UNION ALL
  SELECT * FROM e_msg
  UNION ALL
  SELECT * FROM e_img
)

SELECT *
FROM combined
WHERE 1 = 1
  -- AND session_id IN (116, 117, 118, 119, 121)
ORDER BY session_id, suspect_block;

-- ---------------------------------------------------------------------------
-- 重点 session 116–121 サマリ（別タブで実行可 / 同じ Editor で下だけ実行も可）
-- ---------------------------------------------------------------------------
-- select
--   id as session_id,
--   user_id,
--   status,
--   print_date,
--   exam_dates_json,
--   jsonb_array_length(parsed_items_json) as parsed_len,
--   exam_dates_json = '["unknown_date"]'::jsonb as exam_only_unknown,
--   left(coalesce(raw_text, ''), 200) as raw_preview,
--   coalesce(nullif(trim(source_message_id), ''), '') as source_message_id,
--   coalesce(nullif(trim(source_image_id), ''), '') as source_image_id,
--   (gemini_raw is not null) as has_gemini_raw,
--   (structured_json is not null) as has_structured_json,
--   validation_status,
--   created_at
-- from lab_sessions
-- where id between 116 and 121
-- order by id;
