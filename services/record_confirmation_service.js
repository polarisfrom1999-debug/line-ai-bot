'use strict';

function formatNumber(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return '';
  return Number.isInteger(n) ? String(n) : String(Math.round(n * 10) / 10);
}

function buildConfirmationMessage(candidate = {}) {
  const type = String(candidate?.type || '').trim();
  const payload = candidate?.parsed_payload || {};

  if (type === 'weight') {
    const value = formatNumber(payload.weight_kg);
    return {
      text: value
        ? `体重${value}kgで受け取っています。今日の記録としてこのまま残して大丈夫ですか？`
        : '体重の内容は受け取れています。このまま記録して大丈夫ですか？',
    };
  }

  if (type === 'body_fat') {
    const value = formatNumber(payload.body_fat_percent || payload.body_fat_pct);
    return {
      text: value
        ? `体脂肪率${value}%で受け取れています。このまま記録して大丈夫ですか？`
        : '体脂肪率の内容は受け取れています。このまま記録して大丈夫ですか？',
    };
  }

  if (type === 'meal') {
    return {
      text: '食事の内容は受け取れています。今日の記録としてまとめてよければ保存しますか？違うところだけ、そのまま教えても大丈夫です。',
    };
  }

  if (type === 'exercise') {
    return {
      text: '運動の内容は受け取れています。このまま今日の記録として残して大丈夫ですか？',
    };
  }

  if (type === 'blood_test') {
    return {
      text: '血液検査の内容は受け取れています。このまま整理を進めて大丈夫ですか？必要なら日付や数値だけ追加で教えてください。',
    };
  }

  return {
    text: '内容は受け取れています。このまま記録して大丈夫ですか？',
  };
}

module.exports = {
  buildConfirmationMessage,
};
