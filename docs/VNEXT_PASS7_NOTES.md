# VNEXT PASS7 NOTES

## 修正内容
- 動画 media 受付を movement_session_service へ接続
- 同じ回の動画質問は通常相談へ落とさず session 優先で返答
- 血液検査の複数画像を短時間の labUploadSession として束ね、2枚目以降の受付文を重複させない

## 変更ファイル
- services/input_gateway_service.js
- services/movement_session_service.js
- services/conversation_orchestrator_service.js
