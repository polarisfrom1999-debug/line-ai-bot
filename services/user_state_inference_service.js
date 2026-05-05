'use strict';

function normalizeText(v) {
  return String(v || '').trim();
}

function inferUserStateSignals(params = {}) {
  const text = normalizeText(params.userText).toLowerCase();
  const recentUncertaintySignals = Array.isArray(params.recentUncertaintySignals) ? params.recentUncertaintySignals : [];

  const hasUncertainWords = /(たぶん|くらい|かも|覚えてない|まあいいや|うろ覚え|曖昧|わからない)/.test(text);
  const possibleConfusion = hasUncertainWords || recentUncertaintySignals.length >= 2;
  const possibleUnderreporting = /(あんまり食べてない|食べてない|少しだけ|ほぼ食べてない)/.test(text) && /(食事|食べ)/.test(text);
  const possibleGuiltOrShame = /(ごめん|罪悪感|だめだった|サボった|隠したい)/.test(text) || (possibleUnderreporting && hasUncertainWords);
  const possibleOverexertion = /(まだ足りない|もっとやる|追い込|限界まで|休まない)/.test(text);
  const possibleFatigue = /(疲れ|しんどい|だるい|眠い|寝不足|へとへと)/.test(text);
  const possiblePainOrDiscomfort = /(痛い|痛み|違和感|重い|しびれ|張り)/.test(text);

  return {
    possible_underreporting: Boolean(possibleUnderreporting),
    possible_overexertion: Boolean(possibleOverexertion),
    possible_confusion: Boolean(possibleConfusion),
    possible_guilt_or_shame: Boolean(possibleGuiltOrShame),
    possible_fatigue: Boolean(possibleFatigue),
    possible_pain_or_discomfort: Boolean(possiblePainOrDiscomfort),
  };
}

module.exports = {
  inferUserStateSignals,
};

