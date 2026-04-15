# 導入先と反映方針

## 1. この資料の目的

このファイルは、`kokokara_motion_package` の中身を、既存の「ここから。」本流へ安全に組み込むための導入メモである。

アプリの実行には必須ではないが、どこへ何を置くか、どの順で反映するかを判断しやすくするために用いる。

## 2. GitHub に置く場所

この資料自体は実行ファイルではないため、以下のどちらかでよい。

### 推奨
- `project-root/integration/integration_plan.md`

### 代替
- `project-root/docs/integration/integration_plan.md`

## 3. 必須で反映するファイル

### そのまま GitHub に入れる候補
- `services/motion_analysis_service.js`
- `services/image_processor.js`
- `prompts/motion_analysis_system_prompt.txt`
- `examples/gemini_dispatch_integration_example.js`

## 4. 反映の基本方針

### 方針1: 本流優先
既存の本流コードを壊さない。
全面上書きではなく、差分確認のうえで必要部分だけを統合する。

### 方針2: 疎結合
動作解析機能は専用 service と prompt に閉じ込め、既存の食事解析や会話制御への影響を最小化する。

### 方針3: index.js を肥大化させない
新ロジックは service / util / prompt に分散し、index.js は司令塔のまま維持する。

## 5. 反映順序

### Step 1
`services/image_processor.js` を追加する。

### Step 2
`services/motion_analysis_service.js` を追加する。

### Step 3
`prompts/motion_analysis_system_prompt.txt` を追加する。
既存 repo に `prompts` フォルダがなければ新設する。

### Step 4
`gemini_dispatch_service.js` または類似の dispatch 層から、動作解析 service を呼べるよう分岐を追加する。

### Step 5
ルーティングまたは入力分類で、動作解析対象の画像・動画をこの service に渡す。

## 6. 触り方の注意

- 既存の `index.js` を全面上書きしない
- 既存の `conversation_orchestrator_service.js` を全面上書きしない
- dispatch 層は「追加」にとどめ、既存 meal / lab / chat の流れを壊さない
- 依存追加が必要なら package.json だけ最小変更にする

## 7. 既存コードと統合する時の見方

### 既に似た機能がある場合
- 名前が近い service があってもすぐ置換しない
- まず責務の重複を確認する
- 共通化できる部分だけ抽出する

### 動画処理がまだない場合
- 先に画像フレーム抽出 utility を単独導入し、あとから motion service をつなぐ

### Prompt 管理がない場合
- まず txt ファイルで分離し、将来的に prompt builder へ移行する

## 8. 今回の思想をコードへ反映するポイント

- 最上位思想を system prompt の冒頭へ入れる
- 実装原則を service 内コメントにも残す
- 返答整形で「強み先行」を強制する
- 低 energy 時は出力量を絞る
- 心理推定は問いかけ表現へ変換する

## 9. 実装しないもの

この md は説明用であり、GitHub に入れなくてもアプリは動く。
急ぐ場合は、実装コードと prompt だけを優先して反映してよい。
