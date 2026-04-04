# Homecare Core 初手 deploy

## 目的
家で少し整えたい相談だけを narrow に handled し、既存の記録・summary・smart flow を壊さずに初期完成版ラインへ寄せる。

## ONにする前提
- Stage1〜3 が安定している
- ENABLE_HOMECARE_CORE=1
- ENABLE_SYMPTOM_CORE は必要ならそのまま

## handled する代表入力
- 腰が固まりやすいので家で少しやりたい
- 立ち上がりがつらいので軽めでやりたい
- 膝にやさしいケアをしたい

## legacyに残すもの
- 腰ほぐし1分やった
- 今日の練習は400mを5本
- グラフ出して
- 右膝の内側が3日前から痛い

## 狙い
- 既存 pain_support_service の stretch guidance を再利用
- 実相談だけ一段深く整理して返す
- 実記録や summary 実行経路はそのまま残す
