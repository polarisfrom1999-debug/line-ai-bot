# Integrated latest ZIP (pass4)

## これを正として使ってください
この ZIP は pass1 / pass2 / pass3 を一本化した最新版です。
以後はこの ZIP を基準に上書きしてください。

## 先に流す SQL
1. `sql/phase14_lab_document_schema.sql`
2. `db/migrate_user_profile_facts_to_vnext.sql`

## migration SQL の役割
- 旧 `user_profile_facts` が横持ち（preferred_name / goal / age / height_cm / weight_kg / body_fat_pct）の場合は、
  自動で `user_profile_facts_legacy_vnext` に退避します。
- その後、新しい縦持ち `user_profile_facts` を作成します。
- 旧データを `preferredName / goal / age / height / weight / bodyFat` に変換して移します。
- すでに新スキーマなら壊さずそのまま通ります。

## 今回の正規スキーマ
- `public.user_profile_facts`
  - `user_id`
  - `field_key`
  - `field_value`
  - `field_unit`
  - `source_kind`
  - `confidence`
  - `created_at`
  - `updated_at`

## 補足
- 旧テーブルは `user_profile_facts_legacy_vnext` として残るため、ロールバックや目視確認ができます。
- 以後のコードは新しい縦持ちスキーマ前提です。
