# WEB Portal Return Digest Pass (2026-04-03)

## 追加した主な改善
- ホーム / チャット / 記録に「最近増えたこと」を追加
- ホーム / チャット / 記録に「今すぐ1分でできること」を追加
- 相談前に、最近の変化をひとまとまりで見てから入れるように調整
- 相談に入る前の負担を減らすため、1分単位の小さな入口を追加
- chat/send, bootstrap, chat bundle, records bundle に新しい補助データを返すように調整

## 新しい返却データ
- returnDigest
  - headline
  - body
  - bullets[]
  - prompt
  - badge

- microStep
  - label
  - headline
  - body
  - steps[]
  - prompt
  - actionLabel

## 狙い
- 久しぶりに戻った時に「何から見ればよいか」が分かりやすい
- 記録が増えても全部を追わず、最近の変化をひとまとまりで受け取れる
- 深い相談の前に、今すぐできる小さな一歩を持てる
- ホーム / チャット / 記録のどこからでも相談へ入りやすい
