function buildQuickChartUrl(config) {
  return `https://quickchart.io/chart?c=${encodeURIComponent(JSON.stringify(config))}`;
}

function buildImageMessage(url) {
  return {
    type: 'image',
    originalContentUrl: url,
    previewImageUrl: url,
  };
}

function shortDateLabel(dateText) {
  const s = String(dateText || '');
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s.slice(5).replace('-', '/');
  return s;
}

function buildLabGraphMessage(rows = [], metric = 'hba1c') {
  const labelMap = {
    hba1c: 'HbA1c',
    ldl: 'LDL',
    hdl: 'HDL',
    triglycerides: 'TG',
    fasting_glucose: '血糖',
  };

  const filtered = (rows || [])
    .filter((r) => r && r[metric] != null && r.measured_at)
    .sort((a, b) => String(a.measured_at).localeCompare(String(b.measured_at)))
    .slice(-8);

  if (!filtered.length) {
    return {
      text: `${labelMap[metric] || metric} のグラフに使えるデータがまだありません。`,
      messages: [],
    };
  }

  const labels = filtered.map((r) => shortDateLabel(String(r.measured_at).slice(0, 10)));
  const data = filtered.map((r) => Number(r[metric]));

  const chartConfig = {
    type: 'line',
    data: {
      labels,
      datasets: [
        {
          label: labelMap[metric] || metric,
          data,
          fill: false,
        },
      ],
    },
    options: {
      plugins: {
        title: {
          display: true,
          text: `${labelMap[metric] || metric} 推移`,
        },
        legend: {
          display: true,
        },
      },
      scales: {
        y: {
          beginAtZero: false,
        },
      },
    },
  };

  const url = buildQuickChartUrl(chartConfig);

  return {
    text: `${labelMap[metric] || metric} の推移グラフです。`,
    messages: [buildImageMessage(url)],
  };
}

function buildEnergyGraphMessage(dayRows = []) {
  const sorted = (dayRows || [])
    .sort((a, b) => String(a.date).localeCompare(String(b.date)))
    .slice(-7);

  if (!sorted.length) {
    return {
      text: '食事や活動のグラフに使えるデータがまだありません。',
      messages: [],
    };
  }

  const labels = sorted.map((r) => shortDateLabel(r.date));
  const intake = sorted.map((r) => Number(r.intake_kcal || 0));
  const activity = sorted.map((r) => Number(r.activity_kcal || 0));
  const balance = sorted.map((r) => Number(r.net_kcal || 0));

  const chartConfig = {
    type: 'bar',
    data: {
      labels,
      datasets: [
        {
          label: '摂取kcal',
          data: intake,
        },
        {
          label: '活動消費kcal',
          data: activity,
        },
        {
          label: '収支kcal',
          data: balance,
          type: 'line',
        },
      ],
    },
    options: {
      plugins: {
        title: {
          display: true,
          text: '7日間の食事・活動・収支',
        },
        legend: {
          display: true,
        },
      },
      scales: {
        y: {
          beginAtZero: true,
        },
      },
    },
  };

  const url = buildQuickChartUrl(chartConfig);

  return {
    text: '7日間の食事・活動・収支グラフです。',
    messages: [buildImageMessage(url)],
  };
}

function buildGraphMenuQuickReplies() {
  return ['血液検査グラフ', '食事活動グラフ', 'HbA1cグラフ', 'LDLグラフ', '予測'];
}

module.exports = {
  buildLabGraphMessage,
  buildEnergyGraphMessage,
  buildGraphMenuQuickReplies,
};