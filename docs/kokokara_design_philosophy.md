# ここから。設計思想（最上位）

## 一本の定義

「ここから。」は健康管理機能の寄せ集めではなく、**人生の伴走 OS** である。

食事・運動・血液検査・動作解析・プロフィール・週間/月間報告・WEB・接続導線はすべて、この思想に従属する。

## 最優先: 会話体験

利用者が触れる **会話としての自然さ** を最優先する。

- 処理の正しさ・分類・記録の整合性は重要だが、**会話の自然さを壊すなら設計が誤り**である。
- 「正しさの押し付け」ではなく **可能性の発見** のための道具である。

## 二層構造（表 / 裏）

| 層 | 役割 |
|----|------|
| **表** | ユーザーに見えるもの。ChatGPT のように自然な短文。まず問いに答える。説明しすぎない。自動返信感を出さない。 |
| **裏** | 食事解析、血液検査の抽出と保存、運動集計、DB、安全分岐、接続・オンボーディングなど。 |

裏の結果を **そのまま表に出さない**。最終的には **自然文生成レイヤー** で言い換え、温度感を載せる（数値・日付は捏造しない）。

### 実装上の「最終一段」

- **オーケストレータ**（`services/conversation_orchestrator_service.js`）が、ユーザー向け本文を組み立てたあと `services/conversation_surface_service.js` の `polishDraftToSurface`（内部で `generateNaturalResponse`）を通す経路を主とする。  
- **ルータ**（`services/chatgpt_conversation_router.js` の `naturalizeResult`）は、上記ですでに自然文化した intent や、`normal`（`buildNormalReply`＝`generateReply` 済み）、`sports_*` などでは **二重に `generateNaturalResponse` を呼ばない**。同一メッセージに対する無駄な API 二重化と、数値の揺れリスクを避けるため。  
- 例外・入口メッセージ（`invalid` / `unsupported`）も定型のまま返す。

## 牛込先生らしさ

ChatGPT の自然さを土台に、**少しだけ**次をにじませる。

- 良い所を先に見る・強み起点  
- 安心させるが押し付けない  
- 必要なときだけ専門性  
- 見てもらえている感じ、人の状態を先に受ける  

「先生の講義」ではなく、**会話の中に溶ける**程度が正解。

## 絵文字

目的は軽さではなく温度感。**0〜2 個**、会話全体で毎回は使わない（目安 3 回に 1 回程度）。

- 推奨: 😊 👍 🍀 🌿  
- 避ける: 🤣 😜、🔥 の多用、連続絵文字  

## 品質の守り方

- `docs/kokokara_quality_rubric.md` と回帰 JSON / `scripts/run_conversation_quality_check.js` を修正のたびに参照する。  
- スコアが下がる変更は避ける。機能追加より体験維持。  

## 関連ドキュメント

- `docs/kokokara_quality_rubric.md` … 評価ルーブリック  
- `docs/blood_test_expected_behavior.md` … 血液検査（検査データ管理）  
- `docs/conversation_good_bad_examples.md` … 会話の良否例  
- `docs/current_known_issues.md` … 既知の論点  
