# WEB Portal merge notes (2026-04-03)

このZIPは `kokokara_phase2_profile_lab_meal_full_reflected.zip` を土台に、WEBポータル系の追加実装を再統合した版です。

## 追加・更新の中心
- `/web` 静的フロント
- `/api/web/*` ルーター
- WEB接続コード発行 / 接続セッション
- WEBホーム / チャット / 記録API
- WEBライブ同期 (SSE)
- LINE更新後のWEBキャッシュ無効化
- chat_logs / conversation_summaries を使う会話ログ・要約の追加

## 今回特に合わせ直した点
- 最新ベースの `index.js` に WEB 接続コード導線と WEB ルートを再統合
- `chatgpt_conversation_router.js` で `sourceChannel` を維持
- `conversation_summary_service.js` を、最新の `context_memory_service.js` に合わせて `getLongMemory` ベースでも動くよう調整
- `web_portal_data_service.js` の activity 取得を、最新ベース寄りの `exercise_summary / walking_minutes / estimated_activity_kcal` に調整

## DBで必要なSQL
最低でも以下を適用してください。
- `sql/web_portal_schema.sql`
- `sql/logging_memory_summary.sql`

既に適用済みなら再実行は不要です。
