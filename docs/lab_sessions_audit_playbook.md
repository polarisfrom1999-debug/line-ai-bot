# lab_sessions 棚卸し・再処理プレイブック

目的: 過去に保存された誤読データを**削除せず**特定し、**無効化（supersede）**と**再処理候補**に分類する。  
新規読み取り本流・`exam_dates_json` の設計・session 121 のような改善済み行の構造は変えない。

## やらないこと（合意）

- 過去行をいきなり `DELETE` しない。
- `lab_sessions` の INSERT/UPDATE 本流を壊すマイグレーションを入れない（**NULL 可能な付帯列のみ**追加）。
- follow-up・route・キャッシュ・facility 周りを、この棚卸しの段階では変更しない。
- 画像が残っていないのに数値だけを推測で直さない。

## 1. DB マイグレーション（付帯列）

`sql/20260503_lab_sessions_validation_columns.sql` を適用する。

| 列 | 用途 |
|----|------|
| `validation_status` | 監査ラベル（下記 Enum 案） |
| `validation_notes` | 人間が読める理由（短文） |
| `superseded_by_session_id` | 正とみなす後続セッション id |
| `validation_audited_at` | ラベル付け日時 |

既存行はすべて NULL のままでよい。

### validation_status（提案 Enum）

| 値 | 意味 |
|----|------|
| `ok` | 監査上問題なし |
| `suspect_future_date` | A: print より未来の検査日が `exam_dates_json` に入っている |
| `suspect_range_as_value` | B: 基準範囲が `parsed_items_json.value` に混在 |
| `suspect_single_item_loss` | C: raw に複数項目っぽいのに parsed が極端に少ない |
| `suspect_unknown_date_mismatch` | D: 検査日が unknown のみだが raw は複数項目 |
| `suspect_ocr_value` | 値の桁・妥当性が画像と合わない疑い（例: LDH） |
| `needs_reprocess` | 画像/structured/gemini が残っており再実行可能候補 |
| `needs_manual_review` | 画像なし等、自動補正不可 |
| `superseded` | 後続セッションに置き換え済み（誤読行を履歴として残す） |

複数疑いがある場合は **`validation_notes` に列挙**し、primary は運用で一つ選ぶ。

## 2. 監査 SQL（読み取りのみ）

`sql/20260503_lab_sessions_audit_queries.sql`

- **A**: `print_date` より未来の日付が `exam_dates_json` にある。
- **B**: `parsed_items_json[].value` が基準範囲正規表現に一致。
- **C**: raw にキーワードが複数あるのに `parsed_items_json` が 1 件のみ。
- **D**: `exam_dates_json` が `["unknown_date"]` のみかつ raw に複数キーワード。
- **E**: 同一 `source_message_id` / `source_image_id` で複数セッション。

結果を CSV またはスプレッドシートに落とし、**行単位で validation_status を付ける**。

## 3. 無効化方針（DELETE しない）

1. 誤読と判断した行には `validation_status` を設定し、`validation_notes` に根拠を書く。
2. 正しい後続セッションが判明したら **`superseded_by_session_id`** にその id を入れる。
3. **セッションの `status` 列**を一括で `superseded` 等に変える場合は、**アプリがその status をどう扱うか確認してから**実施する（現状は `active` / `tentative` 中心）。当面は **`validation_status` + `superseded_by_session_id` だけ**でも運用可能。
4. 削除は行わない（監査・再現のため）。

## 4. 再処理方針

| 条件 | 推奨ラベル | 次のアクション |
|------|------------|----------------|
| `source_image_id` または再取得可能な画像があり、`gemini_raw` / `structured_json` が残る | `needs_reprocess` | オフラインで現行パイプラインに再投入するバッチ設計（別タスク） |
| 画像ストレージに原本が無く、テキストのみ | `needs_manual_review` | ユーザーに再送依頼または手入力 |
| すでに新セッションで正しく取り直せている | `superseded` | `superseded_by_session_id` を記録 |

**勝手な数値補正はしない**（特に LDH 213 vs 21 のような桁ずれ）。

## 5. follow-up 参照（将来）

TG／「他の日付は？」は、**`status` が参照対象かつ `validation_status` が `ok` または NULL の最新セッション**だけを見る、としたい。

**このプレイブックの段階ではコード変更しない。**  
棚卸し結果が揃ってから、`lab_session_repository` の取得クエリに条件を足すかどうか判断する。

## 6. 既知の例（メモ）

| session | 観察 |
|---------|------|
| 117 / 118 | 未来日付・基準範囲混入の疑い |
| 119 | raw 8 項目相当だが parsed が極端に少ない（単日落ち） |
| 121 | 改善済み。列日付の画像照合・LDH 単項目は別途確認 |
