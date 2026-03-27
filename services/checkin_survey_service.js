'use strict';
const WEEKLY_QUESTIONS=['1週間で一番続けやすかったことは？','1週間で一番つまずきやすかった場面は？','次の1週間で一番整えたい所は？'];
const MONTHLY_QUESTIONS=['1か月で一番変わったことは？','食事・運動・体調で気になる所は？','次の1か月で意識したいことは？'];
function shouldStartWeekly(text){ return /1週間アンケート|週間アンケート|今週の振り返り|週間振り返り/.test(String(text||'')); }
function shouldStartMonthly(text){ return /1か月アンケート|一か月アンケート|月間アンケート|今月の振り返り|月間振り返り/.test(String(text||'')); }
function buildQuestion(type,index){ const list = type==='monthly' ? MONTHLY_QUESTIONS : WEEKLY_QUESTIONS; return list[index] ? `${index+1}/${list.length}
${list[index]}` : null; }
function buildCompleteMessage(type){ return [`${type==='monthly'?'1か月':'1週間'}アンケートを受け取りました。`,'今回の回答は保存しました。','この内容も今後の伴走に活かします。'].join('
'); }
module.exports = { WEEKLY_QUESTIONS, MONTHLY_QUESTIONS, shouldStartWeekly, shouldStartMonthly, buildQuestion, buildCompleteMessage };
