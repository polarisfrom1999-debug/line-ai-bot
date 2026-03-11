'use strict';

function pad2(v) {
  return String(v).padStart(2, '0');
}

function formatDateOnly(value) {
  if (!value) return '';
  const s = String(value).trim();

  const direct = s.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})/);
  if (direct) {
    return `${direct[1]}-${pad2(direct[2])}-${pad2(direct[3])}`;
  }

  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return '';
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

function toNumberOrNull(v) {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function buildGraphMenuQuickReplies() {
  return ['体重グラフ', '血液検査グラフ', 'HbA1cグラフ', 'LDLグラフ', '食事活動グラフ', '予測'];
}

function buildLabGraphMessage(rows, metric = 'hba1c') {
  const list = Array.isArray(rows) ? rows : [];
  const key = metric === 'ldl' ? 'ldl' : 'hba1c';
  const label = key === 'ldl' ? 'LDL' : 'HbA1c';

  const sorted = [...list]
    .filter((r) => toNumberOrNull(r?.[key]) !== null)
    .sort((a, b) => {
      const aTime = new Date(a?.measured_at || 0).getTime();
      const bTime = new Date(b?.measured_at || 0).getTime();
      return aTime - bTime;
    });

  if (!sorted.length) {
    return {
      text: `${label}の表示に使える血液検査データがまだありません。血液検査画像を送って保存すると表示しやすくなります。`,
      messages: [],
    };
  }

  const latest = sorted[sorted.length - 1];
  const prev = sorted.length >= 2 ? sorted[sorted.length - 2] : null;
  const latestValue = toNumberOrNull(latest?.[key]);
  const prevValue = toNumberOrNull(prev?.[key]);

  const trendText = (() => {
    if (latestValue === null) return '';
    if (prevValue === null) return '前回比較はまだありません。';
    const diff = Math.round((latestValue - prevValue) * 100) / 100;
    if (diff === 0) return '前回から変化はありません。';
    if (diff > 0) return `前回より ${diff} 上がっています。`;
    return `前回より ${Math.abs(diff)} 下がっています。`;
  })();

  const lines = sorted.slice(-12).map((row) => {
    const date = formatDateOnly(row?.measured_at);
    const value = toNumberOrNull(row?.[key]);
    if (!date || value === null) return null;
    return `・${date}: ${value}`;
  }).filter(Boolean);

  return {
    text: [
      `${label}の推移です。`,
      '',
      `最新: ${formatDateOnly(latest?.measured_at)} / ${latestValue}`,
      trendText,
      '',
      '履歴:',
      ...lines,
    ].filter(Boolean).join('\n'),
    messages: [],
  };
}

function buildEnergyGraphMessage(dayRows) {
  const rows = Array.isArray(dayRows) ? dayRows : [];
  const normalized = rows
    .map((row) => ({
      date: formatDateOnly(row?.date),
      intake_kcal: toNumberOrNull(row?.intake_kcal) || 0,
      activity_kcal: toNumberOrNull(row?.activity_kcal) || 0,
      net_kcal: toNumberOrNull(row?.net_kcal) || 0,
    }))
    .filter((row) => row.date);

  if (!normalized.length) {
    return {
      text: '食事活動グラフに使えるデータがまだありません。食事や運動を記録すると確認できるようになります。',
      messages: [],
    };
  }

  const totalIntake = normalized.reduce((sum, row) => sum + row.intake_kcal, 0);
  const totalActivity = normalized.reduce((sum, row) => sum + row.activity_kcal, 0);
  const avgNet = Math.round((normalized.reduce((sum, row) => sum + row.net_kcal, 0) / normalized.length) * 10) / 10;

  const lines = normalized.map((row) => {
    return `・${row.date} / 摂取 ${row.intake_kcal} kcal / 活動 ${row.activity_kcal} kcal / 差分 ${row.net_kcal} kcal`;
  });

  return {
    text: [
      '直近の食事・活動の流れです。',
      '',
      `合計摂取: ${Math.round(totalIntake)} kcal`,
      `合計活動: ${Math.round(totalActivity)} kcal`,
      `1日平均差分: ${avgNet} kcal`,
      '',
      '履歴:',
      ...lines,
    ].join('\n'),
    messages: [],
  };
}

function buildWeightGraphMessage(rows) {
  const list = Array.isArray(rows) ? rows : [];
  const sorted = [...list]
    .filter((r) => toNumberOrNull(r?.weight_kg) !== null)
    .sort((a, b) => {
      const aTime = new Date(a?.measured_at || 0).getTime();
      const bTime = new Date(b?.measured_at || 0).getTime();
      return aTime - bTime;
    });

  if (!sorted.length) {
    return {
      text: '体重データがまだありません。たとえば「体重 63.2」と送ると保存できます。',
      messages: [],
    };
  }

  const latest = sorted[sorted.length - 1];
  const prev = sorted.length >= 2 ? sorted[sorted.length - 2] : null;
  const first = sorted[0];

  const latestValue = toNumberOrNull(latest?.weight_kg);
  const prevValue = toNumberOrNull(prev?.weight_kg);
  const firstValue = toNumberOrNull(first?.weight_kg);

  const dayDiffText = (() => {
    if (latestValue === null || prevValue === null) return '前回比較はまだありません。';
    const diff = Math.round((latestValue - prevValue) * 10) / 10;
    if (diff === 0) return '前回から変化はありません。';
    if (diff > 0) return `前回より ${diff}kg 増えています。`;
    return `前回より ${Math.abs(diff)}kg 減っています。`;
  })();

  const totalDiffText = (() => {
    if (latestValue === null || firstValue === null || sorted.length < 2) return null;
    const diff = Math.round((latestValue - firstValue) * 10) / 10;
    if (diff === 0) return '初回からの変化はありません。';
    if (diff > 0) return `初回から ${diff}kg 増えています。`;
    return `初回から ${Math.abs(diff)}kg 減っています。`;
  })();

  const lines = sorted.slice(-12).map((row) => {
    const date = formatDateOnly(row?.measured_at);
    const value = toNumberOrNull(row?.weight_kg);
    if (!date || value === null) return null;
    return `・${date}: ${value}kg`;
  }).filter(Boolean);

  return {
    text: [
      '体重の推移です。',
      '',
      `最新: ${formatDateOnly(latest?.measured_at)} / ${latestValue}kg`,
      dayDiffText,
      totalDiffText,
      '',
      '履歴:',
      ...lines,
    ].filter(Boolean).join('\n'),
    messages: [],
  };
}

module.exports = {
  buildLabGraphMessage,
  buildEnergyGraphMessage,
  buildWeightGraphMessage,
  buildGraphMenuQuickReplies,
};