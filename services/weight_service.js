function extractNumber(text) {
  const m = String(text || '').match(/(\d{2,3}(?:\.\d+)?)/);
  return m ? Number(m[1]) : null;
}

function extractBodyFat(text) {
  const m = String(text || '').match(/体脂肪(?:率)?\s*[:：]?\s*(\d{1,2}(?:\.\d+)?)/);
  return m ? Number(m[1]) : null;
}

function isWeightIntent(text) {
  const t = String(text || '').trim();
  return (
    /体重/.test(t) ||
    /kg/i.test(t) ||
    /キロ/.test(t) ||
    /今朝/.test(t) ||
    /今夜/.test(t) ||
    /昨日/.test(t) ||
    /今日/.test(t) ||
    /朝/.test(t) ||
    /^\d{2,3}(?:\.\d+)?$/.test(t)
  );
}

function parseWeightLog(text) {
  const t = String(text || '').trim();

  const weight = extractNumber(t);
  const bodyFat = /体脂肪|%|％/.test(t) ? extractBodyFat(t) : null;

  if (weight == null) return null;
  if (weight < 20 || weight > 300) return null;

  return {
    weight_kg: weight,
    body_fat_pct: bodyFat != null && bodyFat >= 1 && bodyFat <= 80 ? bodyFat : null,
  };
}

function buildWeightSaveMessage(log) {
  const bodyFat = Number.isFinite(Number(log?.body_fat_pct)) ? Number(log.body_fat_pct) : null;
  const lines = [
    '体重を記録しました。',
    `体重: ${log.weight_kg} kg`,
    bodyFat != null ? `体脂肪率: ${bodyFat} %` : null,
    '小さく続けることが大事です。',
  ].filter(Boolean);

  return {
    text: lines.join('\n'),
    quickReplies: ['体重グラフ', '予測', '食事を記録', '少し歩いた'],
  };
}

module.exports = {
  isWeightIntent,
  parseWeightLog,
  buildWeightSaveMessage,
};
