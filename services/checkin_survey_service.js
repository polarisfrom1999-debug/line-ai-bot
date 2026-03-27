'use strict';

function shouldSuggestWeeklyCheckin(longMemory) {
  return Boolean(longMemory?.trialStartedAt);
}

function buildWeeklyCheckinPrompt() {
  return [
    '1週間アンケートです。',
    '1. 続けやすさはどうでしたか？',
    '2. 一番つまずきやすかった場面は？',
    '3. 来週はどこを整えたいですか？'
  ].join('\n');
}

function buildMonthlyCheckinPrompt() {
  return [
    '1か月アンケートです。',
    '1. 1か月で一番変わったことは？',
    '2. 食事・運動・体調で気になる所は？',
    '3. 次の1か月で意識したいことは？'
  ].join('\n');
}

module.exports = {
  shouldSuggestWeeklyCheckin,
  buildWeeklyCheckinPrompt,
  buildMonthlyCheckinPrompt
};
