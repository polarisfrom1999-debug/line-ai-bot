# ここから。 phase15 Gemini import 骨格

## 目的
食事 / 血液検査 / 運動解析を、

1. 利用者が送る
2. Gemini が読む
3. raw を保存する
4. thin-normalized を保存する
5. ChatGPT が「ここから。」の言葉に翻訳して返す

という共通骨格へ寄せる。

## 今回のファイル
- `services/media_domain_classifier_service.js`
- `services/gemini_import_orchestrator_service.js`
- `services/lab_gemini_import_service.js`
- `services/meal_gemini_import_service.js`
- `services/movement_gemini_import_service.js`
- `services/trainer_translation_service.js`
- `services/supabase_import_store_service.js`
- `sql/phase15_gemini_import_core.sql`

## 壊さないための進め方
### 先に追加するだけ
- 既存の食事・血液検査・動画ルートを消さない
- 新しい Gemini import レーンを別に追加する
- まず血液検査だけを新レーンへ流す
- 安定したら食事
- 最後に動画

### 推奨差し込み先
- `services/input_gateway_service.js`
- `services/conversation_orchestrator_service.js`
- `services/lab_image_analysis_service.js`
- `services/meal_analysis_service.js`
- `services/movement_video_intake_service.js` またはそれに相当する入口

## 血液検査の理想の流れ
- 画像を1枚または2枚受ける
- `importLabWithGemini()` を呼ぶ
- `gemini_import_sessions` に1件作る
- Gemini raw を `gemini_import_raw_results` に保存
- 照会用の値を `gemini_import_facts` に保存
- 以後 `TGは？` は DB から返す

## 動画解析の理想の流れ
- 動画を同一チェック回としてまとめる
- `importMovementWithGemini()` を呼ぶ
- Gemini の観察を保存する
- `translateMovementToCoachMessage()` で
  「あなたのトレーナーとしての言葉」に翻訳する

## 重要方針
- 重い正規化はしない
- Gemini の値を人間側が作り変えない
- 薄い整理だけ行う
- 画像 / 動画を毎回読み直さない
