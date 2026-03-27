'use strict';

function normalizeText(value) {
  return String(value || '').trim();
}

function collectDayData(params) {
  const messages = Array.isArray(params?.recentMessages) ? params.recentMessages : [];

  const joinedUserText = messages
    .filter((m) => m?.role === 'user')
    .map((m) => normalizeText(m.content))
    .join('\n');

  return {
    mealsMentioned: (joinedUserText.match(/食べた|朝ごはん|昼ごはん|夜ごはん|ラーメン|カレー|卵|味噌汁|寿司/g) || []).length,
    exerciseMentioned: (joinedUserText.match(/歩いた|運動|ジョギング|ランニング|筋トレ|スクワット/g) || []).length,
    weightMentioned: (joinedUserText.match(/体重|kg|キロ|体脂肪/g) || []).length,
    fatigueSignals: (joinedUserText.match(/疲れた|眠い|寝不足|だるい/g) || []).length,
    recoverySignals: (joinedUserText.match(/落ち着いた|安心|大丈夫|休めた/g) || []).length,
    emotionalSignals: (joinedUserText.match(/不安|つらい|しんどい|苦しい/g) || []).length
  };
}

function inferDailyMeaning(dayData, userState, longMemory) {
  if ((dayData.mealsMentioned || 0) > 0 && (dayData.exerciseMentioned || 0) > 0) {
    return '食事も動きも少しずつ積み上げられていて、流れはちゃんと作れています。';
  }

  if ((dayData.fatigueSignals || 0) > 0 || Number(userState?.gasolineScore || 5) <= 4) {
    return '今日は整えるより、消耗を増やしすぎなかったこと自体に意味がある日でした。';
  }

  if ((dayData.mealsMentioned || 0) > 0) {
    return '今日は食事の流れを大きく崩さずに過ごせていて、土台は守れていました。';
  }

  return '今日は大きく崩したというより、今の生活の中で持ちこたえた日として見て大丈夫です。';
}

function buildTomorrowHint(dayData, userState, longMemory) {
  if ((dayData.fatigueSignals || 0) > 0 || Number(userState?.gasolineScore || 5) <= 4) {
    return '明日はまず、無理に詰め直すより休める所を一つ作れれば十分です。';
  }

  if ((dayData.mealsMentioned || 0) > 0) {
    return '明日は一つだけ、食事のリズムを崩しすぎない所を意識できれば十分です。';
  }

  return '明日は一つだけ、戻しやすい所からで大丈夫です。';
}

async function buildDailySummary(params) {
  const dayData = collectDayData(params);
  const meaning = inferDailyMeaning(dayData, params?.userState || {}, params?.longMemory || {});
  const tomorrowHint = buildTomorrowHint(dayData, params?.userState || {}, params?.longMemory || {});

  return [
    meaning,
    tomorrowHint
  ].filter(Boolean).join('\n');
}

module.exports = {
  buildDailySummary
};
