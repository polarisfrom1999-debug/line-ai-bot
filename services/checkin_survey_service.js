'use strict';

const WEEKLY_QUESTIONS = [
  '1週間アンケートです。続けやすさはどうでしたか？',
  'この1週間で一番つまずきやすかった場面は？',
  '来週はどこを整えたいですか？'
];

const MONTHLY_QUESTIONS = [
  '1か月アンケートです。1か月で一番変わったことは？',
  '食事・運動・体調で気になる所は？',
  '次の1か月で意識したいことは？'
];

function buildWeeklyCheckinPrompt(index = 0) {
  return WEEKLY_QUESTIONS[index] || WEEKLY_QUESTIONS[0];
}

function buildMonthlyCheckinPrompt(index = 0) {
  return MONTHLY_QUESTIONS[index] || MONTHLY_QUESTIONS[0];
}

function isWeeklyTrigger(text) {
  return /1週間アンケート|週間アンケート|今週の振り返り|チェックイン/.test(String(text || ''));
}

function isMonthlyTrigger(text) {
  return /1か月アンケート|月間アンケート|今月の振り返り/.test(String(text || ''));
}

function getQuestionList(type) {
  return type === 'monthly' ? MONTHLY_QUESTIONS : WEEKLY_QUESTIONS;
}

function isAnswerLike(text) {
  return Boolean(String(text || '').trim());
}

module.exports = {
  buildWeeklyCheckinPrompt,
  buildMonthlyCheckinPrompt,
  isWeeklyTrigger,
  isMonthlyTrigger,
  getQuestionList,
  isAnswerLike,
  WEEKLY_QUESTIONS,
  MONTHLY_QUESTIONS
};
