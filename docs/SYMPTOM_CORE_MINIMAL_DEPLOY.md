# Symptom Core 最小版 deploy メモ

## 追加されたもの
- `ENABLE_SYMPTOM_CORE` フラグ
- 既存 `pain_support_service` を使った症状整理の最小版

## 初期の考え方
- 入口 help はこれまでどおり Stage1〜3 で handled
- 実際の症状相談は `looksLikePainConsultation(text)` に一致したものだけ symptom core へ入る
- それ以外の痛みっぽい短文やしんどさは既存の support state に残る

## ON する時
- `ENABLE_SYMPTOM_CORE=1`

## まず試す入力
- 右膝の内側が3日前から痛い
- 階段でつらい
- しびれはない

## まだ legacy に残るもの
- 56.8kg
- 朝: トーストと卵
- グラフ出して
- 腰ほぐし1分やった
