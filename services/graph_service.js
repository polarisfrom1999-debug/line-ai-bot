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

function formatShortDate(value) {
  const full = formatDateOnly(value);
  if (!full) return '';
  const m = full.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return full;
  return `${m[2]}/${m[3]}`;
}

function toNumberOrNull(v) {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function round1(v) {
  return Math.round(v * 10) / 10;
}

function round2(v) {
  return Math.round(v * 100) / 100;
}

function buildGraphMenuQuickReplies() {
  return ['体重グラフ', '血液検査グラフ', 'HbA1cグラフ', 'LDLグラフ', '食事活動グラフ', '予測'];
}

function getTrendDirection(values) {
  const nums = (values || []).map(toNumberOrNull).filter((v) => v !== null);
  if (nums.length < 3) return 'insufficient';

  const first = nums[0];
  const last = nums[nums.length - 1];
  const diff = last - first;

  if (Math.abs(diff) < 0.15) return 'flat';
  if (diff > 0) return 'up';
  return 'down';
}

function buildQuickChartUrl(chartConfig, width = 900, height = 520) {
  const json = JSON.stringify(chartConfig);
  const encoded = encodeURIComponent(json);
  return `https://quickchart.io/chart?width=${width}&height=${height}&devicePixelRatio=2&format=png&c=${encoded}`;
}

function buildLineImageMessage(url) {
  return {
    type: 'image',
    originalContentUrl: url,
    previewImageUrl: url,
  };
}

function buildLineChartImage(title, labels, values, yLabel = '') {
  const safeLabels = Array.isArray(labels) ? labels : [];
  const safeValues = Array.isArray(values) ? values : [];

  const config = {
    type: 'line',
    data: {
      labels: safeLabels,
      datasets: [
        {
          label: title,
          data: safeValues,
          fill: false,
          borderWidth: 2,
          pointRadius: 3,
          tension: 0.25,
        },
      ],
    },
    options: {
      plugins: {
        title: { display: true, text: title },
        legend: { display: true },
      },
      scales: {
        y: {
          title: { display: !!yLabel, text: yLabel },
        },
        x: {
          ticks: { maxRotation: 0, minRotation: 0 },
        },
      },
    },
  };

  return buildLineImageMessage(buildQuickChartUrl(config));
}

function buildDualLineChartImage(title, labels, seriesA, seriesB, labelA, labelB, yLabel = 'kcal') {
  const config = {
    type: 'line',
    data: {
      labels,
      datasets: [
        {
          label: labelA,
          data: seriesA,
          fill: false,
          borderWidth: 2,
          pointRadius: 3,
          tension: 0.25,
        },
        {
          label: labelB,
          data: seriesB,
          fill: false,
          borderWidth: 2,
          pointRadius: 3,
          tension: 0.25,
        },
      ],
    },
    options: {
      plugins: {
        title: { display: true, text: title },
        legend: { display: true },
      },
      scales: {
        y: {
          beginAtZero: true,
          title: { display: true, text: yLabel },
        },
        x: {
          ticks: { maxRotation: 0, minRotation: 0 },
        },
      },
    },
  };

  return buildLineImageMessage(buildQuickChartUrl(config));
}

function describeWeightTrend(rows) {
  const values = rows.map((r) => toNumberOrNull(r?.weight_kg)).filter((v) => v !== null);
  const trend = getTrendDirection(values.slice(-5));

  if (trend === 'down') {
    return '直近はゆるやかに下がる流れです。焦らずこのペースを大事にしていきましょう。';
  }
  if (trend === 'up') {
    return '直近は少し上向きです。数日単位の揺れもあるので、食事と活動の流れを一緒に見るのがおすすめです。';
  }
  if (trend === 'flat') {
    return '直近は大きく崩れず横ばいです。まずは安定していること自体が前進です。';
  }
  return '体重の流れは、もう少し記録が増えると読みやすくなります。';
}

function describeLabTrend(label, rows, key) {
  const values = rows.map((r) => toNumberOrNull(r?.[key])).filter((v) => v !== null);
  const trend = getTrendDirection(values.slice(-5));

  if (trend === 'down') {
    return `${label}は直近では下がる流れです。無理のない積み重ねが数字にも出ている可能性があります。`;
  }
  if (trend === 'up') {
    return `${label}は直近では少し上向きです。1回だけで決めつけず、食事・活動・次回検査も合わせて見ていきましょう。`;
  }
  if (trend === 'flat') {
    return `${label}は大きく崩れず安定しています。まずはこの安定を保てると良い流れです。`;
  }
  return `${label}は、もう少し記録が増えると流れを読みやすくなります。`;
}

function describeEnergyTrend(rows) {
  const normalized = rows.map((row) => ({
    intake: toNumberOrNull(row?.intake_kcal) || 0,
    activity: toNumberOrNull(row?.activity_kcal) || 0,
    net: toNumberOrNull(row?.net_kcal) || 0,
  }));

  if (!normalized.length) {
    return '食事と活動の記録が増えると、流れがもっと読みやすくなります。';
  }

  const avgIntake = normalized.reduce((sum, row) => sum + row.intake, 0) / normalized.length;
  const avgActivity = normalized.reduce((sum, row) => sum + row.activity, 0) / normalized.length;
  const avgNet = normalized.reduce((sum, row) => sum + row.net, 0) / normalized.length;

  const comments = [];

  if (avgNet > 300) {
    comments.push('全体としては摂取がやや上回りやすい流れです。食事量か間食の見直し余地があるかもしれません。');
  } else if (avgNet < -100) {
    comments.push('全体としては活動がしっかり積み上がっています。無理なく続けられると良い流れです。');
  } else {
    comments.push('全体としては大きく崩れすぎず、バランスは極端ではありません。');
  }

  if (avgActivity < 80) {
    comments.push('活動量はまだ伸ばせる余地があります。短い運動の積み上げでも十分意味があります。');
  } else {
    comments.push('活動量はある程度保てています。この安定は大きな強みです。');
  }

  if (avgIntake > 2200) {
    comments.push('摂取量はやや高めの日が混ざっていそうです。食事記録と一緒に見ると整えやすくなります。');
  }

  return comments.join('\n');
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
    })
    .slice(-12);

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
    const diff = round2(latestValue - prevValue);
    if (diff === 0) return '前回から変化はありません。';
    if (diff > 0) return `前回より ${diff} 上がっています。`;
    return `前回より ${Math.abs(diff)} 下がっています。`;
  })();

  const lines = sorted
    .map((row) => {
      const date = formatDateOnly(row?.measured_at);
      const value = toNumberOrNull(row?.[key]);
      if (!date || value === null) return null;
      return `・${date}: ${value}`;
    })
    .filter(Boolean);

  const labels = sorted.map((row) => formatShortDate(row?.measured_at));
  const values = sorted.map((row) => toNumberOrNull(row?.[key]));
  const insight = describeLabTrend(label, sorted, key);

  return {
    text: [
      `${label}の推移です。`,
      '',
      `最新: ${formatDateOnly(latest?.measured_at)} / ${latestValue}`,
      trendText,
      insight,
      '',
      '履歴:',
      ...lines,
    ].filter(Boolean).join('\n'),
    messages: [buildLineChartImage(`${label}の推移`, labels, values, label)],
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
    .filter((row) => row.date)
    .slice(-7);

  if (!normalized.length) {
    return {
      text: '食事活動グラフに使えるデータがまだありません。食事や運動を記録すると確認できるようになります。',
      messages: [],
    };
  }

  const totalIntake = normalized.reduce((sum, row) => sum + row.intake_kcal, 0);
  const totalActivity = normalized.reduce((sum, row) => sum + row.activity_kcal, 0);
  const avgNet = round1(normalized.reduce((sum, row) => sum + row.net_kcal, 0) / normalized.length);

  const lines = normalized.map((row) => {
    return `・${row.date} / 摂取 ${row.intake_kcal} kcal / 活動 ${row.activity_kcal} kcal / 差分 ${row.net_kcal} kcal`;
  });

  const labels = normalized.map((row) => formatShortDate(row.date));
  const intakeSeries = normalized.map((row) => row.intake_kcal);
  const activitySeries = normalized.map((row) => row.activity_kcal);
  const insight = describeEnergyTrend(normalized);

  return {
    text: [
      '直近の食事・活動の流れです。',
      '',
      `合計摂取: ${Math.round(totalIntake)} kcal`,
      `合計活動: ${Math.round(totalActivity)} kcal`,
      `1日平均差分: ${avgNet} kcal`,
      insight,
      '',
      '履歴:',
      ...lines,
    ].join('\n'),
    messages: [
      buildDualLineChartImage(
        '食事と活動の推移',
        labels,
        intakeSeries,
        activitySeries,
        '摂取kcal',
        '活動kcal',
        'kcal'
      ),
    ],
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
    })
    .slice(-12);

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
    const diff = round1(latestValue - prevValue);
    if (diff === 0) return '前回から変化はありません。';
    if (diff > 0) return `前回より ${diff}kg 増えています。`;
    return `前回より ${Math.abs(diff)}kg 減っています。`;
  })();

  const totalDiffText = (() => {
    if (latestValue === null || firstValue === null || sorted.length < 2) return null;
    const diff = round1(latestValue - firstValue);
    if (diff === 0) return '初回からの変化はありません。';
    if (diff > 0) return `初回から ${diff}kg 増えています。`;
    return `初回から ${Math.abs(diff)}kg 減っています。`;
  })();

  const lines = sorted
    .map((row) => {
      const date = formatDateOnly(row?.measured_at);
      const value = toNumberOrNull(row?.weight_kg);
      if (!date || value === null) return null;
      return `・${date}: ${value}kg`;
    })
    .filter(Boolean);

  const labels = sorted.map((row) => formatShortDate(row?.measured_at));
  const values = sorted.map((row) => toNumberOrNull(row?.weight_kg));
  const insight = describeWeightTrend(sorted);

  return {
    text: [
      '体重の推移です。',
      '',
      `最新: ${formatDateOnly(latest?.measured_at)} / ${latestValue}kg`,
      dayDiffText,
      totalDiffText,
      insight,
      '',
      '履歴:',
      ...lines,
    ].filter(Boolean).join('\n'),
    messages: [buildLineChartImage('体重の推移', labels, values, 'kg')],
  };
}

module.exports = {
  buildLabGraphMessage,
  buildEnergyGraphMessage,
  buildWeightGraphMessage,
  buildGraphMenuQuickReplies,
};