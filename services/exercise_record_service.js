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

function extractReps(text) {
  const safe = toHalfWidth(text);
  const m = safe.match(/([0-9]+)\s*回/);
  if (!m) return null;
  return Number(m[1]);
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
  if (/腕立て伏せ|腕立て|プッシュアップ/.test(safe)) return 'push_up';
  if (/腹筋|シットアップ/.test(safe)) return 'sit_up';
  if (/スクワット/.test(safe)) return 'squat';
  if (/背筋|バックエクステンション/.test(safe)) return 'back_extension';
  if (/プランク/.test(safe)) return 'plank';
  if (/体幹|体幹トレ|コアトレ/.test(safe)) return 'core_training';
  if (/筋トレ|筋力|ダンベル/.test(safe)) return 'strength';
  if (/ウォーキング|散歩|歩いた/.test(safe)) return 'walking';
  if (/ジョギング/.test(safe) && !/ランニング/.test(safe)) return 'jogging';
  if (/ランニング|全力|スピード|ダッシュ|スプリント|走った|走りました|走る|練習/.test(safe)) return 'running';
  if (/800|1500|８００|１５００/.test(safe) && /m|ｍ|メートル|走/.test(safe)) return 'running';
  if (/ジョギング|ランニング|走/.test(safe)) return 'jogging';
  if (/草むしり|除草/.test(safe)) return 'other_activity';
  if (/縄跳び|エアー.*跳|エアー縄跳び/.test(safe)) return 'other_activity';
  return null;
}

function getDisplayName(kind) {
  if (kind === 'push_up') return '腕立て伏せ';
  if (kind === 'sit_up') return '腹筋';
  if (kind === 'squat') return 'スクワット';
  if (kind === 'back_extension') return '背筋';
  if (kind === 'plank') return 'プランク';
  if (kind === 'core_training') return '体幹トレーニング';
  if (kind === 'walking') return 'ウォーキング';
  if (kind === 'jogging') return 'ジョギング';
  if (kind === 'running') return 'ランニング';
  if (kind === 'strength') return '筋トレ';
  if (kind === 'other_activity') return '運動';
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
  if (kind === 'other_activity') {
    if (m != null) return Math.round(m * 5);
    return Math.round(15 * 5);
  }
  return null;
}

function estimateBodyweightExerciseKcal({ kind, reps, minutes }) {
  const r = reps != null ? Number(reps) : null;
  const m = minutes != null ? Number(minutes) : null;
  if (kind === 'push_up') {
    if (r != null) return Math.round(Math.max(12, r * 0.55));
    if (m != null) return Math.round(m * 5.5);
    return 40;
  }
  if (kind === 'sit_up') {
    if (r != null) return Math.round(Math.max(8, r * 0.45));
    if (m != null) return Math.round(m * 5);
    return 30;
  }
  if (kind === 'squat') {
    if (r != null) return Math.round(Math.max(15, r * 0.6));
    if (m != null) return Math.round(m * 6);
    return 50;
  }
  if (kind === 'back_extension') {
    if (r != null) return Math.round(Math.max(8, r * 0.4));
    if (m != null) return Math.round(m * 4.5);
    return 25;
  }
  if (kind === 'plank') {
    if (m != null) return Math.round(Math.max(5, m * 6.5));
    return 8;
  }
  if (kind === 'core_training') {
    if (m != null) return Math.round(m * 5.5);
    return 40;
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
  const reps = extractReps(safe);
  const trackKm = extractTrackDistanceKm(safe);
  if (trackKm != null) distanceKm = trackKm;

  const weightKg = Number(options.weightKg || 60) || 60;
  const estimatedCalories =
    estimateBodyweightExerciseKcal({ kind, reps, minutes })
    || estimateKcal({ kind, minutes, distanceKm, weightKg });
  if (estimatedCalories == null || !Number.isFinite(estimatedCalories)) return null;

  return {
    type: 'exercise',
    name: (() => {
      if (kind === 'other_activity') {
        if (/草むしり/.test(safe)) return '草むしり';
        if (/縄跳び|エアー/.test(safe)) return '縄跳び';
      }
      return getDisplayName(kind);
    })(),
    exerciseType: kind,
    summary: safe,
    minutes,
    distanceKm: distanceKm != null ? distanceKm : null,
    reps: reps != null ? reps : null,
    steps: null,
    estimatedCalories,
  };
}

function formatEffortLine(record) {
  const name = record?.name || '運動';
  const minutes = record?.minutes != null ? Number(record.minutes) : null;
  const distanceKm = record?.distanceKm != null ? Number(record.distanceKm) : null;
  const reps = record?.reps != null ? Number(record.reps) : null;
  if (minutes != null && Number.isFinite(minutes)) return `${name} ${minutes}分`;
  if (reps != null && Number.isFinite(reps)) return `${name} ${reps}回`;
  if (distanceKm != null && Number.isFinite(distanceKm)) return `${name} ${round1(distanceKm)}km`;
  return name;
}

function buildExerciseLineReply(record, todayBurnTotal) {
  const effort = formatEffortLine(record);
  const once = record?.estimatedCalories != null ? round1(record.estimatedCalories) : null;
  const total = round1(todayBurnTotal || 0);
  const kind = String(record?.exerciseType || '');
  const closing = /push_up|sit_up|squat|plank|core/.test(kind)
    ? '短時間でも積み上がっています。今日はもう「やれた日」で十分です。'
    : '外に出て動けたこと自体が、かなり大きいです。';
  const lines = [
    '🏃‍♂️ 今日の動き、ちゃんと見えています',
    `内容：${effort}`,
    once != null ? `🔥 消費カロリー：約${once} kcal` : '🔥 消費カロリー：不明',
    '',
    '📈 本日の運動消費',
    `🔥 合計：約${total} kcal`,
    '',
    closing,
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
  console.info('[exercise_calorie_detected]', {
    user_id: uid,
    exercise_type: String(record.exerciseType || ''),
    duration_minutes: record.minutes != null ? Number(record.minutes) : null,
    reps: record.reps != null ? Number(record.reps) : null,
    distance_km: record.distanceKm != null ? Number(record.distanceKm) : null,
    estimated_calories: Number(record.estimatedCalories || 0),
  });

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
