services/checkin_survey_service.js
'use strict';

const WEEKLY_STEPS = {
  Q1: 'q1',
  Q2: 'q2',
  Q3: 'q3',
  COMPLETE: 'complete'
};

const MONTHLY_STEPS = {
  Q1: 'q1',
  Q2: 'q2',
  Q3: 'q3',
  COMPLETE: 'complete'
};

function normalizeText(value) {
  return String(value || '').trim();
}

function isWeeklyCheckinTrigger(text) {
  const safe = normalizeText(text);
  return /1週間アンケート|週間アンケート|今週の振り返り|チェックイン/.test(safe);
}

function isMonthlyCheckinTrigger(text) {
  const safe = normalizeText(text);
  return /1か月アンケート|1ヶ月アンケート|月間アンケート|今月の振り返り/.test(safe);
}

function buildWeeklyQuestion(step) {
  if (step === WEEKLY_STEPS.Q1) {
    return '1週間アンケートです。\n1. この1週間で、一番続けやすかったことは何でしたか？';
  }

  if (step === WEEKLY_STEPS.Q2) {
    return '2. この1週間で、一番つまずきやすかった場面はどこでしたか？';
  }

  if (step === WEEKLY_STEPS.Q3) {
    return '3. 来週はどこを一つだけ整えたいですか？';
  }

  return '1週間アンケートは完了です。';
}

function buildMonthlyQuestion(step) {
  if (step === MONTHLY_STEPS.Q1) {
    return '1か月アンケートです。\n1. この1か月で、一番変わったことは何でしたか？';
  }

  if (step === MONTHLY_STEPS.Q2) {
    return '2. 食事・運動・体調で、今いちばん気になる所はどこですか？';
  }

  if (step === MONTHLY_STEPS.Q3) {
    return '3. 次の1か月で、一つだけ意識したいことは何ですか？';
  }

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
    `次の1か月で意識したいこと: ${answers.q3 || '未入力'}`,
    '次の1か月も、無理に詰めすぎず整えやすい一手を大事にしていきましょう。'
  ].join('\n');
}

async function maybeHandleWeeklySurvey({ input, contextMemoryService }) {
  const text = normalizeText(input?.rawText || '');
  const shortMemory = await contextMemoryService.getShortMemory(input.userId);
  const survey = await contextMemoryService.getWeeklySurvey(input.userId);
  const surveyState = shortMemory?.weeklySurveyState || {
    isActive: false,
    step: null
  };

  if (!surveyState.isActive && !isWeeklyCheckinTrigger(text)) {
    return { handled: false };
  }

  if (!surveyState.isActive && isWeeklyCheckinTrigger(text)) {
    await contextMemoryService.saveShortMemory(input.userId, {
      weeklySurveyState: {
        isActive: true,
        step: WEEKLY_STEPS.Q1
      }
    });

    await contextMemoryService.saveWeeklySurvey(input.userId, {
      answers: {},
      completed: false
    });

    return {
      handled: true,
      replyText: buildWeeklyQuestion(WEEKLY_STEPS.Q1)
    };
  }

  if (surveyState.step === WEEKLY_STEPS.Q1) {
    await contextMemoryService.saveWeeklySurvey(input.userId, {
      answers: {
        ...(survey.answers || {}),
        q1: text
      }
    });

    await contextMemoryService.saveShortMemory(input.userId, {
      weeklySurveyState: {
        isActive: true,
        step: WEEKLY_STEPS.Q2
      }
    });

    return {
      handled: true,
      replyText: buildWeeklyQuestion(WEEKLY_STEPS.Q2)
    };
  }

  if (surveyState.step === WEEKLY_STEPS.Q2) {
    await contextMemoryService.saveWeeklySurvey(input.userId, {
      answers: {
        ...(survey.answers || {}),
        q1: survey?.answers?.q1 || '',
        q2: text
      }
    });

    await contextMemoryService.saveShortMemory(input.userId, {
      weeklySurveyState: {
        isActive: true,
        step: WEEKLY_STEPS.Q3
      }
    });

    return {
      handled: true,
      replyText: buildWeeklyQuestion(WEEKLY_STEPS.Q3)
    };
  }

  if (surveyState.step === WEEKLY_STEPS.Q3) {
    const completedSurvey = await contextMemoryService.saveWeeklySurvey(input.userId, {
      answers: {
        ...(survey.answers || {}),
        q1: survey?.answers?.q1 || '',
        q2: survey?.answers?.q2 || '',
        q3: text
      },
      completed: true
    });

    await contextMemoryService.saveShortMemory(input.userId, {
      weeklySurveyState: {
        isActive: false,
        step: WEEKLY_STEPS.COMPLETE
      }
    });

    return {
      handled: true,
      replyText: buildWeeklyCompletionAnswer(completedSurvey)
    };
  }

  return { handled: false };
}

async function maybeHandleMonthlySurvey({ input, contextMemoryService }) {
  const text = normalizeText(input?.rawText || '');
  const shortMemory = await contextMemoryService.getShortMemory(input.userId);
  const survey = await contextMemoryService.getMonthlySurvey(input.userId);
  const surveyState = shortMemory?.monthlySurveyState || {
    isActive: false,
    step: null
  };

  if (!surveyState.isActive && !isMonthlyCheckinTrigger(text)) {
    return { handled: false };
  }

  if (!surveyState.isActive && isMonthlyCheckinTrigger(text)) {
    await contextMemoryService.saveShortMemory(input.userId, {
      monthlySurveyState: {
        isActive: true,
        step: MONTHLY_STEPS.Q1
      }
    });

    await contextMemoryService.saveMonthlySurvey(input.userId, {
      answers: {},
      completed: false
    });

    return {
      handled: true,
      replyText: buildMonthlyQuestion(MONTHLY_STEPS.Q1)
    };
  }

  if (surveyState.step === MONTHLY_STEPS.Q1) {
    await contextMemoryService.saveMonthlySurvey(input.userId, {
      answers: {
        ...(survey.answers || {}),
        q1: text
      }
    });

    await contextMemoryService.saveShortMemory(input.userId, {
      monthlySurveyState: {
        isActive: true,
        step: MONTHLY_STEPS.Q2
      }
    });

    return {
      handled: true,
      replyText: buildMonthlyQuestion(MONTHLY_STEPS.Q2)
    };
  }

  if (surveyState.step === MONTHLY_STEPS.Q2) {
    await contextMemoryService.saveMonthlySurvey(input.userId, {
      answers: {
        ...(survey.answers || {}),
        q1: survey?.answers?.q1 || '',
        q2: text
      }
    });

    await contextMemoryService.saveShortMemory(input.userId, {
      monthlySurveyState: {
        isActive: true,
        step: MONTHLY_STEPS.Q3
      }
    });

    return {
      handled: true,
      replyText: buildMonthlyQuestion(MONTHLY_STEPS.Q3)
    };
  }

  if (surveyState.step === MONTHLY_STEPS.Q3) {
    const completedSurvey = await contextMemoryService.saveMonthlySurvey(input.userId, {
      answers: {
        ...(survey.answers || {}),
        q1: survey?.answers?.q1 || '',
        q2: survey?.answers?.q2 || '',
        q3: text
      },
      completed: true
    });

    await contextMemoryService.saveShortMemory(input.userId, {
      monthlySurveyState: {
        isActive: false,
        step: MONTHLY_STEPS.COMPLETE
      }
    });

    return {
      handled: true,
      replyText: buildMonthlyCompletionAnswer(completedSurvey)
    };
  }

  return { handled: false };
}

module.exports = {
  isWeeklyCheckinTrigger,
  isMonthlyCheckinTrigger,
  maybeHandleWeeklySurvey,
  maybeHandleMonthlySurvey
};
