'use strict';

function buildNextStepSupport(judgment = {}, context = {}) {
  const style = String(judgment?.support_style || 'normal');
  const intent = String(judgment?.surface_intent || '');
  if (style === 'rest') return '今日は負荷を増やすより、回復を優先するのが安全です。';
  if (style === 'caution') return '無理に上積みせず、次の1回は軽めにして様子を見ましょう。';
  if (style === 'reassure') return '責めるための記録ではないので、続けられる形で残せば十分です。';
  if (intent === 'meal_record_text') return '次の食事でたんぱく質を少し足すと、反動を抑えやすいです。';
  if (intent === 'exercise_record') return '記録できた流れが一番大事です。次は回復もセットでいきましょう。';
  return '今の流れを崩さず、次に続けられる1つだけで大丈夫です。';
}

module.exports = {
  buildNextStepSupport,
};

