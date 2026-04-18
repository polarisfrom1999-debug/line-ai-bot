'use strict';

/**
 * データ整合性フェーズ用: 「できない」断定を避け、次の一手を添える。
 * （会話の自然さより信用を優先する再設計方針）
 */

function normalizeText(value) {
  return String(value || '').trim();
}

function softenCantDoStatements(text) {
  let t = String(text || '');
  if (!t) return t;

  const rules = [
    [/修正できません|変更できません|直せません/g, '日付の移動・削除・合計の出し直しはこちらでできます。「昨日の分です」「さっきの食事を削除」と送ってください'],
    [/WEBの記録は見れません|WEBは見れません|ウェブの記録は見れません/g, 'WEBとLINEは同じ保存先を見ています。表示がズレるときは、いまのDBの数値を基準に原因を一緒に切り分けます'],
    [/記録がありません(?!。)/g, 'いま読み直した保存データでは該当がありませんでした'],
    [/読めません|読み取れません/g, 'この画像だけでは数値を確定しきれないので、もう一枚送るか「TGは？」のように項目名を送ってください'],
    [/確認できません|わかりません(?!。)/g, 'いまのデータからは断定せず、次に見る場所を一緒に決めます'],
  ];

  for (const [re, rep] of rules) {
    t = t.replace(re, rep);
  }
  return t;
}

module.exports = {
  softenCantDoStatements,
  normalizeText
};
