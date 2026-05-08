'use strict';

function pickBySeed(seed, arr) {
  const list = Array.isArray(arr) ? arr.filter(Boolean) : [];
  if (!list.length) return '';
  const idx = Math.abs(Number(seed || 0)) % list.length;
  return list[idx];
}

function hashText(value) {
  const s = String(value || '');
  let h = 0;
  for (let i = 0; i < s.length; i += 1) h = ((h << 5) - h) + s.charCodeAt(i);
  return Math.abs(h || 0);
}

function buildMotivationPhrase(params = {}) {
  const intent = String(params?.intent || '');
  const seed = hashText(`${params?.userId || ''}:${params?.userText || ''}:${intent}`);
  if (/meal/.test(intent)) {
    return pickBySeed(seed, [
      '何を食べたか、ちゃんと見えています。責めるためではなく、流れを見るためのメモです。',
      'この選び方は、続けられる現実感があります。',
      '崩れすぎていないのが、いちばん大事なサインです。'
    ]);
  }
  if (/exercise/.test(intent)) {
    return pickBySeed(seed, [
      '短時間でも、積み上がりはちゃんと意味があります。',
      '今日はもう「動けた日」として十分です。',
      '勢いより、明日につながる形を選べているのが良いです。'
    ]);
  }
  if (/body_condition/.test(intent)) {
    return pickBySeed(seed, [
      '違和感に気づけたのは、体とちゃんと向き合えているサインです。',
      '早めに言葉にしてくれたおかげで、こちらも寄り添いやすいです。'
    ]);
  }
  return pickBySeed(seed, [
    '一文でも、今のあなたの様子が伝わってきます。',
    '言いにくいことほど、短くでいいので送ってみてください。'
  ]);
}

module.exports = {
  buildMotivationPhrase,
};

