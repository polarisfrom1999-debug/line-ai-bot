# VNEXT PASS8: Prompt Builder / Gemini Dispatch 実装

## 追加したもの
- services/gemini_dispatch_service.js
- services/meal_extract_prompt_builder_service.js
- services/lab_extract_prompt_builder_service.js
- services/shoe_wear_extract_prompt_builder_service.js
- services/movement_extract_prompt_builder_service.js
- services/shoe_wear_analysis_service.js
- services/movement_still_analysis_service.js

## つないだもの
- meal_analysis_service.js
- lab_structured_extract_service.js
- image_classification_service.js
- input_classifier_service.js
- conversation_orchestrator_service.js

## 目的
- Gemini への指示を domain ごとの prompt builder に分離
- 食事画像 / 血液検査画像を builder + dispatch 経由へ寄せる
- 靴底 / 動作静止画の入口も用意
- rawGeminiPayload と promptVersion を残しやすくする

## 今回の方針
- 利用者は普通に画像や動画を送るだけ
- Backend が input 分類後に domain prompt を作る
- Gemini は JSON を返す
- ChatGPT は保存済み正規化データを元に自然な返答を作る
