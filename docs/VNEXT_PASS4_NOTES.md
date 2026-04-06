# VNEXT PASS4

対象:
- 名前記憶の優先参照
- 運動/相談の誤判定ガード
- 血液検査の保存完了前は値を断定しない固定
- 動画の同一メッセージ重複返信防止
- 複数動画を同一チェック回として束ねる入口

主な変更:
- authoritative_profile_service: patient_name / name fallback を追加
- conversation_fact_resolver_service: buildNameReply を追加
- conversation_orchestrator_service:
  - name_question を追加
  - activity_calorie_question を追加
  - meal follow-up の誤発火を抑制
  - 血液検査は保存準備中なら断定せず待機回答
- movement_session_service を新規追加
- input_gateway_service: movement video を session 化
- index.js: suppressReply 対応で重複返信を抑制

DB追加はなし。
