'use strict';

/**
 * 中1女子 800m / 1500m（東京都）向けの静的コンテンツ。
 * 大会日程は年度で変わるため「目安の季節」と位置づけのみ。確定日はプロフィールで上書きする想定。
 */

const POSTAL_REFERENCE_NOTE =
  '通信陸上は全中への標準突破指定大会の位置づけ。東京都の女子例として参考標準が示されることがあり（例: 800m 2:15.50、1500m 4:28.00 ※年度で変わるので公式要確認）、「目安の星」として扱います。';

function buildAnnualRoadmapPhases() {
  return [
    { id: 'regional', label: '地域別大会', season: '春〜初夏', note: '身近なステージで感覚を育てる。結果より入り方と立て直し。' },
    { id: 'postal', label: '通信陸上', season: '初夏〜夏', note: POSTAL_REFERENCE_NOTE },
    { id: 'tokyo_inter', label: '東京都総体', season: '夏', note: '都内の大きな集い。ここで得た経験が秋以降の土台になる。' },
    { id: 'zenchu', label: '全中', season: '夏', note: '全国の基準に触れる。出場の有無より、準備の質と学びを資産に。' },
    {
      id: 'tokyo_junior',
      label: '東京ジュニア',
      season: '夏〜秋',
      note: '東京都代表選考につながる重要大会。夏で終わらず「秋にも星がある」感覚を大事にする。',
      emphasis: true
    },
    {
      id: 'tokyo_ms_ekiden',
      label: '東京都中学校駅伝',
      season: '秋〜冬',
      note: '800m/1500mの延長として持久力・苦しい中の姿勢・チーム責任を育てる秋冬の大きな節目。',
      emphasis: true
    },
    { id: 'winter_base', label: '冬期基礎期', season: '冬', note: '派手さより土台。怪我なく積み上げる期間。' },
    { id: 'spring_bridge', label: '翌春への橋渡し', season: '早春', note: '中2以降の都大会・全国基準へ向け、呼吸とリズムを整える。' }
  ];
}

/** 曜日インデックス 0=日 … 6=土 に対応する練習メニュー案（意味づけ付き） */
const WEEKLY_MENU_BLUEPRINT = [
  {
    menu: 'ジョグ 25分＋軽いストライド 6本',
    purpose: '血流と神経の目覚めを優先',
    builds: '疲れにくい脚づくり・ケガ予防の土台',
    keyPoint: 'タイムより「軽さ」と「最後まで形」',
    bridgeHint: '先週の整えジョグが、今日の接地の気持ちよさにつながっているかもしれません。'
  },
  {
    menu: 'インターバル 200m×6（走休 200mジョグ）',
    purpose: 'レース後半の粘りを支える酸素系',
    builds: '苦しくなってもリズムを崩しにくい心拍の慣れ',
    keyPoint: '上がりすぎない入り。3本目以降の「整え直し」',
    bridgeHint: '以前の400mリズム練習が、後半の踏ん張りに効いている感覚を探す。'
  },
  {
    menu: '坂ジョグ＋軽いケイデンス走',
    purpose: '接地の強さと股関節まわりの連動',
    builds: '後半で落ちにくい推進力',
    keyPoint: '坂では前のめりになりすぎない',
    bridgeHint: '坂の日が続くと、平路の中盤が楽に感じることがあります。'
  },
  {
    menu: 'レペ 400m×4（R 3分）',
    purpose: '1500mの中盤〜終盤のペース感覚',
    builds: '「まだ走れる」の残し方',
    keyPoint: '1本目を抑える勇気',
    bridgeHint: '800mの入りの落ち着きが、400mの質にも跳ね返ることがあります。'
  },
  {
    menu: '休足 or 30分超慢跑＋整えストレッチ',
    purpose: '神経系の回復と柔軟性',
    builds: '次の硬い練習に入る前のクッション',
    keyPoint: '「何もしない」ではなく「整える」と捉える',
    bridgeHint: '休みの日ほど、睡眠と食事の質が次の練習の伸びしろになります。'
  },
  {
    menu: 'テンポ走 1000m＋200m×2',
    purpose: 'レーススピード域での姿勢保持',
    builds: '苦しい中でもフォームを守る持久力',
    keyPoint: '腕の振りと呼吸のセット',
    bridgeHint: '駅伝を見据えるなら、今日の「我慢の質」が秋冬の財産になります。'
  },
  {
    menu: '自由ジョグ 35分（起伏ありコース推奨）',
    purpose: '楽しさと探索。地続きの持久',
    builds: '走ることへの好感度',
    keyPoint: '景色やリズムを変えてみる',
    bridgeHint: '東京ジュニア前は、短い刺激より「確実に積み上がった感」を大事に。'
  }
];

function getMenuForDate(isoDate) {
  const d = new Date(`${isoDate}T12:00:00+09:00`);
  if (Number.isNaN(d.getTime())) {
    return WEEKLY_MENU_BLUEPRINT[0];
  }
  return WEEKLY_MENU_BLUEPRINT[d.getDay()];
}

const MONTHLY_DIALOGUE_THEMES = {
  4: { title: '4月：目標と不安', athlete: ['今いちばんの目標は？', '不安に感じていることは？'], parent: ['最近うまく支えられた場面は？', '言いすぎてしまったと感じる場面は？'] },
  5: { title: '5月：試合への準備', athlete: ['次のレースで大事にしたいことは？', '練習で意識している一つは？'], parent: ['応援の仕方で工夫していることは？'] },
  6: { title: '6月：苦しい時の乗り越え方', athlete: ['きつい時、自分を支えている言葉やイメージは？'], parent: ['子どもの「しんどさ」のサインに気づいたことは？'] },
  7: { title: '7月：本番前に大事なこと', athlete: ['睡眠や食事で意識していることは？'], parent: ['生活面で手伝えていることは？'] },
  8: { title: '8月：結果より得たもの', athlete: ['結果より「自分で良かった」と思えることは？'], parent: ['レース後、まず伝えたい一言は？'] },
  9: { title: '9月：秋への切り替え', athlete: ['夏から変えたい一つは？'], parent: ['秋冬に向けて家庭で整えたいことは？'] },
  10: { title: '10月：東京ジュニアへ向けて', athlete: ['東京ジュニアに向けて伸ばしたい力は？'], parent: ['期待と不安、どちらが強いですか？'] },
  11: { title: '11月：駅伝と仲間', athlete: ['チームで大事にしたい関わり方は？'], parent: ['チームの雰囲気で感じたことは？'] },
  12: { title: '12月：冬に持ち帰る力', athlete: ['この冬いちばん育てたい力は？'], parent: ['冬の生活リズムで工夫したいことは？'] },
  1: { title: '1月：基礎期の意味', athlete: ['地味に感じる練習の意味を、自分なりに言うと？'], parent: ['見えにくい成長をどう見守りたいですか？'] },
  2: { title: '2月：春への準備', athlete: ['春に向けて試したいことは？'], parent: ['春に向けて家庭で支えたいことは？'] },
  3: { title: '3月：1年の物語', athlete: ['この1年で自分が誇れる変化は？'], parent: ['親としての変化で感じたことは？'] }
};

function getMonthlyDialogue(month) {
  const m = Number(month);
  if (!Number.isFinite(m) || m < 1 || m > 12) return MONTHLY_DIALOGUE_THEMES[4];
  return MONTHLY_DIALOGUE_THEMES[m] || MONTHLY_DIALOGUE_THEMES[4];
}

module.exports = {
  buildAnnualRoadmapPhases,
  getMenuForDate,
  POSTAL_REFERENCE_NOTE,
  getMonthlyDialogue
};

