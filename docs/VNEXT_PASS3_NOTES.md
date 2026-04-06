# VNEXT pass3

- authoritative_profile_service を追加
- user_profile_facts のスキーマを追加
- onboarding / inline profile を authoritative profile へ保存
- memory / profile / weight 質問は authoritative profile 優先
- lab_documents を DB 優先で参照
- web bootstrap / me / link confirm は authoritative profile envelope を返す
- records bundle は fallback JSON を返して画面停止を減らす
