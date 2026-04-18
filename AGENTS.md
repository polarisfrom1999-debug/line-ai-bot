# AGENTS.md — ここから。開発エージェント向け

## 絶対に壊さないもの

- 既存の LINE 会話ルート（`index.js` → `chatgpt_conversation_router` → `conversation_orchestrator_service`）と自然文・伴走思想（`docs/kokokara_design_philosophy.md`）。
- 既存 WEB タブ「チャット」「記録」の挙動。新機能は **別タブ・別 API・別データ** で拡張する。

## 新機能: アスリート伴走（中1女子 800m / 1500m・東京都）

**コード名:** `athlete_support`（環境変数 `ENABLE_ATHLETE_SUPPORT_WEB=1` で WEB のみ有効化。既定はオフ）

### 最上位コンセプト（要約）

- 陸上日誌ではなく、**選手・親・トレーナー**の三者伴走（Phase 1 は選手 WEB のみ）。
- **管理ではなく伴走**。書かない日を責めない。書いたら意味が返る。
- **全肯定はしない**が人格否定はしない。気持ちの受け止め＋事実＋次の一手。
- **結果だけで測らない**成功体験（リズム・整える判断・月経下のがんばり等）。
- **女子中学生配慮**（月経・食事・体重はセンシティブ。将来フェーズで権限分離）。

### 大会ロードマップ（必須の流れ）

地域別大会 → 通信陸上（全中標準突破指定・基準は年度で公式確認）→ 東京都総体 → 全中 → **東京ジュニア**（都代表選考に繋がる重要大会）→ **東京都中学校駅伝**（秋冬の育成節目）→ 冬期基礎期 → 翌春への橋渡し

### Phase 実装状況

| Phase | 内容 | 状態 |
|-------|------|------|
| 1 | 選手 WEB: 体調・練習＋意味づけ・ロードマップ・基本コメント・月1ヒント | **実装済**（フラグ ON 時） |
| 2 | 親画面・月1シート・トレーナー基本・親コメント翻訳 | 未 |
| 3 | 月経/食事/体重傾向・血液検査・レース前後対話・成功体験まとめ | 未 |
| 4 | PDF/A4・目標カード等 | 未 |

### 主要ファイル

- `config/feature_flags.js` — `ENABLE_ATHLETE_SUPPORT_WEB`
- `services/athlete_support_config_service.js` — ロードマップ・週メニュー・月次対話テーマ
- `services/athlete_support_store_service.js` — `data/athlete_support/*.json`（ユーザー別・gitignore）
- `services/athlete_support_service.js` — 集約・「返し」文生成（ルールベース）
- `routes/web.js` — `/api/web/athlete-support/*`
- `public/web/index.html` / `app.js` / `app.css` — 「伴走（陸上）」タブ

### 依頼の進め方（この指示書 18 節）

1. 仕様を理解させる → 本 AGENTS と Cursor ユーザー指示を併読。
2. 拡張方針 → 既存を壊さずフラグ・別ストア。
3. 画面 / DB → Phase ごとに PR サイズを抑える。
4. 変更時は **何を壊していないか** をコミット説明に書く。

### 有効化

```bash
set ENABLE_ATHLETE_SUPPORT_WEB=1
npm start
```

WEB に接続後、「伴走（陸上）」タブが表示されます。
