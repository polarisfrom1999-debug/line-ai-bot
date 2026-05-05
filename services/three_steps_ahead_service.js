'use strict';

function buildThreeStepsAhead(params = {}) {
  const intent = String(params?.intent || '');
  const text = String(params?.userText || '');
  const changes = Array.isArray(params?.microChanges) ? params.microChanges : [];
  const pattern = params?.patternInsight || {};

  if (/body_condition/.test(intent) || /(痛い|重い|違和感|しびれ)/.test(text)) {
    return '今日は負荷を増やすより、軽い散歩やストレッチ程度で様子を見るのが安心です。';
  }
  if (/exercise/.test(intent)) {
    return '次は量を増やすより、同じ強度を気持ちよく続ける方が明日に繋がりやすいです。';
  }
  if (/meal/.test(intent) && pattern?.routine_disruption_detected) {
    if (pattern?.user_may_feel_anxious_about_change) {
      return 'いつもの形が崩れた日は落ち着かないですよね。今日は代替で十分なので、戻せるときにいつもの流れへ戻しましょう。';
    }
    return 'いつものメニューと違う日は、合うかどうかの体感を優先して大丈夫です。合わなければいつもの形に戻して問題ありません。';
  }
  if (/meal/.test(intent) && pattern?.stable_routine_detected && !pattern?.suggest_micro_adjustment_only) {
    return '今の安定したリズムは強みです。無理に変えず、この形を守ることを優先していきましょう。';
  }
  if (/meal/.test(intent) && changes.some((c) => /脂質/.test(c))) {
    return '次の食事は魚・豆腐・鶏肉寄りにすると、体の重さが出にくくなります。';
  }
  if (/meal/.test(intent) && pattern?.suggest_micro_adjustment_only) {
    return '今の形は崩さず、卵・ヨーグルト・豆腐のどれかを少し足すくらいの小さな調整で十分です。';
  }
  if (/meal/.test(intent)) {
    return '次に食べる時は、たんぱく質か温かい汁物を少し足すだけでも安定しやすいです。';
  }
  return '次の一歩は小さくて十分です。続けられる形を優先していきましょう。';
}

module.exports = {
  buildThreeStepsAhead,
};

