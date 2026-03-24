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
    /^(\d{2,3})(\.\d+)?$/.test(t)
  );
}

function parseWeightLog(text) {
  const t = String(text || '').trim();

  const weight = extractNumber(t);
  const bodyFat = extractBodyFat(t);

  if (weight == null) return null;
  if (weight < 20 || weight > 300) return null;

  return {
    weight_kg: weight,
    body_fat_pct: bodyFat != null && bodyFat >= 1 && bodyFat <= 80 ? bodyFat : null,
  };
}

function buildWeightSaveMessage(log) {
  const lines = [
    '体重を記録しました。',
    `体重: ${log.weight_kg} kg`,
    log.body_fat_pct != null ? `体脂肪率: ${log.body_fat_pct} %` : null,
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