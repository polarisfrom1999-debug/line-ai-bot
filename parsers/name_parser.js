const NAME_INVALID_WORDS = [
  '痛い', 'いたい', '痛み', 'つらい', '辛い', 'だるい', 'しびれ', '痺れ',
  '腰', '膝', '肩', '首', '頭', '背中', '足', '脚', '腕', '肘', '手', '胸', 'お腹', '腹',
  '苦しい', '重い', '張る', 'むくみ', '腫れ', '熱', '咳', '発熱',
  '食べた', '飲んだ', '食事', '朝食', '昼食', '夕食',
  '運動', '歩いた', '走った', '睡眠', '水分',
];

function normalizeStoredDisplayName(name) {
  let value = String(name || '').trim();

  value = value
    .replace(/^[「『【\[\(]+/, '')
    .replace(/[」』】\]\)]+$/, '')
    .trim();

  value = value
    .replace(/(さん|ちゃん|くん|君)$/i, '')
    .replace(/(です|だよ|だ)$/i, '')
    .trim();

  if (!value) return '';
  if (NAME_INVALID_WORDS.some((w) => value.includes(w))) return '';
  if (value.length > 20) return '';

  return value;
}

function parseDisplayName(text) {
  const trimmed = String(text || '').trim();
  if (!trimmed) return null;

  const explicitOnly = [
    /^名前[は：:\s]*([^\n]{1,40})$/i,
    /^名前[：:\s]+([^\n]{1,40})$/i,
    /^私の名前は\s*([^\n]{1,40})$/i,
    /^わたしの名前は\s*([^\n]{1,40})$/i,
    /^ニックネーム[は：:\s]*([^\n]{1,40})$/i,
    /^ニックネーム[：:\s]+([^\n]{1,40})$/i,
    /^([^\n]{1,40})と呼んでください$/i,
    /^([^\n]{1,40})と呼んでね$/i,
    /^([^\n]{1,40})と呼んで$/i,
  ];

  let candidate = null;

  for (const regex of explicitOnly) {
    const m = trimmed.match(regex);
    if (m?.[1]) {
      candidate = m[1].trim();
      break;
    }
  }

  if (!candidate) return null;

  candidate = candidate
    .replace(/^[「『【\[\(]+/, '')
    .replace(/[」』】\]\)]+$/, '')
    .trim();

  candidate = candidate
    .replace(/(です|だよ|です。|だ。)$/i, '')
    .replace(/(さん|ちゃん|くん|君)$/i, '')
    .trim();

  candidate = candidate
    .replace(/[。、,.!！?？]+$/g, '')
    .trim();

  if (!candidate) return null;
  if (candidate.length > 20) return null;
  if (/\s{2,}/.test(candidate)) return null;
  if (NAME_INVALID_WORDS.some((w) => candidate.includes(w))) return null;

  if (/^(私|わたし|僕|ぼく|俺|自分)$/i.test(candidate)) return null;
  if (/^(です|ました|ください)$/i.test(candidate)) return null;

  return candidate;
}

function getUserDisplayName(user) {
  const raw = String(user?.display_name || '').trim();
  return normalizeStoredDisplayName(raw);
}

module.exports = {
  NAME_INVALID_WORDS,
  normalizeStoredDisplayName,
  parseDisplayName,
  getUserDisplayName,
};