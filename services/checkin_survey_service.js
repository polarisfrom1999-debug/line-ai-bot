'use strict';

const WEEKLY_STEPS = { Q1: 'q1', Q2: 'q2', Q3: 'q3', COMPLETE: 'complete' };
const MONTHLY_STEPS = { Q1: 'q1', Q2: 'q2', Q3: 'q3', COMPLETE: 'complete' };

function normalizeText(value) {
  return String(value || '').trim();
}

function isWeeklyCheckinTrigger(text) {
  return /1週間アンケート|週間アンケート|今週の振り返り|チェックイン/.test(normalizeText(text));
}

function isMonthlyCheckinTrigger(text) {
  return /1か月アンケート|1ヶ月アンケート|月間アンケート|今月の振り返り/.test(normalizeText(text));
}

function buildWeeklyQuestion(step) {
  if (step === WEEKLY_STEPS.Q1) return '1週間アンケートです。\n1. この1週間で、一番続けやすかったことは何でしたか？';
  if (step === WEEKLY_STEPS.Q2) return '2. この1週間で、一番つまずきやすかった場面はどこでしたか？';
  if (step === WEEKLY_STEPS.Q3) return '3. 来週はどこを一つだけ整えたいですか？';
  return '1週間アンケートは完了です。';
}

function buildMonthlyQuestion(step) {
  if (step === MONTHLY_STEPS.Q1) return '1か月アンケートです。\n1. この1か月で、一番変わったことは何でしたか？';
  if (step === MONTHLY_STEPS.Q2) return '2. 食事・運動・体調で、今いちばん気になる所はどこですか？';
  if (step === MONTHLY_STEPS.Q3) return '3. 次の1か月で、一つだけ意識したいことは何ですか？';
  return '1か月アンケートは完了です。';
}

function buildWeeklyCompletionAnswer(survey) {
  const answers = survey?.answers || {};
  return [
    '1週間アンケートを受け取りました。',
    `続けやすかったこと: ${answers.q1 || '未入力'}`,
    `つまずきやすかった場面: ${answers.q2 || '未入力'}`,
    `来週の一手: ${answers.q3 || '未入力'}`,
    '来週は全部を変えるより、この一手を大事にしていきましょう。'
  ].join('\n');
}

function buildMonthlyCompletionAnswer(survey) {
  const answers = survey?.answers || {};
  return [
    '1か月アンケートを受け取りました。',
    `一番変わったこと: ${answers.q1 || '未入力'}`,
    `気になる所: ${answers.q2 || '未入力'}`,
    `次の一手: ${answers.q3 || '未入力'}`,
    '全部を一気に変えるより、次の1か月はこの一手を軸に見ていきましょう。'
  ].join('\n');
}

function buildDefaultSurvey(type) {
  return {
    type,
    isActive: true,
    currentStep: 'q1',
    answers: {},
    updatedAt: new Date().toISOString()
  };
}

function advanceStep(currentStep, steps) {
  if (currentStep === steps.Q1) return steps.Q2;
  if (currentStep === steps.Q2) return steps.Q3;
  return steps.COMPLETE;
}

function normalizeSurveyState(survey, type) {
  return survey?.isActive ? survey : buildDefaultSurvey(type);
}

function updateSurveyAnswer(survey, answerText) {
  const step = survey.currentStep;
  return {
    ...survey,
    answers: { ...(survey.answers || {}), [step]: normalizeText(answerText) },
    currentStep: advanceStep(step, survey.type === 'weekly' ? WEEKLY_STEPS : MONTHLY_STEPS),
    updatedAt: new Date().toISOString()
  };
}

module.exports = {
  WEEKLY_STEPS,
  MONTHLY_STEPS,
  isWeeklyCheckinTrigger,
  isMonthlyCheckinTrigger,
  buildWeeklyQuestion,
  buildMonthlyQuestion,
  buildWeeklyCompletionAnswer,
  buildMonthlyCompletionAnswer,
  buildDefaultSurvey,
  normalizeSurveyState,
  updateSurveyAnswer
};
