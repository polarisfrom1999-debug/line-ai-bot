# 血液検査（検査データ管理）の期待挙動

## 方針

- 画像は **検査データの取り込み口** とし、毎回フル OCR に依存しない。
- **1 画像 = 1 レポート**（`lab_reports`）として保存し、`exam_date` をキーに `lab_report_items` へ項目をぶら下げる。
- 構造化が不完全でも、**読めた日付・読めた項目だけ**返し、「途中です」で会話を止めない。

## 安定ラベル

- `intakeKind: blood_test` … 項目が一通り拾えた帳票（単日・推移含む）
- `intakeKind: lab_image` … 取り込み途中・部分読み取りだが検査文脈として保持する状態

`followUpContext.intakeKind` とパネル `panel.intakeKind` に載せ、血液検査フォロー中はヘルプ誘導などに迷い込みにくくする。

## 日付

- **採血日・検査日・受診日** ラベル付きを `exam_date` 決定の最優先とする。
- 分類器の `exam_dates` / 抽出 JSON / `raw_text` から `normalizeDateToken` と `extractExamDateFromBlobText` で補完する。

## フォローアップ

- 「TGは？」→ キャッシュまたは DB の **TG / 中性脂肪** を返す。
- 「前回よりどう？」（項目名なし）→ DB 上の **直近 2 検査日** の主要項目を短く比較。
- 「傾向は？」→ 直近 2 点以上があれば差分・流れを返す（単発しかない場合はその旨を短く）。

## 回帰テスト

- `tests/blood_test_regression_cases.json` … 上記の会話品質・禁止語句をチェックに追加。
- `node scripts/run_conversation_quality_check.js` で `conversation_regression_cases.json` と併せて評価される。
