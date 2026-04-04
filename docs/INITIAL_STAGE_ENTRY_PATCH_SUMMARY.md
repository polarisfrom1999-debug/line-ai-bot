# 初回 Stage Entry Patch Summary

## 変更したファイル
- `config/feature_flags.js` 新規追加
- `services/conversation_orchestrator_service.js` 更新

## この変更で入ったもの
- Stage1〜3 の入口 help を narrow に先取り
- 体重/食事/summary 実行/実相談は従来の既存フローに残す
- quick reply つきの案内返信
- feature flag で各入口 help の ON/OFF が可能

## 初回でまだ入れていないもの
- symptom core 本体
- homecare core 本体
- sports core 本体
- competition core 本体
- calendar / wearables
