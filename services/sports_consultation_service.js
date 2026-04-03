'use strict';

function buildSportsConsultationFrame({ latestInput = '' } = {}) {
  const text = String(latestInput || '');
  if (!/フォーム|走り|ランニング|投球|ジャンプ|着地|筋トレ|可動域|動画|静止画|リハビリ|スポーツ|練習メニュー|栄養|女性特有|生理/.test(text)) {
    return null;
  }

  let focus = 'sports_general';
  if (/動画|静止画|フォーム|走り|投球|ジャンプ|着地/.test(text)) focus = 'movement';
  else if (/リハビリ|痛み|怪我|復帰/.test(text)) focus = 'rehab';
  else if (/筋トレ|可動域|インナー|アウター/.test(text)) focus = 'training';
  else if (/栄養|食事|女性特有|生理/.test(text)) focus = 'nutrition';

  const map = {
    movement: '種目・目的・痛みの有無・動画/静止画の有無で整理すると、フォーム相談に入りやすいです。',
    rehab: '怪我の相談は、部位・診断の有無・いつから・どの動きがつらいかを先に整えると安全です。',
    training: '強化の相談は、種目・狙い・今の弱点・使いたい部位を分けると進めやすいです。',
    nutrition: '栄養の相談は、競技・目標・体重変化・女性特有の悩みの有無を整理すると見やすいです。',
    sports_general: 'スポーツ相談は、種目・目的・痛みの有無から始めると整理しやすいです。',
  };

  return {
    focus,
    title: 'スポーツ相談の入口',
    shortText: map[focus],
    guidanceHint: 'スポーツ相談では診断を断定せず、フォーム・負荷・可動域・安全な次の一歩を整理します。',
  };
}

module.exports = { buildSportsConsultationFrame };
