# VNEXT PASS6

今回の pass6 では次を優先修正しました。

1. 消費カロリー回答の単一路線化
- activity_calorie_service に、今日の運動記録を集計して返す共通ロジックを追加
- 「運動分だけ」と「1日全体」を同じサービス内で切り分け
- 「内訳」「どっちが正しい」「正しい範囲」も deterministic に回答
- 会話保存時の運動記録は、authoritative profile の体重を優先して kcal を算出

2. 動画返信の冗長さ軽減
- 1本目は短く受ける
- 2本以上そろった時は bundle_compact で1回に要約して返す
- 同じ説明の繰り返しを減らす

変更ファイル:
- services/activity_calorie_service.js
- services/conversation_orchestrator_service.js
- services/movement_session_service.js
