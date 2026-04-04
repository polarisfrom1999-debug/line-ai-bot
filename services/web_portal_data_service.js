'use strict';

const { supabase } = require('./supabase_service');
const { buildDailySummary } = require('./daily_summary_service');
const realtimeService = require('./web_portal_realtime_service');

function normalizeText(value) {
  return String(value || '').trim();
}

function normalizeIsoCandidate(value) {
  const safe = normalizeText(value);
  if (!safe) return null;
  const time = Date.parse(safe);
  return Number.isFinite(time) ? new Date(time).toISOString() : null;
}

function tokyoNow() {
  return new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Tokyo' }));
}

const dataCache = new Map();
const DEFAULT_CACHE_TTL_MS = Number(process.env.WEB_PORTAL_CACHE_TTL_MS || 60 * 1000);
const HISTORY_CACHE_TTL_MS = Number(process.env.WEB_PORTAL_HISTORY_CACHE_TTL_MS || 15 * 1000);
const SYNC_CACHE_TTL_MS = Number(process.env.WEB_PORTAL_SYNC_CACHE_TTL_MS || 8 * 1000);

function buildCacheKey(prefix, userId, extra = '') {
  return `${prefix}:${userId || 'anonymous'}:${extra}`;
}

async function withCache(key, ttlMs, producer) {
  const hit = dataCache.get(key);
  const nowTs = Date.now();
  if (hit && hit.expiresAt > nowTs) return hit.value;
  const value = await producer();
  dataCache.set(key, { value, expiresAt: nowTs + ttlMs });
  return value;
}

function normalizeScopes(scopes = {}) {
  const safe = {
    chat: true,
    records: true,
    home: true
  };
  if (scopes && typeof scopes === 'object') {
    if (Object.prototype.hasOwnProperty.call(scopes, 'chat')) safe.chat = Boolean(scopes.chat);
    if (Object.prototype.hasOwnProperty.call(scopes, 'records')) safe.records = Boolean(scopes.records);
    if (Object.prototype.hasOwnProperty.call(scopes, 'home')) safe.home = Boolean(scopes.home);
  }
  return safe;
}

function invalidateUserCache(userId, options = {}) {
  const safeUserId = normalizeText(userId);
  if (!safeUserId) return;
  const reason = normalizeText(options.reason || 'invalidate') || 'invalidate';
  const scopes = normalizeScopes(options.scopes || {});
  for (const key of dataCache.keys()) {
    if (key.includes(`:${safeUserId}:`)) dataCache.delete(key);
  }
  realtimeService.notifyUser(safeUserId, { userId: safeUserId, reason, scopes, eventName: 'sync' });
}

function dateYmdInTokyo(date = new Date()) {
  const parts = new Intl.DateTimeFormat('sv-SE', {
    timeZone: 'Asia/Tokyo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).formatToParts(date);
  const map = {};
  for (const part of parts) map[part.type] = part.value;
  return `${map.year}-${map.month}-${map.day}`;
}

function isoRangeForTokyoDay(dateYmd) {
  return {
    start: `${dateYmd}T00:00:00+09:00`,
    end: `${dateYmd}T23:59:59+09:00`
  };
}

function clampDays(days, fallback = 30) {
  const n = Number(days);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(7, Math.min(180, Math.round(n)));
}

function rangeToDays(range = '30d') {
  const matched = String(range || '').match(/^(\d+)d$/);
  return clampDays(matched ? matched[1] : 30, 30);
}

function todayYmdMinusDays(days) {
  const base = tokyoNow();
  base.setDate(base.getDate() - clampDays(days, 0));
  return dateYmdInTokyo(base);
}

function classifyMealSlot(isoText) {
  const date = new Date(isoText);
  const hourText = new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Tokyo', hour: '2-digit', hour12: false }).format(date);
  const hour = Number(hourText);
  if (hour < 11) return 'breakfast';
  if (hour < 15) return 'lunch';
  return 'dinner';
}

function formatMealSummary(row) {
  const label = normalizeText(row?.meal_label || '食事');
  const items = Array.isArray(row?.food_items) ? row.food_items : [];
  const itemText = items
    .map((item) => normalizeText(typeof item === 'string' ? item : item?.name || item?.label || item?.food || ''))
    .filter(Boolean)
    .join('、');
  return itemText ? `${label}: ${itemText}` : label;
}

function buildMealRecordForSummary(row) {
  return {
    summary: formatMealSummary(row),
    kcal: Number(row?.estimated_kcal || 0) || 0,
    protein: Number(row?.protein_g || 0) || 0,
    fat: Number(row?.fat_g || 0) || 0,
    carbs: Number(row?.carbs_g || 0) || 0
  };
}

function buildWeightSummary(row) {
  if (!row) return null;
  const parts = [];
  if (row.weight_kg != null) parts.push(`${row.weight_kg}kg`);
  if (row.body_fat_pct != null) parts.push(`体脂肪 ${row.body_fat_pct}%`);
  return {
    summary: parts.join(' / ') || '体重記録あり',
    weight: row.weight_kg != null ? Number(row.weight_kg) : null,
    bodyFat: row.body_fat_pct != null ? Number(row.body_fat_pct) : null
  };
}

function buildLabItems(row) {
  if (!row) return [];
  const mapping = [
    ['HbA1c', row.hba1c],
    ['血糖', row.fasting_glucose],
    ['LDL', row.ldl],
    ['HDL', row.hdl],
    ['中性脂肪', row.triglycerides],
    ['AST', row.ast],
    ['ALT', row.alt],
    ['γ-GTP', row.ggt],
    ['尿酸', row.uric_acid],
    ['クレアチニン', row.creatinine]
  ];
  return mapping
    .filter(([, value]) => value != null)
    .map(([itemName, value]) => ({ itemName, value: String(value), unit: '' }));
}

function dayDiffFromTokyoYmd(dateText) {
  if (!dateText) return null;
  const base = new Date(`${dateYmdInTokyo()}T00:00:00+09:00`).getTime();
  const target = new Date(`${String(dateText).slice(0, 10)}T00:00:00+09:00`).getTime();
  return Math.round((base - target) / (24 * 60 * 60 * 1000));
}

function computeWeightDelta(series = [], days = 7) {
  const usable = series.filter((row) => row?.value != null);
  if (usable.length < 2) return null;
  const latest = usable[usable.length - 1];
  let reference = null;
  for (let i = usable.length - 2; i >= 0; i -= 1) {
    const diff = dayDiffFromTokyoYmd(usable[i].date);
    if (diff != null && diff >= days) {
      reference = usable[i];
      break;
    }
  }
  if (!reference) reference = usable[0];
  if (reference === latest || reference?.value == null || latest?.value == null) return null;
  const delta = Number((latest.value - reference.value).toFixed(1));
  return {
    days,
    delta,
    direction: delta > 0 ? 'up' : delta < 0 ? 'down' : 'flat',
    fromDate: reference.date,
    toDate: latest.date
  };
}


function buildIsoRangeSinceDays(days = 14) {
  const since = tokyoNow();
  since.setDate(since.getDate() - (clampDays(days, 14) - 1));
  return since.toISOString();
}

function ymdFromIso(value) {
  return value ? String(value).slice(0, 10) : '';
}

async function getEngagementSnapshot(userId, days = 14) {
  const sinceIso = buildIsoRangeSinceDays(days);
  const [chatRows, mealRows, weightRows, activityRows] = await Promise.all([
    safeSelect(() => supabase.from('chat_logs').select('created_at').eq('user_id', userId).gte('created_at', sinceIso).order('created_at', { ascending: false }).limit(60), []),
    safeSelect(() => supabase.from('meal_logs').select('eaten_at').eq('user_id', userId).gte('eaten_at', sinceIso).order('eaten_at', { ascending: false }).limit(60), []),
    safeSelect(() => supabase.from('weight_logs').select('logged_at').eq('user_id', userId).gte('logged_at', sinceIso).order('logged_at', { ascending: false }).limit(40), []),
    safeSelect(() => supabase.from('activity_logs').select('logged_at').eq('user_id', userId).gte('logged_at', sinceIso).order('logged_at', { ascending: false }).limit(40), [])
  ]);

  const daySet = new Set();
  let recentEvents = 0;
  for (const row of chatRows || []) {
    const day = ymdFromIso(row.created_at);
    if (day) daySet.add(day);
    recentEvents += 1;
  }
  for (const row of mealRows || []) {
    const day = ymdFromIso(row.eaten_at);
    if (day) daySet.add(day);
    recentEvents += 1;
  }
  for (const row of weightRows || []) {
    const day = ymdFromIso(row.logged_at);
    if (day) daySet.add(day);
    recentEvents += 1;
  }
  for (const row of activityRows || []) {
    const day = ymdFromIso(row.logged_at);
    if (day) daySet.add(day);
    recentEvents += 1;
  }

  let streakDays = 0;
  for (let i = 0; i < days; i += 1) {
    const day = todayYmdMinusDays(i);
    if (!daySet.has(day)) break;
    streakDays += 1;
  }

  let touchDays7 = 0;
  for (let i = 0; i < 7; i += 1) {
    if (daySet.has(todayYmdMinusDays(i))) touchDays7 += 1;
  }

  return {
    streakDays,
    touchDays7,
    touchDays14: daySet.size,
    recentEvents,
    activeToday: daySet.has(dateYmdInTokyo())
  };
}

function buildProgressSnapshot(home = {}, overview = {}, engagement = {}) {
  const streakDays = Number(engagement.streakDays || 0);
  const touchDays7 = Number(engagement.touchDays7 || 0);
  let headline = '今日はここから整えていけます';
  let body = '少しずつでも接点があること自体が、流れを戻す土台になります。';

  if (streakDays >= 7) {
    headline = `今の流れは${streakDays}日つながっています`;
    body = '完璧さより、途切れず戻って来られていることが強みです。';
  } else if (streakDays >= 3) {
    headline = `${streakDays}日続けて流れを保てています`;
    body = '勢いを上げるより、今の続け方を守ると安定しやすいです。';
  } else if (touchDays7 >= 4) {
    headline = '今週は何度も立ち戻れています';
    body = '毎日完璧でなくても、戻って来られていることが前進です。';
  } else if (home.alerts?.length) {
    headline = '今日は整え直す入口が見えています';
    body = '崩れを責めるより、どこから立て直すかに意識を向ける方が合っています。';
  }

  return {
    headline,
    body,
    streakDays,
    touchDays7,
    recentEvents: Number(engagement.recentEvents || 0),
    badge: streakDays >= 5 ? '続けられている流れ' : touchDays7 >= 4 ? '戻って来られている流れ' : 'ここから整える日'
  };
}

function buildSmallWins(home = {}, overview = {}, engagement = {}) {
  const wins = [];
  const push = (text) => {
    const safe = normalizeText(text);
    if (!safe || wins.includes(safe)) return;
    wins.push(safe);
  };

  if (home.mealStatus?.breakfast || home.mealStatus?.lunch || home.mealStatus?.dinner) {
    const count = ['breakfast', 'lunch', 'dinner'].filter((key) => home.mealStatus?.[key]).length;
    push(`今日は食事記録が${count}回あり、流れを見返せる土台があります。`);
  }
  if (home.weightStatus?.recordedToday) push('今日は体重の現在地を確認できています。');
  if (Number(home.activityCountToday || 0) > 0) push(`今日は運動や活動の記録が${home.activityCountToday}件あります。`);
  if ((engagement.streakDays || 0) >= 2) push(`${engagement.streakDays}日続けて戻って来られているのは、大きな前進です。`);
  if (overview.weightTrend?.direction === 'flat') push('体重は大きく崩れず、流れとしては落ち着いています。');
  if (overview.latestLabDate) push('血液検査も含めて、点ではなく流れで見られる状態に近づいています。');
  if (!wins.length) push('今日はここから一つ整えるだけでも十分です。');
  return wins.slice(0, 3);
}

function buildReassuranceNote(home = {}, overview = {}, engagement = {}) {
  if ((engagement.streakDays || 0) >= 5) {
    return '続けて触れられていること自体が、もう十分に良い流れです。今日は増やすより守る視点で大丈夫です。';
  }
  if ((home.alerts || []).some((item) => /疲れ|不調/.test(item))) {
    return '不調がある日は、前に進むことより負担を増やさない見方が合います。整える相談で十分です。';
  }
  if (overview.weightTrend?.direction === 'up') {
    return '体重の増え方は、短期の揺れと生活の流れを分けて見ると必要以上に不安になりにくくなります。';
  }
  if (overview.latestLabDate) {
    return '血液検査は数字の良し悪しだけでなく、生活の流れと一緒に見ると安心につながりやすいです。';
  }
  return '記録や相談が少ない日があっても大丈夫です。戻って来た時点から、また流れは作り直せます。';
}


function buildActionPlan(home = {}, overview = {}, engagement = {}) {
  const steps = [];
  const push = (slot, title, body, prompt) => {
    const safeTitle = normalizeText(title);
    const safeBody = normalizeText(body);
    const safePrompt = normalizeText(prompt);
    if (!safeTitle || !safeBody || steps.some((item) => item.slot === slot)) return;
    steps.push({ slot, title: safeTitle, body: safeBody, prompt: safePrompt });
  };

  if ((home.alerts || []).some((item) => /疲れ|不調/.test(item))) {
    push('今', 'まずは負担を増やさない', '今日は整えることを優先し、頑張り方を増やさない見方が合っています。', '今日は休み方も含めて、どう整えるのがよさそう？');
  } else if (home.mealStatus && !home.mealStatus.breakfast && !home.mealStatus.lunch && !home.mealStatus.dinner) {
    push('今', '食事を一回だけ整える', '全部を整えようとせず、まず一回ぶんの食事をどう作るかだけで十分です。', '今日は食事が少ないけど、まず一回ぶんをどう整えればいい？');
  } else {
    push('今', '今日いちばん効く一点を決める', '今の流れを大きく変えるより、いちばん効く一点だけ絞ると続きやすくなります。', '今日いちばん効く一歩を一つだけ決めて。');
  }

  if (overview.weightTrend?.direction === 'up') {
    push('このあと', '体重は揺れと流れを分けて見る', '短期の増え方だけで判断せず、食事や疲れとの関係まで含めて見ると落ち着きやすいです。', '最近の体重の上がり方を、生活の流れと一緒に整理して。');
  } else if (overview.latestLabDate) {
    push('このあと', '検査結果を安心につなげる', '数値だけでなく、最近の生活の流れまで含めると受け止めやすくなります。', '血液検査の最新結果を、生活の流れと一緒にやさしく見て。');
  } else {
    push('このあと', '今の流れをやさしく整理する', '食事・体重・疲れを分けて見ると、必要以上に責めずに整理しやすくなります。', '最近の流れを、責めない形でやさしく整理して。');
  }

  if ((engagement.streakDays || 0) >= 3) {
    push('覚えておくこと', '続けられている流れを守る', '新しいことを増やすより、戻って来られている今の流れを守る方が長く続きます。', '今の続け方で十分か、無理がないか見て。');
  } else {
    push('覚えておくこと', '戻って来られた時点で十分', '記録や相談が空いた日があっても、戻って来られた時点から流れは作り直せます。', '空いてしまった日も含めて、ここからどう整えるといい？');
  }

  return steps.slice(0, 3);
}

function buildSupportMode(home = {}, overview = {}, engagement = {}, timeline = []) {
  const recentKinds = Array.isArray(timeline) ? timeline.map((item) => normalizeText(item.kind || item.type || '')) : [];
  const alertText = (home.alerts || []).join(' / ');
  const streakDays = Number(engagement.streakDays || 0);
  let tone = 'steady';
  let label = '今日は整えるモード';
  let headline = '全部を進めるより、いまの流れを整える見方が合っています。';
  let body = 'まず一つだけ整えると、相談もしやすくなります。';
  let prompt = '今日は無理を増やさず、どこから整えるとよさそう？';
  const signals = [];

  if (/疲れ|不調|しんど|痛/.test(alertText)) {
    tone = 'rest';
    label = '今日は休みも大事なモード';
    headline = '前に進むことより、負担を増やさないことを優先して大丈夫です。';
    body = 'しんどさがある日は、整える相談だけでも十分意味があります。';
    prompt = '今日は休み方も含めて、どう整えるのがよさそう？';
    signals.push('不調や疲れのサインがあります');
  } else if ((home.mealStatus && !home.mealStatus.breakfast && !home.mealStatus.lunch && !home.mealStatus.dinner) || /食事/.test(alertText)) {
    tone = 'steady';
    label = '今日は立て直しモード';
    headline = '流れを責めるより、今日ここから一回整える見方が合っています。';
    body = '食事や生活リズムを一つだけ立て直す相談にすると進めやすいです。';
    prompt = '今日はどの一回を整えると流れが戻りやすい？';
    signals.push('食事や生活リズムを整える余地があります');
  } else if (streakDays >= 4 && !/体重/.test(alertText) && !/運動/.test(alertText)) {
    tone = 'forward';
    label = '今日は守りながら進めるモード';
    headline = '今の流れを守りつつ、小さく前へ進める日です。';
    body = '増やしすぎず、いまの続け方を土台に一歩だけ足すと安定しやすいです。';
    prompt = '今の流れを守りながら、今日足すなら何がよさそう？';
    signals.push(`${streakDays}日つながっている流れがあります`);
  }

  if (overview.weightTrend?.direction === 'up') signals.push('体重は短期の揺れと流れを分けて見ると安心しやすいです');
  if (overview.latestLabDate) signals.push('血液検査は生活の流れと一緒に見ると受け止めやすくなります');
  if (recentKinds.includes('activity')) signals.push('最近は活動の記録もあるので、体の流れで整理しやすいです');

  return {
    tone,
    label,
    headline,
    body,
    prompt,
    actionLabel: tone === 'rest' ? 'やさしく相談する' : tone === 'forward' ? 'この流れで一歩決める' : '整える相談をする',
    signals: signals.filter(Boolean).slice(0, 3)
  };
}

function buildStuckPrompts(home = {}, overview = {}, engagement = {}, timeline = []) {
  const prompts = [];
  const push = (text) => {
    const safe = normalizeText(text);
    if (!safe || prompts.includes(safe)) return;
    prompts.push(safe);
  };

  push('うまく言えないけど、今の状態をやさしく整理して');
  push('今日は何から考えると負担が少ない？');

  if ((home.alerts || []).some((item) => /疲れ|不調|しんど|痛/.test(item))) {
    push('今日は休む視点も入れて、どう考えるのがよさそう？');
  }
  if ((home.alerts || []).some((item) => /食事/.test(item))) {
    push('今日は食事を一回だけ整えるなら、どこがよさそう？');
  }
  if (overview.weightTrend?.direction) {
    push('最近の体重の流れを、不安にしすぎない形で見て');
  }
  if (overview.latestLabDate) {
    push('血液検査のことを、心配しすぎないよう整理して');
  }
  if ((engagement.touchDays7 || 0) <= 2) {
    push('久しぶりでも入りやすい相談の始め方を教えて');
  }
  if (Array.isArray(timeline) && timeline.some((item) => /運動|活動/.test(item.title || item.summary || ''))) {
    push('最近の活動の流れも含めて、整え方を見て');
  }

  return prompts.slice(0, 5);
}

function buildChatReflection(home = {}, overview = {}, latestReply = '') {
  const reply = normalizeText(latestReply);
  let received = 'いま抱えていることを、そのまま置いて大丈夫です。';
  let perspective = '全部を一度に整えようとせず、今日の流れとして見る方が楽になります。';
  let nextStep = '次は、今日いちばん気になる一点だけを一緒に絞ると進めやすいです。';

  if ((home.alerts || []).some((item) => /疲れ|不調/.test(item)) || /疲れ|しんど|痛|眠/.test(reply)) {
    received = '頑張り方を増やすより、まず今のしんどさを受け止める進め方で大丈夫です。';
    perspective = '不調がある日は、改善より負担を減らす視点が相談の軸になります。';
  } else if (overview.weightTrend?.direction === 'up') {
    perspective = '体重の増え方は、短期の揺れと生活の流れを分けて見ると整理しやすくなります。';
  } else if (overview.latestLabDate) {
    perspective = '血液検査は、数値だけでなく最近の食事や生活と一緒に見ると納得しやすいです。';
  } else if ((home.alerts || []).some((item) => /食事/.test(item))) {
    perspective = '食事が少ない日は、失敗ではなく立て直しの入口として見ると前に進みやすいです。';
  }

  if ((home.alerts || []).some((item) => /食事/.test(item))) {
    nextStep = '次は、今日の食事をどこから整えると負担が少ないかだけを決めると進めやすいです。';
  } else if ((home.alerts || []).some((item) => /体重/.test(item))) {
    nextStep = '次は、体重をどう評価するかより、最近の生活の流れから見ていくと自然です。';
  } else if ((home.alerts || []).some((item) => /運動/.test(item))) {
    nextStep = '次は、無理のない小さな動き一つを決める相談にすると続けやすいです。';
  }

  return { received, perspective, nextStep };
}

function buildFollowupPrompts(home = {}, overview = {}, latestReply = '') {
  const prompts = [];
  const push = (text) => {
    const safe = normalizeText(text);
    if (!safe || prompts.includes(safe)) return;
    prompts.push(safe);
  };

  push('この話を、今日のことだけに絞って整理して');
  push('気持ちの面も含めて、やさしく見立てて');

  if ((home.alerts || []).some((item) => /食事/.test(item))) {
    push('今日は食事をどこから整えると負担が少ない？');
  }
  if ((home.alerts || []).some((item) => /体重/.test(item)) || overview.weightTrend?.direction) {
    push('最近の体重の流れを、心配しすぎない形で説明して');
  }
  if ((home.alerts || []).some((item) => /疲れ|不調/.test(item)) || /疲れ|しんど|痛|眠/.test(latestReply)) {
    push('今日は休み方も含めて、どう整えるのがよさそう？');
  }
  if (overview.latestLabDate) {
    push('血液検査の見方を、生活の流れと一緒に教えて');
  }
  push('今日いちばん効く一歩を一つだけ決めて');
  return prompts.slice(0, 4);
}

function buildStarterPrompts(home = {}, overview = {}) {
  const prompts = [];
  if (home.alerts?.some((item) => /食事/.test(item))) {
    prompts.push('今日は食事の流れをどう整えるとよい？');
  }
  if (home.alerts?.some((item) => /体重/.test(item))) {
    prompts.push('体重記録が空いている今、どう受け止めればいい？');
  }
  if (home.alerts?.some((item) => /運動/.test(item))) {
    prompts.push('今日は小さな運動なら何から始めるとよい？');
  }
  if (overview.weightTrend?.direction === 'up') {
    prompts.push('最近の体重の上がり方を不安にしすぎず整理して');
  }
  if (overview.latestLabDate) {
    prompts.push('血液検査の最新結果をやさしく読み解いて');
  }
  prompts.push('今日の流れを見て、今いちばん意識することを教えて');
  prompts.push('最近の食事の傾向をやさしく整理して');

  const unique = [];
  for (const prompt of prompts) {
    const safe = normalizeText(prompt);
    if (!safe || unique.includes(safe)) continue;
    unique.push(safe);
    if (unique.length >= 5) break;
  }
  return unique;
}

async function safeSelect(promiseFactory, fallback = []) {
  try {
    const result = await promiseFactory();
    if (result.error) throw result.error;
    return result.data || fallback;
  } catch (_error) {
    return fallback;
  }
}

function latestIso(values = []) {
  return values.filter(Boolean).sort().slice(-1)[0] || null;
}

async function getLatestTimestamp(userId, tableName, columnName) {
  const rows = await safeSelect(() => supabase
    .from(tableName)
    .select(columnName)
    .eq('user_id', userId)
    .order(columnName, { ascending: false })
    .limit(1), []);
  const row = Array.isArray(rows) ? rows[0] : null;
  return row ? row[columnName] || null : null;
}

function buildCareFocus(home = {}, overview = {}) {
  const items = [];

  const push = (title, body, prompt) => {
    const safeTitle = normalizeText(title);
    const safeBody = normalizeText(body);
    const safePrompt = normalizeText(prompt);
    if (!safeTitle || !safeBody || items.some((item) => item.title === safeTitle)) return;
    items.push({ title: safeTitle, body: safeBody, prompt: safePrompt });
  };

  if ((home.alerts || []).some((item) => /疲れ|不調|しんどい/.test(item))) {
    push('今日は整えることを優先', '前に進むことより、負担を増やさず整える視点が合いやすい日です。', '今日は休み方も含めて、どう整えるのがよさそう？');
  }

  if (home.mealStatus && !home.mealStatus.breakfast && !home.mealStatus.lunch && !home.mealStatus.dinner) {
    push('食事が少ない日の見方', '記録が少ない日は失敗ではなく、まず流れを立て直す入口として捉えると楽になります。', '今日は食事が少ないけど、ここからどう整えればいい？');
  }

  if (overview.weightTrend?.direction === 'up') {
    push('体重の上がり方を落ち着いて整理', `直近${overview.weightTrend.days || 7}日の変化を、短期の揺れと生活の流れに分けて見ると必要以上に不安になりにくいです。`, '最近の体重の上がり方を、心配しすぎないよう整理して');
  } else if (overview.weightTrend?.direction === 'down') {
    push('体重の下がり方も意味づけする', `直近${overview.weightTrend.days || 7}日の下がり方が、良い流れなのか無理なのかを整理して見る価値があります。`, '最近の体重の下がり方を、良い変化かどうか整理して');
  }

  if (overview.latestLabDate) {
    push('血液検査は点ではなく流れで見る', '最新値だけでなく、生活リズムや食事の傾向と一緒に読むと安心につながりやすいです。', '血液検査の最新結果を、生活の流れと一緒に読み解いて');
  }

  push('迷った時は一つだけ決める', '全部を整えようとせず、今日いちばん効く一つを決める方が続きやすくなります。', '今日いちばん意識することを一つだけ教えて');

  return items.slice(0, 3);
}



function buildSupportCompass(user = {}, home = {}, overview = {}, engagement = {}, timeline = []) {
  const anchors = [];
  const pushAnchor = (label, value) => {
    const safeLabel = normalizeText(label);
    const safeValue = normalizeText(value);
    if (!safeLabel || !safeValue) return;
    anchors.push({ label: safeLabel, value: safeValue });
  };

  if (user.goal) pushAnchor('目標', user.goal);
  if (user.ai_type) pushAnchor('伴走タイプ', user.ai_type);
  if ((home.alerts || [])[0]) pushAnchor('今いちばん気になること', home.alerts[0]);
  if (overview.weightTrend?.direction === 'up') pushAnchor('体の流れ', '体重は少し上向きなので、短期の揺れと生活の流れを分けて見ると安心しやすいです。');
  else if (overview.weightTrend?.direction === 'down') pushAnchor('体の流れ', '体重は少し下向きです。無理のない変化かを一緒に見ていけます。');
  else if (overview.latestLabDate) pushAnchor('見返しの軸', `血液検査は ${overview.latestLabDate} の結果を起点に見返せます。`);

  if (Number(engagement.touchDays7 || 0) >= 3) {
    pushAnchor('続けられていること', `直近7日で${engagement.touchDays7}日つながれています。`);
  }

  const latestUserTopic = Array.isArray(timeline)
    ? timeline.find((item) => item.type === 'chat' && item.role === 'user' && item.summary)
    : null;
  if (latestUserTopic?.summary) pushAnchor('前回の相談テーマ', latestUserTopic.summary);

  let headline = '今の相談は、責めるより流れを一緒に見ていく形が合っています。';
  let body = '数字だけでなく、最近の食事・体重・疲れ方・気持ちの流れを重ねて見ると、安心しやすい相談になります。';
  let prompt = 'いまの流れを、責めずにやさしく整理して。';

  if ((home.alerts || []).some((item) => /疲れ|不調|しんどい|眠/.test(item))) {
    headline = '今日は前に進めるより、しんどさを減らす相談から入ると自然です。';
    body = '無理に整えようとせず、休み方や負担の減らし方を一緒に決める形が合いやすいです。';
    prompt = '今日は頑張り方を増やさずに、どう整えるのがよさそうか一緒に見て。';
  } else if (overview.latestLabDate) {
    headline = '検査結果は、生活の流れと一緒に見ると納得しやすくなります。';
    body = '最新の数値だけで判断せず、最近の食事や体重、疲れ方も重ねて読むと安心につながります。';
    prompt = '血液検査の結果を、最近の生活の流れと一緒にやさしく読み解いて。';
  } else if (overview.weightTrend?.direction) {
    headline = '体重の流れは、短期の揺れと日々の積み重ねを分けて見ると落ち着きます。';
    body = '良い悪いで急がず、最近の生活リズムや食事の流れと合わせて意味づけすると自然です。';
    prompt = '最近の体重の流れを、短期の揺れと生活の流れに分けて整理して。';
  } else if ((home.alerts || []).some((item) => /食事/.test(item))) {
    headline = '食事の少なさは失敗ではなく、立て直し方を決める入口です。';
    body = '何が食べられていないかより、どこから戻すと負担が少ないかを見ると続きやすくなります。';
    prompt = '今日は食事をどこから整えると負担が少ないか、一緒に決めて。';
  }

  return {
    headline,
    body,
    anchors: anchors.slice(0, 4),
    prompt
  };
}


function trimForUi(text, max = 72) {
  const safe = normalizeText(text).replace(/\s+/g, ' ');
  if (!safe) return '';
  return safe.length > max ? `${safe.slice(0, Math.max(12, max - 1)).trim()}…` : safe;
}

function buildConversationBridge(messages = [], home = {}, overview = {}) {
  const usable = Array.isArray(messages) ? messages.filter(Boolean) : [];
  const latestUser = [...usable].reverse().find((item) => item.role === 'user' && normalizeText(item.text));
  const latestAssistant = [...usable].reverse().find((item) => item.role === 'assistant' && normalizeText(item.text));

  if (!latestUser && !latestAssistant) {
    return {
      headline: '今の状態から、そのまま相談を始めて大丈夫です。',
      userTopic: '',
      assistantSupport: '',
      body: '前回の流れが少なくても、今日の状態や気持ちを一言置くところから始められます。',
      continuePrompt: '今の状態を、責めない形で一緒に整理して。'
    };
  }

  const userTopic = latestUser ? trimForUi(latestUser.text, 82) : '';
  const assistantSupport = latestAssistant ? trimForUi(latestAssistant.text, 92) : '';
  let headline = '前回の流れから、そのまま続けて相談できます。';
  let body = '同じ説明を最初からやり直さなくても、ここから続きとして話せます。';

  if ((home.alerts || []).some((item) => /疲れ|不調|しんど|痛/.test(item))) {
    headline = '前回の流れを保ったまま、無理を増やさず相談できます。';
    body = '今日は前進よりも、今の負担を増やさない見方で続けるのが合っています。';
  } else if (overview.weightTrend?.direction === 'up') {
    body = '体の変化も含めて、前回の相談と今の流れをつなげて見ていけます。';
  } else if (overview.latestLabDate) {
    body = '前回の話と血液検査の流れをつなげて、落ち着いて見返せます。';
  }

  const continuePrompt = userTopic
    ? `前回は「${userTopic}」の話をしていました。この続きとして、今の変化や気持ちを一緒に整理して。`
    : assistantSupport
      ? `前回は「${assistantSupport}」という整理がありました。この続きとして、今の状態を一緒に見て。`
      : '前回の流れを引き継いで、今の状態を一緒に整理して。';

  return {
    headline,
    userTopic,
    assistantSupport,
    body,
    continuePrompt,
    badge: latestUser?.sourceChannel === 'web' ? 'WEBからの続き' : latestUser?.sourceChannel === 'line' ? 'LINEからの続き' : '最近の相談から続ける'
  };
}

function buildReentryGuide(home = {}, overview = {}, engagement = {}, timeline = []) {
  const latestAt = Array.isArray(timeline)
    ? timeline.map((item) => item?.at).filter(Boolean).sort().slice(-1)[0] || null
    : null;
  const gapDays = dayDiffFromTokyoYmd(latestAt ? String(latestAt).slice(0, 10) : '');

  let headline = '今日はここから一つだけ整えれば十分です。';
  let body = '全部を取り戻そうとせず、まず今の状態を置くところから始めると自然です。';
  const steps = [];
  const push = (text) => {
    const safe = normalizeText(text);
    if (safe && !steps.includes(safe)) steps.push(safe);
  };

  if (gapDays != null && gapDays >= 4) {
    headline = '少し空いても、ここから静かに戻れば大丈夫です。';
    body = '空いた分を埋めるより、今日の気分や体調を一言置くところからで十分です。';
    push('まずは「今の体調や気分」を一言だけ置く');
    push('食事か体重のどちらか一つだけ見返す');
    push('必要なら前回の続きから相談する');
  } else if ((home.alerts || []).some((item) => /疲れ|不調|しんど|痛/.test(item))) {
    headline = '今日は整え直しより、負担を増やさない入り方が合っています。';
    body = '頑張り方を足すより、まず今しんどい所をやさしく確認する流れが自然です。';
    push('今いちばんしんどい所を一つだけ言葉にする');
    push('休み方も含めて相談する');
    push('記録は全部でなく、今日ぶんだけで大丈夫');
  } else if ((engagement.streakDays || 0) >= 4) {
    headline = '今の続けられている流れを、そのまま守る日です。';
    body = '新しいことを増やさず、戻って来られている今のペースを保つ見方が合っています。';
    push('今日は何を守れたら十分かを見る');
    push('前回から続く気がかりだけを一つ相談する');
    push('流れを崩さない小さな一歩を決める');
  } else {
    push('今の状態を一言で置く');
    push('今日いちばん気になることを一つ選ぶ');
    push('必要なら最近の流れをやさしく整理する');
  }

  const prompt = gapDays != null && gapDays >= 4
    ? '少し空いてしまったけれど、責めない形でここからどう戻るとよいか一緒に整理して。'
    : (home.alerts || []).some((item) => /疲れ|不調|しんど|痛/.test(item))
      ? '今のしんどさを増やさない形で、今日はどう整えるのがよさそうか一緒に見て。'
      : '今の状態から、無理なく始める入口を一緒に決めて。';

  return { headline, body, steps: steps.slice(0, 3), prompt, gapDays: gapDays != null ? gapDays : null };
}


function buildReturnDigest(home = {}, overview = {}, engagement = {}, timeline = []) {
  const recent = Array.isArray(timeline) ? timeline.filter(Boolean).slice(0, 5) : [];
  const bullets = [];
  const push = (text) => {
    const safe = normalizeText(text);
    if (!safe || bullets.includes(safe)) return;
    bullets.push(safe);
  };

  const recentChat = recent.find((item) => item.type === 'chat');
  const recentMeal = recent.find((item) => item.type === 'meal');
  const recentWeight = recent.find((item) => item.type === 'weight');
  const recentLab = recent.find((item) => item.type === 'lab');
  const recentActivity = recent.find((item) => item.type === 'activity');

  if (recentChat?.summary) push(`最近の相談: ${trimForUi(recentChat.summary, 42)}`);
  if (recentMeal?.summary) push(`最近の食事: ${trimForUi(recentMeal.summary, 42)}`);
  if (recentWeight?.summary) push(`最近の体重: ${trimForUi(recentWeight.summary, 36)}`);
  if (recentLab?.summary) push(`最近の検査: ${trimForUi(recentLab.summary, 40)}`);
  if (recentActivity?.summary) push(`最近の活動: ${trimForUi(recentActivity.summary, 40)}`);

  let headline = '最近の流れから、そのまま今の相談へつなげられます。';
  let body = '新しく増えた記録や相談を全部追いかけなくても、最近の変化をひとまとまりで見れば十分です。';
  let prompt = '最近の流れをまとめて見て、今どこから相談するとよさそうか整理して。';

  if ((home.alerts || []).some((item) => /疲れ|不調|しんど|痛|眠/.test(item))) {
    headline = '最近の変化は、頑張り方より負担の増え方を見ると整理しやすいです。';
    body = '食事や体重より先に、しんどさや疲れの流れから見る方が安心につながりやすいです。';
    prompt = '最近の流れを見ながら、いま負担になっている所をやさしく整理して。';
  } else if (overview.latestLabDate) {
    headline = '最近の流れと血液検査を、同じ地図の上で見られます。';
    body = '検査の数字だけでなく、最近の食事や体調の流れと重ねると納得しやすくなります。';
    prompt = '最近の食事や体調も含めて、血液検査の見方をやさしく整理して。';
  } else if (overview.weightTrend?.direction) {
    headline = '最近の流れは、体重の揺れと生活の流れを一緒に見ると落ち着きやすいです。';
    body = '変化の大きさより、どんな流れで起きているかを見ると必要以上に不安になりにくいです。';
    prompt = '最近の体重と食事の流れを一緒に見て、どこから整えるとよいか教えて。';
  } else if ((engagement.recentEvents || 0) >= 8) {
    headline = '最近の接点が増えているので、流れで整理しやすい状態です。';
    body = '一つ一つを追うより、最近のまとまりとして見返すと相談が始めやすくなります。';
  }

  return {
    headline,
    body,
    bullets: bullets.slice(0, 4),
    prompt,
    badge: bullets.length >= 3 ? '最近の変化をひとまとめに見る' : 'いまの流れをつかむ'
  };
}

function buildSinceDigest(summary = {}, timeline = []) {
  const total = Number(summary.total || 0);
  if (!total) return null;
  const chips = [];
  const push = (label, count) => {
    const n = Number(count || 0);
    if (!n) return;
    chips.push(`${label} ${n}件`);
  };
  push('相談', summary.chats);
  push('食事', summary.meals);
  push('体重', summary.weights);
  push('血液検査', summary.labs);
  push('活動', summary.activities);

  const recent = Array.isArray(timeline)
    ? timeline.filter((item) => item && item.summary).slice(0, 3).map((item) => `${item.label || summarizeTimelineType(item.type)}: ${item.summary}`)
    : [];

  let headline = `前回から${total}件の動きがあります`;
  let body = '全部を追わなくても大丈夫です。増えた分のうち、いちばん気になる流れから見れば十分です。';
  if ((summary.chats || 0) > 0 && total === Number(summary.chats || 0)) {
    headline = `前回から相談が${summary.chats}件増えています`;
    body = '会話の流れが進んでいるので、続きから相談しやすい状態です。';
  } else if ((summary.meals || 0) >= 2 && total === Number(summary.meals || 0)) {
    headline = `前回から食事記録が${summary.meals}件増えています`;
    body = '食事の流れを点ではなく並びで見やすい状態です。';
  } else if ((summary.weights || 0) > 0 && total <= 2) {
    headline = '前回から体の現在地が少し増えています';
    body = '体重や体脂肪の情報が増えたので、流れとして受け止めやすくなっています。';
  }

  let prompt = '前回から増えたことを、いま気にしすぎない形で整理して。';
  if ((summary.labs || 0) > 0) prompt = '前回から増えた検査や記録を、生活の流れと一緒にやさしく整理して。';
  else if ((summary.meals || 0) > 0) prompt = '前回から増えた食事や相談をもとに、最近の流れをやさしく整理して。';
  else if ((summary.chats || 0) > 0) prompt = '前回から増えた相談の流れをもとに、いま大事な一点を整理して。';

  return {
    badge: '前回から動いたこと',
    headline,
    body,
    bullets: chips.slice(0, 5),
    recent,
    prompt,
    actionLabel: 'この増え方を相談する',
    since: summary.since || null,
    lastEventAt: summary.lastEventAt || null,
    total
  };
}

async function getSinceSummary(user, sinceIso, timeline = []) {
  const safeSince = normalizeIsoCandidate(sinceIso);
  if (!safeSince) return null;
  const [chatRows, mealRows, weightRows, labRows, activityRows] = await Promise.all([
    safeSelect(() => supabase.from('chat_logs').select('created_at, role').eq('user_id', user.id).gte('created_at', safeSince).limit(30), []),
    safeSelect(() => supabase.from('meal_logs').select('eaten_at').eq('user_id', user.id).gte('eaten_at', safeSince).limit(30), []),
    safeSelect(() => supabase.from('weight_logs').select('logged_at').eq('user_id', user.id).gte('logged_at', safeSince).limit(20), []),
    safeSelect(() => supabase.from('lab_results').select('measured_at').eq('user_id', user.id).gte('measured_at', safeSince).limit(10), []),
    safeSelect(() => supabase.from('activity_logs').select('logged_at').eq('user_id', user.id).gte('logged_at', safeSince).limit(20), [])
  ]);

  const chats = (chatRows || []).filter((row) => row && row.created_at).length;
  const meals = (mealRows || []).filter((row) => row && row.eaten_at).length;
  const weights = (weightRows || []).filter((row) => row && row.logged_at).length;
  const labs = (labRows || []).filter((row) => row && row.measured_at).length;
  const activities = (activityRows || []).filter((row) => row && row.logged_at).length;
  const total = chats + meals + weights + labs + activities;
  if (!total) return null;
  const recent = Array.isArray(timeline)
    ? timeline.filter((item) => item?.at && Date.parse(item.at) >= Date.parse(safeSince)).slice(0, 4)
    : [];
  const lastEventAt = latestIso([
    ...(chatRows || []).map((row) => row.created_at),
    ...(mealRows || []).map((row) => row.eaten_at),
    ...(weightRows || []).map((row) => row.logged_at),
    ...(labRows || []).map((row) => row.measured_at),
    ...(activityRows || []).map((row) => row.logged_at)
  ]);
  return buildSinceDigest({ since: safeSince, chats, meals, weights, labs, activities, total, lastEventAt }, recent);
}

function buildMicroStep(home = {}, overview = {}, engagement = {}, timeline = []) {
  const steps = [];
  const push = (text) => {
    const safe = normalizeText(text);
    if (!safe || steps.includes(safe)) return;
    steps.push(safe);
  };

  let label = '今すぐ1分でできること';
  let headline = '今日は「全部」ではなく、一つだけ動かせば十分です。';
  let body = '相談の前でも後でも、1分でできることを一つだけやると流れが戻りやすくなります。';
  let prompt = 'いまの状態で、今すぐ1分でできることを一つだけ決めて。';

  if ((home.alerts || []).some((item) => /疲れ|不調|しんど|痛|眠/.test(item))) {
    label = '負担を増やさない1分';
    headline = '今日は増やすより、今の負担を一つ減らすだけで十分です。';
    body = '深呼吸、水分、姿勢を楽にする、相談文を一言だけ置く。そんな小さな動きで大丈夫です。';
    push('いまのしんどさを一言だけ書く');
    push('水分をひと口とる');
    push('今日は無理を増やさないと決める');
    prompt = '今日は負担を増やさないために、今すぐ一つだけできることを決めて。';
  } else if (home.mealStatus && !home.mealStatus.breakfast && !home.mealStatus.lunch && !home.mealStatus.dinner) {
    label = '流れを戻す1分';
    headline = '食事が少ない日は、次の一回を決めるだけで十分です。';
    body = '何を完璧に食べるかより、次に口にしやすいものを一つ決めるだけでも流れが戻ります。';
    push('次に食べやすいものを一つ決める');
    push('相談で「今日は何を一回食べればいい？」と送る');
    push('食事を一回だけ整える前提にする');
    prompt = '今日は食事を一回だけ整えるなら、何がいちばん負担が少ないか一緒に見て。';
  } else if (overview.weightTrend?.direction || overview.latestLabDate) {
    label = '不安をほどく1分';
    headline = '数字が気になる時は、評価より「今の見方」を一つ決めると落ち着きます。';
    body = '良い悪いを急がず、最近の流れと一緒に見る前提を置くだけでも不安は軽くなります。';
    push('数字を責めず、最近の流れと一緒に見ると決める');
    push('気になる数値を一つだけ選ぶ');
    push('その数値を相談で一言だけ出す');
    prompt = 'いま気になる数字を一つだけ選んで、最近の流れと一緒にやさしく見て。';
  } else {
    push('今日の状態を一言だけ書く');
    push('いちばん気になることを一つだけ選ぶ');
    push('相談で「今日は何から見ればいい？」と送る');
  }

  if ((engagement.streakDays || 0) >= 4) push('今の続け方を壊さない一歩にする');
  if (Array.isArray(timeline) && timeline.some((item) => item.type === 'activity')) push('動けたことを一つ思い出す');

  return {
    label,
    headline,
    body,
    steps: steps.slice(0, 4),
    prompt,
    actionLabel: 'この1分から相談する'
  };
}


function buildConsultationCarry(home = {}, overview = {}, engagement = {}, timeline = [], latestReply = '') {
  const clarified = [];
  const canWait = [];
  const remember = [];
  const pushUnique = (arr, text) => {
    const safe = normalizeText(text);
    if (!safe || arr.includes(safe)) return;
    arr.push(safe);
  };

  const alertText = (home.alerts || []).join(' / ');
  const latestTimeline = Array.isArray(timeline) ? timeline.filter(Boolean).slice(0, 4) : [];
  const latestUserTopic = latestTimeline.find((item) => item.type === 'chat' && item.role === 'user' && item.summary);
  const hasMeals = Boolean(home.mealStatus?.breakfast || home.mealStatus?.lunch || home.mealStatus?.dinner);
  const reply = normalizeText(latestReply);

  let headline = '今日ここまでで掴めていれば十分なこと';
  let body = '全部を結論にしなくても、今日の見方が少し整っていれば十分前に進めています。';
  let prompt = '今日ここまでで整理できたことと、まだ急がなくてよいことをやさしくまとめて。';

  if (/疲れ|不調|しんど|痛|眠/.test(alertText) || /疲れ|しんど|痛|眠/.test(reply)) {
    pushUnique(clarified, '今日は前に進むより、負担を増やさない見方が合いやすいです。');
    pushUnique(canWait, '原因を全部つきとめるのは今日でなくても大丈夫です。');
    pushUnique(remember, 'しんどさがある日は、休み方を含めて相談できれば十分です。');
    headline = '今日は「がんばり方を増やさない」が見えていれば十分です。';
    body = '不調がある日は、改善策を増やす前に負担を減らす見方が土台になります。';
    prompt = '今日は無理を増やさない前提で、ここまで整理できたことを短くまとめて。';
  }

  if ((home.alerts || []).some((item) => /食事/.test(item)) || !hasMeals) {
    pushUnique(clarified, '食事は全部を整えなくても、次の一回を決めるだけで流れが戻りやすくなります。');
    pushUnique(canWait, '完璧な献立や細かい栄養計算までは、今すぐ決めなくて大丈夫です。');
    pushUnique(remember, '今日は食事を一回だけ整える見方でも十分です。');
  }

  if (overview.weightTrend?.direction) {
    pushUnique(clarified, '体重は短期の揺れと生活の流れを分けて見ると落ち着きやすいです。');
    pushUnique(canWait, '数字の評価を急がなくても、まず流れとして見られれば十分です。');
    pushUnique(remember, '今日は体重の良し悪しより、流れの見方を整える方が合っています。');
  }

  if (overview.latestLabDate) {
    pushUnique(clarified, `血液検査は、${overview.latestLabDate}の数字だけでなく最近の生活の流れと一緒に見る方が納得しやすいです。`);
    pushUnique(canWait, 'すべての数値を一度に理解しなくても、気になる項目からで大丈夫です。');
    pushUnique(remember, '検査結果は責める材料ではなく、流れを知る手がかりとして見てよいです。');
  }

  if ((engagement.streakDays || 0) >= 3) {
    pushUnique(clarified, `${engagement.streakDays}日つながっている今の流れそのものが土台になっています。`);
    pushUnique(remember, '新しいことを増やすより、戻って来られている今の流れを守るだけでも十分です。');
  }

  if (latestUserTopic?.summary) {
    pushUnique(clarified, `前回の「${trimForUi(latestUserTopic.summary, 26)}」の続きとして見られる状態です。`);
  }

  if (!clarified.length) pushUnique(clarified, '今日は今の状態をそのまま言葉にできていれば十分です。');
  if (!canWait.length) pushUnique(canWait, '全部を一度に整えることは急がなくて大丈夫です。');
  if (!remember.length) pushUnique(remember, '戻って来られた時点から、また流れは作り直せます。');

  return {
    headline,
    body,
    clarified: clarified.slice(0, 3),
    canWait: canWait.slice(0, 2),
    remember: remember.slice(0, 2),
    prompt,
    actionLabel: 'ここまでの整理を相談する'
  };
}

function buildReturnAnchor(home = {}, overview = {}, engagement = {}, timeline = []) {
  const anchors = [];
  const push = (text) => {
    const safe = normalizeText(text);
    if (!safe || anchors.includes(safe)) return;
    anchors.push(safe);
  };

  const latestUserTopic = Array.isArray(timeline)
    ? timeline.find((item) => item.type === 'chat' && item.role === 'user' && item.summary)
    : null;
  const recentMeal = Array.isArray(timeline)
    ? timeline.find((item) => item.type === 'meal' && item.summary)
    : null;
  const recentActivity = Array.isArray(timeline)
    ? timeline.find((item) => item.type === 'activity' && item.summary)
    : null;

  let badge = '戻りやすい形';
  let headline = '今日は「戻りやすい形」に寄せれば十分です。';
  let body = '全部を整えようとせず、最近少し保ちやすかった形へ戻るだけでも流れは作り直せます。';
  let prompt = '最近の流れから、今いちばん戻りやすい形を一緒に決めて。';

  if ((home.alerts || []).some((item) => /疲れ|不調|しんど|痛/.test(item))) {
    badge = '負担を増やさない戻り方';
    headline = '今日は前へ進むより、負担を増やさない形へ戻るのが合っています。';
    body = 'がんばり方を足すより、最近いちばん崩れにくかった形を一つだけ守る方が自然です。';
    push('まずは今いちばんしんどい所を一つだけ言葉にする');
    push('食事や運動は全部でなく、一つだけ戻せれば十分と見る');
    prompt = '今のしんどさを増やさない形で、最近いちばん戻りやすかった形を一緒に決めて。';
  } else if ((engagement.streakDays || 0) >= 4) {
    badge = '守りたい流れ';
    headline = '今続けられている流れを、そのまま守るだけでも十分です。';
    body = '新しいことを増やすより、最近つながれていたペースを崩さないことが次につながります。';
    push(`${engagement.streakDays}日つながれている今のペースを基準にしてよい`);
    push('今日は新しい工夫より、今守れている一つを確認する');
    prompt = '今続けられている流れを崩さないために、今日は何を守れれば十分か一緒に見て。';
  } else if (overview.weightTrend?.direction) {
    badge = '体の流れから戻る';
    headline = '体重の揺れがある時ほど、最近の生活の形へ戻る見方が安心につながります。';
    body = '短期の数字だけでなく、食事や休み方を含めて「どの形なら戻りやすいか」を見る方が自然です。';
    push('体重の数字だけでなく、食事と休み方も一緒に見る');
    push('直近7日の揺れを責めず、戻りやすい一つだけ決める');
    prompt = '最近の体重の流れを見ながら、今いちばん戻りやすい生活の形を一緒に決めて。';
  } else if (overview.latestLabDate) {
    badge = '検査後の戻り先';
    headline = '検査結果が気になる時も、生活の戻り先が見えると安心しやすくなります。';
    body = '数値だけでなく、最近の食事や休み方の中で戻りやすい所を先に決めると、焦りが減りやすいです。';
    push(`血液検査（${overview.latestLabDate}）は生活の流れと一緒に見る`);
    push('全部を変えるより、戻りやすい食事や過ごし方を一つ選ぶ');
    prompt = '血液検査の結果も踏まえて、今いちばん戻りやすい生活の形を一緒に決めて。';
  }

  if ((home.alerts || []).some((item) => /食事/.test(item))) {
    push('食事は全部整えず、次に取りやすい一食からでよい');
  } else if (recentMeal?.summary) {
    push(`最近の食事は「${trimForUi(recentMeal.summary, 26)}」の流れが戻り先になりそうです。`);
  }

  if (recentActivity?.summary) {
    push(`活動は「${trimForUi(recentActivity.summary, 24)}」くらいの軽さを目安にしてよさそうです。`);
  }

  if (latestUserTopic?.summary) {
    push(`相談は「${trimForUi(latestUserTopic.summary, 26)}」の続きから入ると自然です。`);
  }

  if (!anchors.length) {
    push('今日は今の状態を一言置くところからで大丈夫です。');
    push('全部を変えようとせず、戻りやすい一つだけを見ると十分です。');
  }

  return {
    badge,
    headline,
    body,
    anchors: anchors.slice(0, 4),
    prompt,
    actionLabel: '戻りやすい形を相談する'
  };
}

function buildResumePrompts(timeline = [], home = {}, overview = {}) {
  const prompts = [];
  const push = (text) => {
    const safe = normalizeText(text);
    if (!safe || prompts.includes(safe)) return;
    prompts.push(safe);
  };

  const latestUserTopics = (Array.isArray(timeline) ? timeline : [])
    .filter((item) => item.type === 'chat' && item.role === 'user' && item.summary)
    .slice(0, 2);
  latestUserTopics.forEach((item) => {
    push(`前回話していた「${item.summary}」の続きから、やさしく整理して。`);
  });

  if ((home.alerts || [])[0]) {
    push(`いま気になっている「${home.alerts[0]}」を、今日の流れとして整理して。`);
  }
  if (overview.latestLabDate) {
    push(`血液検査（${overview.latestLabDate}）と最近の生活の流れをつなげて見て。`);
  }
  if (overview.weightTrend?.direction) {
    push('最近の体重の流れを、心配しすぎないよう整理して。');
  }
  push('今の流れを振り返って、次の一歩だけ決めて。');
  return prompts.slice(0, 4);
}

function summarizeTimelineType(type) {
  if (type === 'chat') return '相談';
  if (type === 'meal') return '食事';
  if (type === 'weight') return '体重';
  if (type === 'lab') return '血液検査';
  if (type === 'activity') return '運動';
  return '記録';
}

function buildConsultLanes(home = {}, overview = {}, timeline = []) {
  const lanes = [];
  const latestChat = Array.isArray(timeline)
    ? timeline.find((item) => item.type === 'chat' && item.role === 'user' && item.summary)
    : null;

  const push = (id, title, body, prompt) => {
    const safeTitle = normalizeText(title);
    const safeBody = normalizeText(body);
    const safePrompt = normalizeText(prompt);
    if (!id || !safeTitle || !safeBody || !safePrompt) return;
    if (lanes.some((item) => item.id === id)) return;
    lanes.push({ id, title: safeTitle, body: safeBody, prompt: safePrompt });
  };

  push(
    'worry',
    '不安をそのまま話す',
    latestChat?.summary
      ? '今ひっかかっていることを整理せず、そのまま置いて大丈夫です。'
      : 'うまく整理できていなくても、そのまま話し始められます。',
    latestChat?.summary
      ? `今の不安を、整理しきらなくていいのでそのまま受け止めて。気になっているのは「${latestChat.summary}」に近いです。`
      : '今の不安を、整理しきらなくていいのでそのまま受け止めて。'
  );

  if ((home.alerts || []).length) {
    push(
      'reason',
      '原因をやさしく整理する',
      '食事・体重・疲れの流れを分けて見ると、必要以上に責めずに整理しやすくなります。',
      `最近の流れを、原因ごとにやさしく整理して。特に気になるのは「${home.alerts[0]}」です。`
    );
  }

  if (overview.weightTrend?.direction) {
    const dirText = overview.weightTrend.direction === 'up' ? '増え方' : overview.weightTrend.direction === 'down' ? '減り方' : '揺れ方';
    push(
      'body',
      '体の変化を落ち着いて見る',
      '短期の揺れと、生活の流れとしての変化を分けて見る相談です。',
      `最近の体重の${dirText}を、短期の揺れと生活の流れに分けて落ち着いて整理して。`
    );
  } else if (overview.latestLabDate) {
    push(
      'lab',
      '検査結果を安心につなげる',
      '数値だけでなく、生活の流れと一緒に読む相談です。',
      '血液検査の最新結果を、生活の流れと一緒に安心できる形で読み解いて。'
    );
  }

  push(
    'next',
    '今日の一歩だけ決める',
    '全部を変えようとせず、今日いちばん効く一つだけ決める相談です。',
    '今日の流れを見て、いちばん効く一歩を一つだけ決めて。'
  );

  return lanes.slice(0, 4);
}

async function getRecentTimeline(user, limit = 8) {
  const [chatRows, mealRows, weightRows, labRows, activityRows] = await Promise.all([
    safeSelect(() => supabase
      .from('chat_logs')
      .select('role, message_text, created_at, source_channel')
      .eq('user_id', user.id)
      .in('role', ['user', 'assistant'])
      .order('created_at', { ascending: false })
      .limit(4), []),
    safeSelect(() => supabase
      .from('meal_logs')
      .select('eaten_at, meal_label, food_items, estimated_kcal')
      .eq('user_id', user.id)
      .order('eaten_at', { ascending: false })
      .limit(3), []),
    safeSelect(() => supabase
      .from('weight_logs')
      .select('logged_at, weight_kg, body_fat_pct')
      .eq('user_id', user.id)
      .order('logged_at', { ascending: false })
      .limit(3), []),
    safeSelect(() => supabase
      .from('lab_results')
      .select('measured_at, hba1c, fasting_glucose, ldl, hdl, triglycerides, ast, alt, ggt, uric_acid, creatinine')
      .eq('user_id', user.id)
      .order('measured_at', { ascending: false })
      .limit(2), []),
    safeSelect(() => supabase
      .from('activity_logs')
      .select('logged_at, exercise_summary, walking_minutes, estimated_activity_kcal')
      .eq('user_id', user.id)
      .order('logged_at', { ascending: false })
      .limit(3), [])
  ]);

  const timeline = [];
  (chatRows || []).forEach((row) => {
    const summary = normalizeText(row?.message_text || '').replace(/\s+/g, ' ').slice(0, 80);
    if (!summary) return;
    timeline.push({
      type: 'chat',
      role: row.role || 'assistant',
      sourceChannel: row.source_channel || 'line',
      at: row.created_at,
      title: row.role === 'user' ? '相談したこと' : 'AI牛込の返答',
      summary
    });
  });
  (mealRows || []).forEach((row) => {
    timeline.push({
      type: 'meal',
      at: row.eaten_at,
      title: '食事記録',
      summary: formatMealSummary(row)
    });
  });
  (weightRows || []).forEach((row) => {
    const summary = buildWeightSummary(row)?.summary || '体重記録あり';
    timeline.push({
      type: 'weight',
      at: row.logged_at,
      title: '体重記録',
      summary
    });
  });
  (labRows || []).forEach((row) => {
    const items = buildLabItems(row).slice(0, 3).map((item) => `${item.itemName} ${item.value}`).join(' / ');
    timeline.push({
      type: 'lab',
      at: row.measured_at,
      title: '血液検査',
      summary: items || '検査結果を記録'
    });
  });
  (activityRows || []).forEach((row) => {
    const parts = [normalizeText(row.exercise_summary || '運動')];
    if (row.walking_minutes != null) parts.push(`${row.walking_minutes}分`);
    if (row.estimated_activity_kcal != null) parts.push(`${row.estimated_activity_kcal}kcal`);
    timeline.push({
      type: 'activity',
      at: row.logged_at,
      title: '運動記録',
      summary: parts.join(' / ')
    });
  });

  return timeline
    .filter((item) => item.at)
    .sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime())
    .slice(0, limit)
    .map((item) => ({
      ...item,
      label: summarizeTimelineType(item.type),
      date: String(item.at || '').slice(0, 16).replace('T', ' ')
    }));
}

async function getRecentMessages(userId, limit = 20) {
  const { data, error } = await supabase
    .from('chat_logs')
    .select('role, message_text, created_at')
    .eq('user_id', userId)
    .in('role', ['user', 'assistant'])
    .order('created_at', { ascending: false })
    .limit(limit);
  if (error) throw error;
  return (data || []).reverse().map((row) => ({ role: row.role, content: row.message_text || '', created_at: row.created_at }));
}

async function getTodayMeals(userId, dayYmd) {
  const range = isoRangeForTokyoDay(dayYmd);
  const { data, error } = await supabase
    .from('meal_logs')
    .select('eaten_at, meal_label, food_items, estimated_kcal, protein_g, fat_g, carbs_g, ai_comment')
    .eq('user_id', userId)
    .gte('eaten_at', range.start)
    .lte('eaten_at', range.end)
    .order('eaten_at', { ascending: true });
  if (error) throw error;
  return data || [];
}

async function getRecentMeals(userId, limit = 20) {
  const { data, error } = await supabase
    .from('meal_logs')
    .select('eaten_at, meal_label, food_items, estimated_kcal, protein_g, fat_g, carbs_g, ai_comment')
    .eq('user_id', userId)
    .order('eaten_at', { ascending: false })
    .limit(limit);
  if (error) throw error;
  return data || [];
}

async function getRecentWeights(userId, limit = 30) {
  const { data, error } = await supabase
    .from('weight_logs')
    .select('logged_at, weight_kg, body_fat_pct')
    .eq('user_id', userId)
    .order('logged_at', { ascending: false })
    .limit(limit);
  if (error) throw error;
  return data || [];
}

async function getRecentLabs(userId, limit = 10) {
  const { data, error } = await supabase
    .from('lab_results')
    .select('measured_at, hba1c, fasting_glucose, ldl, hdl, triglycerides, ast, alt, ggt, uric_acid, creatinine')
    .eq('user_id', userId)
    .order('measured_at', { ascending: false })
    .limit(limit);
  if (error) throw error;
  return data || [];
}

async function getTodayActivities(userId, dayYmd) {
  const range = isoRangeForTokyoDay(dayYmd);
  return safeSelect(() => supabase
    .from('activity_logs')
    .select('logged_at, exercise_summary, walking_minutes, steps, estimated_activity_kcal')
    .eq('user_id', userId)
    .gte('logged_at', range.start)
    .lte('logged_at', range.end)
    .order('logged_at', { ascending: true }));
}

async function buildHomeBundle(user) {
  const todayYmd = dateYmdInTokyo();
  const [todayMeals, recentWeights, recentLabs, recentMessages, todayActivities] = await Promise.all([
    getTodayMeals(user.id, todayYmd),
    getRecentWeights(user.id, 30),
    getRecentLabs(user.id, 5),
    getRecentMessages(user.id, 16).catch(() => []),
    getTodayActivities(user.id, todayYmd)
  ]);

  const latestWeight = recentWeights[0] || null;
  const latestLab = recentLabs[0] || null;
  const todayWeight = recentWeights.find((row) => String(row.logged_at || '').startsWith(todayYmd)) || null;

  const mealStatus = { breakfast: false, lunch: false, dinner: false };
  for (const meal of todayMeals) {
    mealStatus[classifyMealSlot(meal.eaten_at)] = true;
  }

  const todayRecords = {
    meals: todayMeals.map(buildMealRecordForSummary),
    exercises: (todayActivities || []).map((row) => ({
      summary: normalizeText(row.exercise_summary || '運動'),
      name: normalizeText(row.exercise_summary || '運動'),
      minutes: row.walking_minutes != null ? Number(row.walking_minutes) : null,
      steps: row.steps != null ? Number(row.steps) : null,
      distanceKm: null,
      estimatedCalories: row.estimated_activity_kcal != null ? Number(row.estimated_activity_kcal) : null
    })),
    weights: todayWeight ? [buildWeightSummary(todayWeight)] : [],
    labs: latestLab ? [{ summary: '血液検査あり', examDate: String(latestLab.measured_at || '').slice(0, 10), items: buildLabItems(latestLab) }] : []
  };

  const summaryText = await buildDailySummary({
    todayRecords,
    recentMessages,
    userState: {},
    longMemory: {
      aiType: user.ai_type || null,
      goal: user.goal || null,
      preferredName: user.display_name || null
    }
  });

  const summaryLines = String(summaryText || '').split('\n').map((v) => normalizeText(v)).filter(Boolean);
  const alerts = [];
  if (!todayMeals.length) alerts.push('今日はまだ食事記録が少なめです');
  if (!todayWeight) alerts.push('今日は体重記録がまだありません');
  if ((todayActivities || []).length === 0) alerts.push('今日は運動記録がまだありません');
  if (recentMessages.some((m) => /疲れ|しんどい|痛い|眠い/.test(m.content || ''))) alerts.push('最近の会話では疲れや不調の話題が出ています');

  return {
    todayYmd,
    todaySummary: summaryLines[summaryLines.length - 2] || summaryLines[0] || '今日はここから整えていける日です。',
    fullSummary: summaryLines,
    mealStatus,
    weightStatus: {
      recordedToday: Boolean(todayWeight),
      latestValue: latestWeight?.weight_kg != null ? Number(latestWeight.weight_kg) : null,
      latestBodyFat: latestWeight?.body_fat_pct != null ? Number(latestWeight.body_fat_pct) : null,
      latestDate: latestWeight?.logged_at ? String(latestWeight.logged_at).slice(0, 10) : null
    },
    alerts: alerts.slice(0, 3),
    aiNote: summaryLines[summaryLines.length - 1] || '今日は一つだけ整えられれば十分です。',
    latestLab: latestLab ? {
      examDate: String(latestLab.measured_at || '').slice(0, 10),
      items: buildLabItems(latestLab)
    } : null,
    recentMeals: todayMeals.slice(-3).map((row) => formatMealSummary(row)),
    recentMessagesCount: recentMessages.length,
    activityCountToday: (todayActivities || []).length
  };
}

async function getHomeData(user, options = {}) {
  const since = normalizeIsoCandidate(options.since);
  return withCache(buildCacheKey('home', user.id, since || ''), DEFAULT_CACHE_TTL_MS, async () => {
    const [home, overview, timeline, engagement, chatMessages] = await Promise.all([
      buildHomeBundle(user),
      getRecordsOverview(user),
      getRecentTimeline(user, 8),
      getEngagementSnapshot(user.id, 14),
      getChatHistory(user, 8)
    ]);
    return {
      ...home,
      careFocus: buildCareFocus(home, overview),
      consultLanes: buildConsultLanes(home, overview, timeline),
      recentTimeline: timeline,
      progressSnapshot: buildProgressSnapshot(home, overview, engagement),
      smallWins: buildSmallWins(home, overview, engagement),
      reassuranceNote: buildReassuranceNote(home, overview, engagement),
      actionPlan: buildActionPlan(home, overview, engagement),
      supportMode: buildSupportMode(home, overview, engagement, timeline),
      stuckPrompts: buildStuckPrompts(home, overview, engagement, timeline),
      supportCompass: buildSupportCompass(user, home, overview, engagement, timeline),
      returnDigest: buildReturnDigest(home, overview, engagement, timeline),
      microStep: buildMicroStep(home, overview, engagement, timeline),
      consultationCarry: buildConsultationCarry(home, overview, engagement, timeline),
      returnAnchor: buildReturnAnchor(home, overview, engagement, timeline),
      sinceDigest: await getSinceSummary(user, since, timeline),
      resumePrompts: buildResumePrompts(timeline, home, overview),
      conversationBridge: buildConversationBridge(chatMessages, home, overview),
      reentryGuide: buildReentryGuide(home, overview, engagement, timeline),
      engagement
    };
  });
}

function buildSidebarFromHome(home) {
  return {
    todaySummary: home.todaySummary,
    recentMeals: home.recentMeals,
    latestWeight: {
      value: home.weightStatus.latestValue,
      bodyFat: home.weightStatus.latestBodyFat,
      recordedAt: home.weightStatus.latestDate
    },
    latestLabNote: home.latestLab
      ? `${home.latestLab.examDate} / ${(home.latestLab.items || []).slice(0, 3).map((item) => `${item.itemName} ${item.value}`).join(' / ')}`
      : '血液検査データはまだありません'
  };
}

async function getChatSidebar(user, options = {}) {
  if (options.home) return buildSidebarFromHome(options.home);
  return withCache(buildCacheKey('sidebar', user.id), DEFAULT_CACHE_TTL_MS, async () => {
    const home = await getHomeData(user);
    return buildSidebarFromHome(home);
  });
}

async function getChatBundle(user, { limit = 40, since } = {}) {
  const safeSince = normalizeIsoCandidate(since);
  return withCache(buildCacheKey('chatBundle', user.id, `${limit}:${safeSince || ''}`), HISTORY_CACHE_TTL_MS, async () => {
    const [messages, sidebar, home, overview] = await Promise.all([
      getChatHistory(user, limit),
      getChatSidebar(user),
      getHomeData(user, { since: safeSince }),
      getRecordsOverview(user)
    ]);
    return {
      messages,
      sidebar,
      consultLanes: buildConsultLanes(home, overview, home.recentTimeline || []),
      recentTimeline: (home.recentTimeline || []).slice(0, 5),
      reflection: buildChatReflection(home, overview),
      followups: buildFollowupPrompts(home, overview),
      actionPlan: buildActionPlan(home, overview, home.engagement || {}),
      supportCompass: home.supportCompass || buildSupportCompass(user, home, overview, home.engagement || {}, home.recentTimeline || []),
      returnDigest: home.returnDigest || buildReturnDigest(home, overview, home.engagement || {}, home.recentTimeline || []),
      microStep: home.microStep || buildMicroStep(home, overview, home.engagement || {}, home.recentTimeline || []),
      resumePrompts: home.resumePrompts || buildResumePrompts(home.recentTimeline || [], home, overview),
      conversationBridge: home.conversationBridge || buildConversationBridge(messages, home, overview),
      reentryGuide: home.reentryGuide || buildReentryGuide(home, overview, home.engagement || {}, home.recentTimeline || []),
      consultationCarry: home.consultationCarry || buildConsultationCarry(home, overview, home.engagement || {}, home.recentTimeline || []),
      returnAnchor: home.returnAnchor || buildReturnAnchor(home, overview, home.engagement || {}, home.recentTimeline || []),
      sinceDigest: home.sinceDigest || await getSinceSummary(user, safeSince, home.recentTimeline || [])
    };
  });
}

async function getChatHistory(user, limit = 40) {
  return withCache(buildCacheKey('history', user.id, String(limit)), HISTORY_CACHE_TTL_MS, async () => {
    const { data, error } = await supabase
      .from('chat_logs')
      .select('role, message_text, created_at, source_channel')
      .eq('user_id', user.id)
      .in('role', ['user', 'assistant'])
      .order('created_at', { ascending: false })
      .limit(limit);
    if (error) throw error;
    return (data || [])
      .reverse()
      .map((row) => ({
        role: row.role,
        text: row.message_text || '',
        sourceChannel: row.source_channel || 'line',
        createdAt: row.created_at
      }));
  });
}

async function getMealsList(user, { from, to, limit = 50 } = {}) {
  let query = supabase
    .from('meal_logs')
    .select('eaten_at, meal_label, food_items, estimated_kcal, protein_g, fat_g, carbs_g, ai_comment')
    .eq('user_id', user.id)
    .order('eaten_at', { ascending: false })
    .limit(limit);
  if (from) query = query.gte('eaten_at', `${from}T00:00:00+09:00`);
  if (to) query = query.lte('eaten_at', `${to}T23:59:59+09:00`);
  const { data, error } = await query;
  if (error) throw error;
  return (data || []).map((row) => ({
    eatenAt: row.eaten_at,
    date: String(row.eaten_at || '').slice(0, 10),
    slot: classifyMealSlot(row.eaten_at),
    summary: formatMealSummary(row),
    estimatedKcal: row.estimated_kcal != null ? Number(row.estimated_kcal) : null,
    proteinG: row.protein_g != null ? Number(row.protein_g) : null,
    fatG: row.fat_g != null ? Number(row.fat_g) : null,
    carbsG: row.carbs_g != null ? Number(row.carbs_g) : null,
    comment: row.ai_comment || ''
  }));
}

async function getWeightsSeries(user, range = '30d') {
  const days = rangeToDays(range);
  const since = new Date(tokyoNow());
  since.setDate(since.getDate() - (days - 1));
  const { data, error } = await supabase
    .from('weight_logs')
    .select('logged_at, weight_kg, body_fat_pct')
    .eq('user_id', user.id)
    .gte('logged_at', since.toISOString())
    .order('logged_at', { ascending: true });
  if (error) throw error;
  const rows = data || [];
  const latest = rows.length ? rows[rows.length - 1] : null;
  const series = rows.map((row) => ({
    date: String(row.logged_at || '').slice(0, 10),
    value: row.weight_kg != null ? Number(row.weight_kg) : null,
    bodyFat: row.body_fat_pct != null ? Number(row.body_fat_pct) : null
  }));
  return {
    latest: latest ? {
      value: latest.weight_kg != null ? Number(latest.weight_kg) : null,
      bodyFat: latest.body_fat_pct != null ? Number(latest.body_fat_pct) : null,
      date: String(latest.logged_at || '').slice(0, 10)
    } : null,
    series,
    trend: computeWeightDelta(series, Math.min(days, 7))
  };
}

async function getLabsLatest(user) {
  const rows = await getRecentLabs(user.id, 1);
  const row = rows[0] || null;
  if (!row) return null;
  const items = buildLabItems(row);
  return {
    examDate: String(row.measured_at || '').slice(0, 10),
    items,
    summaryNote: items.length
      ? `${items.slice(0, 3).map((item) => `${item.itemName} ${item.value}`).join(' / ')}`
      : '検査結果があります'
  };
}

async function getLabsList(user, limit = 10) {
  const rows = await getRecentLabs(user.id, limit);
  return rows.map((row) => ({
    examDate: String(row.measured_at || '').slice(0, 10),
    items: buildLabItems(row)
  }));
}

async function getRecordsOverview(user, options = {}) {
  const useCache = !Object.prototype.hasOwnProperty.call(options, 'recentMeals')
    && !Object.prototype.hasOwnProperty.call(options, 'recentWeights')
    && !Object.prototype.hasOwnProperty.call(options, 'latestLab');

  if (useCache) {
    return withCache(buildCacheKey('recordsOverview', user.id), DEFAULT_CACHE_TTL_MS, () => getRecordsOverview(user, {
      recentMeals: undefined,
      recentWeights: undefined,
      latestLab: undefined,
      _skipCache: true
    }));
  }

  const recentMealsPromise = Array.isArray(options.recentMeals) ? Promise.resolve(options.recentMeals) : getRecentMeals(user.id, 10);
  const recentWeightsPromise = Array.isArray(options.recentWeights) ? Promise.resolve(options.recentWeights) : getRecentWeights(user.id, 8);
  const latestLabPromise = Object.prototype.hasOwnProperty.call(options, 'latestLab') ? Promise.resolve(options.latestLab || null) : getLabsLatest(user);
  const [recentMeals, recentWeights, latestLab] = await Promise.all([
    recentMealsPromise,
    recentWeightsPromise,
    latestLabPromise
  ]);

  const weightSeries = [...(recentWeights || [])].reverse().map((row) => ({
    date: String(row.logged_at || '').slice(0, 10),
    value: row.weight_kg != null ? Number(row.weight_kg) : null,
    bodyFat: row.body_fat_pct != null ? Number(row.body_fat_pct) : null
  }));
  const weightTrend = computeWeightDelta(weightSeries, 7);

  return {
    mealsCount: recentMeals.length,
    latestMealDate: recentMeals[0]?.eaten_at ? String(recentMeals[0].eaten_at).slice(0, 10) : null,
    latestWeightValue: recentWeights[0]?.weight_kg != null ? Number(recentWeights[0].weight_kg) : null,
    latestWeightDate: recentWeights[0]?.logged_at ? String(recentWeights[0].logged_at).slice(0, 10) : null,
    latestLabDate: latestLab?.examDate || null,
    latestLabNote: latestLab?.summaryNote || null,
    weightTrend,
    mealDaySpan: recentMeals.length > 1 ? `${String(recentMeals[recentMeals.length - 1].eaten_at || '').slice(0, 10)} 〜 ${String(recentMeals[0].eaten_at || '').slice(0, 10)}` : null
  };
}

async function getRecordsBundle(user, { range = '30d', labsLimit = 10, since } = {}) {
  const days = rangeToDays(range);
  const from = todayYmdMinusDays(days - 1);
  const safeSince = normalizeIsoCandidate(since);
  return withCache(buildCacheKey('recordsBundle', user.id, `${range}:${labsLimit}:${safeSince || ''}`), DEFAULT_CACHE_TTL_MS, async () => {
    const [overview, items, weights, latestLab, labs, timeline, home] = await Promise.all([
      getRecordsOverview(user),
      getMealsList(user, { from, limit: days > 30 ? 80 : 40 }),
      getWeightsSeries(user, range),
      getLabsLatest(user),
      getLabsList(user, labsLimit),
      getRecentTimeline(user, 8),
      getHomeData(user, { since: safeSince })
    ]);
    return {
      overview,
      meals: { items, from, range },
      weights,
      latestLab,
      labs: { items: labs },
      supportMode: home.supportMode || buildSupportMode(home, overview, home.engagement || {}, timeline),
      stuckPrompts: home.stuckPrompts || buildStuckPrompts(home, overview, home.engagement || {}, timeline),
      consultLanes: buildConsultLanes(home, overview, timeline),
      recentTimeline: timeline,
      supportCompass: home.supportCompass || buildSupportCompass(user, home, overview, home.engagement || {}, timeline),
      returnDigest: home.returnDigest || buildReturnDigest(home, overview, home.engagement || {}, timeline),
      microStep: home.microStep || buildMicroStep(home, overview, home.engagement || {}, timeline),
      resumePrompts: home.resumePrompts || buildResumePrompts(timeline, home, overview),
      conversationBridge: home.conversationBridge || buildConversationBridge(await getChatHistory(user, 8), home, overview),
      reentryGuide: home.reentryGuide || buildReentryGuide(home, overview, home.engagement || {}, timeline),
      consultationCarry: home.consultationCarry || buildConsultationCarry(home, overview, home.engagement || {}, timeline),
      returnAnchor: home.returnAnchor || buildReturnAnchor(home, overview, home.engagement || {}, timeline),
      sinceDigest: home.sinceDigest || await getSinceSummary(user, safeSince, timeline)
    };
  });
}

function buildSyncHint({ chatChangedAt, recordsChangedAt, homeChangedAt } = {}) {
  if (chatChangedAt && recordsChangedAt) return '会話と記録の両方に新しい動きがあります。';
  if (chatChangedAt) return '会話に新しい動きがあります。';
  if (recordsChangedAt) return '記録に新しい動きがあります。';
  if (homeChangedAt) return 'ホームに反映される新しい動きがあります。';
  return '最新状態です。';
}

async function getSyncStatus(user) {
  return withCache(buildCacheKey('sync', user.id), SYNC_CACHE_TTL_MS, async () => {
    const [chatChangedAt, mealChangedAt, weightChangedAt, labChangedAt, activityChangedAt] = await Promise.all([
      getLatestTimestamp(user.id, 'chat_logs', 'created_at'),
      getLatestTimestamp(user.id, 'meal_logs', 'eaten_at'),
      getLatestTimestamp(user.id, 'weight_logs', 'logged_at'),
      getLatestTimestamp(user.id, 'lab_results', 'measured_at'),
      getLatestTimestamp(user.id, 'activity_logs', 'logged_at')
    ]);

    const recordsChangedAt = latestIso([mealChangedAt, weightChangedAt, labChangedAt, activityChangedAt]);
    const homeChangedAt = latestIso([chatChangedAt, recordsChangedAt]);
    const version = latestIso([homeChangedAt, user.updated_at, user.created_at]) || new Date().toISOString();
    const scopeVersions = {
      chat: chatChangedAt || '',
      records: recordsChangedAt || '',
      home: homeChangedAt || ''
    };

    return {
      version,
      chatChangedAt: chatChangedAt || null,
      recordsChangedAt: recordsChangedAt || null,
      homeChangedAt: homeChangedAt || null,
      scopeVersions,
      scopes: {
        chat: Boolean(chatChangedAt),
        records: Boolean(recordsChangedAt),
        home: Boolean(homeChangedAt)
      },
      hint: buildSyncHint({ chatChangedAt, recordsChangedAt, homeChangedAt })
    };
  });
}

async function getBootstrapData(user, options = {}) {
  const since = normalizeIsoCandidate(options.since);
  return withCache(buildCacheKey('bootstrap', user.id, since || ''), DEFAULT_CACHE_TTL_MS, async () => {
    const home = await getHomeData(user, { since });
    const recentMeals = await getRecentMeals(user.id, 10);
    const recentWeights = await getRecentWeights(user.id, 8);
    const latestLab = home.latestLab ? {
      examDate: home.latestLab.examDate,
      items: home.latestLab.items,
      summaryNote: home.latestLab.items?.length ? home.latestLab.items.slice(0, 3).map((item) => `${item.itemName} ${item.value}`).join(' / ') : null
    } : null;
    const [recordsOverview, sync, timeline] = await Promise.all([
      getRecordsOverview(user, { recentMeals, recentWeights, latestLab }),
      getSyncStatus(user),
      getRecentTimeline(user, 8)
    ]);
    const sidebar = buildSidebarFromHome(home);
    const starters = buildStarterPrompts(home, recordsOverview);
    return {
      home,
      sidebar,
      recordsOverview,
      starters,
      sync,
      supportMode: home.supportMode || buildSupportMode(home, recordsOverview, home.engagement || {}, timeline),
      stuckPrompts: home.stuckPrompts || buildStuckPrompts(home, recordsOverview, home.engagement || {}, timeline),
      consultLanes: buildConsultLanes(home, recordsOverview, timeline),
      recentTimeline: timeline,
      reflection: buildChatReflection(home, recordsOverview),
      followups: buildFollowupPrompts(home, recordsOverview),
      supportCompass: home.supportCompass || buildSupportCompass(user, home, recordsOverview, home.engagement || {}, timeline),
      returnDigest: home.returnDigest || buildReturnDigest(home, recordsOverview, home.engagement || {}, timeline),
      microStep: home.microStep || buildMicroStep(home, recordsOverview, home.engagement || {}, timeline),
      resumePrompts: home.resumePrompts || buildResumePrompts(timeline, home, recordsOverview),
      conversationBridge: home.conversationBridge,
      reentryGuide: home.reentryGuide,
      consultationCarry: home.consultationCarry || buildConsultationCarry(home, recordsOverview, home.engagement || {}, timeline),
      returnAnchor: home.returnAnchor || buildReturnAnchor(home, recordsOverview, home.engagement || {}, timeline),
      sinceDigest: home.sinceDigest || await getSinceSummary(user, since, timeline)
    };
  });
}

module.exports = {
  dateYmdInTokyo,
  getHomeData,
  getChatSidebar,
  getChatBundle,
  getChatHistory,
  getMealsList,
  getWeightsSeries,
  getLabsLatest,
  getLabsList,
  getRecordsOverview,
  getRecordsBundle,
  getBootstrapData,
  getSyncStatus,
  buildStarterPrompts,
  getRecentTimeline,
  invalidateUserCache,
  buildChatReflection,
  buildFollowupPrompts,
  buildResumePrompts,
  buildSupportMode,
  buildStuckPrompts,
  buildSupportCompass,
  buildConversationBridge,
  buildReentryGuide,
  buildReturnDigest,
  buildSinceDigest,
  buildMicroStep,
  buildConsultationCarry,
  buildReturnAnchor
};
