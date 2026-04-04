# Stage Entry light tests

## Stage 1 only
### handled expected
- どう使うの？
- 体重ってどう送ればいいの？
- 食事はどう送ればいいの？
- 振り返りってどう見る？
- タイプ変更したい

### legacy expected
- 56.8kg
- 朝: トーストと卵
- グラフ出して

## Stage 2 add symptom
### handled expected
- 痛みの相談って何を書けばいい？
- しびれはどう送れば見てもらえる？
- 違和感がある時はどう伝えればいい？

### legacy expected
- 右膝の内側が3日前から痛い
- 腰から足にしびれがある
- 転んでから強く痛い

## Stage 3 add homecare / sports / competition
### handled expected
- 家で何をしたらいいかわからない
- 練習の相談ってどう送ればいい？
- 大会の日の食事ってどう相談すればいい？

### legacy expected
- 腰ほぐし1分やった
- 今日の練習は400mを5本
- 明日の800mの朝食決めて

## stop immediately
- webhook 401
- 二重返信
- handled なのに無反応
- 記録入力がガイド扱い
- 実症状文が入口help扱い
