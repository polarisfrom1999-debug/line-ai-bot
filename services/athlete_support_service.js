'use strict';

const athleteSupportStoreService = require('./athlete_support_store_service');
const athleteSupportConfigService = require('./athlete_support_config_service');

function normalizeText(value) {
  return String(value || '').trim();
}

function isoTodayTokyo() {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Tokyo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).formatToParts(new Date());
  const y = parts.find((p) => p.type === 'year')?.value;
  const m = parts.find((p) => p.type === 'month')?.value;
  const d = parts.find((p) => p.type === 'day')?.value;
  return `${y}-${m}-${d}`;
}

function tokyoMonthFromIso(isoDate) {
  const d = new Date(`${String(isoDate).slice(0, 10)}T12:00:00+09:00`);
  if (Number.isNaN(d.getTime())) return new Date().getMonth() + 1;
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Tokyo',
    month: 'numeric'
  }).formatToParts(d);
  const m = Number(parts.find((p) => p.type === 'month')?.value);
  return Number.isFinite(m) ? m : 4;
}

function daysBetweenIso(fromIso, toIso) {
  const a = new Date(`${fromIso}T12:00:00+09:00`);
  const b = new Date(`${toIso}T12:00:00+09:00`);
  if (Number.isNaN(a.getTime()) || Number.isNaN(b.getTime())) return null;
  return Math.round((b - a) / (24 * 60 * 60 * 1000));
}

function pickSuccessMoment(condition, training) {
  const mood = normalizeText(condition?.mood);
  const hand = normalizeText(condition?.practiceFeel);
  const rpe = training?.rpe;
  const self = normalizeText(training?.selfComment);
  if (/整|休|休足|軽/.test(self)) {
    return '「整える」を選べたこと自体が、長いシーズンでは大きな強みになります。';
  }
  if (Number(rpe) >= 1 && Number(rpe) <= 6) {
    return '今日は負荷をコントロールできています。伸びしろは「我慢の量」より「質」にあります。';
  }
  if (/きつ|苦|しんど/.test(hand) && /形|リズム|踏ん張/.test(self)) {
    return '苦しい中でもフォームやリズムを意識できた点を、しっかり成功体験として残せます。';
  }
  if (/普通|まあ|そこそこ/.test(mood)) {
    return '大きなハイライトがなくても、「淡々と積む日」が後で効いてきます。';
  }
  return 'ベスト更新だけが勝ちではありません。今日の積み重ねも成長の一部です。';
}

function buildDailyEcho({ condition, training, menu }) {
  const moodLine = condition?.mood ? `気分は「${condition.mood}」として受け止めました。` : '';
  const bodyLine = condition?.bodyFeel ? `体の感じは「${condition.bodyFeel}」。` : '';
  const handLine = condition?.practiceFeel ? `練習の手応えは「${condition.practiceFeel}」。` : '';

  const summary = [moodLine, bodyLine, handLine].filter(Boolean).join('') || '今日の入力、ありがとう。短くても十分です。';

  const meaning = [
    `今日のテーマ: ${menu.purpose}`,
    `育てている力: ${menu.builds}`,
    `見どころ: ${menu.keyPoint}`
  ].join('\n');

  const successMoment = pickSuccessMoment(condition, training);

  const tomorrow =
    '明日は「無理に伸ばさず、一つだけ良くする」を軸にしてみましょう。書けない日があっても大丈夫。また来た時に続ければ大丈夫です。';

  return { summary, meaning, successMoment, tomorrowLine: tomorrow };
}

async function getHome(userId, { date } = {}) {
  const iso = normalizeText(date) || isoTodayTokyo();
  const state = await athleteSupportStoreService.readState(userId);
  const menu = athleteSupportConfigService.getMenuForDate(iso);
  const condition = state.dailyByDate?.[iso] || null;
  const training = state.trainingByDate?.[iso] || null;

  let daysToNext = null;
  if (state.profile?.nextCompetitionDate) {
    daysToNext = daysBetweenIso(iso, state.profile.nextCompetitionDate);
  }

  const echo =
    condition || training
      ? buildDailyEcho({ condition, training, menu })
      : {
          summary: '今日の体と練習の「入口」だけでも大丈夫です。ひとことから始められます。',
          meaning: `${menu.purpose} — ${menu.builds}`,
          successMoment: 'まずは自分のペースで触れてみましょう。',
          tomorrowLine: '書けない日があっても大丈夫。また書きたくなった日にどうぞ。'
        };

  const monthTokyo = tokyoMonthFromIso(iso);

  return {
    date: iso,
    profile: state.profile,
    roadmap: athleteSupportConfigService.buildAnnualRoadmapPhases(),
    menu,
    condition,
    training,
    daysToNextCompetition: daysToNext,
    echo,
    monthlyDialogue: athleteSupportConfigService.getMonthlyDialogue(monthTokyo),
    reassurance: [
      'ひとことだけでも大丈夫',
      '書けない日があっても大丈夫',
      'また書きたくなった日にどうぞ'
    ]
  };
}

async function saveDailyCondition(userId, body = {}) {
  const iso = normalizeText(body.date) || isoTodayTokyo();
  const state = await athleteSupportStoreService.readState(userId);
  state.dailyByDate = state.dailyByDate || {};
  state.dailyByDate[iso] = {
    sleep: normalizeText(body.sleep),
    fatigue: normalizeText(body.fatigue),
    legPain: normalizeText(body.legPain),
    mood: normalizeText(body.mood),
    menstrual: normalizeText(body.menstrual),
    appetite: normalizeText(body.appetite),
    bodyFeel: normalizeText(body.bodyFeel),
    practiceFeel: normalizeText(body.practiceFeel),
    noteShort: normalizeText(body.noteShort).slice(0, 400),
    noteDeep: normalizeText(body.noteDeep).slice(0, 2000),
    updatedAt: new Date().toISOString()
  };
  await athleteSupportStoreService.writeState(userId, state);
  return getHome(userId, { date: iso });
}

async function saveTrainingLog(userId, body = {}) {
  const iso = normalizeText(body.date) || isoTodayTokyo();
  const state = await athleteSupportStoreService.readState(userId);
  state.trainingByDate = state.trainingByDate || {};
  state.trainingByDate[iso] = {
    menu: normalizeText(body.menu).slice(0, 400),
    purpose: normalizeText(body.purpose).slice(0, 400),
    whatItBuilds: normalizeText(body.whatItBuilds).slice(0, 400),
    keyPoint: normalizeText(body.keyPoint).slice(0, 400),
    rpe: body.rpe != null && body.rpe !== '' ? Math.max(0, Math.min(10, Number(body.rpe))) : null,
    selfComment: normalizeText(body.selfComment).slice(0, 2000),
    coachSummary: normalizeText(body.coachSummary).slice(0, 2000),
    updatedAt: new Date().toISOString()
  };
  await athleteSupportStoreService.writeState(userId, state);
  return getHome(userId, { date: iso });
}

async function saveProfile(userId, body = {}) {
  const state = await athleteSupportStoreService.readState(userId);
  state.profile = {
    ...state.profile,
    displayName: normalizeText(body.displayName).slice(0, 60) || state.profile.displayName,
    targetTime800: normalizeText(body.targetTime800).slice(0, 32),
    targetTime1500: normalizeText(body.targetTime1500).slice(0, 32),
    nextCompetitionName: normalizeText(body.nextCompetitionName).slice(0, 120),
    nextCompetitionDate: normalizeText(body.nextCompetitionDate).slice(0, 16),
    currentFocus: normalizeText(body.currentFocus).slice(0, 400)
  };
  await athleteSupportStoreService.writeState(userId, state);
  return getHome(userId, {});
}

module.exports = {
  getHome,
  saveDailyCondition,
  saveTrainingLog,
  saveProfile,
  isoTodayTokyo
};
