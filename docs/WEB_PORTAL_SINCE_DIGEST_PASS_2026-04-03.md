# WEB Portal Since Digest Pass (2026-04-03)

## 目的
- 久しぶりにWEBへ戻った時に、前回から何が増えたかを具体的に見せる
- 「最近増えたこと」の一般表示に加えて、利用者自身の不在時間に対する変化をやさしく再開導線へ変える

## 追加内容
- `since` クエリに対応（bootstrap / home / chat bundle / records bundle）
- `sinceDigest` を返却
- フロントで `lastSeenAt` を保持し、再開時に `since` として送信
- Home / Chat / Records に「前回から動いたこと」カードを追加

## 効果
- 久しぶりの再開がしやすくなる
- 何が変わったのか分からない不安を減らす
- 同時利用や途中離脱後でも、相談の続きに入りやすくなる
