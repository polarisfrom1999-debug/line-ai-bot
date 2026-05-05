'use strict';

const labFollowupService = require('./lab_followup_service');
const contextMemoryService = require('./context_memory_service');
const activityLogRepository = require('../repositories/activity_log_repository');
const { supabase } = require('./supabase_service');
const { ensureUser } = require('./user_service');
const dailyEnergyBalanceService = require('./daily_energy_balance_service');

function normalizeText(value) {
  return String(value || '').trim();
}

function toHalfWidth(text) {
  return normalizeText(text).replace(/[０-９．]/g, (s) => String.fromCharCode(s.charCodeAt(0) - 0xFEE0));
}

function round1(value) {
  return Math.round((Number(value || 0) + Number.EPSILON) * 10) / 10;
}

function containsQuestionTone(text) {
  return /[？?]|どう|いくつ|何分|教えて|意味/.test(normalizeText(text));
}

function extractMinutes(text) {
  const safe = toHalfWidth(text);
  const match = safe.match(/([0-9]+(?:\.[0-9]+)?)\s*分/);
  if (!match) return null;
  return Number(match[1]);
}

function extractDistanceKm(text) {
  const safe = toHalfWidth(text);
  const match = safe.match(/([0-9]+(?:\.[0-9]+)?)\s*(?:km|キロ|ｋｍ)/i);
  if (!match) return null;
  return Number(match[1]);
}

/** 800m / 1500m / ８００メートル など */
function extractTrackDistanceKm(text) {
  const safe = toHalfWidth(text);
  const m = safe.match(/([0-9]+(?:\.[0-9]+)?)\s*(?:m|ｍ|メートル)/i);
  if (!m) return null;
  const meters = Number(m[1]);
  if (!Number.isFinite(meters) || meters <= 0) return null;
  return meters / 1000;
}

function detectKind(safe) {
  if (/筋トレ|筋力|ダンベル/.test(safe)) return 'strength';
  if (/ウォーキング|散歩|歩いた/.test(safe)) return 'walking';
  if (/ジョギング/.test(safe) && !/ランニング/.test(safe)) return 'jogging';
  if (/ランニング|全力|スピード|ダッシュ|スプリント|走った|走りました|走る|練習/.test(safe)) return 'running';
  if (/800|1500|８００|１５００/.test(safe) && /m|ｍ|メートル|走/.test(safe)) return 'running';
  if (/ジョギング|ランニング|走/.test(safe)) return 'jogging';
  return null;
}

function getDisplayName(kind) {
  if (kind === 'walking') return 'ウォーキング';
  if (kind === 'jogging') return 'ジョギング';
  if (kind === 'running') return 'ランニング';
  if (kind === 'strength') return '筋トレ';
  return '運動';
}

function estimateKcal({ kind, minutes, distanceKm, weightKg }) {
  const w = Number(weightKg || 60) || 60;
  const m = minutes != null ? Number(minutes) : null;
  const d = distanceKm != null ? Number(distanceKm) : null;

  if (kind === 'walking') {
    if (d != null && Number.isFinite(d)) return Math.round(d * 45 * (w / 60));
    if (m != null) return Math.round(m * 4);
    return Math.round(20 * 4);
  }
  if (kind === 'jogging') {
    if (d != null && Number.isFinite(d)) return Math.round(d * 60 * (w / 60));
    if (m != null) return Math.round(m * 8);
    return Math.round(20 * 8);
  }
  if (kind === 'running') {
    if (d != null && Number.isFinite(d)) return Math.round(d * 60 * (w / 60));
    if (m != null) return Math.round(m * 10);
    return Math.round(20 * 10);
  }
  if (kind === 'strength') {
    if (m != null) return Math.round(m * 6);
    return Math.round(20 * 6);
  }
  return null;
}

/**
 * 運動記録っぽいテキストなら DB 保存用レコードを組み立て（しない場合は null）
 */
function tryParseExerciseRecord(text, options = {}) {
  const safe = normalizeText(text);
  if (!safe) return null;
  if (labFollowupService.normalizeTarget(safe)) return null;
  if (containsQuestionTone(safe)) return null;
  if (/練習メニュー|メニュー.*(考え|教え)|中学生|部活|選手|アドバイス|相談|どうすれば|おすすめ|プラン/.test(safe)) {
    return null;
  }
  if (/痛|できない|出来ない|無理|休む|休みたい|限界|しんど/.test(safe) && !/した|やった|歩いた|走った|できた/.test(safe)) {
    return null;
  }

  const kind = detectKind(safe);
  if (!kind) return null;

  let minutes = extractMinutes(safe);
  let distanceKm = extractDistanceKm(safe);
  const trackKm = extractTrackDistanceKm(safe);
  if (trackKm != null) distanceKm = trackKm;

  const weightKg = Number(options.weightKg || 60) || 60;
  const estimatedCalories = estimateKcal({ kind, minutes, distanceKm, weightKg });
  if (estimatedCalories == null || !Number.isFinite(estimatedCalories)) return null;

  return {
    type: 'exercise',
    name: getDisplayName(kind),
    exerciseType: kind,
    summary: safe,
    minutes,
    distanceKm: distanceKm != null ? distanceKm : null,
    steps: null,
    estimatedCalories,
  };
}

function formatEffortLine(record) {
  const name = record?.name || '運動';
  const minutes = record?.minutes != null ? Number(record.minutes) : null;
  const distanceKm = record?.distanceKm != null ? Number(record.distanceKm) : null;
  if (minutes != null && Number.isFinite(minutes)) return `${name} ${minutes}分`;
  if (distanceKm != null && Number.isFinite(distanceKm)) return `${name} ${round1(distanceKm)}km`;
  return name;
}

function buildExerciseLineReply(record, todayBurnTotal) {
  const effort = formatEffortLine(record);
  const once = record?.estimatedCalories != null ? round1(record.estimatedCalories) : null;
  const total = round1(todayBurnTotal || 0);
  const lines = [
    '🏃‍♂️ 運動を記録しました',
    `内容：${effort}`,
    once != null ? `🔥 消費カロリー：約${once} kcal` : '🔥 消費カロリー：不明',
    '',
    '📈 本日の運動消費',
    `🔥 合計：約${total} kcal`,
    '',
    'いい運動です。無理なく続けましょう。',
  ];
  return lines.join('\n');
}

async function fetchTodayActivityBurnAfterUserId(userId) {
  if (!userId || !supabase) return 0;
  const ymd = contextMemoryService.getTokyoTodayYmd();
  const { startIso, endIso } = dailyEnergyBalanceService.tokyoMealDayRangeIsoFromYmd(ymd);
  if (!startIso || !endIso) return 0;
  const bur = await activityLogRepository.getActivityBurnInRange(userId, startIso, endIso);
  return Number(bur?.totalKcal || 0);
}

/**
 * テキストを運動記録として解釈し activity_logs へ保存し、返答文を返す。
 */
async function recordExerciseFromText(lineUserId, text, options = {}) {
  const uid = String(lineUserId || '').trim();
  const record = tryParseExerciseRecord(text, options);
  if (!record || !uid) return null;

  await contextMemoryService.addDailyRecord(uid, record);
  const user = await ensureUser(supabase, uid, 'Asia/Tokyo');
  const burn = user?.id ? await fetchTodayActivityBurnAfterUserId(user.id) : 0;

  return {
    record,
    replyText: buildExerciseLineReply(record, burn),
  };
}

module.exports = {
  tryParseExerciseRecord,
  buildExerciseLineReply,
  recordExerciseFromText,
  estimateKcal,
};
