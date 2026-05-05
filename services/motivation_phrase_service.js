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
      '内容の選び方が丁寧で、体を整える意図が見えています。',
      'この組み合わせは、続ける前提としてかなり現実的です。',
      '数値以上に、崩れすぎていないのが良いポイントです。'
    ]);
  }
  if (/exercise/.test(intent)) {
    return pickBySeed(seed, [
      '短時間でも積み上げられているのが強みです。',
      '今日はもう「やれた日」として十分に価値があります。',
      '勢いだけでなく、継続できる形になっているのが良いです。'
    ]);
  }
  if (/body_condition/.test(intent)) {
    return pickBySeed(seed, [
      '違和感に気づいて言葉にできたのは、とても良い判断です。',
      '体調を早めに共有できるのは、整える力そのものです。'
    ]);
  }
  return pickBySeed(seed, [
    '今の伝え方で十分です。必要なところから一緒に整えていけます。',
    '小さい報告でも流れが見えるので、ちゃんと意味があります。'
  ]);
}

module.exports = {
  buildMotivationPhrase,
};

