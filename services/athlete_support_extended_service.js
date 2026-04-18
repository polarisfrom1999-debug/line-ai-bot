'use strict';

/**
 * 伴走（陸上）Phase 2〜4: 親向け要約、トレーナー、検査、傾向、レース対話、成功体験、印刷用 HTML
 */

const crypto = require('crypto');
const athleteSupportStoreService = require('./athlete_support_store_service');
const athleteSupportConfigService = require('./athlete_support_config_service');
const athleteSupportService = require('./athlete_support_service');

function normalizeText(value) {
  return String(value || '').trim();
}

function isoTodayTokyo() {
  return athleteSupportService.isoTodayTokyo();
}

function daysBetweenIso(fromIso, toIso) {
  const a = new Date(`${fromIso}T12:00:00+09:00`);
  const b = new Date(`${toIso}T12:00:00+09:00`);
  if (Number.isNaN(a.getTime()) || Number.isNaN(b.getTime())) return null;
  return Math.round((b - a) / (24 * 60 * 60 * 1000));
}

function monthKeyTokyo(d = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Tokyo',
    year: 'numeric',
    month: '2-digit'
  }).formatToParts(d);
  const y = parts.find((p) => p.type === 'year')?.value;
  const m = parts.find((p) => p.type === 'month')?.value;
  return `${y}-${m}`;
}

async function load(userId) {
  return athleteSupportStoreService.readState(userId);
}

async function save(userId, state) {
  await athleteSupportStoreService.writeState(userId, state);
}

/** 親向け: センシティブ生データを出さない要約＋関わり方ヒント */
function buildParentDashboard(state, dateIso) {
  const iso = normalizeText(dateIso) || isoTodayTokyo();
  const d = state.dailyByDate?.[iso] || {};
  const t = state.trainingByDate?.[iso] || {};
  const summaryLines = [];
  if (d.fatigue && /高|強|きつ/.test(d.fatigue)) {
    summaryLines.push('今日は疲労の感じが強めに見える日です。');
  } else if (d.fatigue) {
    summaryLines.push(`疲労の感じ: ${d.fatigue} くらいの日として見ています。`);
  }
  if (d.mood) summaryLines.push(`気分の流れ: ${d.mood} という感じの記述がありました。`);
  if (d.appetite && /少|ない|無/.test(d.appetite)) {
    summaryLines.push('食事の量が少なめに感じられる記述がありました。');
  }
  if (d.sleep && (/少|短|5|4|3/.test(d.sleep))) {
    summaryLines.push('睡眠が薄めに感じられる日かもしれません。');
  }
  let menstrualSummaryOnly = '';
  if (d.menstrual && /つら|重|強|痛|だる/.test(d.menstrual)) {
    menstrualSummaryOnly = '体調の波が強めの期間に近いかもしれません。（詳細は共有していません）';
  } else if (d.menstrual && /あり|生理|きて/.test(d.menstrual)) {
    menstrualSummaryOnly = '体調の波があるタイミングかもしれません。（詳細は共有していません）';
  }

  const engagementHints = [];
  const avoidPhrases = [];
  if (summaryLines.some((s) => /疲労|睡眠|少なめ/.test(s))) {
    engagementHints.push('今日はアドバイスより「お疲れさま」と安心の一言が向いています。');
    avoidPhrases.push('比較の言葉（他の子と〜）は控えめがよさそうです。');
  }
  if (menstrualSummaryOnly) {
    engagementHints.push('温かい食事と休息のサポートが向いていそうです。');
    avoidPhrases.push('詳しく聞き詰めるより、本人のペースを尊重する声かけが向いています。');
  }
  if (t.selfComment && /悔|だめ|最悪/.test(t.selfComment)) {
    engagementHints.push('レースや練習の深掘りより、まず受け止める声かけが向いていそうです。');
    avoidPhrases.push('分析や正論の連発は避けた方がよさそうです。');
  }
  if (!engagementHints.length) {
    engagementHints.push('小さな良いところを一つ見つけて伝えられると安心が伝わりやすいです。');
  }
  if (!avoidPhrases.length) {
    avoidPhrases.push('結果だけで語りすぎないのがよさそうです。');
  }

  const daysTo = state.profile?.nextCompetitionDate
    ? daysBetweenIso(iso, state.profile.nextCompetitionDate)
    : null;
  let raceHint = '';
  if (daysTo != null && daysTo >= 0 && daysTo <= 7) {
    raceHint = '大会が近い日です。生活リズムの支えと「お疲れさま」が中心になりやすいです。';
  }
  if (daysTo != null && daysTo === 0) {
    raceHint = '本番当日は、分析より先に「いってらっしゃい」「お疲れさま」が合いやすいです。';
  }
  if (daysTo != null && daysTo < 0 && daysTo >= -3) {
    raceHint = 'レース直後は、まず受け止め。深い振り返りは少しあとでも大丈夫です。';
  }

  return {
    date: iso,
    athleteDisplayName: state.profile?.displayName || '選手',
    summaryLines,
    menstrualSummaryOnly,
    engagementHints,
    avoidPhrases,
    raceHint,
    growthThisWeek: buildGrowthPoints(state, iso),
    parentMonthlyTheme: athleteSupportConfigService.getMonthlyDialogue(
      Number(monthKeyTokyo().split('-')[1]) || 4
    )
  };
}

function buildGrowthPoints(state, iso) {
  const dates = Object.keys(state.trainingByDate || {}).sort().slice(-7);
  const points = [];
  for (const dt of dates) {
    const tr = state.trainingByDate[dt];
    if (tr?.selfComment && tr.selfComment.length > 8) {
      points.push(`${dt}: 振り返りあり（継続の力）`);
    }
  }
  if (!points.length) points.push('記録が少なくても、来た日の分だけで十分です。');
  return points.slice(-4);
}

async function saveParentDaily(userId, body = {}) {
  const iso = normalizeText(body.date) || isoTodayTokyo();
  const state = await load(userId);
  state.parentByDate = state.parentByDate || {};
  state.parentByDate[iso] = {
    parentMood: normalizeText(body.parentMood).slice(0, 120),
    parentNote: normalizeText(body.parentNote).slice(0, 2000),
    supportWin: normalizeText(body.supportWin).slice(0, 400),
    overwordReflect: normalizeText(body.overwordReflect).slice(0, 400),
    updatedAt: new Date().toISOString()
  };
  await save(userId, state);
  const next = await load(userId);
  return { ok: true, parent: buildParentDashboard(next, iso) };
}

async function saveParentMonthly(userId, body = {}) {
  const key = normalizeText(body.monthKey) || monthKeyTokyo();
  const state = await load(userId);
  state.parentMonthlyByMonth = state.parentMonthlyByMonth || {};
  state.parentMonthlyByMonth[key] = {
    q1: normalizeText(body.q1).slice(0, 2000),
    q2: normalizeText(body.q2).slice(0, 2000),
    q3: normalizeText(body.q3).slice(0, 2000),
    q4: normalizeText(body.q4).slice(0, 2000),
    updatedAt: new Date().toISOString()
  };
  await save(userId, state);
  return { ok: true, monthKey: key };
}

async function translateParentNoteForAthlete(userId, body = {}) {
  const raw = normalizeText(body.rawMessage).slice(0, 3000);
  const state = await load(userId);
  state.parentNotesForAthlete = state.parentNotesForAthlete || [];
  let summaryForAthlete = '';
  let usedAi = false;
  if (raw) {
    try {
      const aiChatService = require('./ai_chat_service');
      if (process.env.OPENAI_API_KEY) {
        summaryForAthlete = normalizeText(
          await aiChatService.generateNaturalResponse(
            '親からのメッセージの要約',
            {
              intentType: 'parent_note_translate',
              responseMode: 'conversation_first',
              messageType: 'text',
              recentMessages: [],
              longMemory: {},
              energyLevel: 'middle'
            },
            {
              draftReply: [
                '次の原文は「親が書いたメモ」です。本人には原文を見せず、責めない言い方で要約してください。',
                '人格否定は禁止。事実の断定は避け、やわらかい一言と、必要なら一つだけ前向きな行動を添えてください。',
                `原文: ${raw}`
              ].join('\n'),
              hasStructuredData: true
            }
          )
        );
        usedAi = Boolean(summaryForAthlete && summaryForAthlete.length > 8);
      }
    } catch (_e) {
      usedAi = false;
    }
    if (!summaryForAthlete) {
      summaryForAthlete = [
        '（自動やわらか要約）今日の気持ちや応援の気持ちを受け取ったよ、というニュアンスで伝えてみてください。',
        '原文の厳しい表現はそのまま使わず、短く安心できる言葉に置き換えるのがおすすめです。'
      ].join('');
    }
  }
  state.parentNotesForAthlete.push({
    id: crypto.randomBytes(8).toString('hex'),
    rawMessage: raw,
    summaryForAthlete,
    usedAi,
    createdAt: new Date().toISOString(),
    showToAthlete: body.showToAthlete === true || body.showToAthlete === '1'
  });
  await save(userId, state);
  return { ok: true, summaryForAthlete, usedAi, notes: state.parentNotesForAthlete.slice(-20) };
}

function buildTrends(state) {
  const dates = Object.keys(state.dailyByDate || {}).sort().slice(-28);
  const fatigueSeries = dates.map((dt) => {
    const f = state.dailyByDate[dt]?.fatigue || '';
    let rough = null;
    if (/低|ライト|少/.test(f)) rough = 1;
    else if (/中|ふつう|普通/.test(f)) rough = 2;
    else if (/高|強|きつ/.test(f)) rough = 3;
    return { date: dt, fatigue: f || null, rough };
  });
  const appetiteLowDays = dates.filter((dt) => /少|無|ない|微妙/.test(state.dailyByDate[dt]?.appetite || '')).length;
  const menstrualMarked = dates.filter((dt) => /あり|生理|つら|痛|重/.test(state.dailyByDate[dt]?.menstrual || '')).length;
  const weights = Array.isArray(state.weeklyWeights) ? state.weeklyWeights : [];
  const summary = [];
  if (appetiteLowDays >= 3) summary.push('直近で「食が細い」記述が続いています。睡眠・月経・試合前後の文脈を合わせて見てください。');
  if (menstrualMarked >= 2) summary.push('月経まわりの記述が複数日に及んでいます。負荷調整の検討が向いていそうです。');
  if (!summary.length) summary.push('大きな偏りは見えにくい期間です。引き続き軽い記録で十分です。');
  return {
    fatigueSeries,
    appetiteLowDaysLast28: appetiteLowDays,
    menstrualRelatedDaysLast28: menstrualMarked,
    weeklyWeights: weights,
    summary
  };
}

function buildTrainerDashboard(state, dateIso) {
  const iso = normalizeText(dateIso) || isoTodayTokyo();
  const dates = Object.keys(state.dailyByDate || {}).sort().slice(-21);
  const series = dates.map((dt) => ({
    date: dt,
    sleep: state.dailyByDate[dt]?.sleep,
    fatigue: state.dailyByDate[dt]?.fatigue,
    menstrual: state.dailyByDate[dt]?.menstrual,
    appetite: state.dailyByDate[dt]?.appetite,
    legPain: state.dailyByDate[dt]?.legPain,
    mood: state.dailyByDate[dt]?.mood
  }));
  const alerts = [];
  const last7 = dates.slice(-7);
  let fatigueHigh = 0;
  let appetiteLow = 0;
  for (const dt of last7) {
    const x = state.dailyByDate[dt];
    if (x?.fatigue && /高|強/.test(x.fatigue)) fatigueHigh += 1;
    if (x?.appetite && /少|ない|無/.test(x.appetite)) appetiteLow += 1;
  }
  if (fatigueHigh >= 3) alerts.push('直近で疲労高めの記述が続いています。負荷と睡眠の確認が向いていそうです。');
  if (appetiteLow >= 2) alerts.push('食事量が少なめの記述が見られます。月経や試合前後の文脈も合わせて見てください。');

  const menstrualRough = last7
    .map((dt) => state.dailyByDate[dt]?.menstrual)
    .filter(Boolean)
    .join(' / ');
  if (/つら|痛|重/.test(menstrualRough)) {
    alerts.push('月経関連のつらさの記述があります。詳細は選手入力を参照し、無理のない調整を。');
  }

  const labs = Array.isArray(state.labRecords) ? state.labRecords.slice(-8) : [];
  const hbLatest = [...labs].reverse().find((l) => l.hb != null);
  if (hbLatest && Number(hbLatest.hb) < 12.0) {
    alerts.push('Hb が低めの記録があります。鉄・再検査の医療判断は専門家に委ねてください。');
  }

  const weights = Array.isArray(state.weeklyWeights) ? state.weeklyWeights.slice(-12) : [];

  const parentNotes = (state.parentByDate && state.parentByDate[iso]?.parentNote) || '';

  return {
    date: iso,
    timeSeries: series,
    alerts,
    labRecords: labs,
    weeklyWeights: weights,
    trends: buildTrends(state),
    parentMemoToday: parentNotes.slice(0, 400),
    trainerMonthlyTheme: athleteSupportConfigService.getMonthlyDialogue(
      Number(iso.slice(5, 7)) || 4
    ),
    profile: state.profile
  };
}

async function saveTrainerMonthly(userId, body = {}) {
  const key = normalizeText(body.monthKey) || monthKeyTokyo();
  const state = await load(userId);
  state.trainerMonthlyByMonth = state.trainerMonthlyByMonth || {};
  state.trainerMonthlyByMonth[key] = {
    success: normalizeText(body.success).slice(0, 2000),
    challenge: normalizeText(body.challenge).slice(0, 2000),
    messageToParent: normalizeText(body.messageToParent).slice(0, 2000),
    nextTheme: normalizeText(body.nextTheme).slice(0, 800),
    updatedAt: new Date().toISOString()
  };
  await save(userId, state);
  return { ok: true, monthKey: key };
}

async function saveWeeklyWeights(userId, body = {}) {
  const state = await load(userId);
  state.weeklyWeights = Array.isArray(body.entries) ? body.entries.slice(0, 52) : state.weeklyWeights || [];
  await save(userId, state);
  return { ok: true, weeklyWeights: state.weeklyWeights };
}

async function saveLabRecord(userId, body = {}) {
  const state = await load(userId);
  state.labRecords = Array.isArray(state.labRecords) ? state.labRecords : [];
  const row = {
    id: normalizeText(body.id) || crypto.randomBytes(8).toString('hex'),
    date: normalizeText(body.date).slice(0, 16) || isoTodayTokyo(),
    hb: body.hb != null && body.hb !== '' ? Number(body.hb) : null,
    ferritin: body.ferritin != null && body.ferritin !== '' ? Number(body.ferritin) : null,
    fe: body.fe != null && body.fe !== '' ? Number(body.fe) : null,
    tibc: body.tibc != null && body.tibc !== '' ? Number(body.tibc) : null,
    tsat: normalizeText(body.tsat).slice(0, 32),
    doctorNote: normalizeText(body.doctorNote).slice(0, 2000),
    supplementNote: normalizeText(body.supplementNote).slice(0, 800),
    nextReviewDue: normalizeText(body.nextReviewDue).slice(0, 32),
    updatedAt: new Date().toISOString()
  };
  const idx = state.labRecords.findIndex((r) => r.id === row.id);
  if (idx >= 0) state.labRecords[idx] = row;
  else state.labRecords.push(row);
  state.labRecords.sort((a, b) => String(a.date).localeCompare(String(b.date)));
  await save(userId, state);
  return { ok: true, labRecords: state.labRecords.slice(-20) };
}

async function deleteLabRecord(userId, id) {
  const state = await load(userId);
  state.labRecords = (state.labRecords || []).filter((r) => r.id !== id);
  await save(userId, state);
  return { ok: true };
}

function labCompare(state) {
  const labs = [...(state.labRecords || [])].sort((a, b) => String(a.date).localeCompare(String(b.date)));
  if (labs.length < 2) return { message: '比較には2件以上の記録があると見やすいです。' };
  const a = labs[labs.length - 2];
  const b = labs[labs.length - 1];
  const parts = [];
  if (a.hb != null && b.hb != null) parts.push(`Hb ${a.hb} → ${b.hb}`);
  if (a.ferritin != null && b.ferritin != null) parts.push(`フェリチン ${a.ferritin} → ${b.ferritin}`);
  return { message: parts.join(' / ') || '前回比を確認してください。', previous: a, latest: b };
}

const RACE_PRE = [
  { id: 'q1', text: '今日はどんなレースにしたい？' },
  { id: 'q2', text: '最初の200mはどう入りたい？' },
  { id: 'q3', text: '苦しくなった時、何を思い出したい？' },
  { id: 'q4', text: '今日の自分に必要な言葉は？' }
];

const RACE_POST = [
  { id: 'p1', text: 'まず今日やり切った自分をどう思う？' },
  { id: 'p2', text: '良かったところを一つ挙げるなら？' },
  { id: 'p3', text: '次に変えたいところはどこ？' },
  { id: 'p4', text: '今日の経験は何につながりそう？' }
];

async function getRaceDialogue(userId) {
  const state = await load(userId);
  state.raceDialogue = state.raceDialogue || { phase: 'idle', preAnswers: {}, postAnswers: {}, updatedAt: null };
  return {
    phase: state.raceDialogue.phase,
    preQuestions: RACE_PRE,
    postQuestions: RACE_POST,
    preAnswers: state.raceDialogue.preAnswers,
    postAnswers: state.raceDialogue.postAnswers
  };
}

async function saveRaceDialogue(userId, body = {}) {
  const state = await load(userId);
  state.raceDialogue = state.raceDialogue || { phase: 'idle', preAnswers: {}, postAnswers: {}, updatedAt: null };
  if (normalizeText(body.action) === 'reset') {
    state.raceDialogue = { phase: 'idle', preAnswers: {}, postAnswers: {}, updatedAt: new Date().toISOString() };
    await save(userId, state);
    return getRaceDialogue(userId);
  }
  const phase = normalizeText(body.phase) || state.raceDialogue.phase;
  const qid = normalizeText(body.questionId);
  const answer = normalizeText(body.answer).slice(0, 2000);
  if (phase === 'pre') {
    state.raceDialogue.phase = 'pre';
    if (qid) state.raceDialogue.preAnswers[qid] = answer;
  } else if (phase === 'post') {
    state.raceDialogue.phase = 'post';
    if (qid) state.raceDialogue.postAnswers[qid] = answer;
  } else {
    state.raceDialogue.phase = 'idle';
  }
  state.raceDialogue.updatedAt = new Date().toISOString();
  await save(userId, state);
  return getRaceDialogue(userId);
}

async function addSuccessHighlight(userId, body = {}) {
  const state = await load(userId);
  state.successHighlights = Array.isArray(state.successHighlights) ? state.successHighlights : [];
  state.successHighlights.push({
    id: crypto.randomBytes(6).toString('hex'),
    who: normalizeText(body.who).slice(0, 20) || 'athlete',
    text: normalizeText(body.text).slice(0, 2000),
    createdAt: new Date().toISOString()
  });
  await save(userId, state);
  return { ok: true, highlights: state.successHighlights.slice(-50) };
}

function buildReminders(state, iso) {
  const list = [];
  const days = state.profile?.nextCompetitionDate ? daysBetweenIso(iso, state.profile.nextCompetitionDate) : null;
  if (days != null && days === 7) list.push('次の本番まであと1週間。睡眠と食事のリズムを整える週にしやすいです。');
  if (days != null && days === 1) list.push('前日は新しい刺激より、落ち着いた過ごし方が向きやすいです。');
  if (days != null && days === 0) list.push('当日はいつもの準備で。緊張はエネルギーに変わりやすいです。');
  const m = Number(iso.slice(5, 7));
  if (m === 10) list.push('東京ジュニアを意識する季節です。長い目標と今週の一歩を両方持てると安心です。');
  if (m === 11 || m === 12) list.push('駅伝・秋冬シーズン。持久力と「苦しい中の姿勢」がテーマになりやすいです。');
  return list;
}

function escapeHtml(s) {
  return String(s || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function buildMonthlyPrintHtml(userId, state) {
  const mk = monthKeyTokyo();
  const [y, m] = mk.split('-');
  const theme = athleteSupportConfigService.getMonthlyDialogue(Number(m) || 4);
  const pm = state.parentMonthlyByMonth?.[mk] || {};
  const tm = state.trainerMonthlyByMonth?.[mk] || {};
  const am = state.profile || {};

  return `<!DOCTYPE html><html lang="ja"><head><meta charset="utf-8"><title>月1シート ${escapeHtml(mk)}</title>
<style>
body{font-family:system-ui,sans-serif;max-width:800px;margin:24px auto;color:#222;line-height:1.5}
h1{font-size:1.25rem} h2{font-size:1rem;margin-top:1.2em;border-bottom:1px solid #ccc;padding-bottom:4px}
.section{border:1px solid #ddd;padding:12px;margin-bottom:12px;border-radius:8px}
ul{padding-left:1.2em}
@media print{ body{margin:12mm} .noprint{display:none} }
</style></head><body>
<h1>ここから。伴走（陸上）— 月1シート <small>${escapeHtml(mk)}</small></h1>
<p class="noprint">ブラウザの印刷（Ctrl+P）で A4 に近い体裁で保存できます。</p>
<div class="section"><h2>選手プロフィール（抜粋）</h2>
<p>表示名: ${escapeHtml(am.displayName)} / 800m目標: ${escapeHtml(am.targetTime800)} / 1500m目標: ${escapeHtml(am.targetTime1500)}</p>
<p>次の本番: ${escapeHtml(am.nextCompetitionName)} ${escapeHtml(am.nextCompetitionDate)}</p>
</div>
<div class="section"><h2>月のテーマ: ${escapeHtml(theme.title)}</h2>
<h3>選手向け問い</h3><ul>${(theme.athlete || []).map((x) => `<li>${escapeHtml(x)}</li>`).join('')}</ul>
<h3>親向け問い</h3><ul>${(theme.parent || []).map((x) => `<li>${escapeHtml(x)}</li>`).join('')}</ul>
</div>
<div class="section"><h2>親の月1メモ（WEB入力）</h2>
<p>${escapeHtml(pm.q1 || '（未記入）')}</p><p>${escapeHtml(pm.q2 || '')}</p><p>${escapeHtml(pm.q3 || '')}</p><p>${escapeHtml(pm.q4 || '')}</p>
</div>
<div class="section"><h2>トレーナー月1</h2>
<p><strong>成功体験</strong><br>${escapeHtml(tm.success || '（未記入）')}</p>
<p><strong>課題</strong><br>${escapeHtml(tm.challenge || '')}</p>
<p><strong>親への一言</strong><br>${escapeHtml(tm.messageToParent || '')}</p>
<p><strong>来月のテーマ</strong><br>${escapeHtml(tm.nextTheme || '')}</p>
</div>
<div class="section"><h2>手書き・写真用スペース</h2>
<p style="min-height:120px;border:1px dashed #bbb;border-radius:6px;padding:8px">ここにメモや印刷した写真を貼る余地を残してください。</p>
</div>
</body></html>`;
}

module.exports = {
  buildParentDashboard,
  saveParentDaily,
  saveParentMonthly,
  translateParentNoteForAthlete,
  buildTrainerDashboard,
  saveTrainerMonthly,
  saveWeeklyWeights,
  saveLabRecord,
  deleteLabRecord,
  labCompare,
  getRaceDialogue,
  saveRaceDialogue,
  addSuccessHighlight,
  buildReminders,
  buildMonthlyPrintHtml,
  buildTrends,
  monthKeyTokyo,
  load
};
