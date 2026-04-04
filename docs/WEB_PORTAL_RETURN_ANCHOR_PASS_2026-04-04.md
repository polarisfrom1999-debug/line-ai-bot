# WEB Portal Return Anchor Pass (2026-04-04)

## 追加したもの
- Home / Chat / Records に「戻りやすい形」カードを追加
- `returnAnchor` を bootstrap / home / chat bundle / records bundle / chat send で返却
- 深い悩みや久しぶり利用時に、"何を元に戻ればよいか" を短く示す導線を追加

## 狙い
- 戻ってきた時に「何からやり直せばよいか」で迷いにくくする
- 深い相談の後でも、次回の入り口を軽くする
- LINE/WEB 同時利用時でも、画面の意味づけが増えるようにする

## 実装メモ
- `services/web_portal_data_service.js` に `buildReturnAnchor()` を追加
- `routes/web.js` の `chat/send` に `returnAnchor` を追加
- `public/web/index.html` / `app.js` / `app.css` に表示を追加
