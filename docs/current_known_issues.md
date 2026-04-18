# 既知の論点・運用上の注意（随時更新）

## 会話レイヤー（自然文ポリッシュ）

- `services/conversation_surface_service.js` が、有効時のみ裏処理の **下書き** を OpenAI 経由で短文に載せ替える。  
- **既定は無効**（緊急方針）。有効化は **`KOKOKARA_SURFACE_LAYER_ON=1`** のときだけ。`KOKOKARA_SURFACE_LAYER_OFF=1` でも無効のまま。  
- **`OPENAI_API_KEY` が無い**、または上記 ON が無い場合はポリッシュせず下書きのまま返す。  
- ON のときは **1 メッセージあたり追加の API 呼び出し**が発生する（レイテンシ・コストに注意）。  
- `chatgpt_conversation_router` の **第2段 `naturalizeResult`** も、表面レイヤーが OFF のときは **本文を書き換えない**。

## スキップされる下書き

次はポリッシュをかけない（フォーム崩れ・長文潰れ防止）。

- プロフィール入力テンプレ（`名前：` かつ `身長：` を含む長文）  
- 長すぎる下書き（実装上限文字数超）  
- 体質アンケートの「ボタンで選んで」系の定型  

## 自然文レイヤーが通る主なテキスト経路（`conversation_orchestrator_service`）

次は `withSurfaceReply` / `polishReplyMessage` / `polishQuickReplyBundle` のいずれかで下書きを載せ替えたうえで `appendTurn` する想定（キーが無い場合は下書きのまま）。

- オンボーディング、体質アンケート完了・定期チェック結果、会話スタイルFB（クイックリプライはラベル維持で本文のみポリッシュ）  
- 痛みスレッド、ケア優先、あんにゅい、ガイド直指定・ステージ案内、ヘルプ各分岐・一般ヘルプ  
- インライン名乗り、AIタイプ／雰囲気の変更プロンプト・確定文、プラン候補の確定  
- 画像ルート再送・保持切れ、食事アナウンス、画像取得失敗、検査／食事ヒント、画像種類確認、静止画モーション、動画失敗・解析  
- 症状コア・在宅ケアコア（`polishQuickReplyBundle`：本文ポリッシュ後に同ラベルでクイックリプライ再構築）  
- 致命的エラー時のフォールバック（ベストエフォートで `appendTurn` まで行う）  

## 血液検査

- 画像は **Gemini 等の視覚モデル + JSON** に依存。画質・帳票レイアウト・スクショ誤判定で取りこぼしが起き得る。  
- 詳細は `docs/blood_test_expected_behavior.md`。  

## 無料体験・オンボーディング

- 途中でも **質問・プロフィール確認**には先に答える経路を持つ（`onboarding_service.answerDuringOnboarding`）。  
- 「質問出来る」（出の旧字体）など表記ゆれは正規表現で拾うよう随時拡張する。  

## WEB

- 接続コードは `?code=` に加え `connect` / `c`、ハッシュ形式も試行。失敗時は入力欄にコードを残す。  

## 回帰テスト

- `node scripts/run_conversation_quality_check.js`  
- `tests/conversation_regression_cases.json` + `tests/blood_test_regression_cases.json`  
