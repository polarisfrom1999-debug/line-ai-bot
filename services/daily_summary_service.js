'use strict';
function buildDailySummary({ records=[], userState={} }){ const meal=records.filter(r=>r.recordType==='meal').length; const weight=records.filter(r=>r.recordType==='weight').length; const exercise=records.filter(r=>r.recordType==='exercise').length; const lab=records.filter(r=>r.recordType==='lab').length; let meaning='今日は大きく崩したというより、今の生活の中で持ちこたえた日として見て大丈夫です。'; if(meal>0&&exercise>0) meaning='今日は食事も動きも少しずつ積み上げられていて、流れはちゃんと作れています。'; else if((userState.gasolineScore||5)<=4) meaning='今日は整えるより、消耗を増やしすぎなかったこと自体に意味がある日でした。'; else if(meal>0) meaning='今日は食事の流れを大きく崩さずに過ごせていて、土台は守れていました。'; return [meaning, `今日の記録: 食事${meal}件 / 体重${weight}件 / 運動${exercise}件 / 検査${lab}件`, '明日は一つだけ、戻しやすい所からで大丈夫です。'].join('
'); }
module.exports = { buildDailySummary };
