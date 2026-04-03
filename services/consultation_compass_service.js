'use strict';

function buildConsultationCompass({ latestInput = '', labState = null } = {}) {
  const text = String(latestInput || '');

  if (labState) {
    return {
      title: '相談の見方',
      shortText: '検査の相談は、気になる項目を一つずつ確認し、必要なら今までの傾向も一緒に見る流れが入りやすいです。',
      guidanceHint: '検査画像の話なら、項目確認と傾向整理の両方を返しやすくします。',
    };
  }

  if (/フォーム|走り|ランニング|投球|ジャンプ|着地|筋トレ|可動域|動画|静止画|リハビリ|スポーツ/.test(text)) {
    return {
      title: '相談の見方',
      shortText: 'スポーツ相談は、種目・目的・痛みの有無から整理すると入りやすいです。',
      guidanceHint: 'スポーツ相談はフォーム・負荷・可動域・安全性の整理を優先します。',
    };
  }

  if (/痛い|しびれ|違和感|腰|膝|股関節/.test(text)) {
    return {
      title: '相談の見方',
      shortText: '体の相談は、部位・いつから・どの動きでつらいか、の順で見ると進めやすいです。',
      guidanceHint: '痛み相談は状態整理を優先します。',
    };
  }

  if (/食事|体重|運動|カロリー/.test(text)) {
    return {
      title: '相談の見方',
      shortText: '記録の相談は、今日のこと一つから整理すると進めやすいです。',
      guidanceHint: '記録は奪わず、自然な会話の中で補助します。',
    };
  }

  return {
    title: '相談の見方',
    shortText: 'いま一番気になること一つからで大丈夫です。',
    guidanceHint: '深い悩みでも入りやすい入口を作ります。',
  };
}

module.exports = { buildConsultationCompass };
