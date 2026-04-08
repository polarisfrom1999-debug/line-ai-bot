# VNEXT PASS9

## 目的
- phase15 の Gemini import 骨格を、既存本流を壊さず追加する。
- 食事 / 血液検査 / 動画解析を共通の import runner で扱えるようにする。
- 既存 `gemini_dispatch_service.js` を画像専用から media 共通へ広げる。

## 新規追加
- services/media_domain_classifier_service.js
- services/gemini_import_orchestrator_service.js
- services/lab_gemini_import_service.js
- services/meal_gemini_import_service.js
- services/movement_gemini_import_service.js
- services/trainer_translation_service.js
- services/supabase_import_store_service.js
- services/gemini_import_runner_service.js
- sql/phase15_gemini_import_core.sql
- docs/README_phase15_gemini_import.md
- docs/simulation_checklist.md

## 差し替え
- services/gemini_dispatch_service.js

## いまの段階
- 追加型の骨格投入。
- まだ index.js 本流切替はしない。
- 次段で lab / meal / movement の各入口へ順次接続する。
