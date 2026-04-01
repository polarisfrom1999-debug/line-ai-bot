'use strict';

const groups = {
  handled_expected: [
    'どう使うの？',
    '体重ってどう送ればいいの？',
    '食事はどう送ればいいの？',
    '振り返りってどう見る？',
    'タイプ変更したい',
    '痛みの相談って何を書けばいい？',
    '家で何をしたらいいかわからない',
    '練習の相談ってどう送ればいい？',
    '大会の日の食事ってどう相談すればいい？',
  ],
  legacy_expected: [
    '56.8kg',
    '朝: トーストと卵',
    'グラフ出して',
    '右膝の内側が3日前から痛い',
    '腰ほぐし1分やった',
    '今日の練習は400mを5本',
    '明日の800mの朝食決めて',
  ],
  stop_immediately_if: [
    'webhook 401',
    '二重返信',
    'handled なのに無反応',
    '記録入力がガイド扱い',
    '実症状文が symptom_entry_help 扱い',
  ],
};

console.log(JSON.stringify(groups, null, 2));
