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
    Number.isFinite(Number(log?.weight_kg)) ? `体重: ${Number(log.weight_kg)} kg` : null,
    Number.isFinite(Number(log?.body_fat_pct)) ? `体脂肪率: ${Number(log.body_fat_pct)} %` : null,
    '小さく続けることが大事です。',
  ].filter(Boolean);

  return {
    text: lines.join('\n'),
    quickReplies: ['体重グラフ', '予測', '食事を記録', '少し歩いた'],
  };
}

function buildBodyFatSaveMessage(log) {
  const lines = [
    '体脂肪率を記録しました。',
    Number.isFinite(Number(log?.body_fat_pct)) ? `体脂肪率: ${Number(log.body_fat_pct)} %` : null,
    '体重も測れた日は、続けて送っても大丈夫です。',
  ].filter(Boolean);

  return {
    text: lines.join('\n'),
    quickReplies: ['体重 62.4', '体重グラフ', '予測'],
  };
}

module.exports = {
  isWeightIntent,
  parseWeightLog,
  buildWeightSaveMessage,
  buildBodyFatSaveMessage,
};
