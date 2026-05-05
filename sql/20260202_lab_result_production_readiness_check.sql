-- 本番適用前・直後の最終安全確認（SELECT のみ）
-- 前提: 20260202_lab_result_canonical_schema.sql + seed 適用済み

-- 1) テーブル存在（エラーなければ存在）
select 'lab_item_master' as tbl, count(*)::bigint as n from lab_item_master;
select 'lab_result_items' as tbl, count(*)::bigint as n from lab_result_items;

-- 2) マスタ行数（seed 反映の目安: 20 行台以上）
select count(*) as master_active_count
from lab_item_master
where is_active = true;

-- 3) 直近の正本行（保存パイプが動いていればイメージ送信後に増える）
select
  lri.id,
  lri.user_id,
  lri.lab_session_id,
  lri.normalized_key,
  lri.display_name,
  lri.value_text,
  lri.value_numeric,
  lri.unit,
  lri.observed_date,
  lri.observed_date_status,
  lri.validation_status,
  lri.review_reason,
  lri.created_at
from lab_result_items lri
order by lri.created_at desc
limit 15;

-- 4) lab_sessions と正本の対応（同一セッションに行があるか）
select
  ls.id as lab_session_id,
  ls.user_id,
  ls.status,
  ls.created_at as session_at,
  count(lri.id) as result_item_rows
from lab_sessions ls
left join lab_result_items lri on lri.lab_session_id = ls.id
where ls.created_at > now() - interval '7 days'
group by ls.id, ls.user_id, ls.status, ls.created_at
order by ls.created_at desc
limit 30;

-- 5) validation 内訳（要確認がどれだけ残っているか）
select validation_status, count(*) as n
from lab_result_items
group by 1
order by 1;

-- 6) 未保存セッションの洗い出し（rawはあるのに正本0件）— 手動 backfill 候補
select
  ls.id,
  ls.user_id,
  ls.created_at,
  jsonb_array_length(coalesce(ls.parsed_items_json, '[]'::jsonb)) as parsed_len
from lab_sessions ls
left join lab_result_items lri on lri.lab_session_id = ls.id
where ls.created_at > now() - interval '14 days'
group by ls.id, ls.user_id, ls.created_at, ls.parsed_items_json
having count(lri.id) = 0
  and coalesce(jsonb_array_length(ls.parsed_items_json), 0) > 0
order by ls.created_at desc
limit 20;
