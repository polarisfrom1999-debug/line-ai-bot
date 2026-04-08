今回の修正ポイント

1. 前回の pass11 ZIP は services/ フォルダの下ではなく直下に入っていたため、
   そのまま展開すると本番の services/ 配下が置き換わらない可能性がありました。
   今回は必ず services/ 配下に入る形へ直しています。

2. 血液検査フローの主な修正
- Gemini の返答JSONが壊れても throw で止めず、空draftへ落とす
- gemini-2.0-flash を使わない
- gemini_import_sessions へ保存する user_id を LINE ID ではなく public.users.id に解決して保存する
- 血液検査画像を受けたら、読取が弱くても pendingLabConfirmation を作る
- 「TGは50」のような修正文だけでも pending draft を育てられる

反映ファイル
- services/conversation_orchestrator_service.js
- services/gemini_import_runner_service.js
- services/gemini_import_orchestrator_service.js
- services/supabase_import_store_service.js
- services/lab_gemini_import_service.js
- services/lab_confirmation_service.js
- services/lab_document_store_service.js

反映後の確認順
1. 血液検査画像を送る
2. 「TGは50」と送る
3. 「はい、このまま保存」と送る
4. 「TGは？」と送る

期待する変化
- 旧い「まだ読み取りが安定していません」固定ではなく、仮確認の返しへ入る
- Gemini の JSON 崩れや一時的なモデル不調でも pending draft は作られる
