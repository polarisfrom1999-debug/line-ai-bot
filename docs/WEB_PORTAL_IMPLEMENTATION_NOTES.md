最新版ベースへ WEBポータル統合を当てる時は、最低でも sql/web_portal_schema.sql と sql/logging_memory_summary.sql を適用してください。

# WEB Portal Implementation Notes

## Added
- `services/web_portal_auth_service.js`
- `services/web_portal_data_service.js`
- `routes/web.js`
- `public/web/index.html`
- `public/web/app.css`
- `public/web/app.js`
- `sql/web_portal_schema.sql`

## Changed
- `index.js`
- `services/chat_log_service.js`

## LINE side usage
Send `WEB接続コード` in LINE to get a one-time code.

## WEB side usage
Open `/web`, input the one-time code, then use home/chat/records.

## Required DB change
Apply `sql/web_portal_schema.sql` to Supabase before using the WEB portal.

## Optional env
- `WEB_PUBLIC_URL` : full public URL for the web portal (example: `https://your-domain.com/web`)
- `WEB_LINK_CODE_MINUTES` : one-time code lifetime in minutes (default 15)
- `WEB_SESSION_DAYS` : session lifetime in days (default 30)


## Extra improvements in proactive pass
- Added `/api/web/bootstrap` to reduce initial request count and smooth first render.
- Added `/api/web/records/overview` for lighter record summary cards.
- Added cleanup of expired codes/sessions on auth flow.
- Improved WEB UI with status strip, quick actions, starter prompts, refresh button, and post-chat home refresh.

## Extra improvements in usability pass
- Reused `home` data to build sidebar and bootstrap payload, reducing duplicate summary work and request load.
- Added dynamic starter prompts based on missing records and latest trends.
- Added record range switching (`7d / 30d / 90d`) for lighter browsing.
- Added session expiry / last updated hint in the sidebar.
- Added friendlier auth-expiry handling: expired sessions now return users to the connect screen instead of leaving the UI half-broken.
- Added record overview trend chip for recent weight movement.
- Added persistence of last selected WEB view, record tab, and range in localStorage.
- On chat send, the UI now restores the draft on failure and refreshes chat history/home/sidebar together on success.

## Extra improvements in stability pass
- Added lightweight in-memory caching for home / sidebar / bootstrap / records overview / recent chat history to reduce repeated summary generation and duplicate Supabase reads.
- Invalidated the WEB portal cache immediately after a successful chat turn so the next home/sidebar snapshot reflects the latest conversation without reloading everything twice.
- Reduced `/api/web/chat/send` response weight by returning the latest assistant message directly instead of re-fetching the full recent history on every send.
- Throttled expired-code/session cleanup so auth checks do not hit cleanup queries on every request.
- Added basic confirm-attempt protection for repeated code verification failures.
- Improved code input UX by accepting the common `ABCD-1234` style without forcing users to remove the hyphen.
- Added local draft persistence, auto-resizing chat input, and disabled-send behavior for empty messages.
- Added small input guidance and focus styling to make the WEB chat easier to use on first launch.


## 追加改良: LINE / WEB 同時利用の追従強化
- `/api/web/sync/status` を追加し、LINE側更新をWEBが約12秒間隔で追従できるようにした
- LINE webhook 処理後に WEB キャッシュを自動無効化し、同一利用者のホーム / 記録 / 補助カードの遅れを減らした
- ホームに「相談の入口」カードを追加し、深い悩みへ自然につながる導線を強化した

## Extra improvements in empathy/depth pass
- Added personalized consult lanes on Home / Chat / Records so users can enter deeper conversations from “anxiety”, “causes”, “body changes”, and “one next step”.
- Added a recent timeline that blends chat, meals, weight, labs, and activity into one readable flow so WEB feels like a place to look back calmly.
- Improved simultaneous LINE+WEB use: if LINE updates arrive while the user is typing in WEB chat, the WEB portal now defers the refresh and protects the draft instead of abruptly replacing the screen.
- After the draft is sent or cleared, deferred sync is applied automatically.


## 追加改善（継続利用・相談深度パス）
- ホームに「続けられていること」「小さな前進」を追加
- 相談画面に「今の相談の見方」「次に聞きやすいこと」を追加
- 相談後に、受け止め / 見方 / 次の一歩 を整理して返す導線を追加
- 直近14日の接点から、継続利用の流れをやさしく見せるスナップショットを追加


## 追加改善（最新パス）
- EventSource を使ったライブ同期を追加しました。LINE 側の更新で WEB キャッシュを無効化した際、WEB が待ち時間少なく追従しやすくなります。
- ホームに「今の進め方」カードを追加しました。深い悩みでも、いきなり全部を整理しなくてよい入口として使えます。
