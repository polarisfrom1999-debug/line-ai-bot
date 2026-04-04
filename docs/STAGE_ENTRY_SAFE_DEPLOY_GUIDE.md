
# Stage Entry Safe Deploy Guide

## 目的
Stage1〜3 の入口 help を、安全に manual deploy するための手順です。

## 初期状態
この版では Stage entry guidance が **デフォルトOFF** です。
そのため deploy 直後に既存挙動を壊しにくい構成です。

## 使う環境変数
- ENABLE_STAGE_ENTRY_GUIDANCE
- ENABLE_GUIDANCE_GENERAL
- ENABLE_GUIDANCE_SUMMARY_VIEW
- ENABLE_GUIDANCE_PERSONA
- ENABLE_GUIDANCE_SYMPTOM_ENTRY
- ENABLE_GUIDANCE_HOMECARE_ENTRY
- ENABLE_GUIDANCE_SPORTS_ENTRY
- ENABLE_GUIDANCE_COMPETITION_ENTRY

## 推奨ON順
### Step 1
```
ENABLE_STAGE_ENTRY_GUIDANCE=1
ENABLE_GUIDANCE_GENERAL=1
ENABLE_GUIDANCE_SUMMARY_VIEW=1
ENABLE_GUIDANCE_PERSONA=1
```

### Step 2
```
ENABLE_GUIDANCE_SYMPTOM_ENTRY=1
```

### Step 3
```
ENABLE_GUIDANCE_HOMECARE_ENTRY=1
ENABLE_GUIDANCE_SPORTS_ENTRY=1
ENABLE_GUIDANCE_COMPETITION_ENTRY=1
```

## 軽テスト
### handled されるべき
- どう使うの？
- 体重ってどう送ればいいの？
- 食事はどう送ればいいの？
- 振り返りってどう見る？
- 痛みの相談ってどう書けばいい？
- 家で何をしたらいいかわからない
- 練習の相談ってどう送ればいい？
- 大会の日の食事ってどう相談すればいい？

### 従来どおり残るべき
- 56.8kg
- 朝: トーストと卵
- グラフ出して
- 右膝の内側が3日前から痛い
- 腰ほぐし1分やった
- 今日の練習は400mを5本
- 明日の800mの朝食決めて

## 即停止
- 記録入力がガイド扱いになる
- 実症状文が entry help に吸われる
- 無反応
- 既存挙動が崩れる
