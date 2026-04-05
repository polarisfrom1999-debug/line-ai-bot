# Phase 12 Root Gateway Rebuild

## 目的
- WEB接続コード発行の入口を一本化する
- /web の接続確認をセッション検証→初期表示の順に整理する
- 血液検査画像の再読みによる値の揺れを減らす
- チャット画面のスクリーンショットを血液検査として誤読しにくくする

## 追加ファイル
- services/input_classifier_service.js
- services/input_gateway_service.js
- services/lab_document_store_service.js
- services/lab_document_ingest_service.js

## 主な変更
- index.js
- services/line_entry_gateway_service.js
- services/web_link_command_service.js
- services/web_token_codec_service.js
- services/conversation_orchestrator_service.js
- services/lab_image_analysis_service.js
- services/image_classification_service.js
- routes/web.js
- public/web/app.js
- public/web/index.html

## 注意
- WEB接続コードは phase12 では `K12-` プレフィックス付きの署名コードです。
- セッショントークンは `S12-` プレフィックス付きです。
- `/web` 側は古い token を先に検証し、無効なら接続画面へ戻します。
- 血液検査は同一画像を同一サーバー内ではハッシュで固定化します。
