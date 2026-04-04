# WEB Portal targeted sync pass (2026-04-03)

## このパスで入れた改善
- sync status に scopeVersions / hint を追加
- cache invalidation 通知に reason / scopes を追加
- フロント側で scope 単位の差分判定を追加
- LINE 同期時に必要な画面だけを更新する targeted refresh を追加
- 入力中の pending sync メッセージを複数更新に対応
- WEB チャット送信後に sync state を即時反映

## 期待される改善
- LINE と WEB を同時に開いているとき、必要以上に広い再取得が減る
- 会話だけ増えたケースで記録画面まで毎回張り替えない
- 記録だけ増えたケースで会話画面の更新を最小化しやすい
- 入力中の相談文を守りながら、あとで差分反映しやすい
