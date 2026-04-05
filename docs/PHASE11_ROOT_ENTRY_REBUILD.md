# Phase 11 Root Entry Rebuild

## 今回の主目的
- `WEB接続コード` の発行と `/web` 接続を、DB の一時保存やメモリ共有に依存しない形へ整理
- LINE 側の入口を `line_entry_gateway_service.js` に集約し、会話ルートより前で確実に処理
- WEB 側は、`自動接続URL` をそのまま開く / 貼るだけで接続できるよう整理

## 変えた考え方
### 以前
- LINE で短いコードを発行
- サーバー側に保存
- `/web` でコード照合
- サーバー再起動やメモリ不一致で `接続コードが見つかりません` が起きうる

### 今回
- LINE で **署名付きの接続コード** を直接発行
- `/web` 側は、そのコードを **検証して接続**
- サーバー内メモリや専用テーブルが無くても成立

## 変更ファイル
- `index.js`
- `routes/web.js`
- `public/web/index.html`
- `public/web/app.js`
- `services/conversation_orchestrator_service.js`
- `services/web_link_command_service.js`
- `services/web_portal_auth_service.js`
- `services/web_token_codec_service.js` (新規)
- `services/line_entry_gateway_service.js` (新規)

## 動作イメージ
1. LINEで `WEB接続コード`
2. LINEが **接続コード** と **自動接続URL** を返す
3. WEBでは
   - URLをそのまま開く
   - または URL 全体を入力欄に貼る
   - または接続コードだけ貼る
4. 接続後は署名付き session token を保存して利用

## 今回の到達点
- WEB接続コードまわりは、入り口から根本設計を整理
- まだ残る本筋は次の2つ
  - 血液検査の strict structured extraction
  - 動画 / 靴底 / フォーム画像の専用入口分離
