'use strict';

/**
 * services/daily_summary_service.js
 *
 * 役割:
 * - 今日の記録や会話を「意味づけ」として返す
 * - 数字の羅列ではなく、全体像 / 意味 / 明日の一手 を短く返す
 */

function collectDayData(params) {
  const recentMessages = Array.isArray(params.recentMessages) ? params.recentMessages : [];
  const userTexts = recentMessages
    .filter((row) => row.role === 'user')
    .map((row) => String(row.content || ''));

  return {
    mealsMentioned: userTexts.filter((t) => /朝|昼|夜|ごはん|食べ|鍋|パン|卵|サラダ/.test(t)),
    exerciseMentioned: userTexts.filter((t) => /歩い|ジョギング|走|運動|筋トレ/.test(t)),
    weightMentioned: userTexts.filter((t) => /kg|体重|体脂肪/.test(t)),
    fatigueSignals: userTexts.filter((t) => /疲|眠|しんど|だる|余裕ない/.test(t)),
    recoverySignals: userTexts.filter((t) => /休め|眠れ|回復|少し楽|安心/.test(t)),
    emotionalSignals: userTexts.filter((t) => /不安|焦|つら|苦し|落ち込/.test(t))
  };
}

function inferDailyTone(dayData, userState) {
  if ((dayData.fatigueSignals || []).length >= 2 && (dayData.mealsMentioned || []).length >= 1) {
    return 'tired_but_holding';
  }
  if ((dayData.emotionalSignals || []).length >= 2 || (userState && userState.nagiScore <= 3)) {
    return 'overstrained';
  }
  if ((dayData.recoverySignals || []).length >= 1) {
    return 'gentle_recovery';
  }
  if ((dayData.mealsMentioned || []).length === 0 && (dayData.exerciseMentioned || []).length === 0) {
    return 'rhythm_disturbed';
  }
  return 'stable';
}

function inferDailyMeaning(dayData, userState, longMemory) {
  void longMemory;
  if ((dayData.fatigueSignals || []).length >= 2) {
    return '今日は整えるより、消耗を増やさなかったこと自体が大きい日でした。';
  }
  if ((dayData.mealsMentioned || []).length >= 2 && (dayData.exerciseMentioned || []).length >= 1) {
    return '派手ではなくても、生活の土台はちゃんとつながっていました。';
  }
  if ((dayData.weightMentioned || []).length >= 1 && userState && userState.nagiScore <= 4) {
    return '数字に気持ちが引っ張られやすい日でも、戻ってきて見直せている流れはあります。';
  }
  return '今日は大きく崩したというより、今の生活の中で持ちこたえた日として見て大丈夫です。';
}

function buildTomorrowHint(dayData, userState, longMemory) {
  if ((dayData.fatigueSignals || []).length >= 2 || (userState && userState.gasolineScore <= 3)) {
    return '明日はまず、休める所を少し増やすだけで十分です。';
  }
  if (longMemory && Array.isArray(longMemory.bodySignals) && longMemory.bodySignals.some((x) => /むくみ|水分/.test(x))) {
    return '明日は水分を少し意識するだけでも、感覚が変わりやすいです。';
  }
  if ((dayData.mealsMentioned || []).length === 0) {
    return '明日はまず1食だけでも、落ち着いて食べられるとかなり違います。';
  }
  return '明日は一つだけ、食事のリズムを崩しすぎない所を意識できれば十分です。';
}

function composeDailySummaryText({ wholeTone, meaning, tomorrowHint }) {
  const opener = {
    stable: '今日は全体として、土台を大きく崩さずに進められていましたね。',
    tired_but_holding: '今日は疲れがありながらも、流れを切らさずに持ちこたえていましたね。',
    rhythm_disturbed: '今日は量よりも、リズムが少し乱れやすい日だった感じですね。',
    gentle_recovery: '今日は無理に詰め直すより、少し戻していく流れが見えていましたね。',
    overstrained: '今日は気持ちや体の負担が少し強めに出ていた日でしたね。'
  }[wholeTone] || '今日は全体として、今の流れをちゃんと見直せていましたね。';

  return [opener, meaning, tomorrowHint].filter(Boolean).join('\n');
}

async function buildDailySummary(params) {
  const dayData = collectDayData(params || {});
  const wholeTone = inferDailyTone(dayData, (params || {}).userState || {});
  const meaning = inferDailyMeaning(dayData, (params || {}).userState || {}, (params || {}).longMemory || {});
  const tomorrowHint = buildTomorrowHint(dayData, (params || {}).userState || {}, (params || {}).longMemory || {});
  return composeDailySummaryText({ wholeTone, meaning, tomorrowHint });
}

module.exports = {
  buildDailySummary,
  collectDayData,
  inferDailyTone,
  inferDailyMeaning,
  buildTomorrowHint,
  composeDailySummaryText
};
